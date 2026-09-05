# RELEASE A — PREDEPLOY REPORT

**Programme:** PCA Public Website (PUBLIC RELEASE A)
**Phases covered:** PUBLIC-12 (accessibility / performance / SEO), PUBLIC-13 (full bilingual browser UAT), PUBLIC-14 (adversarial privacy / security / claim review)
**Generated:** 2026-09-05
**Nothing was deployed.** No Azure resource, container, hostname binding, DNS record or certificate was created, changed or removed.

```
RELEASE_A_TECHNICAL_READINESS   = READY
RELEASE_A_PUBLICATION_AUTHORIZED = NO
```

Technically ready and not authorised to publish are both true at once, and deliberately so: §H lists five blockers, none of which is an engineering defect.

---

## A. Source

| | |
|---|---|
| Branch | `pca-dev` |
| Commit at time of report | `9fb5bff0538f4315fb22042d07002f1c60996340` (the accepted checkpoint) |
| `origin/main` | `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` — **unchanged throughout** |
| Worktree | 27 modified/untracked paths, all Public-owned: `public-web/**`, `docs/public/**`. The PUBLIC-12/13/14 remediation is not yet committed. |
| `stash@{0}` | intact, 48 files, `DO NOT DROP` — never touched by this programme |
| PPR-2 | closed at `74e5ad5`; Part M published |

---

## B. Artifact

| | |
|---|---|
| Build command | `npm run build` → `node --check build.mjs && node build.mjs` |
| Install required | **none** — zero dependencies, no `node_modules`, no lockfile |
| Output | `public-web/dist/` (gitignored; rebuilt from source) |
| Files | **26** |
| Size | **197,122 B raw / 52,775 B gzipped** |
| Manifest SHA256 | `137b147fbafd1d0c55eb9a8c4c7b0d52710cf90e535ca7db5e5612549ac04c42` (sha256 of the sorted per-file checksum list) |
| Determinism | **byte-identical across consecutive rebuilds** — verified 3× |
| Fresh-clone reproducibility | verified: a `--depth 1` clone of `pca-dev` builds with no install, and the frozen v0.2 documentation package still verifies **13/13** against its own `SHA256SUMS.txt` |

`node --check` runs before every build. That is not ceremony: a scripted patch once wrote a literal newline into a regular expression here, making the module a `SyntaxError` and silently disabling four gates while the command still appeared to succeed.

### Deploy root contains nothing internal

14 prerendered pages + `404.html` + `robots.txt` + `sitemap.xml` + CSS + JS + 3 SVG + 4 caption-source files. **Zero JSON.** Build and evidence reports write to `public-web/reports/`, outside the deploy root — PUBLIC-14 found them shipping at `/build-report.json`, publicly readable, carrying the whole internal claim-governance state.

---

## C. Public quality

### Build gates — all executed, all green

```
content parity            EN 189 / AR 189 keys, exact, incl. array shape and claimId index
contrast                  30 pairs computed (WCAG 2.1), min 3.25:1, all pass
claim register            57 rows matched, 53 inherited from frozen v0.2 and cross-checked
forbidden-pattern selftest 20 patterns proven against the register's own prohibited text
duplicate content         0 findings across routes
home reading size         488 EN words (ceiling 900 ≈ 2–3 min)
internal metadata         0 in HTML attributes, 0 governance vocabulary in ANY shipped file
SVG well-formedness       pass; <desc> is public-safe alternative text
video assets              pass (both placeholders; available:true is blocked without real files)
Arabic review coverage    189/189 keys — the whole corpus
review-list liveness      pass (no key named that no longer exists)
internal link resolution  pass (every same-origin href resolves to an emitted file)
```

### PUBLIC-13 — browser UAT

**112/112 checks clean.** Real Chromium, every emitted route × EN/AR × 320/375/390/480/768/1024/1280/1600.

Zero console errors, zero failed requests, zero horizontal overflow, zero broken images, exactly one `<h1>` per page, no heading-level skips, all touch targets ≥44px, correct served `lang`/`dir`, no `<form>`, no external references, no mixed content, no inline scripts or style attributes, legal drafts `noindex`, 404 returns HTTP 404 with working links in both languages.

### PUBLIC-12 — accessibility

