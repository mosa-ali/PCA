# PUBLIC_0_DISCOVERY_REPORT

**Programme:** PCA Public Website + Product Identity + Parent PWA
**Phase:** PUBLIC-0 — Discovery & Requirements Reconciliation
**Mode:** READ-ONLY. No source file created, edited, staged, stashed or committed. No Azure/DNS/certificate change.
**Coordinator:** PCA Public Programme Coordinator
**Generated:** 2026-09-04

**Method:** 11 parallel read-only discovery lanes (dynamic workflow) + 11 adversarial verification agents that were instructed to *refute* each lane's load-bearing claims. 22 agents, 838 tool calls, 0 errors. 7 claims were refuted or corrected as overstated; those corrections are incorporated below and flagged. Live domain/TLS probing and the highest-consequence code claims were re-verified by the coordinator directly.

---

## 1. Repository baseline

```
PUBLIC_ENTRY_LOCAL_SHA        = 7ebd9c546310efa389ce9246b056a79674c11d04
PUBLIC_ENTRY_REMOTE_PCA_DEV   = 7ebd9c546310efa389ce9246b056a79674c11d04   (in sync)
PUBLIC_ENTRY_REMOTE_MAIN      = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd   (untouched)
BRANCH                        = pca-dev
```

`main` was not merged, fetched-into, or modified. No force push. No `git add -A`.

### Repository shape

**This is not a monorepo.** There is no root `package.json`, and no `pnpm-workspace.yaml` / `lerna.json` / `turbo.json` / `nx.json` / `rush.json` / root lockfile. It is six independent npm packages plus two native platforms:

| Package | Identity | Stack |
|---|---|---|
| `backend/` | `pca-backend` | Fastify 5.11.3 + mysql2 3.15.2, TS 5.8.3. **Only 2 runtime deps.** No ORM. No linter. |
| `parent-web/` | `pca-parent-web` | React 18.3.1 + Vite 6.4.3 + react-router-dom 7.18.2, TS 5.5.4, vite-plugin-pwa 0.21.2. Port 4000. |
| `platform-admin-web/` | `pca-platform-admin-web` | Same stack, no PWA. Port 4100. |
| `parent-sdk/browser-runtime` | `@pca/parent-sdk-browser-runtime` | 0-dep TS lib |
| `parent-sdk/runtime-sync` | `@pca/parent-sdk-runtime-sync` | 0-dep TS lib — **orphan: imported by no package** |
| `parent-sdk/wellbeing-control` | `@pca/parent-sdk-wellbeing-control` | 0-dep TS lib |
| `android/` | Gradle Kotlin DSL | — |
| `ios/` | Xcode project | — |

Cross-package linking is npm `file:` protocol only. Backend port 4001.

---

## 2. THE HEADLINE FINDING — nothing is deployed

The owner's evidence that the App Service is live and healthy is correct. What is running on it is **not PCA**.

All five secured hostnames resolve to the **same** Azure IP (`20.74.195.2`) and return the **byte-identical stock nginx default welcome page**:

| Hostname | DNS | HTTPS | Body md5 | Server | Serving |
|---|---|---|---|---|---|
| www.pcasafe.com | 20.74.195.2 | 200 | `e3eb0a1d…` | nginx/1.19.2 | nginx default page |
| app.pcasafe.com | 20.74.195.2 | 200 | `e3eb0a1d…` | nginx/1.19.2 | nginx default page |
| parent.pcasafe.com | 20.74.195.2 | 200 | `e3eb0a1d…` | nginx/1.19.2 | nginx default page |
| platform.pcasafe.com | 20.74.195.2 | 200 | `e3eb0a1d…` | nginx/1.19.2 | nginx default page |
| api.pcasafe.com | 20.74.195.2 | 200 | `e3eb0a1d…` | nginx/1.19.2 | nginx default page |
| **pcasafe.com (apex)** | **NXDOMAIN** | — | — | — | **does not resolve** |

Corroborating probes:

- `Last-Modified: Tue, 11 Aug 2020 14:50:35 GMT` and `ETag: "5f32b03b-264"` — identical on every host. This is the `nginx:1.19.2` container image's built-in default page, untouched since the image was built.
- `/login`, `/health`, `/index.html`, `/api/health`, `/v1/health`, `/api/auth/login`, `/dashboard` → all **404** (153-byte nginx default 404), except `/index.html` which returns the same 612-byte welcome page.
- **`api.pcasafe.com` does not serve the PCA backend.** It serves the same nginx placeholder. No API is reachable on it.

### What is genuinely good

- **TLS is valid and correct on all five hosts.** Per-hostname DigiCert / GeoTrust TLS RSA CA G1 certificates, `notBefore 2026-09-04`, `notAfter 2027-03-04`, `ssl_verify_result = 0`. SAN matches the host. This is consistent with App Service Managed Certificates.
- **HTTP→HTTPS redirect works**: `http://www.pcasafe.com/` → `301` → `https://www.pcasafe.com/`. App Service "HTTPS Only" is on.

### What this means for Release A

This is *favourable*, not alarming. There is **no live Parent, Admin or API application to damage**. Deploying Release A cannot break a running product, because no product is running.

But it also means: **there is no host-based routing.** One IP, one container, five hostnames, one response. Serving different applications per hostname is entirely undesigned work — see §9.

### Missing security headers on the live hosts

