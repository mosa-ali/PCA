# PCA Public Implementation Programme

**Status:** Detailed planning programme — implementation not authorized  
**Programme:** PUBLIC-0 through PUBLIC-15  
**Authoritative inputs:** `PCA_PUBLIC_PRODUCT_GUIDELINE.md`, `PCA_PUBLIC_INFORMATION_ARCHITECTURE.md`, `PCA_PUBLIC_CONTENT_EN.md`, `PCA_PUBLIC_CONTENT_AR.md`, `PCA_PUBLIC_DESIGN_GUIDELINE.md`, `PCA_PARENT_PWA_GUIDELINE.md`, `PCA_PARENT_FEEDBACK_GUIDELINE.md`, `PCA_PUBLIC_PRIVACY_MESSAGING.md`, `PCA_PUBLIC_CLAIM_REGISTER.csv`.

## 1. Programme objective

Build PCA's public website, bilingual public/auth entry experience, Parent feedback capability and installable Parent PWA without weakening the existing Parent/Admin security separation, overstating product capabilities or turning privacy messaging into unsupported marketing claims.

The programme is evidence-gated. A phase is not complete merely because code exists. Acceptance requires the relevant combination of implementation, tests, real-browser evidence, EN/AR parity, privacy/security review, accessibility and clean ownership.

## 2. Global operating rules

1. Start with repository discovery; do not assume framework/routing/file ownership.
2. Use one authoritative coordinator.
3. Dynamic workflow/ultracode may be used only with dependency gates and exact non-overlapping ownership.
4. No two writing agents may edit the same file concurrently.
5. Shared/high-risk files receive single-writer ownership and coordinator review.
6. Never use `git add -A`.
7. Never force push.
8. Never merge to `main` automatically.
9. Do not change Azure, DNS, production or store publication in this programme.
10. Do not fabricate store links, browser capabilities or feature availability.
11. Preserve the Parent/Platform Admin security/session/RBAC boundary.
12. Never weaken the locked central privacy invariants.
13. Every material claim must map to `PCA_PUBLIC_CLAIM_REGISTER.csv`.
14. Screenshots alone are not acceptance evidence; use functional browser/tests.
15. If the repository state or active work makes safe implementation impossible, stop that slice and report the blocker rather than overriding another workstream.
16. No phase may self-declare final publication acceptance; final state is `READY_FOR_PRIMARY_CHATGPT_REVIEW`.

## 3. Dynamic workflow model

### Coordinator
**PUBLIC PROGRAMME COORDINATOR** owns:
- repository discovery and phase state;
- dependency graph;
- ownership ledger;
- shared-file arbitration;
- claim register reconciliation;
- integration and test matrix;
- commit staging decisions;
- final evidence report.

### Specialist workers
Use only when their scopes are non-overlapping:
- Product/Message reviewer
- IA/UX reviewer
- English content implementation agent
- Arabic/RTL implementation agent
- Design-system/frontend shell agent
- Public page-family agents
- Auth agent
- Feedback agent
- PWA agent
- Accessibility/SEO agent
- Browser UAT agent
- Privacy/Security adversarial reviewer

### Dependency graph
`PUBLIC-0 Discovery`  
→ `PUBLIC-1 Brand/message` + `PUBLIC-2 IA`  
→ `PUBLIC-3 EN`  
→ `PUBLIC-4 AR/RTL`  
→ `PUBLIC-5 Design system`  
→ `PUBLIC-6/7/8 page families (parallel only after ownership freeze)`  
→ `PUBLIC-9 Auth` + `PUBLIC-10 Feedback` + `PUBLIC-11 PWA` where file boundaries allow  
→ `PUBLIC-12 Accessibility/Performance/SEO`  
→ `PUBLIC-13 Full browser UAT`  
→ `PUBLIC-14 Privacy/Security adversarial review`  
→ `PUBLIC-15 Publication-readiness package`.

## 4. Ownership protection

PUBLIC-0 must produce an ownership table before any writer agent starts. Each owned path gets exactly one active writer. Read-only reviewers may inspect any path but must not edit it.