| Check | Result |
|---|---|
| axe-core, WCAG 2.1 A + AA, **real Chromium** | **0 violations** across 14 page runs |
| `color-contrast` rule actually evaluated | **yes** — 100+ nodes assessed per page |
| Controls without a visible focus indicator | **0** |
| Keyboard-reachable controls on Home | 30, no trap, logical order |
| Heading order | no skips, one `<h1>` per page |
| Landmarks | exactly one `<main>` per page; header/nav/footer present |
| Form labels | no unlabelled controls (Release A ships no form) |
| Reduced motion | clean |
| Reflow at 320px | clean |
| `forced-colors` (Windows High Contrast) | handled |

**The one axe `incomplete` is closed by proof, not waived.** Two hero elements sit on a gradient whose background axe cannot resolve. Both endpoints are in the computed contrast table — text `#132030` measures **15.27:1** and **15.59:1**; the lead `#4a5a6e` measures **6.55:1** and **6.68:1**. A two-stop linear gradient interpolates channels linearly and relative luminance is monotonic in each channel, so every intermediate background lies between the endpoints and contrast is bounded below by the worse of the two. Both pass comfortably.

**This is evidence, not a conformance claim.** CLM-054 remains `NOT_APPROVED_FOR_PUBLIC_CLAIM` per the owner ruling, and no page states a conformance level. The words `WCAG`, `AA compliant` and `fully accessible` are in the forbidden-claim scan.

*Context:* PUBLIC-0 found the repository's only existing a11y gate runs axe under **jsdom**, where `color-contrast` cannot return a result at all. This is the first contrast evidence in the project that a browser actually produced.

### PUBLIC-12 — performance

| Measure | Value |
|---|---|
| Total artifact | 197,122 B raw / **52,775 B gzipped** |
| **First load (Home HTML + CSS + JS, gzipped)** | **8,408 B** |
| Home HTML | 16,803 B / 3,903 B gz |
| How PCA Works HTML | 12,948 B / 3,389 B gz |
| Privacy & Safety HTML | 15,239 B / 3,990 B gz |
| CSS | 21,061 B / 4,104 B gz |
| JS | 1,013 B / **401 B gz** |
| SVG (3 files) | 3,139 B |
| **LCP (Home)** | **68 ms** |
| **CLS (Home)** | **0** |
| Requests on Home | 4 |
| Blocking resources | 1 (the single stylesheet) |
| **External requests** | **0** |
| Fonts | none — system stack |

Comments are stripped from the shipped bundles, which cut first load from 12,794 B to 8,408 B. For contrast, PUBLIC-0 measured `parent-web` at a single eager **719,632 B** JS chunk.

### PUBLIC-12 — SEO

Every page carries a unique title (16–74 chars), a meta description (93–149 chars), a canonical URL, `hreflang` for `en`/`ar`/`x-default`, and complete OpenGraph. `sitemap.xml` holds 10 entries — the five indexable routes × two locales. `robots.txt` disallows exactly the four legal-draft URLs. Robots and sitemap are generated from one `indexable` flag, so they cannot disagree; the UAT asserts that agreement independently.

`lang` and `dir` are correct in the **served** markup, which is what makes Arabic indexable as Arabic — PUBLIC-0 found both existing SPAs permanently serve `lang="en" dir="ltr"` and fix it only after JS boots.

Metadata is scanned for gated claim wording. PUBLIC-14 found Contact's own description still soliciting security reports while the page body said PCA cannot receive messages; both are now consistent.

### EN/AR parity and Arabic status

189 keys each, exact, enforced at build. Array lengths and `claimId` positions match. `AR_REVIEW_PENDING` is **derived** from the content table, so it covers all 189 keys and cannot be narrower than the corpus.

**`NATIVE_ARABIC_REVIEW = NOT_STARTED`.** OD-12 requires owner-designated native sign-off before publication. CLM-050 and CLM-051 stay `COMING_LATER`.

### Claim and privacy audit — PUBLIC-14

Five independent read-only adversarial lanes (privacy, feature honesty, commercial honesty, security, Arabic), each finding verified by a second agent instructed to refute it, then a re-verification pass against the rebuilt artifact.

**25 CRITICAL/HIGH findings raised; 11 survived verification; all 11 remediated and re-verified.**

The substantive ones:

| Was | Now |
|---|---|
| Intro video summary said PCA protects "without building a central record of them" — dropping *readable*, and contradicting `/privacy/`'s own disclosure that PCA holds an opaque child identifier, enrollment state, entitlement and timestamps | Restored to "readable central profile of their activity" in both locales; `grep "central record"` returns zero |
| `/privacy/` shipped the camera "processed on the device and not stored or uploaded" wording that correction C-2 holds gated until runtime proof | Removed in both locales; the card states the feature is not active and that behaviour will be described once verified |
| Retention section promised "meaningful control over their account" (AR: "genuine control") while PPR1R-D036 records no deletion path exists | Both locales now state the controls are **not built yet** |
| `/how-it-works/` walked parents through account creation and email verification as live steps | A release-state notice now precedes the steps in both locales: PCA is not open for new accounts |
| A green **Available** pill invited parents to "Use PCA Parent in a supported browser" — which `app.pcasafe.com` cannot honour | Retitled "No installation required"; describes the design property instead of instructing |
| `/privacy/` and `/accessibility/` routed people to a "Report security concern" control that exists nowhere | Both corrected; Contact opens with a notice that PCA cannot receive messages yet, and its title/description no longer solicit |
| Forbidden-claim scan was Latin-only — seven Arabic pages unprotected | Arabic patterns added, and **every pattern is now self-tested against the register's own prohibited text on each build** |
| Arabic asserted "there is no hidden surveillance" as fact; step 8 converted "should help" into present tense | Both restored to design language |
| `build-report.json` and `release-a-evidence.json` shipped at the deploy root | Moved to `public-web/reports/` |
| Claim ids and internal paths shipped in CSS, JS, SVG `<desc>` and caption headers | Comments stripped from bundles; `<desc>` is plain alt text; caption headers cleaned; the metadata sweep now reads **every** shipped file, not just HTML |
| Arabic review list omitted the `/ar/privacy/` H1 and lede | List is now derived from the corpus — understatement is structurally impossible |

```
PUBLIC_RELEASE_A_CRITICAL_FINDINGS = 0
PUBLIC_RELEASE_A_HIGH_FINDINGS     = 0
```

Residual MEDIUM/LOW items are recorded for the native Arabic reviewer: translationese in five newly authored strings, a `صُمم حول` calque, and two Arabic scope narrowings (`لم يُفتح إنشاء الحسابات` closes sign-up but not sign-in; `حماية أجهزة iPhone` reads as device security rather than child protection). None changes a claim's strength beyond its register status.

### Two gates that were themselves defective — found and fixed

Worth stating plainly, because a gate reporting green while asserting nothing is this project's recorded failure mode and both instances were self-inflicted:

1. **`assertClaimLabels` was tautological.** The renderer and the expectation both read `claims.mjs`, so flipping a status changed both together. Proven by flipping CLM-024 and watching the build stay green. Fixed by cross-checking against `PCA_PUBLIC_CLAIM_REGISTER.csv` — which immediately caught a real drift: an unapproved PUBLIC-1 proposal applied to CLM-043 as though approved.
2. **Four Arabic and four English forbidden patterns could not match their own claims.** The Arabic ones hardcoded masculine agreement while every page renders PCA feminine, and could not cross the definite article. Fixed, and the self-test now proves all 20 on every build.

---

## D. Azure current state

Verified read-only on 2026-09-05. **No subscription ID, credential or app-setting value appears in this report.**

| | |
|---|---|
| App Service | **`pca`** — Linux, Running, HTTPS Only, UAE North, RG `AppWenPlan` |
| Plan | `NEWWEPPLAN` — **B1 Basic, capacity 1**, shared with `ims-platform` and `ims-v1` |
| Container | `mcr.microsoft.com/appsvc/staticsite:latest` — **Azure's own placeholder** |
| Deployment source | **none configured** |
| App settings | one: `WEBSITES_ENABLE_APP_SERVICE_STORAGE` |
| `alwaysOn` | **false** — cold start after ~20 min idle |
| `http20Enabled` | **false** |
| `healthCheckPath` | **null** |
| `minTlsVersion` / `ftpsState` | 1.2 / FtpsOnly |

**All five secured hostnames are bound to this one service**, every one `SniEnabled`:

`www.pcasafe.com` · `app.pcasafe.com` · `parent.pcasafe.com` · `platform.pcasafe.com` · `api.pcasafe.com`

All five still return the identical 612-byte nginx placeholder (re-confirmed today). The apex `pcasafe.com` does not resolve.

### The constraint

