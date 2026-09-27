# 04 — Parent ↔ API Contract Reconciliation

Authority for backend behavior: `docs/pre_production_assessment/api/**` (API assessment, 2026-09-26)
+ the shared route inventory (`raw/routes.json`, 195 routes). Method: every `/api/**` literal in
`parent-web/src` matched against the backend route table (`raw/contract_matched_pairs.json`).

## 1. Contract matrix (mission §14)

| Feature | Client call | Method | Path | Server route | Status |
|---|---|---|---|---|---|
| CSRF bootstrap | `realServiceAuthClient.readCsrf` | POST | `/api/parent/csrf` | `parentAccountRoutes.ts` (POST-only; GET→404 confirmed live) | MATCH |
| Register | register flow | POST | `/api/parent/register` | ✅ | MATCH |
| Verify email | `VerifyEmail.tsx` | POST | `/api/parent/verify-email` | ✅ | MATCH |
| Login | `Login.tsx` → `signIn` | POST | `/api/parent/login` | ✅ (incl. `/login/step-up` variant) | MATCH |
| Session | `getSession` | GET | `/api/parent/session` | ✅ (401 unauth live-verified) | MATCH |
| Logout | `signOut` | POST | `/api/parent/logout` (CSRF) | ✅ | MATCH |
| Forgot password | `ForgotPassword.tsx` | POST | `/api/parent/request-password-reset` | ✅ | MATCH |
| Reset password | `ResetPassword.tsx` | POST | `/api/parent/reset-password` | ✅ | MATCH |
| MFA enrollment start/confirm | `MfaSetup.tsx` | POST | `/api/parent/mfa/enrollment/start`, `/confirm` | ✅ | MATCH |
| MFA recovery request/complete | `MfaRecover.tsx` | POST | `/api/parent/mfa/recovery/request`, `/complete` | ✅ | MATCH |
| Step-up (commercial/sensitive) | `StepUpContext` | POST | `/api/parent/mfa/step-up` | ✅ | MATCH |
| Identity | untracked lane | GET/PATCH | `/api/parent/identity` | ✅ both methods exist | MATCH (lane in-flight) |
| Preferences | `Settings.tsx` | GET/PUT | `/api/parent/preferences` | ✅ | MATCH |
| Free access status | banner | GET | `/api/parent/free-access-status` | ✅ | MATCH |
| Member invitation accept | `Members.tsx` | POST | `/api/parent/member-invitations/:id/accept` | ✅ | MATCH |
| Family audit events | `Audit.tsx` | GET | `/api/parent/families/:familyId/audit-events` | ✅ | MATCH |
| Bonus time grant | children pages | POST | `/api/parent/families/:familyId/bonus-time/grant` | ✅ | MATCH |
| Child requests decide | `Requests.tsx` | POST | `/api/parent/families/:familyId/child-requests/:requestId/decide` | ✅ | MATCH |
| Web rules list/write/remove | `WebProtectionPage.tsx` | GET/POST | `/api/parent/families/:familyId/children/:childProfileId/web-rules[/remove]` | ✅ route exists — **503 by production composition** (see §3) | ROUTE_MATCH / FEATURE_FAIL_CLOSED |
| Safe zones list/upsert/delete | `realSafeZoneClient.ts` | GET/POST/(suffix) | `/api/parent/families/:familyId/safe-zones[/:zoneId]` | ✅ | MATCH |
| Schedule policy | `realSchedulePolicyClient.ts` | POST | `…/children/:childProfileId/schedule-policy` | ✅ | MATCH |
| Members invitations (create/revoke/role) | `Members.tsx` | POST | `…/members/invitations[/:id/revoke|/role]` | ✅ | MATCH |
| Member remove | `Members.tsx` | POST | `…/members/:accountId/remove` | ✅ | MATCH |
| Protection alerts | `Alerts.tsx` | GET | `/api/parent/families/:familyId/protection-alerts` | ✅ | MATCH |
| Devices/pairing/enrollment | devices suite | via `/v1/**` runtime-sync + pairing clients | ✅ per API assessment (16-call matrix, 0 drift) | MATCH |