Likely high-risk shared areas to single-own after discovery:
- root application router;
- global i18n registry/config;
- shared global CSS/theme/tokens;
- auth/session provider;
- service-worker/manifest registration;
- API client/runtime config;
- shared layout/header/footer;
- server route registration;
- schema/migrations if feedback persistence requires them.

Exact filenames are deliberately not invented before discovery.

---

# PUBLIC-0 — Discovery & Requirements Reconciliation

## OBJECTIVE
Establish the actual repository, route, auth, i18n, Parent Web, security, PWA and data-flow baseline before architecture is changed.

## SCOPE
Read-only or minimally invasive discovery. No public feature implementation.

## DEPENDENCIES
Owner-approved documentation package; clean understanding of currently active engineering workstreams.

## OWNED FILES / likely ownership
No product-code ownership yet. Coordinator may create discovery documentation in a dedicated docs path after confirming it does not collide with another workstream.

## TASKS
- record branch/HEAD/status and remote relationship;
- inventory public routes and existing landing pages;
- locate login/signup/forgot/reset/verify routes;
- locate Parent Web routes and auth/session providers;
- locate Platform Admin routing/auth/RBAC boundary;
- inventory i18n framework, EN/AR resources and RTL support;
- inventory design system/global CSS/component library;
- inspect current manifest/service worker/PWA support;
- inspect feedback/support backend if any;
- map central fields/data flows relevant to public privacy claims;
- inventory analytics/cookies/logging/crash reporting;
- identify Android/iOS/store/public availability evidence;
- identify build/test/browser tooling;
- produce collision/ownership risk map.

## TESTS
No feature tests required, but run existing safe baseline tests/build commands sufficient to establish pre-change health and document failures.

## BROWSER VALIDATION
Open current public/auth/Parent surfaces in real browser where available; record current routes, EN/AR state, console errors and responsive behavior.

## SECURITY/PRIVACY CHECK
Map actual central child/account fields, relay payload visibility, auth boundaries, logs and providers at a discovery level. Do not publish claims yet.

## ARABIC/RTL CHECK
Determine whether Arabic exists, how direction is set, and which shared components are RTL-sensitive.

## ACCEPTANCE CRITERIA
- repository architecture documented;
- route/auth/i18n/PWA/data-flow inventories complete enough to assign work;
- no unsupported assumption remains about package/app structure;
- exact ownership ledger proposed;
- pre-existing failures separated from programme-introduced failures.

## BLOCKERS
Active conflicting work on the same shared files; inaccessible runtime; missing auth/environment needed for evidence.

## OUTPUTS
`PUBLIC_0_DISCOVERY_REPORT.md`, route map, ownership map, data/claim evidence matrix, baseline test report.

## COMMIT/PUBLICATION RULE
Discovery docs only if safe. No feature code, no main merge, no publication.

---

# PUBLIC-1 — Brand & Message Architecture

## OBJECTIVE
Reconcile the approved product doctrine with actual runtime facts and lock the implementation copy rules.

## SCOPE
Brand terms, tagline decision placeholders, product-surface naming, feature-status vocabulary, trust language.

## DEPENDENCIES
PUBLIC-0.

## OWNED FILES / likely ownership
Dedicated public content/config files or docs only; exact paths assigned after discovery.

## TASKS
- verify every owner-approved doctrine statement remains technically possible;
- create implementation-safe terminology constants/content keys;
- resolve any conflict between current UI names and PCA Public doctrine;
- preserve provisional OD decisions as explicit configuration/copy notes;
- update claim register evidence links/statuses from discovery.

## TESTS
Content-key uniqueness, no stale/forbidden brand strings in intended public scope.

## BROWSER VALIDATION
Spot-check representative brand/title/header strings in EN/AR once mounted.

## SECURITY/PRIVACY CHECK
No brand message may weaken the privacy doctrine or imply unreadable central content is readable.

## ARABIC/RTL CHECK
Arabic product names/terminology reviewed for consistency; no broad “family data” phrasing where child activity is meant.

## ACCEPTANCE CRITERIA
One authoritative vocabulary and no unresolved naming collision that would mislead users.

## BLOCKERS
Owner decision required only if implementation cannot safely use the recommended provisional default.

## OUTPUTS
Brand/message implementation map; updated claim register.

