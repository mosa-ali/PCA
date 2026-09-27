# 04 — API Enrollment & Device Identity

Evidence: `[READ]` source + deep-dive report
(`raw/subagent_enrollment_proof.md`). All `path:line` at current worktree.

## 1. Enrollment lifecycle (server)

- **Route**: `POST /v1/enrollment/bootstrap` (`bootstrapRoutes.ts:54`) with its
  own 30/min IP bucket (`:57`) and 4 KiB body limit (`:6-13`); handler →
  `EnrollmentCoordinator.enrollDevice` (`EnrollmentCoordinator.ts:95-180`) →
  single MySQL transaction (`MySqlEnrollmentCoordinatorRepository.ts:71-214`).
- **Validation (two layers)** — shape: token ≤64 non-empty, platform ∈
  {ANDROID, IOS}, keys non-empty ≤128, `bootstrapAttemptId` 16–64,
  `attemptRecoveryToken` 32–88 → else `400 invalid_request`
  (`bootstrapRoutes.ts:61-79`). Coordinator: token must be canonical 43-char
  base64url (`token.ts:8-10,36-38`); keys canonical base64url 16–256 bytes with
  re-encode check (`publicKey.ts:1-21`); DSK ≠ DEK (`EnrollmentCoordinator.ts:104`);
  attempt shapes (`attempt.ts:10-42`).
- **Identity creation**: server generates `deviceId`, `signingKeyId`,
  `encryptionKeyId` via `randomUUID()` (`EnrollmentCoordinator.ts:111-113`);
  device row `status='PAIRING_PENDING'` (`MySqlEnrollmentCoordinatorRepository.ts:141-145`);
  DSK/DEK rows in `device_public_keys` (`:148-153`; UNIQUE(public_key) →
  `DUPLICATE_KEY` on reuse).
- **Family/child authority comes ONLY from the invitation row** — selected
  `FOR UPDATE` (`:93-96`), copied to the device (`:141-143`) and result
  (`:126-130,198-202`). Caller-supplied family/child values are never authority
  (`bootstrapRoutes.ts:40-51`).
- **Token validation**: lookup by SHA-256 `token_hash` (`token.ts:27-29`),
  row-locked; `NOT_FOUND`/`REVOKED`/expiry (`now >= expires_at`)/platform
  mismatch all fail closed (`EnrollmentCoordinator.ts:96-101,136-137`).
- **Idempotency / replay**: attempt row keyed by client `attempt_id` + hashed
  recovery token, written in the same transaction (`:167-195`); PK/unique
  conflict → `ATTEMPT_CONFLICT` + full rollback (`:188-194`). In `REDEEMED`
  state: exact replay (same token + both keys) returns the original result and
  mints no new device (`:116-132`); different keys → `ATTEMPT_CONFLICT`;
  no attempt row → `ALREADY_REDEEMED` (`:133`). Concurrent first-time attempts
  serialize on the invitation row lock (`:50-53`).
- **Lost-response recovery**: `POST /v1/enrollment/bootstrap/recover`
  (`bootstrapRoutes.ts:116-143`, separate 30/min bucket) is read-only,
  oracle-free (`timingSafeEqual` over hashes; unknown id ≡ wrong token,
  `EnrollmentCoordinator.ts:186-210`), returns the original result +
  `status:'PAIRING_PENDING'`.
- **Post-commit exposure**: slot consumption + success audit run **after** the
  transaction commits (`EnrollmentCoordinator.ts:130-145`); a throw there yields
  HTTP 500 with the enrollment already committed — recoverable via `/recover`
  (defect API-F08). Attempt rows are write-once and **never expire**
  (`migrations/0003_enrollment_bootstrap_attempts.sql:60-107`) — a held
  recovery token can re-read the result indefinitely, rate-limited only
  (API-F11).

## 2. iOS platform policy (finding of this assessment)

- The **invitation minting** route refuses iOS by decision:
  `400 {error:'invalid_request', code:'PLATFORM_ENROLLMENT_UNAVAILABLE'}` with
  no token/row created (`invitationRoutes.ts:113`; regression guard
  `test/invitation/iosEnrollmentUnavailable.test.mjs` — "no iOS host app
  ships"; that guard currently fails against the mid-migration worktree, see
  report 10 §4).
- `bootstrapRoutes.ts` still lists `IOS` in `VALID_PLATFORMS` (`:13`), but with
  iOS invitation minting refused, **no valid iOS token can exist** — the iOS
  bootstrap path is unreachable by construction until the platform decision
  changes.

## 3. Device identity (what the server owns)

| Storage | Columns of note | Migration |
|---|---|---|
| `devices` | `device_id` PK, `family_id`, `platform`, `status` ∈ {PAIRING_PENDING, PAIRED, ACTIVE, REVOKED}, revoke/pair bookkeeping, `registered_by_account_id` | `0001:156-173`, `0026:21` |
| `device_public_keys` | DSK/DEK public keys, status, UNIQUE(public_key) | `0001:175-196` |
| `enrollment_invitations` | family/child/age/policy authority, 8 states, expiry | `0001:129-153`, `0016`, `0019` |
| `enrollment_bootstrap_attempts` | attempt PK, recovery-token hash UNIQUE, keys, device FK | `0003:60-107` |

- **Who may claim**: possession of the single-use invitation token only; the
  device stays `PAIRING_PENDING` until a parent confirms
  (`pairingRoutes.ts:54-66`) — the confirm predicate excludes the account that
  registered it (`MySqlDeviceRepository.ts:275-277`).
- **Cross-family claim impossible**: all device reads/pairing pin `family_id`
  from the authorized session/invitation, never the request
  (`MySqlDeviceRepository.ts:107,275-277`; `DeviceAuthService.ts:122-126`;
  `DeviceSessionService.ts:96-107,142-144`).
- **Revocation**: only via `RemovalDecisionAuthority` (parent decision flow) →
  device + all ACTIVE keys REVOKED atomically (`MySqlDeviceRepository.ts:131-157`).
  No client-supplied authority can override the server.

## 4. Verdicts

```text
API_ENROLLMENT      = PASS        (server contract sound; post-commit 500 + non-expiring attempts are P2/P3 defects)
API_DEVICE_IDENTITY = PASS        (server-owned ids, invitation-derived family, atomic revocation)
```
