# 03 — API Auth, Authority & Family Isolation

Evidence: `[READ]` backend source; subagent deep-dives (full reports in
`.agent-local-artifacts/pca-api-pre-production/raw/subagent_policy_lifecycle.md`
and `subagent_enrollment_proof.md`).

## 1. Session models (API side)

- **Parent/browser sessions**: opaque service-session cookie validated by
  `auth/fastifyAuthPlugin.ts`; family and role are **re-resolved per request**
  from server state (`ParentAccountService.ts:427-432`); sensitive operations
  consume one-use step-up grants (`:587-592`); global revoke-all exists
  (`parentAccountRoutes.ts:654-679`).
- **Device sessions** (mobile): `POST /v1/runtime-sync/devices/:deviceId/session`
  mints an opaque Bearer token, **TTL 1 h** (`runtime-sync/policy.ts:26`),
  Bearer parsed with prefix + 4096 cap and identity pinned to request props
  (`runtimeSyncRoutes.ts:178-187`). Challenges are enumeration-safe: unknown or
  revoked devices receive a synthesized, unusable nonce
  (`DeviceSessionService.ts:57-86`).
- **Session store is process-local in-memory** (`runtime-sync/DeviceSessionRepository.ts:11-21`;
  wired `main.ts:827`). No device-session table exists in the schema. A
  restart invalidates all device sessions; scale-out would issue per-instance
  sessions.
- **No device-session revocation caller exists** — `DeviceSessionService.revokeSession`
  (`:154`) has no route/handler; `validateSession` reads only the in-memory
  record (`:112-117`), so a REVOKED device keeps syncing with its minted token
  until the 1 h TTL. New challenges are refused (`DeviceAuthService.ts:95-96`).

## 2. Authorization source (mobile-sensitive routes)

| Route family | Authority source | Backend citation |
|---|---|---|
| bootstrap / recover | invitation token (hashed, row-locked); attempt+recovery-token pair | `bootstrapRoutes.ts:50-57,116-143`; `EnrollmentCoordinator.ts:95-210` |
| runtime-sync routes | verified device session only; deviceId/familyId from session | `runtimeSyncRoutes.ts:177-190,273,308,347-350` |
| invitation create/revoke | parent service session + RBAC + fresh step-up for revoke | `invitationRoutes.ts:211-223` |
| pairing view/confirm | parent service session + `VIEW_/CONFIRM_PAIRING_REQUEST`; family-scoped, no self-confirm | `pairingRoutes.ts:34-66`; `MySqlDeviceRepository.ts:275-277` |
| child policy / web rules | cookie family == path family, CSRF, actor device bound to family | `childPolicyRoutes.ts:97-134`; `webRuleRoutes.ts:89-124` |
| child requests (device) | device bearer; familyId must equal verified session family | `childRequestRoutes.ts:235-247,310-321` |
| retention | family scope status check | `retentionRoutes.ts:110-123` |

**No route found that derives authority from a client-submitted id alone.**
Client ids are cross-checked against server-derived identity everywhere the
scan reached (bootstrap family comes from the invitation row; sync from the
session; parent routes from cookie session).

## 3. Family isolation evidence

Grep over `backend/test/**` for `crossFamily|cross-family|wrongFamily|wrong-family|CROSS_FAMILY`
→ **189 hits in 54 files**. Key suites: `test/runtime-sync/OutboundRelayService.test.mjs:74,80`
(cross-family recipient rejected), `test/http/childPolicyRoutes.test.mjs:141`
(foreign childProfileId rejected indistinguishably), `test/http/childRequestRoutes.test.mjs:79,242,274,431`
(wrong-family decide is 404 no-oracle), `test/http/familyMemberRoutes.test.mjs:164,503`,
`test/db/http.mysql.test.mjs:328,720,897` (wrong-family invite/revoke/recovery/pairing → 404),
`test/db/enrollment.mysql.test.mjs:356` (cross-family recovery secret never recovers),
`test/db/actionIdempotency.mysql.test.mjs:112` (ledger isolation).

## 4. Verdicts

```text
API_AUTH_SESSION        = PARTIAL   (models sound; in-memory store + no device-session revocation)
API_AUTHORIZATION       = PASS      (server-derived authority; step-up for sensitive ops)
API_FAMILY_ISOLATION    = PASS      (proved per-route + 54 test files)
```

Gaps feed defects API-F02/F03 (report 12).
