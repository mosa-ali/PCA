# 03 — Platform Admin Web (platform.pcasafe.com) Final Assessment

Source: `platform-admin-web/**` [READ]; backend surface: 93 routes under `/platform-admin/*` [READ];
live: https://platform.pcasafe.com [LIVE].

## 1. Application inventory (mission §10)

| Feature | Class | Evidence |
|---|---|---|
| Login (single-shot email+password+TOTP) | IMPLEMENTED | `pages/Login.tsx`; `platformAdminAuthClient.login` matches `platformAdminAuthRoutes.ts` contract exactly (one call carries all three fields) |
| MFA challenge/failure/completion | IMPLEMENTED (source) / LIVE UNPROVEN | AuthContext `login()` → whoami; server lockout mapping; live page renders "Authenticator code" field; production activation never completed (report 05) |
| Session lifecycle | IMPLEMENTED | in-memory token only (`security/secureSession.ts:1-15` — never localStorage/sessionStorage/cookie, deliberate reload-loss); 30 s server revalidation (`AuthContext.tsx:88-97`); EXPIRED/REVOKED reasons |
| Logout / revoke-all-sessions | IMPLEMENTED | `platformAdminAuthClient.logout/revokeAllSessions`; routes matched |
| Admin dashboard | IMPLEMENTED | `pages/Dashboard.tsx`; read routes matched |
| User/admin administration | IMPLEMENTED | `pages/AdminUsers.tsx`; `/platform-admin/admin-users*` (session-guarded) |
| Accounts administration (search/suspend/reactivate/identity) | IMPLEMENTED | `pages/accounts/**`; routes matched incl. `accounts/:accountId/identity` |
| Entitlements + complimentary capacity | IMPLEMENTED (lane mid-flight) | `pages/entitlements/**`; readmodels `ComplimentaryCapacityReadModel.ts` untracked (in-flight) |
| Billing (plans/pricing/quotes/invoices/settlement) | IMPLEMENTED | `pages/billing/**`; billing routes matched |
| Enrollment management | IMPLEMENTED | `pages/EnrollmentManagement.tsx` (lane of 9496fb19) |
| Commercial pricing directories | IMPLEMENTED | `pages/CommercialPricing.tsx` (lane of HEAD 6a2cc073) |
| Audit visibility | IMPLEMENTED | `pages/Audit.tsx`; `/platform-admin/audit*` session-guarded |
| Settings / free-access policy | IMPLEMENTED | `pages/Settings.tsx`, `entitlements/FreeAccessPolicy.tsx` |
| Activation (one-time link + QR) | IMPLEMENTED | `pages/Activation.tsx`; token cleared from URL/history; QR rendered locally |
| Roles/RBAC UI hints | IMPLEMENTED (hints only; server authoritative) | `rbac/RouteGuard.tsx:19-27`, `PermissionGate`, `Billing*/Settlement*` guards |
| Arabic + RTL | IMPLEMENTED | 630/630 parity; `i18n/index.ts:33-34`; `e2e/arabicShell.spec.ts` |
| Appearance (Dark/Slate/Light) | IMPLEMENTED | `state/AppearanceContext.tsx`, `appearance-boot.js` (served live) |
| Error states | IMPLEMENTED | `ErrorState`, `PlatformAdminApiError` closed-code mapping; `isForbiddenError/isNotFoundError` |
| COMING_SOON surfaces | INTENTIONALLY_DISABLED | `components/common/ComingSoon.tsx` — documented "never renders placeholder data" |

## 2. Architecture review (mission §12)

- **Realm separation:** platform-admin-web holds ONLY the operator session; config module is
  deliberately standalone so it cannot collapse onto parent-web's (`config/env.ts:1-6`);
  comment cites PCA-ADD-PA-001 "architecturally separate application".
- **API client:** `apiBaseUrl` default is `''` (same-origin) — production serves app + `/platform-admin/*`
  from one origin behind nginx; the previous absolute-localhost default was removed after direct
  reproduction of the cross-origin failure, documented in `config/env.ts:14-26` [READ]. Every call
  attaches the in-memory bearer; no cookies, no CSRF (bearer realm). Error bodies normalized to a
  closed code set; 5xx never surfaces server detail (`platformAdminApiClient.ts:11-30`).
