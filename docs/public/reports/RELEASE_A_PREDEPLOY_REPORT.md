# RELEASE A — PREDEPLOY REPORT

**Programme:** PCA Public Website (PUBLIC RELEASE A)
**Phases covered:** PUBLIC-12 (accessibility / performance / SEO), PUBLIC-13 (full bilingual browser UAT), PUBLIC-14 (adversarial privacy / security / claim review), plus the Azure topology reconciliation, the production container and the Arabic review handoff
**Generated:** 2026-09-05
**Nothing was deployed.** No Azure resource, container, hostname binding, DNS record or certificate was created, changed or removed by this session.
**Revised 2026-09-05** after the owner created a dedicated Public Web App and moved `www.pcasafe.com` to it.

```
RELEASE_A_TECHNICAL_READINESS   = READY
RELEASE_A_PUBLICATION_AUTHORIZED = NO
```

Technically ready and not authorised to publish are both true at once, and deliberately so: §K lists the remaining blockers, none of which is an engineering defect. The one engineering blocker from the previous revision — no production security headers — is now closed.

---

## A. Source

| | |
|---|---|
| Branch | `pca-dev` |
| Commit at time of report | `220ca40def530c63f02abc7a081902bd77a7e2d1` |
| Previous accepted checkpoints | `9fb5bff` (IA consolidation), `1fd9bd4` (PUBLIC-12/13/14) |
| `origin/main` | `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` — **unchanged throughout** |
| Worktree | Public-owned paths only: `public-web/**`, `docs/public/**`. Pre-existing untracked container files at the repository root (`Dockerfile.backend`, `docker-compose.yml`, `azure-pipelines.yml` and others) belong to separate backend/admin work and were left untouched and unstaged. |
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

## D. Azure current state — reconciled 2026-09-05

Verified **read-only**. No subscription ID, tenant ID, verification ID, publish profile, credential, registry username or app-setting value appears in this report.

The owner created a dedicated Public Web App and moved `www.pcasafe.com` to it. That is independently confirmed, and the move is **complete** — which is the part that could not be taken on trust, because a hostname can appear on a new app while still being bound to the old one.

### D.1 The dedicated Public app

| | |
|---|---|
| Web App | **`pcaSafe`** — Linux, container, Running, UAE North |
| Resource group | `pca-group` |
| App Service Plan | `PcAPlan` — **B1 Basic, 1 site** (not shared with anything) |
| HTTPS Only | **true** — `http://` answers `301` to `https://` |
| Default hostname | `pcasafe-…uaenorth-01.azurewebsites.net` |
| Custom domain | **`www.pcasafe.com`**, `SniEnabled` |
| TLS certificate | `CN=www.pcasafe.com`, DigiCert/GeoTrust, issued 2026-09-05, valid to 2027-03-05, SAN covers `www.pcasafe.com` only |
| Container | `sitecontainers`, main container on port 80 |
| Current image | `pcasafe.azurecr.io/pca-public-placeholder:hold-v1` — **a placeholder** |
| Registry auth | ACR **admin user credentials**; **no managed identity assigned** |
| App settings | one: `WEBSITES_ENABLE_APP_SERVICE_STORAGE` |
| `alwaysOn` / `http20Enabled` / `healthCheckPath` | false / false / null |
| `minTlsVersion` / `ftpsState` | 1.2 / FtpsOnly |

### D.2 The old app, re-checked

| | |
|---|---|
| Web App | `pca` — Linux, Running, HTTPS Only, UAE North, RG `AppWenPlan` |
| Plan | `NEWWEPPLAN` — B1 Basic, **shared with `ims-platform` and `ims-v1`** (unrelated product) |
| Container | `mcr.microsoft.com/appsvc/staticsite:latest` — Azure's own placeholder |
| Hostnames | `api` · `platform` · `parent` · `app`.pcasafe.com, all `SniEnabled` |
| **`www.pcasafe.com`** | **ABSENT** — genuinely removed, not merely duplicated |

### D.3 Independent confirmation that the move is real

Binding lists can lie by omission, so the isolation was confirmed by behaviour as well as by configuration:

| Hostname | DNS CNAME target | Serves |
|---|---|---|
| `www.pcasafe.com` | the **`pcaSafe`** default hostname | 1,696 B "Welcome to Azure Container Instances!", no `Server` version |
| `app` / `parent` / `platform` / `api`.pcasafe.com | the **`pca`** default hostname | identical 612 B "Welcome to nginx!", `Server: nginx/1.19.2` |

Two different placeholder pages from two different containers. `www` is served by the new app and nothing else is.

