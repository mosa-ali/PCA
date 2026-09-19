# PCA Public Website — Release-Blocker Closure Evidence

Date: 2026-09-20
Repository: `D:\PCA\pca-app`
Branch: `pca-dev`
Baseline: `7f62afb93d216aa50d58c1a787d0b68e05c6efd3`

## Gate disposition

`PCA_PUBLIC_RELEASE_GATE = PARTIAL`

The source and local static artifact are ready for owner review. Production is not ready because the public host still requires an authorized deployment, mobile viewport QA is unavailable without adding a dependency, OD-12 native Arabic approval is pending, and provisional privacy/legal text has not received formal approval.

## 1. Sign-in route trace and root cause

| Check | Evidence | Result |
| --- | --- | --- |
| Canonical English URL | `urlFor('signIn', 'en')` in `public-web/src/content/routes.mjs` | `/sign-in/` |
| Canonical Arabic URL | `urlFor('signIn', 'ar')` in `public-web/src/content/routes.mjs` | `/ar/sign-in/` |
| Route declaration | `ROUTES` entry: `id: signIn`, `path: sign-in`, `release: A`, `build: true`, `indexable: false` | Present |
| Renderer | `public-web/src/pages/signIn.mjs` | Present |
| Localized content | `public-web/src/content/pages/signIn.en.mjs` and `signIn.ar.mjs` | Present |
| Header and mobile links | `loginCta()` plus shared header in `public-web/src/lib/components.mjs` | Present in both locales |
| Static export | `public-web/build.mjs` | Emits 18 pages, including both sign-in files |
| Authentication behavior | Sign-in page contains only Parent and Platform Admin handoffs | Unchanged; no public auth form added |

`SIGN_IN_ROOT_CAUSE = DEPLOYMENT_DRIFT / AZURE_PLACEHOLDER_RUNTIME`.

This is not a missing localized route, bad href, renderer omission, or locale mismatch. Repository evidence records the live Azure App Service serving `mcr.microsoft.com/appsvc/staticsite:latest`, with no deployment source configured; the public host therefore does not contain this repository's `dist/` artifact. The previous live observation of `/ar/sign-in/` as not-found is consistent with that placeholder state. A fresh shell recheck was not possible in this run because the environment forces traffic through refused proxy `127.0.0.1:9`, and the available browser surface timed out.

`AR_SIGN_IN_SOURCE_FIXED = NOT_REQUIRED`.

## 2. Local route verification and definitive manifest

The local static server was run from the current build at `http://127.0.0.1:4202/`. All 18 routes returned HTTP 200, with `lang="en"/dir="ltr"` for English and `lang="ar"/dir="rtl"` for Arabic. Local link scanning found 0 broken internal links and 44 generated sign-in-link occurrences, all resolving to an emitted route. The two sign-in handoffs remain the approved external realm paths `/parent/login/` and `/platform-admin/login/`.

The live column is intentionally marked as recorded deployment evidence rather than a new HTTP assertion because live rechecking was blocked by the environment network/browser limitation.