- **Authority model:** every one of the 93 backend routes is guarded by
  `requirePlatformAdminSession` (grep: 19 files, 128 refs); auth routes add
  `platformAdminAuthAttemptLimiter`; RBAC gates are usability-only by explicit policy
  (`rbac/RouteGuard.tsx` header) with server enforcement as the real boundary.
- **Token hygiene:** activation bearer/URI cleared from address bar/history; login result token kept
  only in the module-scoped store; logout clears local state even when the server call fails
  (`AuthContext.tsx:103-108`, `finally`).
- No fixture/mock data paths in production: audit found 2 comment-only hits (report 07 §5);
  `ComingSoon` guarantees no fabricated working data; e2e specs mock at the network layer (tests only).

## 3. Live domain (https://platform.pcasafe.com) [LIVE 2026-09-26]

- TLS 1.3; cert valid to 2027-03-04; HTTP→301→HTTPS.
- 200 HTML shell; `/login`, `/accounts` deep routes 200; CSP **header**
  (`default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; …`) +
  matching meta CSP; XFO DENY, nosniff, referrer-policy, permissions-policy, COOP.
- Unauthenticated API denial through the same origin: `GET /platform-admin/auth/whoami` → **401
  `{"error":"unauthorized"}`**; GET on the POST-only login route → 404 Fastify envelope — topology
  and guard behavior confirmed [LIVE].
- Login page renders: Language EN/AR, Appearance selector, Email/Password/Authenticator-code,
  disabled-until-valid Sign in, explicit "Operator access only" + "MFA required and cannot be
  skipped" copy (browser snapshot). One console error per load (meta `frame-ancestors` — PP-F04).
- No client-side token/secret appears in the served shell; bundle `index-BILulNyR.js` (built
  2026-09-25), no operator-session values embedded [LIVE].

## 4. Cross-assessment reconciliation

- API assessment scope (mobile-facing `/v1` + parent API) does not cover the platform-admin realm;
  no API finding contradicts platform behavior. API-F01 (worktree) applies repo-wide.
- The prior SESSION_2B gate set (activation atomicity, token hash-only, single-use, TOTP replay
  protection, scrypt, AES-256-GCM) — re-verified at source as still present in the current
  worktree's lane files; no regression found [READ]; live MFA completion remains the open gate.

## 5. Final verdict block (mission §50)

```text
PLATFORM_SOURCE = PASS
PLATFORM_BUILD = PASS
PLATFORM_TESTS = PASS              (44 files / 226 tests green locally 2026-09-26)
PLATFORM_AUTH = PASS
PLATFORM_MFA = PARTIAL             (implementation PASS; production activation/MFA completion never proven live — owner gate, last recorded PENDING_ACTIVATION 2026-09-24)
PLATFORM_API_CONTRACT = PASS       (53/53 client calls; 93/93 backend routes session-guarded)
PLATFORM_ROLE_HANDLING = PASS      (client hints + server authority; roleBoundaries e2e spec; billing/settlement guards)
PLATFORM_LOCALIZATION = PASS       (630/630 parity; arabicShell spec)
PLATFORM_FRONTEND_SECURITY = PARTIAL (in-memory token + strict CSP; no HSTS; meta frame-ancestors console error — PP-F04)
PLATFORM_LIVE_DOMAIN = PASS
PLATFORM_SOURCE_LIVE_MATCH = PARTIAL (structural + behavioral; no revision surface — PP-F03)

PLATFORM_PRE_PRODUCTION = CONDITIONAL
PLATFORM_PRODUCTION     = NO-GO

PLATFORM_BLOCKERS =
  1. Owner activation + MFA completion in production (runbook ready; S7 lockout test never run)
  2. PP-F03 deployment provenance unrecorded (live build 2026-09-25 vs unrecorded SHA)
  3. PP-F02 per-IP rate limiting ineffective in production (login/activation attempt limits)
  4. API-F01 worktree not green (repo-level acceptance blocker)
```