Result: **30/30 real client paths matched**; the 4 unmatched literals are comments/apart-unavailable
declarations (`realServiceAuthClient.ts:22-24`, `unavailableProviders.ts:17/19/145-147`) — no drift.
Auth/CSRF/error handling conventions cross-checked against the API assessment error inventory
(401 unauthorized, 429 rate_limited, 400 invalid_request, 404 invitation_unavailable) → all mapped
to distinct client states (report 06 §2).

## 2. NEW finding — device-enrollment link base is localhost in production (PP-F01, P1)

Evidence chain:
1. Source: `config/env.ts:79` — `deviceEnrollmentLinkBaseUrl: … ?? 'http://localhost:4000/enroll'`;
   the env var `VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL` appears **nowhere else in the repository**
   (not in `.env.example`, docs, or CI) [READ].
2. Build: production-style local build reproduces the same baked literal [RUN].
3. **Live**: the production bundle at `https://parent.pcasafe.com/assets/index-pwh0Qt3P.js` contains
   `deviceEnrollmentLinkBaseUrl:"http://localhost:4000/enroll"` as the ACTIVE value (minified config
   object, next to `apiBaseUrl:"https://api.pcasafe.com"`) [LIVE — verbatim extraction].
4. Usage: `pages/family/devices/enrollmentState.tsx:191-192` builds the enrollment link as
   `${base}/${rawInvitationToken}`; `AddDeviceWizard.tsx:560-586` renders it as text + QR
   ("On your child's device", Copy link).
5. Consumer: Android `EnrollmentLinkParser.kt` accepts schemes `pca://enroll?token=…` or the
   **App-Link form `https://<APP_LINK_HOST>/<token>`** where `APP_LINK_HOST = "enroll.pca.app"` —
   a placeholder domain the project does not own (`EnrollmentDeepLinkConfig.kt:30,47`) [READ].

Consequence: in production every generated device-enrollment link/QR is
`http://localhost:4000/enroll/<token>` — unresolvable on any device and never matching the Android
App-Link host. The fallback-code path (derived code shown beside the link) and the pairing flow
remain the only potentially-working enrollment mechanisms.

Root layer: **MULTI_LAYER** (PARENT_SOURCE: unguarded default, unlike the apiBaseUrl guard at
`env.ts:62`; PRODUCTION_CONFIGURATION: build env var unset and undocumented; EXTERNAL: Android
App-Link host placeholder + DNS/assetlinks). BLOCKS_PRODUCTION = YES; BLOCKS_PRE_PRODUCTION = YES
for the enrollment-link acceptance step. Register: PP-F01. Recommended fix (no implementation here):
add a production guard like apiBaseUrl's, document the variable in `.env.example` + deployment docs,
set it to the parent origin, and align `enroll.pca.app` (or the chosen host) on the Android side.

## 3. API findings with parent impact (mission §40)

| API finding | Affected app | Client impact | Current client behavior | Required client change | Root layer | Severity |
|---|---|---|---|---|---|---|
| API-F01 worktree not green | PARENT (indirect) | acceptance/CI only | parent suite itself green (08) | none (repo process) | MULTI_LAYER | P1(repo) |
| API-F06 policy sync no version/read-back | PARENT | cannot show delivered-vs-applied | UI honestly shows PENDING_DELIVERY only (`usePolicyStatus.ts:21`) | none now; richer status later | API_SOURCE | P2 |
| API-F07 web-rules 503 by design | PARENT | Web Protection authoring unavailable in prod | **honest unavailable state** documented (`WebProtectionPage.tsx:24-32`) — no fabricated data | none (already honest); feature launch needs encrypted storage contract | API_SOURCE | P2 (product gap) |
| API R-01 trusted-proxy env | PARENT | per-IP limits ineffective for login/step-up | server-side; client unaffected | none | PRODUCTION_CONFIGURATION | shared → PP-F02 |
| API-F02/F03 device sessions | PARENT | device pages read status, not device sessions | unaffected (parent cookie realm) | none | API_SOURCE | none |