| EN_ROUTE | AR_ROUTE | SOURCE | BUILD_GENERATED | LOCAL_RESULT | LIVE_CURRENT_RESULT | POST_DEPLOY_EXPECTED_RESULT |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `/ar/` | `routes.mjs` + `pages/home.mjs` | YES | 200 / 200; EN LTR, AR RTL | Recorded Azure placeholder; not independently rechecked this run | 200; localized metadata and navigation |
| `/how-it-works/` | `/ar/how-it-works/` | `routes.mjs` + `pages/howItWorks.mjs` | YES | 200 / 200 | Recorded Azure placeholder; not independently rechecked this run | 200; setup instructions and RTL |
| `/privacy/` | `/ar/privacy/` | `routes.mjs` + `pages/privacy.mjs` | YES | 200 / 200 | Recorded Azure placeholder; not independently rechecked this run | 200; privacy claims unchanged |
| `/download/` | `/ar/download/` | `routes.mjs` + `pages/download.mjs` | YES | 200 / 200 | Recorded Azure placeholder; not independently rechecked this run | 200; availability remains truthful |
| `/contact/` | `/ar/contact/` | `routes.mjs` + `pages/contact.mjs` | YES | 200 / 200 | Recorded Azure placeholder; not independently rechecked this run | 200; no premature contact promise |
| `/accessibility/` | `/ar/accessibility/` | `routes.mjs` + `pages/accessibility.mjs` | YES | 200 / 200 | Recorded Azure placeholder; not independently rechecked this run | 200; accessibility copy and metadata |
| `/privacy-policy/` | `/ar/privacy-policy/` | `routes.mjs` + `pages/privacyPolicy.mjs` | YES | 200 / 200; noindex | Recorded Azure placeholder; not independently rechecked this run | 200; provisional notice and noindex |
| `/terms/` | `/ar/terms/` | `routes.mjs` + `pages/terms.mjs` | YES | 200 / 200; noindex | Recorded Azure placeholder; not independently rechecked this run | 200; provisional notice and noindex |
| `/sign-in/` | `/ar/sign-in/` | `routes.mjs` + `pages/signIn.mjs` | YES | 200 / 200; EN LTR, AR RTL | Recorded placeholder/404 before deployment | 200; neutral chooser and approved realm handoffs |

## 3. Evidence table — 29 retained PCA references

All 29 occurrences were re-derived from the current merged Arabic content corpus. No occurrence was found to be ordinary prose that could naturally use `النظام`, `نظام الحماية الأبوية`, `تطبيق الوالدين`, `تطبيق الطفل`, or `منصة الإدارة` instead.

