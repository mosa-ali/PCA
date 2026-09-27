# 02 — Parent Web (parent.pcasafe.com) Final Assessment

Source: `parent-web/**` [READ] at worktree 2026-09-26; live: https://parent.pcasafe.com [LIVE].

## 1. Application inventory (mission §10)

| Feature | Class | Evidence |
|---|---|---|
| Registration entry (+identity capture lane untracked) | IMPLEMENTED | `pages/auth/Register.tsx`; untracked `src/identity/`, `tests/component/RegisterIdentity.test.tsx` |
| Email verification | IMPLEMENTED | `pages/auth/VerifyEmail.tsx`; `/api/parent/verify-email` matched |
| Login (email+password → TOTP/emailed code per account) | IMPLEMENTED | `pages/auth/Login.tsx`; `realServiceAuthClient.ts:1-70` (PCA-DEC-037) |
| MFA setup / recovery (TOTP) | IMPLEMENTED | `pages/auth/MfaSetup.tsx`, `MfaRecover.tsx`, `TotpQrCode.tsx`, `MfaGracePrompt.tsx` |
| Step-up (commercial + sensitive, fresh 6-digit code, single-use grant) | IMPLEMENTED | `state/StepUpContext.tsx:17-31,64-140`; server routes matched |
| Forgot / reset password | IMPLEMENTED | `pages/auth/ForgotPassword.tsx`, `ResetPassword.tsx`; routes matched |
| Logout | IMPLEMENTED | `/api/parent/logout` (CSRF double-submit) matched; `AuthContext` refresh |
| Session lifecycle (cookie; fail-closed on reject) | IMPLEMENTED | `AuthContext.tsx:46-63` (rejection → session=null → /login, never stuck loading) |
| Pre-family state | PARTIAL (tolerant, no creation UI) | family-less session renders shell; `DevicesTabs.tsx:61` `session?.familyId ?? ''`; no family-creation UI exists |
| Genesis / family-init | **NOT_IMPLEMENTED in current source** (superseded) | 0 matches for `genesis` in `parent-web/**` [READ]; live bundle counts all 0 [LIVE]; replaced by f66e0e28 |
| Family/children pages (dashboard, children suite, devices, members) | IMPLEMENTED | `pages/Dashboard.tsx`, `pages/children/**` (13 pages), `pages/family/**` |
| Activity timeline | IMPLEMENTED | `pages/children/ActivityTimelinePage.tsx`, `i18n/activitySummary.ts` |
| Settings (+ identity lane untracked) | IMPLEMENTED / PARTIAL | `pages/Settings.tsx`; `SettingsIdentity.test.tsx` untracked (in-flight) |
| Notifications | IMPLEMENTED | `pages/Notifications.tsx`, `components/shell/NotificationsBell.tsx` |
| Arabic + RTL | IMPLEMENTED | 1527/1527 key parity; `i18n/index.ts:73-74` sets `dir`/`lang` |
| Responsive / PWA | IMPLEMENTED | `e2e/responsive.spec.ts`, `overflow.ts`, `pwa-service-worker.spec.ts` (CI-certified set); `registerSW.js` served live [LIVE] |
| Privacy pages (export/delete-now/retention/transparency) | IMPLEMENTED | `pages/privacy/**`; routes matched |
| Web Protection authoring | **INTENTIONALLY_DISABLED (fail-closed, honest UI)** | route family 503-by-design (report 04 §3); `WebProtectionPage.tsx:24-32` documents "honest unavailable state" for non-demo client |
| Billing/subscription surfaces | IMPLEMENTED (commercial notifications real; payment provider external) | `pages/billing/**`, `realBillingClient.ts`; provider gate = external |

## 2. Architecture review (mission §11)

- Entry/router: React SPA (`App.tsx`), `AppLayout` auth gate (`components/shell/AppLayout.tsx:75-78`:
  loading→null, session null→`/login` with `state.from`), route-level `RouteGuard` (role hints only,
  server re-authorizes — `rbac/RouteGuard.tsx:19-27`).
- Session/API client: real HTTP client over HttpOnly `pca_family_session` cookie +
  double-submit CSRF header (only non-HttpOnly `pca_family_csrf` is read) —
  `api/real/realServiceAuthClient.ts:8-28`; `credentials:'include'` everywhere; no JS-readable token.