## COMMIT/PUBLICATION RULE
Commit only owned files after coordinator review; no publication.

---

# PUBLIC-2 — Information Architecture & Routing

## OBJECTIVE
Implement or prepare the approved sitemap and public-to-authenticated transitions with minimal disruption to existing routing.

## SCOPE
Public routes, navigation model, footer/legal routes, auth entry transitions, indexability map.

## DEPENDENCIES
PUBLIC-0 and PUBLIC-1.

## OWNED FILES / likely ownership
Router/layout/nav files assigned to one routing owner; page stubs may be created only if they do not become false “implemented” features.

## TASKS
- map canonical routes to actual router architecture;
- implement/adjust route shells only after conflict review;
- ensure no public/admin crossover;
- define 404/not-found behavior;
- define language-equivalent route behavior;
- decide `/access` provisional route and conditional `/cookies` handling;
- set auth routes non-indexable where appropriate.

## TESTS
Route unit/integration tests; direct deep-link tests; auth boundary tests; not-found tests.

## BROWSER VALIDATION
Desktop/mobile navigation, language switcher, login/get-started transitions, direct URL reloads.

## SECURITY/PRIVACY CHECK
No route bypasses authentication or exposes Platform Admin.

## ARABIC/RTL CHECK
Mobile/desktop nav order and route labels work in RTL.

## ACCEPTANCE CRITERIA
All documented routes have an intentional runtime mapping/status and no security boundary regression.

## BLOCKERS
Existing router architecture requires shared changes owned by another active workstream.

## OUTPUTS
Route implementation map and tests.

## COMMIT/PUBLICATION RULE
Single routing owner stages exact paths only; no `git add -A`; no publication.

---

# PUBLIC-3 — English Content Integration

## OBJECTIVE
Integrate the full approved English first-draft copy without placeholders or unsupported claims.

## SCOPE
All 27 content sections/experiences in `PCA_PUBLIC_CONTENT_EN.md`.

## DEPENDENCIES
PUBLIC-1/2; claim register evidence statuses.

## OWNED FILES / likely ownership
English content resources or page-owned copy files; no Arabic file overlap.

## TASKS
- implement headings, body copy, CTAs, helper text, error/empty states and SEO copy;
- gate or soften claims according to claim register status;
- keep legal drafts visibly provisional and unpublished where required;
- no fake store buttons/links;
- no unresolved pricing values.

## TESTS
Content-key/reference tests, forbidden-claim regression scan, broken-link scan.

## BROWSER VALIDATION
Representative pages across mobile/desktop for truncation, headings and CTA flow.

## SECURITY/PRIVACY CHECK
Privacy/security text matches actual discovery evidence; strong claims remain gated.

## ARABIC/RTL CHECK
N/A for content itself; ensure key architecture can support parity.

## ACCEPTANCE CRITERIA
No placeholder copy; every material claim is registered; English content complete for all defined sections.

## BLOCKERS
Claim needs runtime proof; use approved provisional wording rather than inventing certainty.

## OUTPUTS
Complete EN integration and content QA report.

## COMMIT/PUBLICATION RULE
English owner only; no publication.

---

# PUBLIC-4 — Arabic Content & RTL Integration

## OBJECTIVE
Deliver full Arabic parity as a native-quality RTL experience, not a literal translation overlay.

## SCOPE
All 27 Arabic content sections plus global navigation/auth/feedback/PWA microcopy.

## DEPENDENCIES
Stable PUBLIC-3 meaning; RTL architecture from PUBLIC-0/5 may be coordinated.

## OWNED FILES / likely ownership
Arabic resources; RTL-specific styling only if explicitly assigned and non-overlapping with design-system owner.

## TASKS
- integrate Arabic copy;
- preserve PCA/technical terms consistently;
- implement direction and bidi-safe handling;
- mark/resolve `NATIVE_REVIEW_REQUIRED` strings;
- validate error messages, form labels and metadata;
- ensure route/language switching preserves equivalent destination.

## TESTS
Translation-key parity, missing-key scan, RTL snapshot/layout tests where useful, bidi edge-case tests for email/URLs/numbers.

## BROWSER VALIDATION
320/375/390/tablet/desktop/wide RTL review; keyboard and screen-reader spot checks.