No `Strict-Transport-Security`, no `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`. Also `Server: nginx/1.19.2` (an August-2020 build) is disclosed. All are Release A gate items.

### Azure control plane — RESOLVED (owner re-authenticated)

Initial management calls failed with `AADSTS50078` (MFA expired). The owner re-authenticated and read-only discovery completed. **No subscription ID, verification ID, publish profile, credential, or app-setting value is recorded anywhere in this report — resource names and configuration flags only.**

`PUBLIC_0_AZURE_CONTROL_PLANE = COMPLETE`

#### The topology question is answered: ONE App Service holds all five bindings

| Property | Value |
|---|---|
| App Service | **`pca`** — Linux, Running, HTTPS Only, UAE North |
| Resource group | `AppWenPlan` |
| App Service Plan | **`NEWWEPPLAN` — B1 Basic, Linux, capacity 1** |
| Custom hostname bindings | **`www` · `app` · `parent` · `platform` · `api`.pcasafe.com — all five, all `SniEnabled`** |
| Container | `linuxFxVersion: sitecontainers`; main container image **`mcr.microsoft.com/appsvc/staticsite:latest`**, targetPort 80, Anonymous, no startup command, no environment variables |
| Container created | 2026-09-04 06:39 |
| Deployment source | **none configured** — `repoUrl: null`, `isGitHubAction: false` |
| App settings | exactly one: `WEBSITES_ENABLE_APP_SERVICE_STORAGE` |
| `alwaysOn` | **false** |
| `http20Enabled` | **false** |
| `healthCheckPath` | **null** |
| `minTlsVersion` | 1.2 |
| `ftpsState` | FtpsOnly |

`mcr.microsoft.com/appsvc/staticsite:latest` is **Azure's own default placeholder container** — it is the nginx that serves the welcome page observed externally. This closes the loop: the App Service is genuinely healthy, and it is healthily serving Microsoft's placeholder because nothing has ever been deployed to it.

#### Three further findings with direct Release A impact

1. **The B1 plan is shared with an unrelated product.** `NEWWEPPLAN` (B1 Basic, capacity 1) hosts **three** App Services: `pca`, `ims-platform` (Running) and `ims-v1` (Stopped). PCA shares one Basic instance's CPU and memory with the IMS product. This is a capacity and noisy-neighbour consideration for a public marketing site, and it is an owner decision whether to separate them.
2. **`alwaysOn` is false.** On App Service the app unloads after roughly 20 minutes idle, so the first visitor after a quiet period pays a cold start. For a public site whose Release A gates include LCP, this should be enabled before launch. B1 supports it.
3. **`http20Enabled` is false and `healthCheckPath` is null.** Both are one-flag changes that belong in the predeploy checklist, not in this phase.

**No Azure change of any kind was made.** No DNS, certificate, binding, container, app setting or plan was modified.

---

## 3. Deployment and CI — there is none

| Artifact | Status |
|---|---|
| Dockerfiles | **1** — `backend/Dockerfile` (Fastify API only; copies no frontend assets; no `EXPOSE`, no `USER`, no `HEALTHCHECK`) |
| Frontend Dockerfile | **NOT_FOUND** for either SPA |
| compose files | 5, all in `backend/`, all disposable `mysql:8.4` test harnesses. No app service, no proxy. |
| GitHub Actions workflows | **1** — `.github/workflows/quality-gates.yml` |
| Deploy job / Azure action | **NOT_FOUND**. `permissions: contents: read`; the file states outright it "does not receive credentials, publish artifacts, deploy, or modify repository state". |
| `azure-pipelines.yml`, `.deployment`, `web.config`, `staticwebapp.config.json`, bicep/ARM, Terraform, `infra/` | **all NOT_FOUND** |
| nginx / Caddy / any reverse-proxy config | **NOT_FOUND** |
| Host-based routing (`req.hostname`, `headers.host`, `server_name`, `proxy_pass`, `vhost`) | **NOT_FOUND** — the single repo-wide hit is an iOS custom-URL-scheme deep link, not HTTP virtual hosting |
| `pcasafe` anywhere outside `docs/` | **zero files** |

**Both SPAs' configs assume a reverse proxy that does not exist in this repository.** `platform-admin-web/vite.config.ts:14-16` states the app "is deployed same-origin behind a reverse proxy in every real environment", and its `.env.example` tells deployers to leave the API base URL empty for that reason. That proxy is the missing piece of the whole topology.

`backend/Dockerfile` also does not set `HOST`, and `main.ts:263` defaults to `127.0.0.1` — deployed as-is the container would accept no external connections.

---

## 4. Existing public surface — none

- **No public/marketing/landing package exists.** Verified four independent ways, including a repo-wide `pcasafe` grep returning zero non-docs files, and `grep -rniE 'landing|marketing|\bhero\b'` over both `src/` trees returning **zero** hits.
- No `robots.txt`, no `sitemap.xml`, no canonical link, no OpenGraph or Twitter tags anywhere.
- No head-management library (`react-helmet` / `@unhead` / `next/head`) and no `document.title` write anywhere. Each app serves **one static title to every crawler**.
- `platform-admin-web/index.html:7` has `<meta name="robots" content="noindex, nofollow">`. **`parent-web/index.html` has no robots meta** — the parent console is currently indexable.
- **No feedback / report-a-problem / suggest-a-feature / rate UI exists anywhere.** A `feedback` grep over all application source returns zero matches. PUBLIC-10 is net-new, not an extension.
- No privacy policy or terms **implemented**. Provisional drafts exist only in `PCA_PUBLIC_CONTENT_EN.md` §15/§16. *(Corrected: one lane initially claimed no such text existed anywhere; the verifier established the drafts do exist in docs.)*

