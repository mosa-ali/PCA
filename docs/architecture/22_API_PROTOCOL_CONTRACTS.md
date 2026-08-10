# 22 — API and Protocol Contracts

Owning agent: **PCA-DOC-F**. These are documentation-safe contracts: they specify security, state, and compatibility constraints before endpoint, schema, transport, or cryptographic-suite implementation. They do not create a readable central family-history API.

## 1. Trust-plane separation

There are two deliberately separate planes.

| Plane | Purpose | Authority | Forbidden capability |
|---|---|---|---|
| Service control plane | Account/license, enrollment-token lifecycle, public-key directory, release metadata, opaque Relay routing | Service account/session authorization | Reading or generating family policy/activity plaintext; signing a family policy. |
| Family E2EE plane | Policy, receipt, activity summary, location response, tamper/recovery/deletion instruction | Current FTS-authorized DSK and recipient DEK/FDEK material | Treating a service token, Relay delivery, or push notification as family authorization. |

PCA-API-001: a service token MAY authorize issuance of an enrollment token or retrieval of an opaque envelope, but MUST NOT make a policy envelope valid. Recipients independently verify the doc 09 FTS, signature, expiry, replay ledger, policy/key/trust epochs and role.

## 2. Service interfaces (logical only)

| Group | Request purpose | Minimum response / invariant |
|---|---|---|
| Enrollment | Create/redeem a single-use, short-lived invitation; submit device public DSK/DEK and fingerprint; confirm pairing | No private key, RS, RWK, FDEK, activity or policy plaintext accepted. |
| Device directory | Get current public trust/discovery material necessary to route a pairing/recovery transition | Public keys only; FTS validity still verified by receiving family device. |
| License/release | Entitlement, supported-version gate, signed app/model/rule-package metadata, rollout/rollback channel | Does not expose family monitoring content. Package metadata is independently signature/checksum verified. |
| Relay | Submit, poll/retrieve, acknowledge, and expire an opaque envelope | Opaque device routing IDs, ciphertext, bounded TTL/delivery outcome only; no payload indexing/search. |
| Recovery availability | Retrieve/store opaque recovery envelope and transaction delivery receipt | Service never receives RS/RWK or plaintext contents; `recoveryTransactionId` is one-time. |

All service requests authenticate over standard secure transport; exact authentication and rate-limit choices are an implementation security-review decision. Error bodies and logs MUST be metadata-minimized and never echo supplied ciphertext, recovery material, URL, activity or location.

## 3. Family envelope wire contract

The family envelope follows doc 09 §4. A serialization is acceptable only if it preserves every signed field exactly. It has the following logical shape:

```text
FamilyEnvelope {
  protocolMajor, protocolMinor, messageId, familyOpaqueId,
  senderDeviceOpaqueId, recipientDeviceOpaqueId | recipientGroup,
  senderKeyId, messageType, trustSetEpoch, keyEpoch,
  senderSequence | replayNonce, issuedAtUtc, expiresAtUtc,
  semanticVersion, correlationId?, encryptedPayload, signature
}
```

`signature` covers all preceding envelope fields, including routing/epoch/expiry/version metadata. `encryptedPayload` is authenticated encryption under the approved doc 09 construction. `messageId` is globally unique for idempotency; `senderSequence` is monotonic per sender key or an equivalent bounded replay-resistant nonce mechanism. Identifiers are opaque and MUST NOT be reused as readable central-schema identifiers.

PCA-API-002: receiver checks are independent and mandatory: parse/schema bounds; protocol compatibility; FTS/key lookup; sender role; signature; anti-replay; expiry; trust/key epoch; semantic ordering; decrypt/authenticate payload; payload schema and authorization. Failure of any check rejects the envelope, records a doc 21 anomaly where appropriate, and leaves the last-valid state in place.

## 4. Message types and semantics