| # | ROUTE | CURRENT ARABIC TEXT | PCA FORM | CLASSIFICATION | WHY RETAINED | SOURCE FILE/KEY |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Site-wide | الصفحة الرئيسية لنظام الحماية الأبوية (PCA) | PCA | FIRST_IDENTIFICATION | Brand locator in the accessible home link | `global.ar.mjs` / `brand.homeLink` |
| 2 | Site-wide | PCA | PCA | BRAND_REQUIRED | Official footer group name | `global.ar.mjs` / `footer.group.pca` |
| 3 | Site-wide | ‏PCA منصة لحماية الأطفال في المساحات الرقمية... | PCA | BRAND_REQUIRED | Brand statement and release-status note | `global.ar.mjs` / `footer.legalNote` |
| 4 | `/how-it-works/` | ...تطبيق الطفل (PCA Child) في إصدار لاحق | PCA Child | OFFICIAL_PRODUCT_NAME | Official child-app identification | `global.ar.mjs` / `release.journeyNotice` |
| 5 | 404 page | الصفحة غير موجودة — PCA | PCA | BRAND_REQUIRED | SEO/page identity | `global.ar.mjs` / `notFound.seo.title` |
| 6 | Site-wide CTA | تطبيق الوالدين (PCA Parent) | PCA Parent | OFFICIAL_PRODUCT_NAME | Official parent-app CTA label | `global.ar.mjs` / `cta.pcaParent` |
| 7 | `/ar/` | نظام الحماية الأبوية PCA — حماية الأطفال... | PCA | BRAND_REQUIRED | Canonical Arabic SEO identity | `home.ar.mjs` / `home.seo.title` |
| 8 | `/ar/how-it-works/` | ...تطبيق الوالدين (PCA Parent) | PCA Parent | FIRST_IDENTIFICATION | First official parent-app identification | `howItWorks.ar.mjs` / `howItWorks.hero.body` |
| 9 | `/ar/how-it-works/` | تثبيت تطبيق الطفل (PCA Child) | PCA Child | FIRST_IDENTIFICATION | First official child-app setup identification | `howItWorks.ar.mjs` / `howItWorks.steps.items[3].title` |
| 10 | `/ar/how-it-works/` | تطبيق الوالدين (PCA Parent) | PCA Parent | OFFICIAL_PRODUCT_NAME | Official section title | `howItWorks.ar.mjs` / `howItWorks.parent.title` |
| 11 | `/ar/privacy/` | الخصوصية والسلامة في نظام الحماية الأبوية PCA... | PCA | BRAND_REQUIRED | Canonical privacy SEO identity | `privacy.ar.mjs` / `privacy.seo.title` |
| 12 | `/ar/privacy/` | نشاط طفلك يخصك أنت، وليس PCA | PCA | BRAND_REQUIRED | Direct brand contrast in approved privacy message | `privacy.ar.mjs` / `privacy.hero.title` |
| 13 | `/ar/download/` | تطبيق الوالدين (PCA Parent) وتطبيق الطفل... | PCA Parent | OFFICIAL_PRODUCT_NAME | Official product comparison | `download.ar.mjs` / `download.platforms.title` |
| 14 | `/ar/download/` | تطبيق الوالدين... وتطبيق الطفل (PCA Child) | PCA Child | OFFICIAL_PRODUCT_NAME | Official product comparison | `download.ar.mjs` / `download.platforms.title` |
| 15 | `/ar/download/` | تطبيق الوالدين (PCA Parent) | PCA Parent | OFFICIAL_PRODUCT_NAME | Official platform card title | `download.ar.mjs` / `download.platforms.items[0].title` |
| 16 | `/ar/download/` | تطبيق الطفل (PCA Child) على أندرويد | PCA Child | OFFICIAL_PRODUCT_NAME | Official Android card title | `download.ar.mjs` / `download.platforms.items[1].title` |
| 17 | `/ar/download/` | تطبيق الطفل (PCA Child) على iPhone وiPad | PCA Child | OFFICIAL_PRODUCT_NAME | Official iOS card title | `download.ar.mjs` / `download.platforms.items[2].title` |
| 18 | `/ar/download/` | ...تطبيق الطفل (PCA Child) على أي منصة... | PCA Child | OFFICIAL_PRODUCT_NAME | Availability statement identifies the unreleased product | `download.ar.mjs` / `download.child.lead` |
| 19 | `/ar/download/` | ما تطبيق الوالدين (PCA Parent)... | PCA Parent | OFFICIAL_PRODUCT_NAME | SEO product identification | `download.ar.mjs` / `download.seo.description` |
| 20 | `/ar/download/` | ...وتطبيق الطفل (PCA Child)... | PCA Child | OFFICIAL_PRODUCT_NAME | SEO product identification | `download.ar.mjs` / `download.seo.description` |
| 21 | `/ar/contact/` | التواصل مع نظام الحماية الأبوية PCA... | PCA | BRAND_REQUIRED | Canonical contact SEO identity | `contact.ar.mjs` / `contact.seo.title` |
| 22 | `/ar/accessibility/` | إمكانية الوصول في نظام الحماية الأبوية PCA... | PCA | BRAND_REQUIRED | Canonical accessibility SEO identity | `accessibility.ar.mjs` / `accessibility.seo.title` |
| 23 | `/ar/accessibility/` | ...تطبيق الوالدين (PCA Parent)... | PCA Parent | OFFICIAL_PRODUCT_NAME | Official parent-app accessibility scope | `accessibility.ar.mjs` / `accessibility.seo.description` |
| 24 | `/ar/privacy-policy/` | سياسة خصوصية نظام الحماية الأبوية PCA | PCA | BRAND_REQUIRED | Legal-document identity | `privacyPolicy.ar.mjs` / `privacyPolicy.seo.title` |
| 25 | `/ar/terms/` | شروط استخدام نظام الحماية الأبوية PCA | PCA | BRAND_REQUIRED | Legal-document identity | `terms.ar.mjs` / `terms.seo.title` |
| 26 | `/ar/sign-in/` | اختر مسار تطبيق الوالدين (PCA Parent)... | PCA Parent | OFFICIAL_PRODUCT_NAME | Official sign-in realm chooser | `signIn.ar.mjs` / `signIn.seo.description` |
| 27 | `/ar/sign-in/` | تطبيق الوالدين (PCA Parent) | PCA Parent | OFFICIAL_PRODUCT_NAME | Official sign-in card title | `signIn.ar.mjs` / `signIn.parent.title` |
| 28 | `/ar/how-it-works/` | ...في تطبيق الوالدين (PCA Parent)... | PCA Parent | OFFICIAL_PRODUCT_NAME | Official enrollment reference in transcript | `video.ar.mjs` / `video.enroll.transcript[0]` |
| 29 | `/ar/how-it-works/` | ...لتطبيق الطفل (PCA Child)... | PCA Child | OFFICIAL_PRODUCT_NAME | Official enrollment reference in transcript | `video.ar.mjs` / `video.enroll.transcript[3]` |