### Already-tracked open V1 blockers this programme inherits

From `docs/pre-production/PCA_PPR1R_DEFECT_REGISTER.csv` — these are **not** new discoveries:

| ID | Defect | Class | Status |
|---|---|---|---|
| PPR1R-D035 | No privacy policy document, page or URL exists anywhere | COMPLIANCE_REQUIRED | OPEN — V1 blocker, PRODUCT_OWNER |
| PPR1R-D034 | No parental-consent artifact exists | NEW_FEATURE_ARCHITECTURE_REQUIRED | OPEN |
| PPR1R-D036 | No account-deletion path exists | — | OPEN |
| PPR1R-D039 | `frame-ancestors` inert in meta CSP → no clickjacking protection; no repo-side hosting layer | PRODUCTION_INFRA_REQUIRED | OPEN |

`PCA_PPR1_OWNER_DECISIONS.md:339` (D13) records that the privacy policy "cannot be written without" the data-controller ruling.

---

## 5. Routing and auth inventory

### parent-web unauthenticated routes (the only non-gated surface in the repo)

`parent-web/src/App.tsx:57-61`, deliberately outside `AppLayout`:

| Route | Component |
|---|---|
| `/register` | `pages/auth/Register.tsx` — **note: `/register`, not `/signup`** |
| `/verify-email` | `pages/auth/VerifyEmail.tsx` |
| `/login` | `pages/auth/Login.tsx` |
| `/forgot-password` | `pages/auth/ForgotPassword.tsx` |
| `/reset-password` | `pages/auth/ResetPassword.tsx` |

Everything else (60+ routes) is nested under `<Route element={<AppLayout />}>` at `App.tsx:63`. `AppLayout.tsx:71-74` is the authentication gate and fails closed.

`platform-admin-web` mirrors this: one `/login`, everything else behind `<RequireSession>`.

### Route collisions with the approved public IA — must be resolved before any page is written

| Public IA route | Conflict in `parent-web/src/App.tsx` |
|---|---|
| `/` (public home) | index route `:64` → `Navigate to="/dashboard"`, **inside the auth gate** → anonymous visitor is redirected to `/login` |
| `/privacy` (public overview) | `:107` → authenticated **Data & Privacy hub**, plus 5 sub-routes `/privacy/{retention,export,delete,transparency,permissions}` |
| `/download` (public install guidance) | `:251` → authenticated child-app download page |
| `/security` (public overview) | `/security/{status,trusted-browser,recovery,audit}` |
| `/signup` | **does not exist** — the app implements `/register`, hard-linked from `Login.tsx:147` and `VerifyEmail.tsx:101` |
| public 404 | catch-all `path="*"` at `:254` is **inside the gate** → every unknown public URL redirects an anonymous visitor to `/login`, never showing a 404 |

### Auth shell

**`NOT_FOUND` as a component.** There is no `AuthLayout` / `AuthShell` / `RequireAuth`. The five auth pages are flat siblings sharing only a `.auth-page` CSS class (`global.css:1996-2017`). Consequences:

- Auth pages have **no header, no logo, no footer**.
- **No language switcher on any parent-web pre-login screen.** `LanguageSwitch.tsx` renders only from `shell/Header.tsx:168`, which renders only inside `AppLayout`. An Arabic-speaking parent arriving at `/login` can only reach Arabic by hand-typing `?lng=ar`. *(platform-admin-web deliberately does the opposite and puts a switcher on its Login page.)* This directly contradicts the approved IA §9/§14 requirement that the switcher be available before login.
- parent-web renders **no sign-out control at all** (`ProfileMenu.tsx:10-15` documents the deliberate absence).
- parent-web's `/login` does not redirect an already-authenticated visitor.

Release A must hide or divert Login / Create Account, but **there is no feature flag, kill switch or env gate anywhere in the router** to turn the auth routes off. They are live and reachable today.

---

## 6. Transactional email — RELEASE B IS HARD-BLOCKED

**There is no real transactional email sender anywhere in the repository.** `backend/package.json` declares exactly two runtime dependencies: `fastify` and `mysql2`. A repo-wide search for nodemailer / SendGrid / SES / Postmark / Mailgun / Resend / SMTP / Azure Communication Services returns **zero** matches.

Coordinator-verified directly in `backend/src/main.ts:246-260`:

```js
class RejectingEmailSender implements EmailSenderPort {
  async sendVerificationCode(): Promise<void> {
    throw new Error('Email sending is not configured in production (PCA-ADD-IDENT-005 EXTERNAL_GATE, provider not yet selected).');
  }
  …
}
function createDefaultEmailSender(env = process.env): EmailSenderPort {
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') return createTestSandboxEmailSender(env);
  return new RejectingEmailSender();          // ← this is what production gets
}
```

And in `backend/src/parentaccount/ParentAccountService.ts:174-178`:

```js
try {
  await this.emailSender.sendVerificationCode(email, code);
} catch {
  // deliberately swallowed -- see this method's own doc comment.
}
```