```
AZURE_PUBLIC_APP_CREATED       = YES
AZURE_PUBLIC_SURFACE_ISOLATION = PASS
WWW_CURRENT_APP                = pcaSafe (resource group pca-group)
OLD_PCA_WWW_BINDING            = ABSENT
PCA_PUBLIC_RELEASE_A_DEPLOYED  = NO
```

**A healthy Web App is not a deployed website.** `pcaSafe` is Running and its container answers 200 — with a placeholder. No PCA content is live at `www.pcasafe.com`, and nothing in this session changed that.

### D.4 Findings from the reconciliation

| # | Finding |
|---|---|
| **AZ-1** | The apex **`pcasafe.com` has no A, AAAA or CNAME record** — only SOA/NS on Squarespace nameservers. A visitor typing the bare domain reaches nothing. `www` alone is not enough for a public launch; an apex record plus an apex→`www` redirect is needed. **DNS change — not made.** |
| **AZ-2** | `pcaSafe` pulls from ACR using **admin-user credentials** and has **no managed identity**. Admin credentials live in site config and are shared by everything holding them. A managed identity with `AcrPull` is scoped, rotatable and revocable. **Not changed.** |
| **AZ-3** | ACR `pcaSafe` (Basic, `pca-group`) has **admin user enabled** and **public network access enabled**. Repository contents could not be listed — the signed-in identity lacks the data-plane role — so the image inventory is **unverified**, and is recorded as unverified rather than assumed. |
| **AZ-4** | `healthCheckPath` is null, `alwaysOn` false, `http20Enabled` false. The Release A image provides `/healthz`; without a health path Azure cannot distinguish a wedged container from a healthy one. |
| **AZ-5** | The `www` certificate covers **`www.pcasafe.com` only**. Any future apex binding needs its own certificate. |
| **AZ-6** | `pca` still shares a B1 plan with `ims-platform` and `ims-v1`, an unrelated product. Unchanged from PUBLIC-0 and unaffected by the Public split. |

**Azure changes made by this session: 0. DNS changes: 0. Custom-domain changes: 0. Certificate changes: 0. Deployments: 0.**

---

## E. Deployment topology — resolved

The PATH B / PATH C question from the previous report is **closed by the owner's action**. Creating a dedicated Public Web App and moving `www` to it *is* PATH B, which was the recommendation: true isolation, per-surface rollback, and a Public deploy that cannot touch `api.pcasafe.com`.

The constraint that drove the earlier caution is gone. Deploying Release A now changes exactly one hostname.

That cuts both ways, and it is why the deployment freeze matters more now, not less: **`www.pcasafe.com` is live and pointed at the app this image would replace.** Pushing the Release A image is no longer a staging step — it is publication.

Still recommended, none of it done here: enable `alwaysOn`, enable HTTP/2, set `healthCheckPath` to `/healthz`, move ACR auth to managed identity, and separate `pca` from the B1 plan it shares with an unrelated product.

---

## F. Production security headers — implemented and verified locally

Previously this section was a specification with no host configuration behind it, tracked as blocker **INF-1**. The configuration now exists, and has been verified against a running container rather than reviewed on paper.

### F.1 The artifact

| | |
|---|---|
| `public-web/deploy/Dockerfile` | two-stage: run every gate, then serve from nginx 1.27-alpine |
| `public-web/deploy/nginx.conf` | the response headers, routing, compression and health endpoint |
| `public-web/deploy/manifest.mjs` | SHA-256 of every shipped byte, written outside the deploy root |
| `public-web/deploy/verify-container.mjs` | asserts a **running** container serves the reviewed artifact |
| `public-web/deploy/README.md` | build/run/verify, deployment procedure, rollback |

`docker build` is not packaging — it runs the full gate suite inside the image, asserts the deploy root holds exactly the manifest's files and that each matches its checksum, then runs `nginx -t`. A gate failure produces no image.

### F.2 Headers actually served, measured

Confirmed present on every page, on assets, on `robots.txt`, on `sitemap.xml` **and on the 404**:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
                         img-src 'self'; base-uri 'self'; form-action 'none';
                         frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Server: nginx            (version suppressed)
