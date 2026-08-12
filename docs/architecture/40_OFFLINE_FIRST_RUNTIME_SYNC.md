# 40. Offline-First Runtime Sync (PCA-16)

Status: implemented (runtime plumbing) / crypto suite PENDING_HUMAN_SECURITY_REVIEW.

## 1. Problem

PCA must work fully offline (local enforcement never depends on connectivity)
and must converge safely with family endpoints whenever connectivity returns.
This lane wires a **runtime** layer across three processes -- Android child
runtime, backend HTTP relay surface, and a browser-neutral parent SDK -- on
top of infrastructure other lanes already built and own:

- `backend/src/relay/*` (PCA-09/10) -- ciphertext-blind store-and-forward.
- `backend/src/familyenvelope/*` (PCA-09/22) -- envelope parse/verify
  (protocol, replay, epoch, version, signature).
- `backend/src/familysync/*` (PCA-11) -- `SyncCoordinator` (dependency-hold
  ordering on top of the verifier) and `computeSyncConnectionState`.
- `android/.../persistence/sync/SyncOutboxRepository` /
  `SyncReceiptRepository` (PCA-12) -- durable, Room-backed local queue and
  inbound dedupe/ordering.

This module does not reimplement any of the above. It adds exactly the
missing runtime glue: HTTP exposure with device-level auth, bounded
batch/backoff/priority delivery, connectivity observation, and thin
client SDKs, on both ends of the relay.

## 2. Connection states

Reused verbatim from `backend/src/familysync/connectionState.ts`
(`computeSyncConnectionState`) and mirrored with the same semantics in the
Android and parent-sdk runtimes:

`OFFLINE | SYNCING | SYNC_PENDING | STALE | LIVE`

`LIVE` requires both a connected transport AND a recent successful
convergence -- transport connectivity alone is never reported as `LIVE`.
`STALE` fires when the last successful sync is older than the (configurable,
default 24h) threshold, so a long offline period surfaces honestly in the
remote/parent view without disabling local enforcement (which never reads
this state).

## 3. Device-level HTTP auth (new: `DeviceSessionService`)

`backend/src/deviceauth/DeviceAuthService` proves possession of a device's
DSK but deliberately issues no session (its own doc comment defers this).
`backend/src/runtime-sync/DeviceSessionService.ts` closes that gap: it
composes `DeviceAuthService` (challenge/response, unmodified) with a new,
short-lived opaque session token (`auth/token.ts`'s existing
generate/hash primitives, reused not duplicated) scoped to
`(deviceId, familyId)`.

Enumeration-safety: `issueChallengeSafely` never lets an HTTP caller learn
whether a given `deviceId` exists, belongs to another family, or is
revoked. A request for a nonexistent/revoked device still receives a
well-formed, syntactically valid (but unresolvable) challenge -- it can
never subsequently complete, but the failure surfaces later, at
`completeChallenge`, collapsed into the exact same generic
`RuntimeSyncAuthError('UNAUTHORIZED')` used for every other failure mode
(wrong signature, expired challenge, ...), mirroring `AuthService`'s
existing single-generic-401 pattern.

## 4. Backend HTTP surface (`backend/src/http/routes/runtimeSyncRoutes.ts`)

All routes require a valid device session (`requireDeviceSession`), which
sets `request.deviceId` / `request.deviceFamilyId` from the *verified*
session -- never from the request body or params.

| Route | Purpose |
|---|---|
| `POST /v1/runtime-sync/devices/:deviceId/challenge` | issue (or fake) a challenge |
| `POST /v1/runtime-sync/devices/:deviceId/session` | complete challenge -> device session token |
| `POST /v1/runtime-sync/outbound` | bounded batch submit of opaque envelopes |
| `GET /v1/runtime-sync/inbound` | list queued opaque envelopes for the caller device |
| `POST /v1/runtime-sync/inbound/:messageId/ack` | acknowledge delivery |
| `GET /v1/runtime-sync/status` | this device's last-known sync status |

**Cross-family IDOR closure (PCA-16 addition):** `RelayService.queueEnvelope`
itself does not check that `recipientDeviceId` actually belongs to
`familyId` -- that is explicitly out of relay's scope (it is
ciphertext-blind, not a family-authority source). The outbound route closes
this: `senderDeviceId`/`familyId` are always taken from the verified
session (never trusted from the body), and `recipientDeviceId` must resolve,
via the existing family-scoped `DeviceRepository.findDeviceForFamily`, to a
real device in the *same* family before an envelope is ever queued. A
cross-family recipient is rejected as `invalid_request`, indistinguishable
from a malformed recipient id. See `backend/test/runtime-sync/http/`.

The backend never decrypts `payload` at any point in this flow (see
`envelopeWireCodec.ts`: it (de)serializes the *wire* `FamilyEnvelope`
structure -- whose `payload` field is always still ciphertext -- to/from the
relay's opaque `Buffer`; it never touches what's inside `payload`).

## 5. Outbound: offline queue -> reconnect delivery

Each side (Android child runtime, parent-sdk) owns its own durable local
outbox (Android: `SyncOutboxRepository`, PCA-12; parent-sdk: caller-supplied
port) and decides bounded batches with the *shared* policy in
`backend/src/runtime-sync/policy.ts` / mirrored `BackoffPolicy.kt`:

- `MAX_BATCH_SIZE` per reconnect delivery attempt (never unbounded drain).
- Priority ordering (`priority.ts` / `PriorityPolicy.kt`) trust/security >
  policy > child/parent decision > receipt > critical state > activity
  summary -- ties broken by enqueue order. This governs which items get the
  bounded batch's slots first; it grants no additional authority (every
  item is still independently verified server-side and receiver-side).
- Bounded exponential backoff with jitter (`backoff.ts` / `BackoffPolicy.kt`,
  same algorithm, independently implemented per runtime since JS and Kotlin
  cannot share code): `min(cap, base * 2^retryCount) * (0.5 + 0.5*rand())`,
  capped, with a hard `MAX_RETRY_COUNT` after which the item is reported
  `EXPIRED`/permanent-failure rather than retried forever.

Idempotency: every envelope carries its own `messageId`; both
`RelayService.queueEnvelope` (relay-level idempotent create) and
`FamilyEnvelopeVerifier`/`SyncCoordinator` (message-id idempotency ledger)
independently guarantee that redelivering the same batch after a flapping
reconnect never double-applies.

## 6. Inbound: reconnect drain

`backend/src/runtime-sync/InboundReconnectService.ts` composes, in order:

1. `RelayService.listQueuedForRecipient` (bounded by relay's own TTL/expiry).
2. `envelopeWireCodec.parseEnvelopeFromRelayCiphertext` (wire parse only).
3. `SyncCoordinator.reconnectDrain` (deterministic `(issuedAt, messageId)`
   ordering, dependency-hold, full security pipeline) -- this module supplies
   `senderPublicKey`/epoch floor as caller-provided inputs (FTS-owned,
   per `FamilyEnvelopeVerifier`'s own documented boundary); it does not
   resolve them itself.
4. `RelayService.acknowledgeEnvelope` for every `APPLY_NOW` outcome.
5. `familysync/receipts.ts` to build local, metadata-only `SyncReceipt`s.

The caller (parent-web, or the Android on-device runtime for the child's own
side) is responsible for decrypting `payload` and dispatching the
authorized result -- this service hands back verified-but-still-encrypted
`FamilyEnvelope`s plus their `SyncDecision`s, never plaintext.

On the Android side, the same shape is mirrored on-device by
`SyncReceiptRepository` (PCA-12, already merged) rather than duplicated --
`ReconnectSyncOrchestrator` (this lane) is the piece that drives inbound
fetch/verify-adapter/apply/ack around it.

## 7. Family Envelope runtime adapter (Android)

`android/.../runtime/sync/envelope/` provides Kotlin data classes mirroring
`backend/src/familyenvelope/types.ts`'s wire shape, JSON wire codec
(`org.json`, already part of the Android SDK -- no new Gradle dependency),
and an `EnvelopeSignatureVerifier` **interface** with the same crypto gate
as the backend:

```
PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW
```

The shipped default implementation (`RejectingEnvelopeSignatureVerifier`)
always returns `false` -- there is no insecure fallback; an unreviewed
crypto suite fails closed, never open.

## 8. Connectivity (Android)

`ConnectivitySource` is a small interface (`observe(): Flow<ConnectivitySignal>`).
`AndroidConnectivityMonitor` implements it via
`ConnectivityManager.NetworkCallback` -- a platform API, not a Gradle
dependency, so it needs no `build.gradle.kts` change. It requires the
`INTERNET`/`ACCESS_NETWORK_STATE` manifest permissions and construction from
an Android `Context`, neither of which this lane may add (`AndroidManifest.xml`
/ `MainActivity.kt` are out of scope per the PCA-16 ownership brief) --
wiring it into the app process is left to whichever lane owns those files.
Connectivity becoming available only *triggers* a reconnect attempt; `LIVE`
is never reported from connectivity alone (see §2).

## 9. Bounded batches / backoff / priority / no reconnect flood

Enforced identically on both runtimes:

- Reconnect drain processes at most `MAX_BATCH_SIZE` outbox items per
  attempt (`policy.ts` / orchestrator).
- A repeated connectivity flap re-triggers delivery, but every item already
  `SENT`/`ACKNOWLEDGED` is not resubmitted (outbox state transition is the
  source of truth, not "network came back"), and every already-applied
  inbound envelope is not re-applied (message-id idempotency, §5/§6) -- see
  `backend/test/runtime-sync/flapping.test.mjs` and the Android flapping
  test.
- A device with pending local work whose retries are still backed off does
  not retry on every single flap-triggered attempt -- `nextRetryAtEpochMillis`
  (existing `SyncOutboxRepository` field) gates it.

## 10. What this lane explicitly does NOT do

- Select a concrete signature/encryption suite (§7).
- Resolve FTS/sender-key/epoch floor (caller-supplied input, §6).
- Decrypt or log `payload` anywhere, on either runtime.
- Add a new relay-readable table or DB migration.
- Touch `AndroidManifest.xml`, `MainActivity.kt`, `build.gradle.kts`,
  `parent-web/**`, `backend/src/relay/**`, `backend/src/familyenvelope/**`,
  or `backend/migrations/**`.