**The throw is swallowed.** In production, `POST /api/parent/register` returns `202 PENDING_VERIFICATION` and `POST /api/parent/request-password-reset` returns `202 RESET_CODE_SENT_IF_ACCOUNT_EXISTS`, the code is written to MySQL, and **it never leaves the process**. A real user hits a silent dead end at `/verify-email` with no error and no way to obtain a code. The same applies to password reset.

No test covers this gate — a green backend suite proves nothing about email.

### PUBLIC-9A gate status (all sixteen checks)

| Check | Status |
|---|---|
| SIGNUP | Endpoint exists; **cannot complete** — no delivery |
| SIGNUP_EMAIL_DELIVERY | **INFRASTRUCTURE_BLOCKED** |
| VERIFY_EMAIL / RESEND_VERIFICATION | **INFRASTRUCTURE_BLOCKED** (also: no dedicated resend endpoint — re-POST `/register`) |
| DUPLICATE / REPLAYED / EXPIRED_VERIFICATION | Logic present (single-use CAS, 15-min TTL, 8-attempt cap) — **unprovable without delivery** |
| FORGOT_PASSWORD / RESET_PASSWORD_EMAIL / RESET_PASSWORD | **INFRASTRUCTURE_BLOCKED** |
| EXPIRED / REPLAYED_RESET_TOKEN | Logic present — unprovable |
| ACCOUNT_ENUMERATION | **PREVENTED** — genuinely implemented (identical 202s; login collapses all failures to one 401 and runs scrypt against a fixed dummy hash to equalise timing) |
| RATE_LIMITING | Present and thorough (dual per-IP + per-email-hash budgets on all five identity endpoints) — but **in-process only**; multi-instance deployment multiplies every budget |
| EN_EMAIL_CONTENT / AR_EMAIL_CONTENT | **NOT_FOUND and structurally impossible today** — `EmailSenderPort` is `(email, code)` with no locale parameter, and the backend `MessageId` union contains no email ids. Closing this needs a widened port + new message ids, not configuration. |
| EMAIL_LINK_REAL_DOMAIN | **BLOCKED** — no sender, and `api.pcasafe.com` serves nginx default |

No value above is reported as PASS. Nothing was fabricated.

### Additional auth-security findings raised by the adversarial verifiers

These are real and worth routing to the PPR-2/security owner — they are **not** in this programme's remit to fix, but they bound what the public site may claim:

1. **Verification and reset codes are unsalted, unpeppered SHA-256 over a 6-digit code.** `verificationCode.ts:19-27`: `randomInt(0, 10**6)` then plain `createHash('sha256')`. The entire keyspace is 1,000,000 digests — `code_hash` is trivially reversible from any DB read, backup or replica, and a recovered live reset code is an account takeover. Contrast the same domain's password handling: scrypt N=32768 with a 16-byte random salt.
2. **`resetPassword` did not receive the hardening `verifyEmail` was explicitly given.** `ParentAccountService.ts:468` uses `findLatestPasswordResetCode` — a single-newest `ORDER BY … LIMIT 1` lookup. The same service's own doc comment (`:186-205`) records that this exact shape was *rejected* for verification because "a hostile re-registration silently invalidates the code the real mailbox owner is holding". An attacker who knows a victim's email can, within the 5/hour budget, keep displacing the victim's reset code indefinitely.
3. **`hashParentEmail` is unkeyed SHA-256** over the lowercased address, with no pepper or per-row salt, yet its doc comment presents it as the privacy mechanism for `parent_accounts`. Against a mailing list it is offline-enumerable: the stored hash is a lookup key, not a privacy control. **This constrains privacy copy** — it must not be described as making parent identity unrecoverable.

---

## 7. Security topology

### CORS — single origin

`backend/src/http/parentWebCors.ts` is the only CORS implementation. It is a **single exact origin**, not a list: `resolveParentWebOrigin()` reads `PCA_PARENT_WEB_ORIGIN`, defaulting to `http://localhost:4000`. Credentials allowed. Wildcard throws.

**It cannot serve two origins.** `www.pcasafe.com` and `app.pcasafe.com` cannot both be cross-origin clients without a code change. And `PCA_PARENT_WEB_ORIGIN` is **not documented in `backend/.env.example`** — a deployer following the example file silently ships the localhost default, which looks like a backend outage rather than a config miss.

### Cookies

Both serialized by hand in `backend/src/parentaccount/cookies.ts:43-48`:

| Cookie | HttpOnly | Secure | SameSite | Domain | Max-Age |
|---|---|---|---|---|---|
| `pca_family_session` | yes | only when `NODE_ENV==='production'` | Strict | **none (host-only)** | 43200 |
| `pca_family_csrf` | no (double-submit) | same | Strict | **none (host-only)** | 43200 |

The `Secure` gate **fails open** when `NODE_ENV` is unset. Only `backend/Dockerfile` sets it.

**Corrected by verification:** it does *not* follow that no cross-host interaction is possible. Three qualifications matter for a public site on the same registrable domain:

- **No `__Host-` / `__Secure-` prefix is used.** Nothing prevents a sibling host under `pcasafe.com` from setting a `Domain`-scoped cookie of the same name that the browser attaches to the API host.
- **The server resolves duplicate cookies last-wins** (`cookies.ts` uses `result.set`), while parent-web resolves them **first-wins** (`document.cookie.split('; ').find(...)`). They disagree — an unmitigated shadowing/fixation surface.
- **CORS enforcement is preflight-only**: `parentWebCors.ts:55-58` returns 403 only for `OPTIONS`. A non-OPTIONS request from a disallowed origin is served normally, just without CORS headers. And because `pcasafe.com` and `app.pcasafe.com` are the **same site**, `SameSite=Strict` does not separate them — a public-site page could cause authenticated requests to execute against the API even though it cannot read the responses. No test covers a same-site sibling origin.