**Any deployment to `pca` changes what all five hostnames serve at once, `api.pcasafe.com` included.** There is no host-based routing in the App Service and none in the repository.

---

## E. Deployment options

Directly replacing the current container with Public HTML remains **NOT APPROVED** for public go-live, per the owner ruling, because `api` / `app` / `parent` / `platform` would all serve the Public site.

| | **PATH C — host-routing container** | **PATH B — separate App Service per surface** |
|---|---|---|
| **Isolation** | One process fronts all four surfaces. A routing bug or crash affects everything. | True isolation. A Public outage cannot touch the API. |
| **Blast radius** | Every deploy to any surface restarts the shared container. | Per-surface. Public deploys independently of Parent and API. |
| **Security headers** | One place to set them for every surface — a real advantage while §F is unresolved. | Set per service; four places to keep in step, but each independently correct. |
| **Future Parent/API** | Parent and API must be reachable behind the same container, so their deployment model is coupled to Public's. | Each surface keeps its own runtime, scaling and rollback. Matches the Parent/Admin realm separation the architecture already enforces. |
| **Rollback** | Redeploy the previous container image; all surfaces roll back together. | Per-surface rollback; Public can revert without touching the API. |
| **Cost** | No new plan. Stays on the shared B1. | New capacity. Also the natural moment to move PCA off a B1 shared with an unrelated product. |
| **Operational complexity** | A routing layer to build, test and own — it does not exist today. | More resources, but each is a stock static-site or container deployment. |

**Coordinator assessment.** PATH C is the better *interim* step and the worse *destination*. It is the only option that does not need new Azure resources, and it puts the security headers of §F in one enforceable place — but it couples Public, Parent, Admin and API into one blast radius, which is precisely the separation the Parent/Platform-Admin realm boundary exists to protect (CLM-046).

**Recommendation: PATH B for `www.pcasafe.com`,** because Release A is a static artifact with no backend calls and gains nothing from sharing a runtime with the API. If a single interim container is preferred for cost, PATH C is acceptable **only** with a written commitment to split before Release B activates auth — an auth outage caused by a Public deploy would be the worst version of this trade.

Either path also wants: `alwaysOn` enabled, HTTP/2 enabled, a health-check path set, and PCA separated from the B1 plan it currently shares with `ims-platform` and `ims-v1`.

**This is an assessment, not a decision.** No Azure change is proposed for execution here.

---

## F. Security headers — Release A production set

The artifact ships a `<meta>` CSP and referrer policy, and the UAT confirms nothing in the build violates them: zero inline scripts, zero inline style attributes, zero external origins. But `frame-ancestors` is ignored in a meta CSP by specification, and HSTS, `X-Frame-Options`, `X-Content-Type-Options` and `Permissions-Policy` have **no meta equivalent at all**. These must be real response headers.

```
Content-Security-Policy:   default-src 'self'; script-src 'self'; style-src 'self';
                           img-src 'self' data:; font-src 'self'; connect-src 'none';
                           frame-ancestors 'none'; base-uri 'self'; form-action 'none';
                           object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options:    nosniff
X-Frame-Options:           DENY
Referrer-Policy:           strict-origin-when-cross-origin
Permissions-Policy:        camera=(), microphone=(), geolocation=(), interest-cohort=()
```

Justification for the strict directives: Release A makes **no** network calls (`connect-src 'none'`), submits **no** forms (`form-action 'none'`), loads **no** third-party resource, and has all CSS in one external file (`style-src 'self'` with no `'unsafe-inline'` — stricter than either existing console).

Recommended additions: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: public, max-age=300` on HTML with a longer immutable TTL on hashed assets.

**PUBLIC-14 was right that the deliverable contains no host configuration file.** The header set exists as a specification in `reports/build-report.json`, which is deliberately not deployed. Emitting the concrete host config is deployment work that follows the PATH B/C decision — a `_headers` file, `staticwebapp.config.json` and an nginx snippet are all trivial once the target is known, and writing one before the decision would be guessing. Tracked as blocker **INF-1**.

---

## G. Rollback

The current state is the safest possible baseline: **nothing is deployed**, so the first Release A deployment has a clean rollback target.

1. **Before deploying**, record the current container image reference and app settings for `pca` (read-only `az webapp config show` / `az webapp sitecontainers list`), and save them alongside this report.
2. **Rollback = redeploy the recorded prior container.** The placeholder `mcr.microsoft.com/appsvc/staticsite:latest` is a public image, so the baseline is always recoverable.
3. **PATH B rollback** is narrower still: revert the Public App Service only; `api` / `app` / `platform` bindings are untouched by a Public deploy.
4. **Artifact rollback:** the build is deterministic from a commit SHA, so any previous Release A artifact is reproducible by checking out that SHA and running `npm run build` — no stored artifact required, no install step.
5. **Verification after any rollback:** re-run `scripts/release-a-evidence.mjs` against the live origin (`PCA_UAT_BASE=https://www.pcasafe.com`) and confirm 112/112.
6. **DNS and certificates are never part of a rollback.** All five bindings already exist with valid SNI certificates; deployment changes container content only.