## 4. Mobile and RTL QA evidence

`MOBILE_375 = NOT_EXECUTED`
`MOBILE_390 = NOT_EXECUTED`
`MOBILE_430 = NOT_EXECUTED`

The existing public-web UAT harness requires `playwright-core`, which is not installed in this zero-dependency checkout. The available browser-control surface exposed no viewport-setting capability and timed out while capturing a local/live tab. No dependency was added and no mobile pass is claimed.

Static/local evidence still confirms the responsive implementation is present in the shared CSS and that all Arabic documents ship `dir="rtl"`. Desktop-width local HTTP verification covered all 18 pages; geometry, overflow, menu interaction, accordion arrows, and mixed bidi placement remain post-deployment visual gates.

`RTL_BIDI = PASS for emitted document metadata and source structure; visual viewport verification pending.`

## 5. Privacy/legal Arabic review package

The current merged corpus contains 66 privacy/legal strings requiring review: 23 under `privacy.*`, 25 under `privacyPolicy.*`, 17 under `terms.*`, and 1 site-wide `legal.provisionalNotice`. The exact English and current Arabic values are in the source-of-truth modules listed below; the current owner review CSV and correction ledger preserve the before/after lineage.

| Source scope | Count | English/current-Arabic source | Risk | Recommended status |
| --- | ---: | --- | --- | --- |
| `privacy.*` | 23 | `public-web/src/content/pages/privacy.en.mjs` + `privacy.ar.mjs` | PRIVACY / SECURITY | Body claims: `NEEDS_LEGAL_CONFIRMATION`; headings/SEO: `TECHNICAL_TRANSLATION_ONLY` |
| `privacyPolicy.*` | 25 | `public-web/src/content/pages/privacyPolicy.en.mjs` + `privacyPolicy.ar.mjs` | LEGAL / PRIVACY | `NEEDS_LEGAL_CONFIRMATION` |
| `terms.*` | 17 | `public-web/src/content/pages/terms.en.mjs` + `terms.ar.mjs` | LEGAL | `NEEDS_LEGAL_CONFIRMATION` |
| `legal.provisionalNotice` | 1 | `public-web/src/content/global.en.mjs` + `global.ar.mjs` | LEGAL | `NEEDS_LEGAL_CONFIRMATION` |

High-risk review topics are: central readable child data, local processing, end-to-end encrypted delivery, retention/deletion, provider inventory, cookies/analytics, account/security records, parental responsibility, acceptable use, service availability, and legal entity/contact details. No substantive legal-policy change was made in this closure pass. Formal legal sign-off remains pending.

Supporting evidence: [Arabic review pack](RELEASE_A_ARABIC_REVIEW_PACK.csv), [owner sign-off sheet](RELEASE_A_ARABIC_OWNER_SIGNOFF.csv), and [corrections ledger](../../../public-web/reports/arabic-corrections-ledger.json).