### Security headers

**The backend sets none.** No helmet. The only CSP in the repo is a build-time `<meta>` tag injected by each SPA's Vite plugin, where `frame-ancestors` is **inert** per CSP Level 3 — both consoles are framable today. HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy: all NOT_FOUND, and there is no hosting layer in the repo to put them in.

### Parent ↔ Platform Admin boundary — VERIFIED INTACT

This is the one inherited `VERIFIED_AVAILABLE` claim (CLM-046) that discovery **confirms**:

- **Separate transports** — Parent accepts cookie or Bearer; Platform Admin is Bearer-**only**, with no cookie code path at all (`fastifyPlatformAdminAuthPlugin.ts:41-50` never imports `parseCookies`; `platformAdminAuthRoutes.ts` contains zero `Set-Cookie`).
- **Separate token audiences** — admin tokens are `pa_` + 43 chars; family tokens are 43 chars with no prefix. Each plane's plausibility check runs before any DB lookup, so a token from one plane can never reach the other's query.
- **Separate request fields, separate storage** (7 dedicated tables, migration 0005), **separate RBAC** (closed 5-role matrix, disjoint from family authz).
- **Proven by test** — `backend/test/platformadmin/crossRealm.test.mjs`, both rejection directions 401.
- `/parent/admin`, `isAdmin`, `isPlatformAdmin`, `adminOverride`, `superuser`, impersonation/login-as: **all genuinely NOT_FOUND**. Every repo-wide match is a negative-assertion test or a prohibition doc.

**One caveat to record:** both realms run on the **same Fastify instance and port**, and the CORS hook is global with no `/platform-admin/*` exclusion. The boundary rests on token-audience separation, not transport or process isolation. No current test would catch a future change that added cookie support to the admin plane or widened the CORS allowlist.

---

## 8. i18n / RTL, design system, PWA

### i18n — strong foundation, one blocking gap

| | parent-web | admin | backend | Android | iOS |
|---|---|---|---|---|---|
| Key parity EN↔AR | **1079/1079** | **535/535** | **112/112** | **315+1** | **35/35** |
| Enforced by a real test CI runs | yes | yes | yes | yes | yes |

Locales are exactly `en` and `ar` everywhere. RTL is genuinely first-class in parent-web: **zero** physical `margin-left`/`padding-right`/`left:` box declarations in its 2,672-line stylesheet — logical properties throughout, with only two `[dir='rtl']` escape hatches. `<bdi>` bidi isolation at 37 sites. `applyDocumentDirection()` sets `dir`/`lang` on `languageChanged`.

**Blocking gap — Arabic is not release-approved.** 127 parent-web keys are listed in an `_arReviewPending` array as machine-suggested Arabic awaiting native-reviewer sign-off. `android/.../values-ar/strings.xml` and `backend/src/i18n/messages/ar.ts:5-6` carry the same warning. `PCA_PPR2_OWNER_DECISIONS.md:216` states this Arabic is **"NOT APPROVED FOR RELEASE"** — and the ledger is stale, saying 115 where the array holds 127. **Nothing in code, tests or CI reads that list**, so the flag cannot block a build. This matches OD-12 and gates CLM-050/CLM-051.

Other material gaps: **no Playwright/e2e job exists in CI at all**, so every RTL spec (including the geometric sidebar assertion) never runs automatically. Both `index.html` files serve static `lang="en" dir="ltr"`, so a crawler always sees English/LTR — the public site must serve correct static `lang`/`dir` per locale or Arabic pages will be misindexed. `platform-admin-web` does not persist locale at all and has 34 locale-omitting `toLocale*()` calls across 16 files — the exact bug class parent-web fixed and guards.

### Design system

Hand-written plain CSS, no Tailwind / CSS Modules / CSS-in-JS / UI kit / icon library / charting library. Two tracked stylesheets. parent-web carries a genuine documented **two-layer token system, 146 CSS custom properties**, light-only, brand accent **teal `#0f766a`**.

Findings that bear on Release A:

- **Brand hue conflict — owner decision.** The shipped accent is teal. `PCA_PUBLIC_DESIGN_GUIDELINE.md` §3 recommends a *"calm medium blue family"* as the **primary action** colour with teal/green demoted to a trust accent. §3 is explicitly `OWNER_APPROVAL_PENDING`. Implementing it literally makes the public site's primary button a different hue from the Parent console's — or forces re-deriving parent-web's whole accent chain (PPR-2 territory). **Compounding risk:** `platform-admin-web`'s accent `#4f8cff` sits in exactly that blue family, so a blue public primary could visually merge the public brand with the *operator console* — against Design Guideline §27's realm-separation requirement.
- **No brand assets exist.** No logo, no wordmark, no OG/social image. Five tracked assets total: two `favicon.svg` and three PWA icons that are self-declared placeholders (`generate-icons.mjs`: *"Placeholder only: swap for real brand assets before shipping"*). The guideline's header §7 and footer §9 both assume a logo that does not exist.
- **No webfonts at all**, and the production CSP is `font-src 'self'`. Guideline §4 asks for a family with strong Arabic and Latin support; adding one is a CSP change plus a PWA cache-size decision, not a CSS edit.
- **Contrast is unverified.** Every WCAG ratio in `global.css` is a hand-written comment. The only a11y gate is `vitest-axe` running under **jsdom**, where axe-core's `color-contrast` rule cannot compute a result at all (no layout, no colour compositing). No contrast check exists anywhere. *(This is the "green signals that mean nothing" pattern again.)* No `forced-colors` or `prefers-contrast` block exists either.
- `--content-max` is 90rem (1440px) vs the guideline's 1180–1280px content / 720–820px long-form.
- **Verifier correction:** the two-layer invariant is already broken — four component rules make seven direct `var(--pca-*)` Layer-1 references (`global.css:1655, 1712-1713, 1757-1759, 2343`). A third stylesheet also ships inline in `public/offline.html:7-28` with hard-coded hexes outside the token system.
- There is **no written design-system spec** in the repo, despite `global.css` citing "spec sections 1-3" and "spec section 1.7". The CSS header comment is currently the only design documentation that exists.

