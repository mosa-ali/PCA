# 02 — API Architecture & Route Map

Evidence: `[READ]` backend source, current worktree; route inventory scan
(195 routes) + `raw/source_map.json`, `raw/routes.json`.

## 1. Entrypoint and server initialization

- Composition root `backend/src/main.ts` (builds repositories, services,
  gates, wires into `buildServer`); boot-time assertions:
  `assertKnownRuntimeEnvironment()` and `assertDatabaseTlsConfiguration()`
  (main.ts:~333,~341 — an unstated or plaintext DB TLS posture refuses boot).
- Server builder `backend/src/http/buildServer.ts`; Fastify with
  **`logger: false`** (buildServer.ts:359) — see report 11 §4.
- Error handler (buildServer.ts:431-438): every ≥500 collapses to
  `{error:'internal_error'}`, other statuses to `{error:'invalid_request'}`;
  the error object itself is discarded (no server-side trace).

## 2. Middleware and cross-cutting controls

| Concern | Where | Notes |
|---|---|---|
| Trusted proxy | `http/trustProxyConfig.ts:31-36,80-107` | `PCA_TRUSTED_PROXY_CIDRS` allowlist; unset ⇒ trust `false` (never `true`) |
| Client address | `http/clientAddress.ts:18-21,66-68` | strips `ip:port` (S8 fix) before rate-limit keying |
| Rate limiting | `http/rateLimit.ts:35-75` | in-process fixed window; key = `bucket:clientAddress` (IP only); per-route buckets + a global 60/min hook over `/api/parent/*` + `/api/families/*` (buildServer.ts:364-424) |
| CORS (parent) | `http/parentWebCors.ts:4,51-76` | `PCA_PARENT_WEB_ORIGIN`; production refuses localhost fallback (`InsecureProductionOriginError`) |
| CORS (platform) | `http/parentWebCors.ts:99` | `PCA_PLATFORM_ADMIN_WEB_ORIGIN`, same fail-closed pattern |
| Session auth (browser) | `auth/fastifyAuthPlugin.ts`; `auth/AuthService.ts` | opaque service-session cookie; per-request validation |
| Device auth | `runtimeSyncRoutes.ts:177-190` + `DeviceSessionService` | Bearer device-session token (≤4096 chars), identity pinned from session, never request body |
| CSRF | parent mutation routes | double-submit header on family/child policy routes (e.g. `childPolicyRoutes.ts:121-128`) |
| Body limits | per-route | bootstrap/recover 4 KiB (`bootstrapRoutes.ts:6-13`); runtime-sync outbound own 2.3 MB limit (`runtimeSyncRoutes.ts:88`) |
| Health | `buildServer.ts:440-477` | `/health`, `/health/db`, `/health/email` (report 09 §4) |

## 3. Route families (195 routes scanned; mobile-relevant subset expanded)

| Family (prefix) | Purpose | Auth | Mobile consumer | Criticality |
|---|---|---|---|---|
| `/v1/enrollment/*` | bootstrap, recover, invitation transitions | none (token authority) | Android + iOS | critical (gated) |
| `/v1/runtime-sync/*` | device challenge/session, relay outbound/inbound/ack/status, protection-status | Bearer device session (except challenge) | Android + iOS | critical (gated) |
| `/v1/families/:familyId/*` | invitations, pairing, members, retention, runtime-sync device status | parent service session (+step-up for sensitive) | parent-web / child devices | high |
| `/api/parent/*` | parent account, settings, children, policy, web-rules, alerts, audit, safe zones | parent session cookie + CSRF (+actor device on writes) | parent-web | high |
| `/api/families/:familyId/*` | child-request submit/apply | device bearer | child apps | high |
| `/platform-admin/*` | admin console APIs | platform admin session (+MFA) | platform-admin-web | high (out of mobile scope) |
| billing/pricing/settlement | commercial | mixed | platform/web | out of scope |
| `/health*` | liveness/readiness | none | ops | high |

Detailed per-endpoint records (method, path, input/output, auth, limits,
consumers, status) live in `raw/routes.json` (scan) and are summarised per
domain in reports 03–08; the mobile-relevant 33 endpoints are enumerated in
report 08.

## 4. Data access and services

Repositories are MySQL-backed (`MySql*` classes) with transactions via
`runInTransaction`; notable service authorities: `EnrollmentCoordinator`
(enrollment), `DeviceAuthService` + `DeviceSessionService` (device proof /
sessions), `RelayService` + `OutboundRelayService` + `InboundReconnectService`
(policy relay), `RemovalDecisionAuthority` (revocation), `ParentActionAuthorizationService`
(+ durable `action_idempotency_ledger`), `FamilyAuditService` (in-memory
reference store — report 11 §4), alert ledgers (durable).

## 5. Crypto/security gates (pointer)

Six fail-closed gates are wired in production (report 05 §3); the device
session verifier and envelope verifier are `Rejecting*` placeholders pending
the PCA-DEC-020 human security review; the P-256 device verifier exists in
source, unwired.

## 6. Assessment

The API is a single Fastify process over MySQL with coherent middleware and
clear route families. The architectural weak points are operational rather
than structural: in-memory device sessions, in-process rate limits, no
request logging, and the deliberately rejecting crypto gates (reports 05–07,
11).