```

The CSP was **tightened** against measurement, not copied forward. Every `data:` occurrence in `dist/` turned out to be the policy string itself — not one image used a data URI — and the stylesheet declares no `@font-face` and contains no `url()` at all. So `img-src 'self' data:` became `img-src 'self'`, `font-src` was dropped, and the baseline became `default-src 'none'` with every unused fetch directive inheriting it. `'unsafe-inline'` and `'unsafe-eval'` appear nowhere.

`assertCspCoversArtifact()` re-derives the policy from the emitted files on every build and fails **both** ways: a use with no grant would break a real asset, a grant with no use is standing permission for an unreviewed change. Proven by reintroducing five defects (unsafe-inline added, font-src re-added, img-src removed, data: re-granted, frame-ancestors moved back into the inert meta tag) — all five caught.

`Cross-Origin-Embedder-Policy` is deliberately absent: it buys cross-origin isolation, which only matters for `SharedArrayBuffer` and high-resolution timers, and this site uses neither.

### F.3 Local container verification

```
LOCAL_RELEASE_A_CONTAINER                = PASS   (271/271 checks)
PRODUCTION_SECURITY_HEADER_CONFIGURATION = PASS_LOCAL
```

Covered: all 8 required headers on 19 distinct paths including the 404; every page byte-identical to the reviewed artifact; `lang`/`dir` correct in the served markup for both locales; real 404 with no SPA fallback; relative directory redirects; dotfile paths denied; gzip on HTML and CSS; no internal claim metadata; reports and source not served; and a real Chromium pass over five pages confirming zero console errors under the **response-header** CSP, zero external requests, every image with `naturalWidth > 0`, and the stylesheet actually applied.

Artifact identity: 26 files, 195,856 B, `artifact-sha256 = f0b042cb7e88782f1bf084920d96d4815807e5a79221a86806523ba649919cce`. Over the wire: home 4,538 B gzipped, `/ar/` 5,458 B, CSS 5,253 B.

### F.4 The verifier was proven, and it found a defect in this image

A verifier that passes on its first run has demonstrated nothing. Four deliberate misconfigurations, all caught:

| Deliberate defect | Result |
|---|---|
| a `location` block declares its own `add_header` | 8 security headers silently missing on `/assets/` |
| `always` dropped from the CSP | header absent on the 404 |
| SPA history fallback added | missing paths soft-200 as the home page |
| `absolute_redirect on` | container's internal address leaked into `Location` |

The first is the one worth naming: nginx **discards every inherited `add_header`** in any location block that declares one of its own. A plausible config can serve a fully protected home page and a naked 404, and only a running server reveals it.

A fifth defect was found by inspecting the running container rather than by any check: the nginx base image ships `index.html` and `50x.html` in the document root, and `COPY` **merges into** that directory instead of replacing it. The first build served a stock English `/50x.html` at HTTP 200 — an unreviewed page in the deploy root, absent from the manifest — while all 270 HTTP checks passed, because nothing thinks to request a file it does not know exists. The document root is now cleared before the copy, the file count and every checksum are asserted at build time, and the verifier probes for the leftover explicitly.

---

## G. Email and contact channels

The owner has configured four **forwarding aliases** on `pcasafe.com`, all forwarding to a single owner-monitored destination. That destination is deliberately not recorded in this repository, in any report, in any rendered page or in any log.

```
SUPPORT_ALIAS_CONFIGURED  = YES     SUPPORT_INBOUND_VERIFIED  = NOT_TESTED
PRIVACY_ALIAS_CONFIGURED  = YES     PRIVACY_INBOUND_VERIFIED  = NOT_TESTED
SECURITY_ALIAS_CONFIGURED = YES     SECURITY_INBOUND_VERIFIED = NOT_TESTED
ADMIN_ALIAS_CONFIGURED    = YES     ADMIN_INBOUND_VERIFIED    = NOT_TESTED
PUBLIC_REPLY_IDENTITY     = NOT_TESTED
CONTACT_CHANNEL           = NOT_READY
EMAIL_ALIAS_CONFIGURATION = OWNER_EVIDENCE_PRESENT
```

**Configuration is not delivery.** A forwarding rule can exist and still not deliver: SPF or DMARC may not align for forwarded mail, the receiving provider may junk it silently, a loop may form, or the alias may accept and blackhole. None of that is visible from the configuration screen.

**Forwarding is also not send-as.** These are independent capabilities. If a reply to a privacy request leaves from the owner's private mailbox, the requester learns a private address and the reply does not come from the published contact. That must be tested before any address is published.

The full test procedure — 9 inbound tests and 5 reply-identity tests per alias, with the classification rules — is in `RELEASE_A_CONTACT_CHANNEL_VERIFICATION.md`. **None has been run by this session**, and the results table is deliberately empty. I have neither an external mail account nor access to the owner's mailbox, and a fabricated delivery result is worse than an open blocker.

Until delivery is proven, `/contact/` keeps its current honest wording — that PCA cannot receive messages yet — and no address is published. `admin@pcasafe.com` stays operational and is not proposed as public copy in any case.

---

## H. Arabic review

```
ARABIC_REVIEW_PACK            = COMPLETE   (189 rows, 338 Arabic strings)
ARABIC_REVIEW_GUIDE           = COMPLETE
ARABIC_OWNER_SIGNOFF_TEMPLATE = COMPLETE   (87 rows, all OWNER_DECISION = PENDING)
NATIVE_ARABIC_REVIEW          = AWAITING_EXTERNAL_REVIEW
OD_12                         = NOT_APPROVED
```

The independent reviewer is assigned and the pack now exists:

| File | |
|---|---|
| `RELEASE_A_ARABIC_REVIEW_PACK.csv` | 189 rows, 14 columns, one per Arabic key |
| `RELEASE_A_ARABIC_REVIEW_GUIDE.md` | what to check, how to fill it in, scope boundaries |
| `RELEASE_A_ARABIC_OWNER_SIGNOFF.csv` | the 87 rows needing the owner's own decision |

Generated by `public-web/scripts/arabic-review-pack.mjs`, which refuses to write a pack it cannot prove faithful: EN/AR key-set equality, one row per key, matching value shapes, no empty string on either side, every route resolving, every claim id present in **both** `claims.mjs` and the register CSV — and then all 14 pages re-rendered and required to match the emitted `dist/` files byte for byte.

Risk distribution: **73 CRITICAL**, 20 HIGH, 70 MEDIUM, 26 LOW. Critical covers every privacy assertion, all legal text, every feature-status label, every release-state notice, and anything bound to a claim weaker than `VERIFIED_AVAILABLE` — because overstating a hedge in Arabic is the exact failure this review exists to catch.

Export and validation only: not one character of Arabic was changed, every row ships `PENDING_REVIEW`, and `PROPOSED_ARABIC` is empty on all 189. Returned corrections will be checked against the English source, claim status, privacy hedge and approved terminology before any is applied — a linguistically better translation that strengthens a claim will be rejected.

---

## I. Legal

```
LEGAL_PUBLICATION_STATUS             = NOT_AUTHORIZED
PRIVACY_POLICY_PUBLICATION_READINESS = NOT_READY
TERMS_PUBLICATION_READINESS          = NOT_READY
OD_13                                = UNRESOLVED
PPR1R-D035                           = OPEN
```

Unchanged, and **not** resolved by the new email aliases. The 13 facts required from the owner — operator name, entity type, country, jurisdiction, legal and privacy contacts, controller wording, effective date, parent/guardian wording, child age boundary, governing regimes — are set out in `RELEASE_A_LEGAL_OWNER_INPUT.md`. None has been invented or filled with a plausible default.

`/privacy-policy/` and `/terms/` remain provisional drafts: `noindex, nofollow`, excluded from the sitemap, reachable only from the footer.

---

## J. Rollback

The baseline is the safest possible: **PCA has never been deployed**, so the first Release A deploy has a clean, known rollback target. The topology split makes it narrower than before.

1. **Record before deploying.** Capture `pcaSafe`'s current sitecontainer image reference, port and app settings (read-only). That record is the rollback target.
2. **Roll back = redeploy the recorded prior image** (`pca-public-placeholder:hold-v1`). It is a placeholder, so the baseline is always recoverable.
3. **Blast radius is one hostname.** `www.pcasafe.com` is the only binding on `pcaSafe`. `app`, `parent`, `platform` and `api` live on the separate `pca` App Service and cannot be affected by a Public deploy or rollback — this is what the owner's split bought.
4. **No stored artifact needed.** The build is deterministic from a commit SHA with no install step; any previous artifact is reproducible by checking out that SHA and rebuilding. Confirm by comparing `artifact-sha256`.
5. **DNS and certificates are never part of a rollback.** The binding and its SNI certificate are independent of container content. Do not touch them to fix a content problem.
6. **Verify after any rollback:** run `verify-container.mjs` against the live origin, and confirm the other four hostnames still serve exactly what they served before.
7. **Use immutable dated tags, never `latest`.** A moving tag makes "which bytes are live?" unanswerable, and turns rollback into guesswork.

---

## K. Remaining blockers before publication

None is an engineering defect in the artifact.

| # | Class | Blocker | Owner |
|---|---|---|---|
| **ARB-1** | ARABIC | `NATIVE_ARABIC_REVIEW = AWAITING_EXTERNAL_REVIEW`. Pack delivered; OD-12 sign-off outstanding. CLM-050/051 stay `COMING_LATER`. | Reviewer, then owner |
| **LEG-1** | LEGAL | OD-13 unresolved; `PPR1R-D035` open. 13 facts requested in `RELEASE_A_LEGAL_OWNER_INPUT.md`. | Owner + legal |
| **OPS-1** | CONTACT | Four aliases configured, **zero delivery tests run**. `CONTACT_CHANNEL = NOT_READY`, `PUBLIC_REPLY_IDENTITY = NOT_TESTED`. A child-protection site must not publish `security@` before proving it receives mail. | Owner |
| **AZ-1** | DNS | Apex `pcasafe.com` does not resolve at all. Needs an apex record and an apex→`www` redirect. **DNS change — not made.** | Owner |
| **AZ-2** | SECURITY | `pcaSafe` pulls from ACR with admin-user credentials and has no managed identity. | Owner |
| **CLM-1** | CLAIM | CLM-054 stays `NOT_APPROVED_FOR_PUBLIC_CLAIM` by ruling; CLM-041/042 unapproved; CLM-056 approved but deliberately not rendered. **No action needed** — recorded so the gap is not mistaken for an oversight. | — |

**INF-1 is CLOSED.** Production security headers are implemented, served and verified against a running container.

Not blockers, for the predeploy checklist: `alwaysOn` false, HTTP/2 off, no health-check path, `pca` sharing a B1 plan with an unrelated product.

---

## L. Status

```
PUBLIC_12 = COMPLETE    PUBLIC_13 = COMPLETE    PUBLIC_14 = COMPLETE