## SECURITY/PRIVACY CHECK
Arabic privacy claims must not become broader/stronger than English.

## ARABIC/RTL CHECK
This phase is the primary Arabic/RTL gate; native reviewer status documented.

## ACCEPTANCE CRITERIA
100% required key parity; no obvious clipping/overlap; no machine-literal legal/security distortion; native review issues tracked.

## BLOCKERS
No native reviewer yet: implementation may proceed provisionally, but publication cannot.

## OUTPUTS
Arabic parity report, unresolved native-review list.

## COMMIT/PUBLICATION RULE
Arabic owner only; no publication.

---

# PUBLIC-5 — Design System & Responsive Public Shell

## OBJECTIVE
Create the light-default accessible shell that all public/auth pages reuse.

## SCOPE
Tokens, typography, containers, header/mobile nav/footer, buttons, cards, forms, alerts, dialogs, RTL foundations.

## DEPENDENCIES
PUBLIC-0/1/2; design guideline.

## OWNED FILES / likely ownership
Global public design/shared component files assigned exclusively to design-system owner.

## TASKS
- implement light visual baseline;
- create responsive container/spacing/typography;
- implement header/footer/language switcher;
- reusable CTA/card/form/alert/dialog/FAQ primitives;
- visible focus and reduced motion;
- RTL-compatible primitives;
- prohibit dark cyberpunk/surveillance imagery.

## TESTS
Component tests, accessibility linting, keyboard interaction tests, visual regression where stable.

## BROWSER VALIDATION
All required widths in EN/AR; mobile menu; focus; zoom; reduced motion.

## SECURITY/PRIVACY CHECK
No admin components/authority assumptions reused in ways that blur realms; no sensitive example data.

## ARABIC/RTL CHECK
Directional icons, layout flow, typography and form alignment.

## ACCEPTANCE CRITERIA
Reusable shell is stable enough for parallel page-family work; no major accessibility/RTL defect.

## BLOCKERS
Shared CSS/theme conflicts with active workstreams.

## OUTPUTS
Design-system implementation and validation report.

## COMMIT/PUBLICATION RULE
Single shared-design owner; coordinator integrates before parallel writers start.

---

# PUBLIC-6 — Homepage

## OBJECTIVE
Implement the full bilingual homepage and conversion/trust journey.

## SCOPE
Hero, origin, challenge, feature summary, privacy, how-it-works, Parent, Child, principles, access, FAQ preview, final CTA.

## DEPENDENCIES
PUBLIC-3/4/5.

## OWNED FILES / likely ownership
Homepage page/component files only; shared components consumed read-only.

## TASKS
Implement sections, responsive illustrations/assets, feature status labels and claim-gated copy.

## TESTS
Page/component tests, link/CTA tests, metadata tests, forbidden-claim scan.

## BROWSER VALIDATION
EN/AR across required widths; all CTAs; no console errors; performance spot check.

## SECURITY/PRIVACY CHECK
Homepage privacy claims match register; no store/AI/iOS fabrication.

## ARABIC/RTL CHECK
Full homepage parity and visual balance.

## ACCEPTANCE CRITERIA
Homepage is complete, coherent, fast and claim-safe.

## BLOCKERS
Missing approved/usable imagery; use non-misleading illustration/placeholder-free neutral design rather than unsupported product screenshots.

## OUTPUTS
Homepage + evidence.

## COMMIT/PUBLICATION RULE
Owned files only; no publication.

---

# PUBLIC-7 — Product, Privacy & Security Pages

## OBJECTIVE
Implement `/how-it-works`, `/features`, `/privacy`, `/security`, `/parents`, `/access`, `/download` with strong claim discipline.

## SCOPE
Seven product/trust pages.

## DEPENDENCIES
PUBLIC-3/4/5 and updated claim evidence.

## OWNED FILES / likely ownership
This page family only, or split among agents with exact page-file ownership if repository structure permits.

## TASKS
- implement all approved copy;
- render feature-status states;
- ensure download surfaces are capability-aware;
- no fake PWA/store controls;
- privacy/security advanced sections may be progressive disclosure.

