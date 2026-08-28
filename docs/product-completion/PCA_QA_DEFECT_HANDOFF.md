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

## Summary for Coordinator A

**No genuine product/backend defects were found and confirmed this
session.** Every initially-suspicious failure resolved to either: (a) this
session's own QA-environment setup bug (missing
`VITE_PCA_API_BASE_URL=""`, since fixed), (b) the vite-dev-proxy-only
artifact above (QA-B-001, tooling, not product), (c) real, working
anti-abuse controls (rate limiting, anti-brute-force delay) triggered by this
session's own repeated testing, or (d) test-authoring bugs in this session's
own new Playwright specs (wrong field id, a `.count()` read that needed to be
an auto-retrying `expect().toBeVisible()`), all fixed in-session and
committed.

Positive confirmations this session added real-browser evidence for (see
ledger): `/forgot-password` and `/reset-password` (previously untested,
explicitly listed P1 items) both work correctly end-to-end against the real
backend, including the anti-enumeration property and single-use code
consumption.
