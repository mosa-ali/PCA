# 12 — API Defect Register

`P0 = 0 · P1 = 1 · P2 = 7 · P3 = 5` (13 findings). Machine-readable mirror:
`api_findings.json`. Severities not inflated; all are source-proven.

## API-F01 — Worktree regression cluster · P1
- **Area / route**: repo state — invitation + Safe Zone routes, meta gates.
- **File**: `backend/src/http/routes/invitationRoutes.ts` (dirty), `parentaccount` safe-zone routes (dirty), meta suites.
- **Evidence**: `npm test` 2599/2615 (16 fail; run-to-run 21→16); fresh-build recheck of `test/invitation/iosEnrollmentUnavailable.test.mjs` + `test/parentaccount/preferencesSafeZonesRoute.test.mjs` = 1 pass / 9 fail, all `500` vs expected 400/403/200/401; failing meta names recorded in `raw/unit_suite_failures.json`.
- **Current**: concurrent lane mid-migration; routes answer 500 under their own committed harnesses; registration/schema/certification gates red.
- **Expected**: tree green on its own suite before acceptance.
- **Android/iOS impact**: none directly (client contracts unchanged) — but blocks CI/merge and pre-production acceptance.
- **Blocks**: physical UAT = NO (indirectly via CI); pre-production = YES until green; production = YES until green.
- **Fix / owner**: land the in-flight migration green (concurrent lane + coordinator); no fix by this assessment.

## API-F02 — Device sessions are process-local in-memory · P2
- **File**: `runtime-sync/DeviceSessionRepository.ts:11-21`; `main.ts:827`.
- **Evidence**: no device-session table in schema; store constructed in-memory.
- **Current**: restart invalidates all sessions; scale-out gives per-instance inconsistent sessions.
- **Expected**: durable/shared session store before production scale-out.
- **Android/iOS impact**: unexplained 401s after deploys/restart; re-challenge needed.
- **Blocks**: pre-production NO (single instance); production YES at scale-out.
- **Fix**: add MySQL-backed session store (or document single-instance constraint). Owner: backend.

## API-F03 — No device-session revocation · P2
- **File**: `runtime-sync/DeviceSessionService.ts:112-117,154` (only definition; no caller).
- **Current**: a REVOKED device keeps its minted Bearer token for up to 1 h.
- **Expected**: revoke-on-device-revocation endpoint/hook.
- **Android/iOS impact**: revocation not immediate; security-relevant for lost devices.
- **Blocks**: pre-production NO; production YES.
- **Fix**: call `revokeSession` (and clear store entries) from `revokeDevice`; add test. Owner: backend.

## API-F04 — No device-initiated unenroll / unenrolled state · P2
- **Evidence**: grep `unenroll|deregister|unpair|remove-device` → none; no device delete/revival; revocation parent-only (`MySqlDeviceRepository.ts:136`).
- **Current**: device cannot leave a family itself; server cannot represent "unenrolled".
- **Expected**: defined de-enrollment contract (product decision) + route or documented absence.
- **Android/iOS impact**: mobile "no de-enrollment path" findings confirmed at server layer.
- **Blocks**: pre-production = depends on owner scope decision; production YES if in scope.
- **Fix**: owner decision, then route + client wiring. Owner: product + backend.

## API-F05 — Observability & audit gaps · P2
- **File**: `buildServer.ts:359` (`logger:false`), `:431-438` (5xx discarded); `main.ts` family audit = `InMemoryFamilyAuditRepository`; `deviceauth/**` emits no audit.
- **Current**: no request/error log; security events (failed enrollment, proof failure/replay, cross-family denials, rate limiting) not durably recorded.
- **Expected**: durable security-event audit + request/error logging (redacted).
- **Android/iOS impact**: incident forensics for mobile flows impossible from server side.
- **Blocks**: pre-production NO; production YES (operability).
- **Fix**: wire logger + durable audit sinks for device/enrollment events. Owner: backend.

## API-F06 — Policy sync lacks version/cursor/read-back · P2
- **File**: `relay/RelayService.ts:96`; `migrations/0001:221-240` (no message_type/version column); `childPolicyRoutes.ts:201` (202 PENDING label only).
- **Current**: delivery = queue + drain + ack; no way to query application state or version.
- **Expected**: versioned policy state accessible to the parent console (at least delivery-state).
- **Android/iOS impact**: "policy never applied" cannot be distinguished from "delivered but not applied" server-side.
- **Blocks**: production (multi-device rollouts) = YES.
- **Fix**: persist message_type/version + add status projection. Owner: backend.

## API-F07 — web-rules permanently 503 in production · P2
- **File**: `webRuleRoutes.ts:23-30,130`; `buildServer.ts:657-663` (service omitted); scaffold stores readable domains (PCA-SEC-023).
- **Current**: all three routes 503 `not_configured` in production.
- **Expected**: remove the scaffold or replace with reviewed encrypted storage + delivery.
- **Android/iOS impact**: Android web-rule consumer remains un-fed (mobile MOB-014 confirmed server-side).
- **Blocks**: pre-production = YES if web rules are in scope; production YES.
- **Fix**: per existing lane classification (REMOVE_OBSOLETE or encrypted replacement). Owner: backend + product.

## API-F08 — Post-commit enrollment failure can 500 · P2
- **File**: `EnrollmentCoordinator.ts:130-145` (slot/audit after tx commit); `bootstrapRoutes.ts` maps to 500.
- **Current**: caller sees 500 though the enrollment committed; `/recover` retrieves the result.
- **Expected**: commit-then-respond semantics that never misreport committed state (or documented recover flow only).
- **Android/iOS impact**: client must treat 500 as ambiguous and call `/recover` — currently it does not.
- **Blocks**: pre-production NO; production YES.
- **Fix**: move side effects inside the tx or return success-with-warning. Owner: backend.

## API-F09 — Rate-limit hardening · P3
- **Evidence**: `rateLimit.ts:35-75` (in-process, IP-only); per-route scan: no route-level limiter on childPolicy/webRule/childRequest/familyMember (global 60/min hook only).
- **Current/expected**: limits exist for device/health/auth routes; hardening for the rest + shared store + optional device-session keying.
- **Blocks**: none directly.
- **Owner**: backend.

## API-F10 — Server-minted idempotency keys · P3
- **File**: `childPolicyRoutes.ts:173-174`.
- **Current**: client retries mint new keys → ledger does not dedupe client retries.
- **Expected**: accept a client idempotency key on retryable parent/device mutations.
- **Blocks**: production (subtle duplicates) — P3 hardening.
- **Owner**: backend.

## API-F11 — Enrollment attempts never expire · P3
- **File**: `migrations/0003:60-107` (no expiry column).
- **Current**: held recovery token re-readable indefinitely (rate-limited).
- **Expected**: expiry/rotation policy.
- **Owner**: backend.

## API-F12 — No client-version / capability gating · P3
- **Evidence**: grep `minimumVersion|clientVersion|X-PCA-Client` → none; only `/v1` path prefix.
- **Current**: older/newer clients are indistinguishable server-side.
- **Expected**: version header + min-supported policy before store rollouts.
- **Owner**: backend + mobile.

## API-F13 — Exact-replay does not re-compare platform · P3
- **File**: `EnrollmentCoordinator.ts:116-119` (replay matches token+keys only).
- **Current**: same-token+keys replay with a different `platform` returns the original result.
- **Expected**: comparison at parity with first-accept validation.
- **Owner**: backend.