## TESTS
Route/page tests, claim-status tests, CTA/link tests, download/install eligibility tests where applicable.

## BROWSER VALIDATION
EN/AR; direct routes; responsive; feature status; privacy/security readability.

## SECURITY/PRIVACY CHECK
Every strong security/privacy claim reconciled with PUBLIC-0 evidence and register.

## ARABIC/RTL CHECK
All pages parity, especially tables/diagrams/accordions.

## ACCEPTANCE CRITERIA
No material claim exceeds evidence status; no later feature looks available.

## BLOCKERS
Production crypto/location/store evidence may remain pending; page must use provisional wording.

## OUTPUTS
Seven pages + claim reconciliation report.

## COMMIT/PUBLICATION RULE
No publication until PUBLIC-14/15.

---

# PUBLIC-8 — About, Child Safety, FAQ, Contact, Accessibility & Legal Shells

## OBJECTIVE
Complete remaining public trust/help pages and legal placeholders without pretending legal review is complete.

## SCOPE
`/why-pca`, `/about`, `/child-safety`, `/faq`, `/contact`, `/accessibility`, `/privacy-policy`, `/terms`, conditional `/cookies`.

## DEPENDENCIES
PUBLIC-3/4/5; support and legal decisions may remain provisional.

## OWNED FILES / likely ownership
This page family only.

## TASKS
- implement origin/values without founder embellishment;
- accessible FAQ;
- public contact categories;
- legal shells with clear review status in non-production environments;
- only instantiate cookies page if runtime justifies it;
- no internal operator contacts exposed.

## TESTS
FAQ keyboard tests, contact validation, legal-route index/visibility rules, contact anti-enumeration/anti-abuse as applicable.

## BROWSER VALIDATION
Mobile/desktop EN/AR; forms; FAQ; accessibility page.

## SECURITY/PRIVACY CHECK
Contact cannot become sensitive child-data intake; legal copy matches runtime evidence and remains gated.

## ARABIC/RTL CHECK
FAQ and form parity; legal Arabic remains native/legal review pending.

## ACCEPTANCE CRITERIA
All public trust/help routes complete; conditional/legal statuses honest.

## BLOCKERS
Legal entity/jurisdiction/provider list. These block production legal publication, not other page development.

## OUTPUTS
Trust/help/legal page family + review list.

## COMMIT/PUBLICATION RULE
No final legal publication without owner/legal approval.

---

# PUBLIC-9 — Auth Public Shell Integration

## OBJECTIVE
Make login/signup/recovery/verification part of PCA's bilingual public identity while preserving existing auth security behavior.

## SCOPE
Auth shell and five auth routes.

## DEPENDENCIES
PUBLIC-0 auth discovery, PUBLIC-2 routing, PUBLIC-4/5.

## OWNED FILES / likely ownership
Auth presentation files assigned to one auth owner; auth security provider/shared backend changes require separate single-owner approval.

## TASKS
- branded auth shell;
- language switcher;
- login/signup/recovery/reset/verify states;
- generic anti-enumeration copy;
- terms/privacy links;
- omit child data from public signup;
- implement recommended OD defaults only where compatible with real auth.

## TESTS
Auth integration tests, invalid/expired token tests, account-enumeration behavior, validation/accessibility tests.

## BROWSER VALIDATION
Real login/signup/recovery with safe test accounts where authorized; mobile EN/AR; error/success states.

## SECURITY/PRIVACY CHECK
No weakening of password/session/verification controls; no admin auth reuse that merges realms.

## ARABIC/RTL CHECK
All fields/errors/helper text and password controls.

## ACCEPTANCE CRITERIA
Auth works exactly as securely as baseline or better, with public design integration and bilingual parity.

## BLOCKERS
Unresolved email verification policy or existing auth defects; report rather than bypass.

## OUTPUTS
Auth shell + UAT evidence.

## COMMIT/PUBLICATION RULE
Security-sensitive files single-owned; no production auth configuration changes outside scope.

---

# PUBLIC-10 — Parent Help & Feedback

## OBJECTIVE
Implement privacy-safe Provide Feedback, Report a Problem, Suggest a Feature and Rate PCA.

## SCOPE
Parent UI, approved backend persistence/API if required, validation, support routing, no attachments V1.