- Config: fail-closed production guard — build throws if `VITE_PCA_API_BASE_URL` missing or loopback
  in production (`config/env.ts:34-62`); demo mode is a build-time flag with its own CI gate
  (report 08 §5). `deviceEnrollmentLinkBaseUrl` fallback is the one unguarded default (PP-F01).
- State: two contexts (Auth, StepUp); fixtures only when `config.demoMode===true`
  (`api/client.ts:344-354`); `isFixtureBacked` surfaced in UI (demo banner).
- Error mapping: closed `ServiceAuthErrorCode` set → i18n keys (`i18n/errorMessages.ts`); network
  and unknown errors have truthful copy (2026-09-24 login-copy hotfix lineage).
- No hard-coded production URLs in src beyond the API host guard; URL-literal audit found only
  dev defaults/comments; zero open redirects (returnPath guarded — see report 09).
- Dead/demo paths: `api/dev/**` unreachable unless demo mode; `unavailableProviders.ts` throws
  honest "no backend implementation" errors (never fixtures) [READ].

## 3. Live domain (https://parent.pcasafe.com) [LIVE 2026-09-26]

- TLS 1.3; cert valid to 2027-03-04 (SAN parent.pcasafe.com); HTTP→301→HTTPS.
- 200 HTML app shell; `/login`, `/family/devices` deep routes 200 (SPA fallback); bundle
  `/assets/index-pwh0Qt3P.js` (built 2026-09-25) + `registerSW.js`; meta CSP present with
  `connect-src 'self' https://api.pcasafe.com`; XFO DENY, nosniff, referrer-policy,
  permissions-policy, COOP (table in report 07). One console error per load (meta `frame-ancestors`
  ignored — PP-F04).
- Login page renders complete auth surface EN/AR + forgot-password + authenticator recovery +
  register links (browser snapshot); resource-health clean (only the expected 401 session probe).
- API integration: live bundle bakes `https://api.pcasafe.com` as apiBaseUrl [LIVE bundle extraction].

## 4. Cross-assessment reconciliation

- API-F07 (web-rules 503): parent treatment = intentional fail-closed with honest UI (report 04 §3).
- API-F01 (worktree not green): parent suite itself is green (report 08 §2); the 16 backend
  failures remain the acceptance blocker.
- Enrollment link/localhost: NEW finding PP-F01 (report 04 §2) — not in any prior report.

## 5. Final verdict block (mission §49)

```text
PARENT_SOURCE = PARTIAL            (excellent auth/session/security engineering; one unguarded production default — PP-F01)
PARENT_BUILD = PASS
PARENT_TESTS = PASS                (1063/1064; 1 load-flake attributed, isolated 24/24 ×3; CI 8-shard authoritative)
PARENT_AUTH = PASS
PARENT_SESSION = PASS              (HttpOnly cookie + double-submit CSRF; fail-closed; real E2E proved)
PARENT_API_CONTRACT = PASS         (30/30 real paths; 4 exclusions explained)
PARENT_FAMILY_STATE = PASS         (state machine sound; family creation intentionally outside web UI)
PARENT_ARABIC = PASS               (1527/1527 parity; RTL wiring; native signoff = EXTERNAL, unchanged)
PARENT_RESPONSIVE = PASS           (CI-certified responsive/overflow/contrast specs; live viewport OK)
PARENT_FRONTEND_SECURITY = PARTIAL (strong client posture; edge headers/HSTS + rate-limit config gaps — PP-F02/F04)
PARENT_LIVE_DOMAIN = PASS
PARENT_SOURCE_LIVE_MATCH = PARTIAL (structural+behavioral match; no revision surface — PP-F03)

PARENT_PRE_PRODUCTION = CONDITIONAL
PARENT_PRODUCTION     = NO-GO

PARENT_BLOCKERS =
  1. PP-F01 enrollment link base = http://localhost:4000/enroll in the production bundle
  2. PP-F03 deployment provenance unrecorded (live build 2026-09-25 not tied to a SHA; worktree ahead/dirty)
  3. PP-F02 per-IP rate limiting ineffective in production (shared with API R-01)
  4. API-F01 worktree not green (repo-level acceptance blocker)
  5. (external) Android APP_LINK_HOST = enroll.pca.app placeholder — deep-link completion needs DNS/assetlinks
```
