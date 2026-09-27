# 05 — Platform Admin ↔ API Contract Reconciliation

## 1. Contract matrix (mission §15)

Client literals: 53 unique `/platform-admin/*` paths [READ]; backend surface: **93 routes** across
17 route files, every one guarded by `requirePlatformAdminSession` (19 files / 128 references;
login route adds `platformAdminAuthAttemptLimiter`) [READ]. Automated match:
`raw/contract_matched_pairs.json` — **53/53 client calls matched, 0 unmatched, 0 drift**.

| Feature (page) | Client call example | Authority | Role requirement (server) | Status |
|---|---|---|---|---|
| Login | POST `/platform-admin/auth/login` (email+password+totpCode) | public route + attempt limiter | — | MATCH |
| Logout / revoke-all | POST `…/auth/logout`, `…/auth/sessions/revoke-all` | session | any admin | MATCH |
| Step-up | POST `…/auth/step-up` (scope+totpCode) | session + fresh code | scope-based (billing/settlement scopes in `domain/stepUpScopes.ts`) | MATCH |
| Who-am-I | GET `…/auth/whoami` | session | any; live 401 unauth verified | MATCH |
| Dashboard | GET `…/dashboard/*` | session | readLimiter | MATCH |
| Accounts list/search/detail/identity/suspend/reactivate | `…/accounts*` | session | read/mutate limiters + server RBAC | MATCH |
| Admin users (list/create/activation/role) | `…/admin-users*` | session | server RBAC | MATCH |
| Entitlements (list/approve/deny/set-limit/free-access) | `…/entitlements*`, `…/settings/free-access*` | session | server RBAC | MATCH |
| Complimentary grants | `…/complimentary-*` | session | server RBAC | MATCH |
| Billing (plans/prices/invoices/payments/quotes/refunds) | `…/billing/*` | session | billing roles + step-up scopes | MATCH |
| Settlement (accounts/batches/reconciliation) | `…/settlement/*` | session | settlement roles + step-up | MATCH |
| Enrollment management | `…/enrollments*` (readmodel lane) | session | readLimiter | MATCH |
| Audit | `…/audit*` | session | append-only server guarantee (CI privilege gate) | MATCH |
| Settings (currency/market/plan defaults) | `…/settings/*` | session | mutate + audit | MATCH |
| Release/pricing directories | `…/release*`, `…/price-books` | session | server RBAC | MATCH |
| Activation (public) | `/platform-admin/activation/*` | **outside session realm by design** | one-time token | MATCH |

Checks per mission §15: no UI endpoint without backend authority; no wrong role assumption detected
(all role gates are hints; server enforces — `rbac/RouteGuard.tsx` header documents this);
no missing API route; no stale procedure/path (the automated match is exact); error handling maps
401/403/404/409/400 uniformly, and a real defect class (bodyless POST + empty-JSON 400) was already
solved in-source with a documented comment (`platformAdminApiClient.ts:63-71`).

## 2. Backend authority evidence

- `platformAdminAuthRoutes.ts:58-100` — every session route carries
  `preHandler: [platformAdminAuthAttemptLimiter, requirePlatformAdminSession]`.
- 16 further `platformadmin/*Routes.ts` + `commercialNotificationRoutes.ts` + `billingRefundRoutes.ts`
  import the same guard factory (`fastifyPlatformAdminAuthPlugin.ts:40-41`).
- Live: `GET https://platform.pcasafe.com/platform-admin/auth/whoami` → 401 `{"error":"unauthorized"}`
  through the same-origin proxy [LIVE] — topology + guard confirmed end-to-end.

## 3. API assessment findings with platform impact (mission §40)

| API finding | Affected | Impact | Client change | Root layer | Severity |
|---|---|---|---|---|---|
| API-F01 (worktree not green) | PLATFORM (indirect) | acceptance/CI | none | MULTI_LAYER | P1(repo) |
| API R-01 (trusted proxy) | PLATFORM | per-IP limiter ineffective → attempt limiting relies on server lockout + per-account rules | none | PRODUCTION_CONFIGURATION | → PP-F02 |
| API-F02–F08 (device/policy/audit) | — | mobile-runtime scoped; platform-admin realm independent | none | API_SOURCE | none |

## 4. Platform session/authority model vs API assessment boundary

The API assessment explicitly covered the mobile `/v1` + parent `/api` surface; the platform-admin
realm (`/platform-admin/*`, bearer sessions, separate guard factory) was verified here
independently. No cross-realm token is accepted or stored by the platform app
(`secureSession.ts` header: never a parent/family token, PCA-ADD-PA-001).

```text
PLATFORM_API_CONTRACT = PASS (53/53, 93/93 guarded, live denial verified)
```