## DEPENDENCIES
PUBLIC-0 data/schema/support discovery; feedback guideline; privacy review.

## OWNED FILES / likely ownership
Feedback UI/API/schema files assigned explicitly. Any shared schema/router gets one writer.

## TASKS
- implement four flows;
- categories/rating/contact permission;
- EN/AR privacy warnings;
- no screenshot/file upload;
- no automatic child activity/location/history/messages;
- safe case reference if supported;
- retention/support workflow hooks consistent with approved architecture.

## TESTS
Payload allowlist tests, negative tests proving sensitive fields are absent, validation/rate-limit tests, persistence/authorization tests, accessibility tests.

## BROWSER VALIDATION
Submit all four flows EN/AR; error recovery; keyboard; mobile; verify network payloads.

## SECURITY/PRIVACY CHECK
Adversarially inspect request payloads, logs and storage for accidental sensitive data.

## ARABIC/RTL CHECK
Warnings, categories, rating and dialogs.

## ACCEPTANCE CRITERIA
No automatic sensitive attachment/data path; all flows functional; retention documented; V1 attachments OFF.

## BLOCKERS
No approved secure persistence/support route; may implement UI only if clearly non-functional status is not misrepresented, otherwise hold phase.

## OUTPUTS
Feedback feature + privacy evidence.

## COMMIT/PUBLICATION RULE
No external support-system integration without explicit authorization.

---

# PUBLIC-11 — PCA Parent PWA

## OBJECTIVE
Make existing Parent Web safely installable where supported without changing trust authorization semantics.

## SCOPE
Manifest, icons, service worker, install state, first-visit prompt, iOS/manual guidance, update/offline behavior.

## DEPENDENCIES
PUBLIC-0 PWA/auth discovery, PUBLIC-5 shell, PWA guideline.

## OWNED FILES / likely ownership
Manifest/SW/install components exclusively owned by PWA agent; shared app bootstrap changes coordinator-controlled.

## TASKS
- implement manifest and assets;
- safe service-worker cache strategy;
- install capability detection;
- owner-approved install/continue flow;
- standalone detection;
- dismissal and provisional 30-day re-prompt policy;
- unsupported fallback;
- update UX;
- safe offline fallback;
- prove install does not alter Trusted Browser state.

## TESTS
Service-worker/cache tests, install-state logic tests, trust-state regression tests, offline/update tests.

## BROWSER VALIDATION
Real Chromium Android/desktop where available; iPhone/iPad manual guidance on real/supported environment; standalone launch; dismissed state; EN/AR.

## SECURITY/PRIVACY CHECK
Inspect caches/storage for sensitive decrypted data/tokens/keys; no trust elevation from install.

## ARABIC/RTL CHECK
Install prompts/instructions, icons and dialogs.

## ACCEPTANCE CRITERIA
Browser remains usable; installs work where real support exists; unsupported environments are honest; sensitive caching prohibited; trust semantics unchanged.

## BLOCKERS
Browser/platform limitations; do not fabricate support.

## OUTPUTS
PWA implementation + platform evidence matrix.

## COMMIT/PUBLICATION RULE
No store publication; PWA web deployment still waits for programme approval.

---

# PUBLIC-12 — Accessibility, Performance & SEO

## OBJECTIVE
Bring the public programme to objective quality thresholds before full UAT.

## SCOPE
Accessibility, Core Web/performance budget, metadata, sitemap, robots, hreflang/canonical, structured data where justified.

## DEPENDENCIES
PUBLIC-6 through 11 substantially integrated.

## OWNED FILES / likely ownership
SEO/accessibility-specific files; shared component fixes returned to their single owner or coordinator-assigned fixer to prevent overlap.

## TASKS
- keyboard audit;
- focus audit;
- heading/landmark audit;
- form/error semantics;
- contrast/reduced motion;
- image optimization/lazy-loading where appropriate;
- JS/performance review;
- EN/AR metadata;
- canonical/hreflang;
- sitemap/robots;
- keep auth routes non-indexable as appropriate;
- no unsupported claim in metadata.

## TESTS
Automated accessibility scan plus manual checks; link scan; metadata assertions; performance tests/budget.