BUILD         = PASS (14 pages, 189/189 EN/AR parity, all gates green, deterministic)
BROWSER_UAT   = 112/112 PASS (real Chromium, EN+AR, 8 widths, every route)
ACCESSIBILITY = 0 axe violations, WCAG 2.1 A+AA, real browser, contrast evaluated
SEO           = PASS (canonical, hreflang+x-default, sitemap 10, robots, OG, per-page metadata)
PERFORMANCE   = 8,387 B gz first load | LCP 68 ms | CLS 0 | 0 external requests
CLAIM_GATES   = PASS (57 rows, 53 inherited cross-checked, 20 patterns self-tested)

PUBLIC_RELEASE_A_CRITICAL_FINDINGS = 0
PUBLIC_RELEASE_A_HIGH_FINDINGS     = 0

AZURE_PUBLIC_APP_CREATED       = YES
AZURE_PUBLIC_SURFACE_ISOLATION = PASS
WWW_CURRENT_APP                = pcaSafe (pca-group)
OLD_PCA_WWW_BINDING            = ABSENT
PCA_PUBLIC_RELEASE_A_DEPLOYED  = NO

LOCAL_RELEASE_A_CONTAINER                = PASS (271/271)
PRODUCTION_SECURITY_HEADER_CONFIGURATION = PASS_LOCAL