### PWA — greenfield, and Release C not Release A

`vite-plugin-pwa` 0.21.2 in parent-web only. No source manifest or SW file; both generated. Caching is deliberately app-shell-only with `runtimeCaching: []` and an explicit E2EE comment — **this is correct and matches OD-09.**

- **Zero install-prompt handling exists anywhere.** `beforeinstallprompt`, `appinstalled`, install banner, standalone/display-mode detection, dismissal persistence, OD-08's 30-day timer — all absent. Entirely greenfield.
- **Trusted Browser is a real, structurally separate subsystem** (six-state machine, non-extractable ECDSA P-256 key held in memory only, backend device-registration routes, migration 0026). No code path links install/standalone state to trust state. **CLM-022 is supported.** The one leak is *copy, not code*: the shipped manifest description says *"decrypted only in a trusted parent browser context"*, which browsers surface in install UI and which brushes the guideline's prohibited-claims list.
- `registerType: 'autoUpdate'` + `skipWaiting()` + `clientsClaim()` **contradicts PWA Guideline §16** ("avoid silently reloading while a parent is typing"; "allow the user to apply the update at a safe moment").
- `navigateFallback: '/offline.html'` (not `/index.html`) is the SW's only NavigationRoute — plausibly resolving every SW-controlled navigation to the offline page rather than the SPA shell. **Nothing tests it.**
- `scope: '/'` and `start_url: '/'` — **any public route on the same origin would be shadowed by the parent console's precached shell.** This is a hard origin-separation requirement, not a preference.
- `offline.html` is hardcoded `lang="en"` with no RTL handling.
- **Zero PWA test coverage of any kind.**

---

## 9. Architecture recommendation — separate `public-web` package

Every independent line of evidence converges on the same answer. **PCA Public must be a new, standalone, lightweight package on its own origin — not a route family inside `parent-web`.**

| Evidence | Consequence of putting Public inside parent-web |
|---|---|
| **Zero code splitting.** 0 dynamic imports, 0 `React.lazy`, 0 `Suspense`; no `build` key in `vite.config.ts`. One 719,632-byte JS chunk. `App.tsx` has 49 eager page imports; `api/client.ts` eagerly imports all 21 Dev fixture + 22 Real clients. | Every anonymous marketing visitor downloads the entire authenticated console, both locales and all API clients. |
| **Both locales statically imported** (`en.json` 78,636 B + `ar.json` 105,222 B = 183,858 B, ~15% of src) | Arabic ships to English visitors and vice versa. |
| **SW `scope: '/'`, `navigateFallback: '/offline.html'`** | Public routes shadowed by the parent console's precached shell; the "PCA Parent Console" install prompt would apply to marketing pages. |
| **Route collisions** on `/`, `/privacy`, `/download`, `/security`; `/signup` vs `/register`; catch-all inside the auth gate | One of each pair must be renamed; anonymous visitors get `/login` instead of a public 404. |
| **CSP baked at build time**, `connect-src 'self' http://localhost:4001` | Any public-site font/analytics/embed forces loosening the console's own CSP. |
| **Static `lang="en" dir="ltr"` in `index.html`; direction applied post-JS** | Arabic public pages misindexed as English. |
| **`parent-web/**` is entirely PPR-2 territory** (see §10) | Concurrent-edit corruption risk. |
| **Demo/fixture machinery** — `productionDemoModeGate.mjs` exists because the app is fixture-backed | Widens the blast radius of the demo-mode gate onto a genuinely public build. |

**Precedent exists:** `platform-admin-web` is already exactly this shape — a self-contained sibling, 66 src files, with a deliberately separate session/RBAC model.

**Honest costs of a new package** (no workspace tooling exists, so nothing is free):

1. A seventh standalone `node_modules` + `package-lock.json`. No hoisting, no shared install.
2. `tooling/repo-checks/Invoke-RepositoryChecks.ps1:38`'s `$AllowedTopLevel` array **hard-fails on any new top-level tracked path** until edited. One line, but a hard gate.
3. `.github/workflows/quality-gates.yml` hardcodes `working-directory:` per package and enumerates all six packages in the dependency-audit/SBOM job. A new package gets **zero CI coverage** — no build, no test, no HIGH/CRITICAL audit — until ~7 blocks are edited.
4. No shared UI/design-system/eslint-config/tsconfig-base package exists. Tokens must be duplicated or a shared package created. **Note:** the two existing copies of `securityHeadersPlugin.ts` have already diverged (75 vs 109 lines) — copying the wrong one would ship weaker headers on the public site.
5. ESLint 8.57.0 with legacy `.eslintrc.cjs` is end-of-life; there is no flat-config migration in the repo to copy.
6. `react-router-dom` + `BrowserRouter` needs SPA history fallback at the hosting layer, and there is **no SSR/SSG framework anywhere** in the repo — a real risk against the Release A SEO gate. Prerendering or static generation should be decided in PUBLIC-2.