## BROWSER VALIDATION
Required viewport matrix, zoom, reduced motion, keyboard-only navigation, screen-reader spot checks.

## SECURITY/PRIVACY CHECK
SEO metadata cannot expose internal routes, child data or unsupported security claims; analytics changes require privacy approval.

## ARABIC/RTL CHECK
Arabic metadata and RTL accessibility.

## ACCEPTANCE CRITERIA
No critical accessibility issue; reasonable performance; complete metadata parity; no broken public links.

## BLOCKERS
Third-party assets/fonts or architecture causing unacceptable performance/accessibility; remediate before UAT.

## OUTPUTS
Accessibility/performance/SEO report.

## COMMIT/PUBLICATION RULE
No public indexing/deployment yet.

---

# PUBLIC-13 — Real Browser Bilingual UAT

## OBJECTIVE
Validate the integrated public programme end-to-end in real browser conditions.

## SCOPE
All public routes, auth entry, Parent feedback, PWA, EN/AR, responsive states.

## DEPENDENCIES
PUBLIC-6–12.

## OWNED FILES / likely ownership
Primarily read-only testing. Fixes are assigned back to the owning agent/path, sequentially.

## TASKS
- execute route/CTA matrix;
- test 320/375/390/tablet/desktop/wide;
- EN/AR switching;
- RTL;
- auth navigation/states;
- feedback flows;
- PWA install/standalone/unsupported;
- console/network error review;
- direct-link/reload;
- broken links;
- form keyboard/accessibility.

## TESTS
Playwright/Chromium automation plus real Chrome/manual checks. Use real local backend where needed and authorized.

## BROWSER VALIDATION
This phase is the primary full browser gate. Screenshots may supplement but never replace functional evidence.

## SECURITY/PRIVACY CHECK
Inspect network payloads for public/auth/feedback/PWA slices where sensitive regressions are possible.

## ARABIC/RTL CHECK
Full route parity and native-review issue verification.

## ACCEPTANCE CRITERIA
No blocker/critical defect; all required journeys pass; no console-breaking errors; no false availability state.

## BLOCKERS
Environment/provider issues documented with reproducible evidence.

## OUTPUTS
UAT matrix, evidence links/logs, defect closure list.

## COMMIT/PUBLICATION RULE
Fix commits only through owner paths; no publication.

---

# PUBLIC-14 — Privacy & Security Adversarial Review

## OBJECTIVE
Challenge the integrated implementation and every material public claim before release readiness.

## SCOPE
Central data, logs, relay/encryption, auth boundaries, feedback payloads, PWA caches, deletion, providers, claims.

## DEPENDENCIES
PUBLIC-13 substantially green.

## OWNED FILES / likely ownership
Reviewer is read-only by default. Remediation assigned to original owners/coordinator.

## TASKS
- reconcile all 52 initial registered claims and any new ones;
- inventory actual central readable fields;
- validate locked privacy invariants;
- inspect logs/crash reporting/analytics;
- verify encryption/key/relay claims;
- test Parent/Admin separation;
- inspect PWA cache/local storage;
- inspect feedback payload/storage;
- verify deletion/retention claims;
- confirm store/AI/iOS/YouTube gated states;
- search source/content/metadata for prohibited absolute claims.

## TESTS
Security/privacy regression tests, packet/payload inspection, authorization negative tests, claim-regression scan.

## BROWSER VALIDATION
Targeted real-browser privacy/security scenarios and network inspection.

## SECURITY/PRIVACY CHECK
This is the final pre-publication privacy/security gate; unresolved critical findings block PUBLIC-15 readiness.

## ARABIC/RTL CHECK
Ensure Arabic claims do not overstate English and native review is complete or explicitly blocking.

## ACCEPTANCE CRITERIA
- zero unresolved critical privacy/security defects;
- claim register statuses reflect evidence;
- prohibited strong claims removed/gated;
- privacy policy can be finalized with actual facts.

## BLOCKERS
External crypto/security review may remain required for production-E2EE claims. If so, those claims stay gated and publication wording remains conservative.

## OUTPUTS
Adversarial review report, final claim register candidate, privacy evidence matrix.

