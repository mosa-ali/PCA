# 07 — Live Runtime, Domain Topology and Configuration

All live checks 2026-09-26, GET/HEAD only, no state change.

## 1. Domain topology (mission §13)

| Host | Serves | Status | Evidence |
|---|---|---|---|
| parent.pcasafe.com | Parent Web SPA | 200, TLS 1.3, cert→2027-03-04 | [LIVE] |
| platform.pcasafe.com | Platform Admin SPA + same-origin `/platform-admin/*` proxy | 200 + 401 unauth API | [LIVE] |
| api.pcasafe.com | Backend JSON API (no HTML: 404 JSON on unknown; 401 unauth) | per API assessment + re-probed 401 on `/api/parent/session` | [LIVE] |
| app.pcasafe.com | **not part of current topology** — TLS certificate verification FAILS (MaxRetryError/SSLError); historically a placeholder | [LIVE] |
| www.pcasafe.com | public web (separate programme; out of scope) | — | — |

- Parent/Platform UIs are NOT served from the backend host; each is its own nginx artifact —
  verified structurally (dist + live headers `server: nginx`) and behaviorally (SPA deep routes
  200 with app shell; api host returns JSON, never HTML) [LIVE].
- `app.pcasafe.com` has zero references in `parent-web/src` or `platform-admin-web/src` [READ].
  Docs/public still describe it as the *future* parent-web domain (Release C); the live parent
  console is parent.pcasafe.com. Owner decision pending — recorded, not judged here.

`DOMAIN_TOPOLOGY = PASS` (with the app.pcasafe.com note above)

## 2. Live headers (full set observed)

| Header | parent.pcasafe.com | platform.pcasafe.com |
|---|---|---|
| server / TLS | nginx / TLSv1.3, GeoTrust→2027-03-04 | nginx / same |
| strict-transport-security | **absent** | **absent** |
| content-security-policy | **absent as header**; meta CSP in HTML: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.pcasafe.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` | **header present**: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` + same meta |
| x-frame-options | DENY | DENY |
| x-content-type-options | nosniff | nosniff |
| referrer-policy | strict-origin-when-cross-origin | strict-origin-when-cross-origin |
| permissions-policy | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | same |
| cross-origin-opener-policy | same-origin | same-origin |
| cache-control | `no-cache` (shell) | `no-cache` (shell) |
| HTTP→HTTPS | 301 | 301 |

Notes: (a) meta CSP `frame-ancestors` is ignored by browsers — one console error per page load on
both domains (PP-F04; XFO still protects). (b) The parent's CSP correctly allow-lists the
cross-origin API. (c) Missing HSTS on both domains (PP-F04).

## 3. Live application behavior

- Parent `/login` (browser): full sign-in surface, EN/AR toggle, forgot-password + authenticator
  recovery + register links, email auto-focus (snapshot). Resource audit: 7 resources, only
  expected "failure" = the 401 session probe.
- Platform `/login` (browser): Language EN/AR + Appearance selector, Email/Password/Authenticator
  code, disabled-until-valid submit, "Operator access only" + "MFA required" copy (snapshot).
- Unauthenticated denials: platform whoami 401; parent session 401; GETs on POST-only routes 404
  (Fastify envelope); no HTML/error leakage.
- Live bundle extraction: parent bundle contains `apiBaseUrl:"https://api.pcasafe.com"` (correct)
  **and `deviceEnrollmentLinkBaseUrl:"http://localhost:4000/enroll"` (PP-F01 — the confirmed
  production defect)**; parent bundle genesis/replaces strings = 0; platform bundle contains no
  API host (same-origin design) and no operator secrets.

## 4. Environment configuration expectations (mission §27)

| Application | Variable | Classification |
|---|---|---|
| parent-web | `VITE_PCA_API_BASE_URL` | PRESENT (baked `https://api.pcasafe.com`); production guard throws on missing/loopback (`env.ts:34-62`) |
| parent-web | `VITE_PCA_DEMO_MODE` | PRESENT (false in prod; CI gate + negative control) |
| parent-web | `VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL` | **ABSENT/UNDOCUMENTED** — fallback localhost is live (PP-F01); not in `.env.example`, docs, or CI |
| parent-web | `VITE_PCA_ANDROID_APP_DOWNLOAD_URL` | optional by design (unset = honest "no download configured" page; `.env.example` documents) |
| platform-admin-web | `VITE_PCA_PLATFORM_ADMIN_API_BASE_URL` | ABSENT deliberately (empty = same-origin; `env.ts:14-26` documents why) |
| both | debug/source-map flags | none found; no staging/production ambiguity found in source |

## 5. Fixture / demo / mock paths (mission §28)

- parent-web: all "demo" hits are comments + the documented `VITE_PCA_DEMO_MODE` gate; fixtures are
  constructed **only** when `config.demoMode===true` (`api/client.ts:344-354`); production builds
  cannot flip it (build-time replacement + CI `gate:demo-mode:both` with a negative control);
  `unavailableProviders.ts` throws honest unimplemented errors instead of fixtures [READ].
- platform-admin-web: 2 comment-only hits; `ComingSoon.tsx` documents "never renders
  placeholder/sample data"; e2e mocks exist in tests only [READ].

```text
PARENT_PRODUCTION_FIXTURE_RISK   = NONE
PLATFORM_PRODUCTION_FIXTURE_RISK = NONE
```

## 6. Source ↔ live consistency (mission §26)

- Structural: live script assets match repo artifact shapes (`/registerSW.js` parent PWA;
  `/appearance-boot.js` platform pre-paint script); live parent bundle's apiBaseUrl matches the
  intended production config; behavior matches current source flows (login surfaces, gates,
  honest-unavailable web rules would require a session to observe further).
- Provenance: the shell `last-modified` values (parent 2026-09-25 17:55Z, platform 2026-09-25 22:12Z)
  postdate the recorded 2026-09-24 deploy lineage; **no SHA/digest surface exists** on either site
  and the local build hashes differ (different build inputs) — an exact revision match cannot be
  proven from outside (PP-F03). Azure-side evidence was not readable in this session.

```text
PARENT_SOURCE_LIVE_MATCH   = PARTIAL
PLATFORM_SOURCE_LIVE_MATCH = PARTIAL
```
