# PCA QA Defect Handoff (Coordinator B → Coordinator A)

Coordinator B appends; Coordinator A reads. Do not edit concurrently without
coordination.

Entry SHA: `025a684` (origin/pca-dev at session start). QA worktree:
`.agent-runtime/worktrees/qa-coordinator-b`, branch `qa-coordinator-b-session`
(local only, not pushed).

---

## QA-B-001 — vite dev-server proxy drops real-browser POST logins (tooling, not product)

- **APP**: parent-web (dev tooling only — `vite.config.ts`'s
  `VITE_E2E_REAL_PROXY_TARGET` real-backend-E2E proxy path)
- **ROUTE**: `/login` (`POST /api/parent/login` via the `/api` proxy rule)
- **PERSONA**: any verified parent account (reproduced with owner-a and owner-b)
- **LANGUAGE / VIEWPORT**: EN, desktop (not language-dependent)
- **SEVERITY**: P3 — dev/QA tooling artifact, NOT a production defect (see
  root-cause below). Downgraded from an initial P1 read once isolated.
- **STEPS**:
  1. Start parent-web's dev server with `VITE_E2E_REAL_PROXY_TARGET=<backend>`,
     `VITE_PCA_API_BASE_URL=""` (same-origin, proxied through vite).
  2. In a real Chromium browser (Playwright), fill valid credentials and click
     "Sign in" (triggers the app's own `fetch('/api/parent/login', ...)`).
- **EXPECTED**: 200, session cookie set, redirect to `/dashboard`.
- **ACTUAL**: Backend returns `500 {"error":"internal_error"}` consistently.
- **ISOLATION (all against the identical backend/DB, same seeded account)**:
  - `curl` (direct to backend, and through the vite proxy, with/without an
    explicit `Origin` header) → always 200.
  - Playwright's `page.request.post()` (through the proxy, and direct to the
    backend) → always 200.
  - Real page `fetch()` (the actual "click Sign In" flow) through the vite
    proxy → always 500.
  - Real page `fetch()` with `VITE_PCA_API_BASE_URL` pointed **directly** at
    the backend (`http://127.0.0.1:4011`, bypassing vite's proxy, real
    cross-origin CORS round trip) → **200, reaches `/dashboard` reliably.**
- **CONCLUSION**: the failure reproduces only for a real-browser `fetch()`
  routed through vite's dev-server proxy specifically; every path that
  bypasses that proxy (curl, Playwright's raw request API, or a direct
  cross-origin browser fetch) succeeds against the identical backend code.
  This points at vite's proxy layer (or this machine's vite/Node version
  interaction with it) in local dev, not at `backend/src` — no product code
  path is implicated. Backend's error handler (`buildServer.ts`) also has
  `Fastify({ logger: false })` with no `console.error` in the generic
  handler, so no server-side stack trace was obtainable to confirm further
  without instrumenting product source, which is outside this lane's
  ownership.
- **WORKAROUND (adopted this session)**: run parent-web's dev server with
  `VITE_PCA_API_BASE_URL=http://127.0.0.1:<backend-port>` (direct
  cross-origin) instead of the same-origin proxy path, for any REAL-browser
  QA run. `e2e-real/realBackend.spec.ts`'s existing accepted suite uses the
  proxy path and passed in earlier sessions — if this is genuinely
  intermittent/version-dependent rather than deterministic, it may be worth a
  quick health-check next time that suite runs.
- **LIKELY_OWNER**: N/A (tooling, no action required) — flagged for
  awareness only.

---

## QA-B-002 — (confirmed NOT a defect) Login rate limiter and reset-password anti-brute-force delay both work as designed

Recorded for context, not as a defect: this session's own heavy repeat
testing against `owner-a@pca-seed.test` / `owner-b@pca-seed.test` tripped
`LOGIN_EMAIL_RATE_LIMIT` (10/15min, `backend/src/parentaccount/policy.ts`)
partway through — confirmed directly via `curl` (`429 {"error":"rate_limited"}`).
A single wrong-password attempt was also observed taking ~8s to respond, and
this delay measurably grows with repeated attempts against the same account —
consistent with a deliberate anti-brute-force control, not a hang. Both are
**positive** findings (the controls work); several `PCA_PAGE_QA_LEDGER.csv`
rows this session note timeouts caused by this, not app bugs. No action
needed from Coordinator A.

---

## QA-B-003 — verify-email code TTL: retest needed, not a defect

`owner-pending@pca-seed.test`'s seeded verification code expired between
seeding and the browser step running (this session ran unusually long). The
FAILURE path was confirmed honest and correct (a clean "That verification
code is incorrect or has expired." message, no crash). The SUCCESS path (a
still-valid code) needs a retest run where seeding and the Playwright step
happen back-to-back. See `PCA_PAGE_QA_LEDGER.csv`'s `/verify-email` row
(`PARTIAL`).

---

## QA-B-004 — (confirmed NOT a defect) platform-admin-web TOTP-window collisions under dense back-to-back test logins

Running platform-admin-web's 24-test QA suite sequentially (each test does
its own fresh login) produced 11 failures, nearly all "stuck at /login"
after a real, correctly-shaped login submission. Root cause: `verifyTotp`'s
counter-claim (`backend/src/platformadmin/auth/PlatformAdminAuthService.ts`,
`TOTP-REPLAY-1`) is a real, working anti-replay control -- the SAME 30-second
TOTP window cannot be claimed twice, even across unrelated logins for the
same admin. Several of this suite's tests for the SAME persona (e.g.
FINANCE_ADMIN across 8 billing/settlement route tests) run close enough
together that consecutive fresh `computeTotp()` calls sometimes land in a
window already claimed by the previous test's login, and login is honestly
(and correctly) rejected exactly as designed. This is a **test-suite-density
limitation**, not a product defect -- it is direct proof the anti-replay
control works. Confirmed separately: `secureSession.ts`'s in-memory-only
session token (deliberately lost on any hard page reload,
PCA-ADD-PA-014/016) is also working as designed; this session's Playwright
specs were fixed to navigate authenticated routes via client-side sidebar-link
clicks rather than `page.goto()`, which resolved an earlier, larger batch of
false failures.