## COMMIT/PUBLICATION RULE
No publication; reviewer cannot self-approve final release.

---

# PUBLIC-15 — Final Publication Readiness

## OBJECTIVE
Assemble an evidence-based package for owner and primary ChatGPT review without publishing anything.

## SCOPE
Final integrated status, claims, content, legal blockers, UAT, accessibility, security/privacy, git state and deployment prerequisites.

## DEPENDENCIES
PUBLIC-0–14 accepted or explicitly documented as gated with safe public wording.

## OWNED FILES / likely ownership
Documentation/report only unless final defects are assigned to owners.

## TASKS
- verify all pages/routes/statuses;
- ensure EN/AR/native review status;
- final claim register;
- final privacy/legal runtime facts;
- final store/PWA platform matrix;
- final tests/build/UAT;
- confirm no unowned or unstaged programme work;
- list Azure/DNS/store steps as future out-of-scope actions only;
- create publication-readiness report.

## TESTS
Final full test suite relevant to touched areas; clean build; claim regression; link/accessibility checks.

## BROWSER VALIDATION
Smoke test the release candidate in all required languages/viewports.

## SECURITY/PRIVACY CHECK
Final check against non-negotiable invariants and unresolved external review items.

## ARABIC/RTL CHECK
Final native review evidence and route parity.

## ACCEPTANCE CRITERIA
Package is complete enough for independent owner/primary ChatGPT decision. Do **not** label production accepted.

## BLOCKERS
Legal entity/jurisdiction, native Arabic approval, external security review, unresolved critical defect, unverified store/provider claim, or owner decision required for release.

## OUTPUTS
`PUBLIC_15_PUBLICATION_READINESS_REPORT.md` plus evidence inventory.

## COMMIT/PUBLICATION RULE
Stop with `READY_FOR_PRIMARY_CHATGPT_REVIEW`. No merge to main, Azure change, DNS change, store publication or production release.

---

# 5. Parallelism matrix

| Phase | Parallelism recommendation |
|---|---|
| PUBLIC-0 | Sequential coordinator-led discovery |
| PUBLIC-1 + PUBLIC-2 | Limited parallel read/write only with non-overlapping docs/config; routing remains single-owner |
| PUBLIC-3 | English first, mostly sequential before Arabic stabilization |
| PUBLIC-4 | Follows stable English meaning; can overlap late EN fixes only with separate files |
| PUBLIC-5 | Sequential shared foundation |
| PUBLIC-6 / PUBLIC-7 / PUBLIC-8 | Can run in parallel after shared design/route/content contracts are frozen and page files do not overlap |
| PUBLIC-9 / 10 / 11 | Can overlap only if auth/feedback/PWA shared files are disjoint; otherwise sequential single-owner slices |
| PUBLIC-12 | Integrated quality pass; shared fixes sequentially assigned |
| PUBLIC-13 | Testing parallelizable by journey, fixes routed through owners |
| PUBLIC-14 | Independent adversarial review; remediation sequentially assigned |
| PUBLIC-15 | Coordinator only |

## 6. Claim-regression testing requirement

Implementation should include a maintainable mechanism that catches at least:
- prohibited “zero data”/absolute security claims;
- iOS/App Store/Google Play links shown without verified status;
- production AI/YouTube Mode B presented as active;
- PWA text that equates install with Trusted Browser;
- missing EN/AR equivalents for material public strings;
- sensitive feedback fields/attachments accidentally added;
- metadata containing stronger claims than page content.

Exact test mechanism depends on repository architecture discovered in PUBLIC-0.

## 7. Owner decisions

OD-01 through OD-15 remain `OWNER_APPROVAL_PENDING`. The recommended defaults in `PCA_PUBLIC_PRODUCT_GUIDELINE.md` govern drafting/implementation unless the owner overrides them. No unresolved commercial/legal decision should block unrelated implementation, but legal/commercial claims remain gated from publication.

## 8. Programme terminal state

The implementation programme is complete only when the coordinator can truthfully return:

`PCA_PUBLIC_IMPLEMENTATION = READY_FOR_PRIMARY_CHATGPT_REVIEW`

It must never self-return `PUBLIC_SITE_FINAL_ACCEPTED` or publish automatically.