**Release A should make zero backend calls.** That keeps it entirely clear of the single-origin CORS constraint, the missing reverse proxy, and the same-site cookie-shadowing surface. Contact should be a `mailto:` or a deferred item until PUBLIC-8 resolves a safe intake path.

---

## 10. PPR-2 concurrency safety — ownership ledger

**A PPR-2 session is live in this tree right now.** Dirty-file mtimes were 10:32–10:35 against a 10:40 clock at discovery time.

### Current dirty state

Five modified tracked files, all `backend/`, one coherent change — `CREATE_INVITATION` flipped `requiresLicense: true → false`, citing *"OWNER DECISION … Part M"*:

```
 M backend/src/authz/policy.ts
 M backend/test/authz/service.test.mjs
 M backend/test/db/authz.mysql.test.mjs
 M backend/test/db/childProfileInvitationBindingHttp.mysql.test.mjs
 M backend/test/db/http.mysql.test.mjs
```

Plus one untracked tree: `docs/public/` — this programme's own documentation. **Zero tracked-file overlap.**

**Part M does not exist yet.** The committed ledger `docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` ends at Part L (line 617 of 693). The code cites a ledger section its author has not yet written — so that file is an imminent write target.

### `stash@{0}` — the sharpest trap, invisible to `git status`

Coordinator-verified read-only:

```
stash@{0}: On pca-dev: PRE-EXISTING uncommitted work found in main worktree at session start,
           unrelated to Session A writers -- needs separate investigation, DO NOT DROP
```

**48 files, 1,883 insertions.** It contains **precisely the files Public Release B/C would target**:

```
parent-web/src/pages/auth/{Login,Register,ForgotPassword,ResetPassword,VerifyEmail}.tsx
parent-web/src/i18n/index.ts
parent-web/src/i18n/locales/{en,ar}.json
parent-web/src/styles/global.css
parent-web/src/components/shell/{AppLayout,Header,Sidebar,Breadcrumb}.tsx
parent-web/src/rbac/PermissionGate.tsx
platform-admin-web/src/i18n/locales/{en,ar}.json          (+ 11 admin files)
```

**Never run `git stash pop`, `drop`, `clear`, `checkout`, `reset` or `add -A`.** A public writer editing those files guarantees a conflict on the eventual pop.

### Cross-programme collision the verifier surfaced

The uncommitted Part M decision — *"basic/free V1 child-device enrollment must not require an active paid license row"* — **is a free-tier commercial commitment**, and therefore a direct input to two public claims currently marked forbidden:

- **CLM-041** "PCA offers a permanent free plan." — `NOT_APPROVED_FOR_PUBLIC_CLAIM` / HIGH, rationale *"No free-tier promise yet."*
- **CLM-042** "PCA pricing is finalized and publicly available." — `COMMERCIAL_MODEL_PENDING`

**No `/access` copy may be written until Part M is committed and the claim register is reconciled**, or the public site may describe the wrong product. Three already-pushed PPR-2 evidence documents also go stale the moment the flip lands, and `parent-web/src/i18n/locales/en.json:230` ships a string asserting the license gate that Part M removes — a string that is *also* inside the stash.

Two further PPR-2 owner decisions constrain this programme directly: **D3** (privacy-policy URL authority) and **D7** (production origin topology).

`CURRENT_DIRTY_PATHS.txt` at repo root reads like an authoritative register but is dated **2026-08-18** and matches neither today's `git status` nor the stash. **Do not treat it as current.**

### Ownership ledger