Complete key-by-key extraction index (the linked EN/AR source modules are the authoritative English meaning and current Arabic value for every row):

- `privacy.*`: `privacy.seo.title`, `privacy.seo.description`, `privacy.hero.title`, `privacy.hero.body`, `privacy.where.title`, `privacy.where.items`, `privacy.notStored.title`, `privacy.notStored.items`, `privacy.honesty.title`, `privacy.honesty.body`, `privacy.topics.title`, `privacy.topics.items`, `privacy.retention.title`, `privacy.retention.body`, `privacy.principles.title`, `privacy.principles.lead`, `privacy.principles.items`, `privacy.faq.title`, `privacy.faq.items`, `privacy.advanced.title`, `privacy.advanced.lead`, `privacy.advanced.items`, `privacy.cta.policy`.
- `privacyPolicy.*`: `privacyPolicy.seo.title`, `privacyPolicy.seo.description`, `privacyPolicy.hero.title`, `privacyPolicy.summary.title`, `privacyPolicy.summary.body`, `privacyPolicy.account.title`, `privacyPolicy.account.body`, `privacyPolicy.childDevice.title`, `privacyPolicy.childDevice.body`, `privacyPolicy.notCollected.title`, `privacyPolicy.notCollected.body`, `privacyPolicy.processing.title`, `privacyPolicy.processing.body`, `privacyPolicy.retention.title`, `privacyPolicy.retention.body`, `privacyPolicy.deletion.title`, `privacyPolicy.deletion.body`, `privacyPolicy.feedback.title`, `privacyPolicy.feedback.body`, `privacyPolicy.providers.title`, `privacyPolicy.providers.body`, `privacyPolicy.cookies.title`, `privacyPolicy.cookies.body`, `privacyPolicy.contact.title`, `privacyPolicy.contact.body`.
- `terms.*`: `terms.seo.title`, `terms.seo.description`, `terms.hero.title`, `terms.using.title`, `terms.using.body`, `terms.responsibility.title`, `terms.responsibility.body`, `terms.availability.title`, `terms.availability.body`, `terms.accountSecurity.title`, `terms.accountSecurity.body`, `terms.acceptableUse.title`, `terms.acceptableUse.body`, `terms.privacy.title`, `terms.privacy.body`, `terms.changes.title`, `terms.changes.body`.
- Site-wide: `legal.provisionalNotice`.

Current-value sources: [privacy EN](../../../public-web/src/content/pages/privacy.en.mjs), [privacy AR](../../../public-web/src/content/pages/privacy.ar.mjs), [privacy-policy EN](../../../public-web/src/content/pages/privacyPolicy.en.mjs), [privacy-policy AR](../../../public-web/src/content/pages/privacyPolicy.ar.mjs), [terms EN](../../../public-web/src/content/pages/terms.en.mjs), [terms AR](../../../public-web/src/content/pages/terms.ar.mjs), and [global EN/AR](../../../public-web/src/content/global.en.mjs).

## 6. OD-12 native Arabic sign-off pack

The pack covers the complete 203-key Arabic corpus. The page/key inventory is:

| Review group | Route(s) | Arabic key count | Special attention |
| --- | --- | ---: | --- |
| Site-wide/global | Shared header, footer, status, release, 404 and CTA strings | 56 | UX, brand, availability, navigation |
| Home | `/ar/` | 16 | SAFETY, UX, claims, video transcript |
| How it works | `/ar/how-it-works/` | 19 | SAFETY, TECHNICAL, setup sequence, platform limits |
| Privacy | `/ar/privacy/` | 23 | PRIVACY, SECURITY, readable/central qualifiers, retention |
| Download | `/ar/download/` | 11 | TECHNICAL, availability, platform names |
| Contact | `/ar/contact/` | 8 | PRIVACY, UX, pre-launch contact wording |
| Accessibility | `/ar/accessibility/` | 10 | UX, accessibility terminology |
| Privacy Policy | `/ar/privacy-policy/` | 25 | LEGAL, PRIVACY, SECURITY, provisional claims |
| Terms | `/ar/terms/` | 17 | LEGAL, responsibility, availability, acceptable use |
| Sign-in chooser | `/ar/sign-in/` | 10 | SECURITY, TECHNICAL, separate realm handoffs |
| Shared video content | Used by Home and How it works | 8 | SAFETY, TECHNICAL, availability/transcript wording |
| **Total** |  | **203** | **OD-12 covers every key** |