---

## H. Blockers

None is an engineering defect. All five block **publication**, not readiness.

| # | Class | Blocker | Owner |
|---|---|---|---|
| **ARB-1** | ARABIC | `NATIVE_ARABIC_REVIEW = NOT_STARTED`. OD-12 requires owner-designated native sign-off; all 189 Arabic keys are pending. CLM-050 and CLM-051 stay `COMING_LATER`. | Owner-designated reviewer |
| **LEG-1** | LEGAL | OD-13 legal entity and jurisdiction unresolved. `PPR1R-D035` (no privacy policy artifact) is an OPEN V1 blocker. `/privacy-policy/` and `/terms/` are provisional drafts, `noindex`, excluded from the sitemap. `LEGAL_PUBLICATION_STATUS = NOT_AUTHORIZED`. | Owner + legal |
| **INF-1** | INFRASTRUCTURE | No production security headers can be served. Depends on the PATH B/C decision (§E), then a host config file (§F). | Owner decision, then deployment |
| **OPS-1** | OWNER | No contact, support or security-disclosure channel exists anywhere. The site now says so honestly rather than pointing at a control that does not exist — but **publishing a child-protection site with no vulnerability-disclosure route is not advisable.** A monitored address, and ideally `/.well-known/security.txt`, should exist before launch. | Owner |
| **CLM-1** | CLAIM | CLM-054 (accessibility conformance) stays `NOT_APPROVED_FOR_PUBLIC_CLAIM` by owner ruling; no page states a conformance level. CLM-041/042 remain unapproved; CLM-056 approved but deliberately not rendered. **No action needed — recorded so the gap is not mistaken for an oversight.** | — |

Not blockers, recorded for the predeploy checklist: `alwaysOn` false, HTTP/2 off, no health-check path, B1 plan shared with an unrelated product.

---

## I. Status

```
PUBLIC_12 = COMPLETE
PUBLIC_13 = COMPLETE
PUBLIC_14 = COMPLETE

BUILD        = PASS (14 pages, 189/189 EN/AR parity, all gates green, deterministic)
BROWSER_UAT  = 112/112 PASS (real Chromium, EN+AR, 8 widths, every route)
ACCESSIBILITY= 0 axe violations, WCAG 2.1 A+AA, real browser, contrast evaluated
SEO          = PASS (canonical, hreflang+x-default, sitemap 10, robots, OG, per-page metadata)
PERFORMANCE  = 8,408 B gz first load | LCP 68 ms | CLS 0 | 0 external requests | 52,775 B gz total
CLAIM_GATES  = PASS (57 rows, 53 inherited cross-checked, 20 patterns self-tested)

PUBLIC_RELEASE_A_CRITICAL_FINDINGS = 0
PUBLIC_RELEASE_A_HIGH_FINDINGS     = 0

NATIVE_ARABIC_REVIEW      = NOT_STARTED (189 keys pending, OD-12)
LEGAL_PUBLICATION_STATUS  = NOT_AUTHORIZED (OD-13, PPR1R-D035)

VIDEO_1_STATUS = SCRIPTED_PLACEHOLDER (EN+AR script, storyboard, transcript, poster, caption source)
VIDEO_2_STATUS = SCRIPTED_PLACEHOLDER (as above; real footage after Android device UAT)

RELEASE_A_TECHNICAL_READINESS    = READY
RELEASE_A_PUBLICATION_AUTHORIZED = NO
```

Stopping here for owner and primary ChatGPT review. No Azure container, binding, DNS record or certificate was touched, and Release B auth/email was not activated.

`PCA_PUBLIC_IMPLEMENTATION = READY_FOR_PRIMARY_CHATGPT_REVIEW`