| Type | Authorized sender → recipient | Semantic version / idempotent effect |
|---|---|---|
| `POLICY_UPDATE` | Authorized parent → child | Strictly increasing policy version; child applies once then issues receipt. |
| `POLICY_RECEIPT` | Child → parent | Names policy version, result, timestamp; parent shows pending until received. |
| `STATUS_SNAPSHOT` | Child → authorized parent | Latest status only; not proof that a later pending policy is enforced. |
| `ACTIVITY_SUMMARY`, `LOCATION_RESPONSE` | Child → authorized parent | Retention-scoped family content; never readable to Relay. |
| `CHILD_REQUEST`, `PARENT_DECISION` | Child ↔ authorized parent | Correlated request/decision; decision expires and cannot be replayed. |
| `TAMPER_ALERT` | Child → authorized parent | References doc 21 condition/state; alert acknowledgement does not alter enforcement state. |
| `RETENTION_DELETION_INSTRUCTION`, `RETENTION_RECEIPT` | Authorized parent → device → parent | One-time deletion ID; duplicates are no-ops with same completion result. |
| `FTS_UPDATE`, `KEY_ROTATION`, `DEVICE_REVOKE` | Authorized FTS/recovery actor → family devices | Advance epoch; revoked key is never accepted for future control. |
| `RECOVERY_TRANSACTION` | Recovery-authorized replacement → relay/family | One-time `recoveryTransactionId`; creates next FTS/key epoch only after full verification. |
| `SIGNED_ROLLBACK` | Explicitly authorized parent → target | Distinct, time-bounded exception naming exact target/reason/one-time ID; never inferred from lower policy version. |

No `activity-history:list`, server-side search, plaintext diagnostics, screenshot, microphone, message-content, or generic remote-command message type exists.

## 5. Ordering, offline operation and expiry

Family devices process semantic dependencies, not Relay arrival order. A future policy can wait for a signed predecessor until expiry; it MUST NOT skip an intervening version. A device that cannot obtain the required FTS/key epoch is `EPOCH_STALE` or `DEVICE_OFFLINE`; it continues its last valid local policy but cannot exercise new control authority. The parent UI distinguishes Live, Offline/last seen, Sync overdue/policy stale, and confirmed receipt.

Relay queue TTL is short operational availability (doc 11 proposes a maximum seven days), independent of activity retention. When a queue item expires, the sender re-enqueues a still-valid instruction after reconnect; expiry never converts a pending action into success. Push is opaque wake-up only.

## 6. Compatibility and evolution

- `protocolMajor` incompatibility: reject without decrypting/applying, enter upgrade-required/degraded presentation, retain last-valid policy.
- Higher unknown `protocolMinor`: accept only if required fields/types are known and signature coverage is preserved; ignore explicitly extensible unknown fields, never unknown security semantics.
- New message types require a documented authorization matrix, retention classification, privacy review, negative tests and doc 33 source/capability review before use.
- Envelope and payload size/depth/field limits are mandatory implementation limits to prevent parser/resource exhaustion; violations are rejected without verbose logging.
- A rollback is a message type, not a relaxed monotonicity check.

## 7. Contract test matrix

| Test | Expected result |
|---|---|
| Valid signed policy delivered twice | Exactly one application and stable receipt. |
| Valid old/replayed, expired, lower-version ordinary policy | Reject; last-valid policy remains. |
| Valid signature from revoked DSK or wrong FTS/key epoch | Reject before payload application. |
| Service session attempts to submit a forged policy | Cannot create a family-valid signature or authority. |
| Offline child receives ordered N+2 before N+1 | Holds pending until predecessor/expiry; never skips state. |
| Repeated deletion/recovery transaction ID | Idempotent completion for deletion; recovery accepted once only. |
| Protocol-major mismatch/oversized envelope | Safe reject, no data leak, actionable upgrade/degraded state. |
| Central logs and push payload inspection | No readable family content. |

## 8. Dependencies and source handoff

Doc 09 is authoritative for cryptographic fields and acceptance checks; doc 05 owns system transport/offline presentation; doc 08 owns lifecycle; docs 11/21 own deletion/recovery semantics. `SRC-H-F-024`: IETF [RFC 9180, HPKE](https://www.rfc-editor.org/rfc/rfc9180), verified 2026-08-10, is supplied to doc 33 as a primary reference for the candidate device-envelope construction only; exact suite remains security-review controlled. `SRC-H-F-025`: IETF [RFC 5116](https://www.rfc-editor.org/rfc/rfc5116), verified 2026-08-10, supports the AEAD interface/property baseline; it does not authorize custom cryptography.