Final-pass corrected strings are grouped in the source diff and include: accessibility grammar; contact request wording; platform/affordability/SEO phrasing; the Home protection heading and scope sentence; setup grammar and preservation of the English “should”; privacy synchronization, central-record, readable-history, camera, retention, transparency, FAQ, RBAC and TLS wording; privacy-policy processing, child/device, readable-collection, retention and provider wording; Arabic quotation marks in Terms; and the video enrollment sentence.

`OD12_NATIVE_REVIEW_PACKAGE = READY`
`OD12_NATIVE_SIGNOFF = PENDING`
No owner/native approval is inferred from automated checks.

## 7. Technical validation

| Check | Result |
| --- | --- |
| Localization | PASS — EN 203 / AR 203 exact parity |
| Build | PASS — 18 pages, 9 routes × 2 locales |
| Tests | PASS — 9/9; the printed sign-off failure is the intentional negative-control fixture |
| Lint/typecheck | Not configured in `public-web/package.json` |
| Adversarial pass | Baseline CRITICAL findings retained: EN/AR drift counts for “not open/not available yet” and the “readable” privacy qualifier; no new sign-in finding |
| Local route HTTP | PASS — 18/18 returned 200 |
| Local broken internal links | PASS — 0 |
| Source/worktree | Clean at baseline before evidence-only work |

## 8. Post-deployment smoke-test checklist

Run for each of these 18 routes: `/`, `/how-it-works/`, `/privacy/`, `/download/`, `/contact/`, `/accessibility/`, `/privacy-policy/`, `/terms/`, `/sign-in/`, `/ar/`, `/ar/how-it-works/`, `/ar/privacy/`, `/ar/download/`, `/ar/contact/`, `/ar/accessibility/`, `/ar/privacy-policy/`, `/ar/terms/`, `/ar/sign-in/`.

- Confirm HTTP 200 and trailing-slash directory resolution; unknown paths remain real 404s.
- Confirm title, description, canonical, hreflang, robots/noindex and sitemap behavior.
- Confirm `lang="ar"` and `dir="rtl"` on Arabic pages; inspect mixed Arabic/Latin strings, URLs, email placeholders, parentheses and numbers.
- At 375px, 390px, 430px and desktop, confirm no horizontal overflow, clipping, overlap or truncated label.
- Exercise desktop/mobile header, menu, logo, language switcher, footer, CTA buttons, FAQ accordions, badges and ordered steps.
- Confirm every internal link resolves; confirm the 44 generated sign-in anchors continue to target the correct locale route.
- Confirm `/sign-in/` and `/ar/sign-in/` render only the neutral chooser and the approved external Parent/Admin realm handoffs; do not add public auth forms.
- Confirm CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP and CORP headers.
- Confirm no console/network errors beyond approved unavailable/coming-later assets; confirm no build report, manifest, source or repository files are served.
- Confirm the live artifact SHA against the authorized deployment commit before accepting production publication.

## Final handoff

`PRODUCTION_DEPLOYED = NO`
`PRODUCTION_READY = NO`

Remaining blockers are external or owner-controlled: authorized deployment of the PCA artifact to replace the Azure placeholder, live 18-route smoke testing, mobile visual QA at 375/390/430px, OD-12 native Arabic approval, and formal privacy/legal approval.