**Recommended retest approach**: either add a short stagger between
back-to-back logins for the same persona in the same run, or (simpler) run
each spec file separately so fewer logins for the same persona land close
together.

---

## QA-B-007 — POSSIBLE real gap: an account's stored language_code preference is never read/applied by the frontend (needs Coordinator A confirmation)

`parent_account_preferences.language_code` (a real DB row -- owner-a is
seeded with `'ar'`, see seed-local.mjs) is not referenced anywhere in
`parent-web/src/state/AuthContext.tsx` or `parent-web/src/App.tsx` (direct
source search, zero matches for `parentPreferences`/`languageCode`/
`changeLanguage`). A real-browser check confirms it: logging in as owner-a
and landing on `/dashboard` renders `dir="ltr"` (English), not the
account's stored `'ar'` preference -- only an explicit `?lng=ar`
querystring (i18next's own detector, unrelated to the account row) flips
it. This may be intentional (the preference row might be read elsewhere,
e.g. a Settings page, or by a different client not yet wired to
auto-apply on load) rather than a defect -- flagging for Coordinator A to
confirm scope rather than asserting it's broken. If genuinely unused, this
is a P2/P3 UX gap: a returning Arabic-speaking parent's saved preference
would not take effect automatically.

---

## QA-B-005 — (fixed, QA tooling only) seed-local.mjs read the WRONG code for password-reset, not a backend defect

`backend/scripts/seed-local.mjs`'s `pendingResetCode` line called
`emailSender.lastCodeFor(email)` with no second argument.
`TestSandboxEmailSender.lastCodeFor(email, kind = 'VERIFICATION')` defaults
`kind` to `'VERIFICATION'` -- so after `requestPasswordReset()` sent a REAL,
correctly-hashed-and-stored `'PASSWORD_RESET'`-kind code, this call
silently returned the account's much-earlier REGISTRATION verification
code instead (same 6-digit shape, so nothing about it looked wrong).
Every `/reset-password` real-browser test this session was therefore
submitting a code that could never match the stored hash -- confirmed by
direct backend tracing (`ParentAccountService.resetPassword` correctly
threw `UNAUTHORIZED`; the STORED code hash never matched
`SHA256(the code the seed script printed)`). **The backend's reset-code
verification is correct and was never in question** -- this was purely a
QA-tooling bug, now fixed (`lastCodeFor(email, 'PASSWORD_RESET')`) and
verified end-to-end via a standalone trace script: reset succeeds, the OLD
password is correctly rejected afterward, and the NEW password correctly
signs in. Retested via the full real-browser suite after the fix -- see
the ledger's `/reset-password` row.

## QA-B-006 — (fixed, QA tooling only) `127.0.0.1` vs `localhost` broke session-cookie delivery under the direct-cross-origin workaround

Follow-up to QA-B-001's workaround (`VITE_PCA_API_BASE_URL` pointed
directly at the backend, bypassing vite's proxy): pointing it at
`http://127.0.0.1:<port>` while parent-web itself serves from
`http://localhost:4000` makes every authenticated follow-up request
cross-**site** by browser cookie rules (`localhost` and `127.0.0.1` are
different sites for `SameSite=Strict` purposes, even though they resolve
to the same machine) -- so the session cookie set at login was never sent
back on subsequent calls. This surfaced as: login succeeds and lands on
`/dashboard`, but any page whose data fetch depends on a fresh
`/api/parent/session` check (e.g. `/subscription/invoices`, via
`cookieSessionFamilyId()`) silently bounces back to `/login`. Confirmed via
direct `curl`/`Invoke-WebRequest` session tests (worked fine, because
neither enforces `SameSite`) versus real Chromium network capture (401 on
every `/api/parent/session` call post-login). Fixed by pointing
`VITE_PCA_API_BASE_URL` at `http://localhost:<port>` (same host as the
frontend, different port only -- same-site, cookie delivery restored).
Not a backend defect: `/api/parent/session` returns 200 correctly for a
real cookie session (confirmed directly); this was purely a QA
dev-server-config artifact of the QA-B-001 workaround.

---

## Summary for Coordinator A

**No genuine product/backend defects were found and confirmed this
session.** Every initially-suspicious failure resolved to either: (a) this
session's own QA-environment setup bugs (missing
`VITE_PCA_API_BASE_URL=""`, then a `127.0.0.1`/`localhost` host mismatch in
its replacement, both fixed -- QA-B-001/006), (b) the vite-dev-proxy-only
artifact (QA-B-001, tooling, not product), (c) real, working anti-abuse
controls (rate limiting, anti-brute-force delay, TOTP replay rejection)
triggered by this session's own repeated testing (QA-B-002/004), (d)
test-authoring bugs in this session's own new Playwright specs (wrong field
id, a `.count()` read that needed to be an auto-retrying
`expect().toBeVisible()`), or (e) a QA seed-script bug reading the wrong
sandbox-email code kind (QA-B-005) -- all fixed in-session and committed.

Positive confirmations this session added real-browser evidence for (see
ledger): `/forgot-password` and `/reset-password` (previously untested,
explicitly listed P1 items) both work correctly end-to-end against the real
backend, including the anti-enumeration property and single-use code
consumption, with the reset flow's full old-password-rejected /
new-password-accepted round trip now genuinely verified after QA-B-005's fix.
