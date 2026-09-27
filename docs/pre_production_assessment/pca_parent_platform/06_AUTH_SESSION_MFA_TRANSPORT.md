# 06 — Auth, Session, MFA and Transport

## 1. Parent auth flow (mission §16) — client correctness [READ + same-day real E2E]

- Registration → verification → login implemented against the real routes; login is
  email+password then (per account MFA status) an authenticator/emailed code — PCA-DEC-037
  model documented in `realServiceAuthClient.ts:29-40`.
- Session check: `getSession()` maps 401→null, rejections→fail-closed null→login
  (`AuthContext.tsx:46-63`; comment records the blank-page bug this fixed).
- Logout: POST + CSRF echo; local state cleared via refresh; server revocation on parent side.
- Step-up: `StepUpContext.tsx` mints a single-use grant for exactly one operation with a fresh
  6-digit code; error mapping covers INVALID_MFA_CODE / MFA_LOCKED / RATE_LIMITED / FORBIDDEN /
  SESSION_EXPIRED; token never stored [READ].
- Password reset / verification: dedicated pages, honest server-code mapping.
- Same-day real-backend browser evidence (test-results 2026-09-26 17:04Z, `realBackend.spec.ts`):
  "wrong credentials are rejected generically" ✓; "sign-in reaches the dashboard via a real session
  cookie" ✓; "the session cookie survives a full page reload (HttpOnly, real backend-issued)" ✓;
  "Settings loads real parentPreferences data" ✓; "fresh unauthenticated context is redirected away
  from a protected route" ✓ — 1/1 passed, 0 flaky [RUN/RECORDED in-repo].
- Old-password/new-password and expired-session cases: covered by unit/component suites
  (report 08 §3) and server-side (API assessment §27).

`PARENT_AUTH_FLOW = PASS`

## 2. Parent session transport (mission §18) — PASS

- HttpOnly + SameSite=Strict + Secure-in-production cookie `pca_family_session`; the only readable
  cookie is the non-HttpOnly CSRF companion, echoed in `X-PCA-CSRF-Token` for state-changing calls
  (`realServiceAuthClient.ts:8-28`). `credentials:'include'`; no JS-readable session token exists
  (structurally impossible — HttpOnly).
- Cross-origin design: parent.pcasafe.com → api.pcasafe.com, explicitly allowed by the meta CSP
  `connect-src 'self' https://api.pcasafe.com` [LIVE] and by server CORS (API assessment).
- No wildcard CORS, no CSRF disablement, no storage of session values (E2E asserts token never
  touches localStorage/sessionStorage/URL — `e2e/device-enrollment.spec.ts`).

`PARENT_SESSION_TRANSPORT = PASS`

## 3. Platform auth / MFA flow (mission §17) — PASS (source), live completion external

- Single-step login (email+password+TOTP in one POST) matches the backend contract exactly;
  no separate challenge round-trip exists server-side and the client does not pretend otherwise
  (`platformAdminAuthClient.ts:55-64`; `AuthContext.tsx:100-107`).
- MFA failure → mapped codes; lockout server-side (rolling window) surfaced truthfully.
- Session: in-memory-only token (kills reload persistence deliberately), 30-second
  server revalidation via whoami, 401/403 → REVOKED/EXPIRED sign-out reasons; revoke-all available.
- Route protection: `RequireSession` + `RouteGuard` (usability) + server `requirePlatformAdminSession`
  on all 93 routes (report 05). MFA can never be weakened client-side — no bypass path exists.
- Live gate: production activation/MFA has never been completed (owner action; report 03 §4).
  Nothing in this assessment modified accounts, MFA state, or sessions [READ-ONLY].

`PLATFORM_AUTH_FLOW = PASS`  ·  `PLATFORM_MFA_LIVE = UNPROVEN (owner gate)`

## 4. Platform session transport (mission §18) — PASS

- Bearer token, in-memory module store (`secureSession.ts:1-15`): never localStorage,
  sessionStorage, cookie, or any persisted form — the header documents the kiosk/XSS rationale.
- Same-origin transport (nginx proxy) — no CORS dependency; CSP `connect-src 'self'` [LIVE].
- Logout clears local state even when the server call fails; revoke-all clears immediately.

`PLATFORM_SESSION_TRANSPORT = PASS`

## 5. CORS / CSRF client compatibility (mission §19)

| Assumption | Parent | Platform |
|---|---|---|
| credentials mode | `include` everywhere | n/a (bearer) |
| CSRF header | `X-PCA-CSRF-Token` from `pca_family_csrf` cookie | none sent (not required) |
| Origin pairing | parent origin allow-listed server-side (API assessment) | same-origin |
| OPTIONS assumptions | none beyond standard fetch preflight | none |
| Stale hosts | none found (URL audit) | none found (URL audit) |

`PARENT_API_TRANSPORT = PASS`  ·  `PLATFORM_API_TRANSPORT = PASS`

## 6. MFA/step-up anti-abuse note

Login/step-up rate limiting exists per route (API assessment §29) but **per-IP keying is currently
ineffective in production** (PP-F02): the resolved `request.ip` is a platform hop, not the client.
Parent side mitigations: per-email keying exact where used (login 10/email/15 min, proven live
2026-09-24 S8 A/B) + server lockout on authenticator codes. Platform side: attempt limiter keyed by
IP (weak today) + server-side admin lockout after repeated wrong codes. No MFA bypass exists.
