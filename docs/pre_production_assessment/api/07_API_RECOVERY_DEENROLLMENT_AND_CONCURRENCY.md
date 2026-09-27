# 07 — API Recovery, De-enrollment & Concurrency

Evidence: `[READ]` source + deep-dive (`raw/subagent_policy_lifecycle.md`,
`raw/subagent_enrollment_proof.md`).

## 1. Recovery / retry / idempotency

- **Enrollment recovery is strong**: attempt PK + UNIQUE recovery-token hash
  (`migrations/0003:92-93`); one transaction spans invitation + device + attempt
  (`MySqlEnrollmentCoordinatorRepository.ts:50-56,90`); conflicts roll back the
  whole transaction (`:188-191`); `/recover` is read-only and oracle-free
  (`EnrollmentCoordinator.ts:186-210`); exact-replay returns the original
  result (`:116-132`).
- **Durable action ledger**: `action_idempotency_ledger`
  (`migrations/0047:54-74`, PK `(scope, idempotency_key)`, 64-hex fingerprint)
  is consumed by `ParentActionAuthorizationService.authorize`
  (`ParentActionAuthorizationService.ts:120-137`) and the delete-now path
  (`retentionRoutes.ts:240-247`, durable since migration 0040).
  **Caveat**: mobile/parent action routes mint the key server-side
  (`childPolicyRoutes.ts:173-174`), so only in-request duplication is
  deduplicated, not client retries with distinct requests (API-F10).
- **Known rough edge**: post-commit failure can 500 after the enrollment is
  already committed (slot/audit after tx) — recoverable via `/recover`
  (API-F08).

## 2. De-enrollment / revocation — server paths that exist

| Path | Mechanism | Authority |
|---|---|---|
| Invitation revoke | `POST /v1/families/:familyId/invitations/:invitationId/revoke` — PENDING→REVOKED, slot released (`invitationRoutes.ts:211-223`; `InvitationService.ts:296,313-316`) | ADMINISTRATOR + `REVOKE_INVITATION` + fresh step-up `family.device.enrollment.revoke` |
| Device revocation | RemovalDecisionAuthority `ALLOW_REMOVAL` → device + all ACTIVE keys REVOKED atomically, idempotent, crash-safe sweep (`MySqlDeviceRepository.ts:131-157`; `RemovalDecisionAuthority.ts:715-741`) | parent decision flow (PIN / authorized recovery / signed remote) |
| Parent session revoke-all | `POST /api/parent/sessions/revoke-all` (`parentAccountRoutes.ts:654-679`) | parent session |
| Member removal | clears family/seat atomically (`familyMemberRoutes.ts:258-275`) | ADMIN + step-up |

## 3. De-enrollment gaps (the honest list)

1. **No device-session revocation caller** — `DeviceSessionService.revokeSession`
   (`:154`) is dead; a REVOKED device's already-issued bearer token remains
   valid until its 1 h TTL (`:112-117`). (API-F03)
2. **No device-initiated unenroll/self-revoke route** and **no
   return-to-unenrolled state** — no `DELETE FROM devices`, no revival to
   `PAIRING_PENDING`; revocation is parent-driven only (grep
   `unenroll|deregister|unpair|remove-device` in `backend/src` → none).
   (API-F04)
3. **No child-side ack** for retention delete-now (API-F12 note in report 06 §2).

So: can Android/iOS "reliably return to an unenrolled state"? **Not today** —
a parent can revoke a device, but the device cannot initiate it, cannot fully
confirm it, and retains a live token for up to an hour.

## 4. Transactional integrity & concurrency

- Enrollment: single tx + row locks (invitation `FOR UPDATE`; attempt PK/unique)
  — solid against double-creation/replay.
- Revocation: one repository transaction for device+keys — solid.
- Relay: queue insert single-row; ack conditional UPDATE — solid; no
  surrounding multi-step transaction needed.
- Confirmed risks: post-commit slot/audit (API-F08); non-expiring attempt rows
  (API-F11); server-side idempotency keys (API-F10).
- Constraint support for concurrency: `SOURCE_SCHEMA_SUPPORTS_API = YES`,
  `MIGRATIONS_SUPPORT_API = YES`, `CONSTRAINTS_SUPPORT_CONCURRENCY = YES`
  (unique keys + row locks + conditional updates; see cited migrations).

## 5. Verdicts

```text
API_MOBILE_RECOVERY = PASS      (with API-F08/F10/F11 as non-blocking defects)
API_DEENROLLMENT    = PARTIAL   (revocation exists; session revocation + device-initiated unenroll + unenrolled state absent)
```