| Classification | Paths |
|---|---|
| **`WAIT_FOR_PPR2_PATH` — hot, edited today** | `backend/src/authz/**`, `backend/test/authz/**`, `backend/test/db/**`, `docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` |
| **`WAIT_FOR_PPR2_PATH` — owned** | `backend/**` (esp. `src/childprofiles/`, `src/invitation/`, `src/http/buildServer.ts`, `src/http/routes/`, `src/main.ts`, `src/i18n/messages/`, `schema/migrations/`, `package.json`, `scripts/`); **`parent-web/**` in its entirety**; `platform-admin-web/src/**`; `docs/architecture/**`; `docs/pre-production/**`; `.github/workflows/quality-gates.yml`; `android/app/src/main/res/values*/**`; `CURRENT_DIRTY_PATHS.txt`; **the git stash itself** |
| **`SAFE_NOW`** | `docs/public/**` (this programme's own untracked tree — in no commit, no stash, no PPR-2 doc) and **one new top-level directory that does not exist today** (verified absent from `ls`, every stash entry and every recent commit) |

Migration numbering is a silent race: PPR-2 just added `0036`. If public feedback persistence ever needs a migration, both programmes reach for `0037`.

---

## 11. Phase state

| Phase | State |
|---|---|
| PUBLIC-0 Discovery | **COMPLETE** |
| PUBLIC-1 Brand/message | NOT_STARTED |
| PUBLIC-2 IA/routing | NOT_STARTED |
| PUBLIC-3 EN content | NOT_STARTED |
| PUBLIC-4 AR/RTL | NOT_STARTED |
| PUBLIC-5 Design system | NOT_STARTED |
| PUBLIC-6/7/8 Page families | NOT_STARTED |
| PUBLIC-9 Auth shell | **BLOCKED_EXTERNAL** — no email provider (§6) |
| PUBLIC-9A Email gate | **BLOCKED_EXTERNAL** — infrastructure absent |
| PUBLIC-10 Feedback | NOT_STARTED (net-new; needs a backend route ⇒ `WAIT_FOR_PPR2_PATH`) |
| PUBLIC-11 PWA | **WAIT_FOR_PPR2_PATH** — `parent-web/vite.config.ts` + `index.html` are the choke point and PPR-2 edited `index.html` in both recent commits. Also Release C, not A. |
| PUBLIC-12 A11y/SEO/perf | NOT_STARTED |
| PUBLIC-13 Browser UAT | NOT_STARTED |
| PUBLIC-14 Adversarial review | NOT_STARTED |
| PUBLIC-15 Release readiness | NOT_STARTED |

### Staged release status

```
PUBLIC_RELEASE_A = NOT_READY   (no source exists; buildable — see §9)
PUBLIC_RELEASE_B = BLOCKED     (no transactional email provider; EN/AR email structurally absent)
PUBLIC_RELEASE_C = NOT_READY   (PWA install UX greenfield; parent-web is PPR-2-owned)
PUBLIC_RELEASE_D = NOT_READY   (Android COMING_LATER by claim register; out of this programme's scope)
```

Per the v0.2 staged model, B/C/D being blocked does **not** block Release A.

---

## 12. Owner-level decision — now scoped by evidence

The topology question is **resolved**: one App Service (`pca`) holds all five `pcasafe.com` bindings, running Azure's placeholder container, with no deployment source configured.

**The consequence: any deployment to `pca` changes what all five hostnames serve simultaneously — including `api.pcasafe.com`.** There is no host-based routing in the App Service, and none in the repository.

Today this costs nothing, because all five already serve the same placeholder and no PCA application is live. It becomes a real constraint the moment Parent, Platform Admin or the backend need to differ from Public.

### Three viable paths, for owner decision at the predeploy gate

| | Approach | What it costs | What it buys |
|---|---|---|---|
| **A** | **Deploy Release A directly to `pca`.** All five hostnames serve the public marketing site. | `api`/`app`/`platform` would serve marketing pages — harmless now, wrong later. Must be replaced by B or C before Release B/C. | Fastest path to a live `www.pcasafe.com`. Zero new Azure resources. No binding changes. |
| **C** | **Host-routing container on `pca`.** One container that switches on `Host`: Public on `www` (+ `parent` alias), later `app`→Parent, `platform`→Admin, `api`→backend. | Must be built — it does not exist in the repo. Becomes shared infrastructure across all four surfaces. Everything stays on one shared B1 instance. | Matches the reverse-proxy topology both SPAs' configs already assume. Single place to set the real HTTP security headers (`PPR1R-D039`). No binding moves. |
| **B** | **Separate App Service per surface**, moving bindings accordingly. | Binding moves are routing-sensitive and need explicit owner authorisation. New plan capacity; more cost. | Cleanest isolation. Independent scaling, deploys and rollback per surface. Removes the shared-B1 noisy-neighbour issue. |

**Coordinator recommendation:** build Release A now as a standalone static artifact that is deployable under **any** of the three (§9). Decide between them at the `RELEASE_A_PREDEPLOY_REPORT` gate, when the artifact is real and its measured size and header requirements are known. **A** is a legitimate interim step *only* if the owner accepts that `api.pcasafe.com` will serve marketing HTML until B or C lands.

**Not decided here, and not actioned:** whether to enable `alwaysOn`, enable HTTP/2, set a health-check path, or separate PCA from the shared `NEWWEPPLAN` B1 plan. All four are recorded for the predeploy checklist.

**No destructive change was made or proposed.** No DNS, certificate, binding, container, app setting or App Service Plan was modified. No hosts-file trick was used.

---

## 13. Evidence integrity

- 22 agents, 838 tool calls, 0 errors, ~1.8M subagent tokens. Every lane was required to cite a real path it had actually read; every load-bearing claim was then handed to an independent agent instructed to refute it.
- **7 claims were refuted or corrected as overstated** and are reported here in corrected form: the "only two stylesheets" claim, the two-layer token invariant, the cookie cross-host conclusion, the "no privacy policy/terms text anywhere" claim (twice), the "phrases appear only in docs/public" claim, and a file-tree listing presented as exact command output.
- No claim in this report rests on a single unverified agent assertion where it was material. The live-domain, TLS, email-sender, CORS and stash findings were re-verified by the coordinator directly.
- No subscription ID, verification ID, publish profile, credential, secret or environment **value** appears anywhere in this report — variable names only.

```
PUBLIC_0 = COMPLETE
PUBLIC_DOCS_VERSION = v0.2
PUBLIC_DOCS_MISSING = 0
PPR2_TREE_INTEGRITY = PRESERVED (no file created, edited, staged, stashed or committed)
AZURE_STATE = UNCHANGED
```