SUPPORT/PRIVACY/SECURITY/ADMIN_ALIAS_CONFIGURED = YES
SUPPORT/PRIVACY/SECURITY_INBOUND_VERIFIED       = NOT_TESTED
PUBLIC_REPLY_IDENTITY                            = NOT_TESTED
CONTACT_CHANNEL                                  = NOT_READY

ARABIC_REVIEW_PACK   = COMPLETE (189 rows)
NATIVE_ARABIC_REVIEW = AWAITING_EXTERNAL_REVIEW
OD_12                = NOT_APPROVED

LEGAL_PUBLICATION_STATUS = NOT_AUTHORIZED

VIDEO_1_STATUS = SCRIPTED_PLACEHOLDER (EN+AR script, storyboard, transcript, poster, captions)
VIDEO_2_STATUS = SCRIPTED_PLACEHOLDER (as above; real footage after Android device UAT)

AZURE_RESOURCE_CHANGES_BY_THIS_SESSION = 0
DNS_CHANGES_BY_THIS_SESSION            = 0
CUSTOM_DOMAIN_CHANGES_BY_THIS_SESSION  = 0

RELEASE_A_TECHNICAL_READINESS    = READY
RELEASE_A_PUBLICATION_AUTHORIZED = NO
```

Technically ready and not authorised to publish remain true at once. The engineering blocker that stood in the previous report (no production security headers) is closed; every remaining blocker is an owner decision or an owner-side verification.

`www.pcasafe.com` now resolves to the dedicated Public Web App, which means the next deploy is not a rehearsal — it is publication. Stopping here for owner and primary ChatGPT review.

`PCA_PUBLIC_IMPLEMENTATION = READY_FOR_PRIMARY_CHATGPT_REVIEW`
