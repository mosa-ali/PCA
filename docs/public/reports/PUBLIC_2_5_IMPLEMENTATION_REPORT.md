# PUBLIC-2 → PUBLIC-5 IMPLEMENTATION REPORT

**Programme:** PCA Public Website + Product Identity + Parent PWA
**Phases:** PUBLIC-2 (IA/routing) · PUBLIC-3 (EN content) · PUBLIC-4 (AR/RTL content) · PUBLIC-5 (design system)
**Authority:** Owner ruling of 2026-09-04 — PUBLIC-0 ACCEPTED, PUBLIC-1 ACCEPTED_WITH_NOTES, `public-web/` standalone package APPROVED
**Generated:** 2026-09-05

```
PUBLIC_2 = COMPLETE
PUBLIC_3 = COMPLETE_WITH_DEFECT   (see section 7 — DEF-1, owner decision required)
PUBLIC_4 = COMPLETE_PENDING_NATIVE_REVIEW  (OD-12 gate)
PUBLIC_5 = COMPLETE
PPR2_TREE_INTEGRITY = PRESERVED
AZURE_STATE = UNCHANGED
```

---

## 1. What exists now

A new standalone package at `public-web/`, **untracked**, exactly as the ruling directed. 16 routes × 2 locales = **32 prerendered HTML pages**, plus `404.html`, `robots.txt`, `sitemap.xml` and a build report.

| Metric | Value |
|---|---|
| Routes implemented | **16 of 16** approved Release-A routes (`/cookies` deliberately not built — see §2) |
| Pages emitted | 32 |
| Content keys | **268 EN / 268 AR — exact parity, build-enforced** |
| First-load payload (home) | **~13 KB gzipped total** — 4.3 KB HTML + 7.6 KB CSS + 1.0 KB JS |
| Whole site on disk | 465 KB |
| Runtime dependencies | **0** |
| Build dependencies | **0** — `node build.mjs`, no install step, no `node_modules`, no lockfile, no CI audit entry |
| JavaScript shipped | 2.1 KB, one file, one control (the mobile menu disclosure) |
| Fonts / images / third-party | none, beyond a 1 KB inline-styled SVG favicon |

For contrast: PUBLIC-0 measured `parent-web` at a **single eager 719,632-byte JS chunk** with zero code splitting, plus 183,858 bytes of both locale bundles shipped to every visitor. The separation the owner approved is what makes ~13 KB possible.

---

## 2. PUBLIC-2 — Information architecture and routing

### URL scheme — topology-neutral by construction

```
English   /            /why-pca/            /privacy-policy/
Arabic    /ar/         /ar/why-pca/         /ar/privacy-policy/
```

Every URL is a real directory + `index.html`. There is **no client router and no SPA history fallback**, so the artifact drops unchanged onto the current placeholder container, a host-routing container (predeploy PATH C) or a dedicated App Service (PATH B). Nothing in the build encodes an origin: every link and asset reference is origin-relative. Only `canonical`, `hreflang` and `og:url` are absolute, because those three must name the canonical host regardless of which copy a crawler reaches — and they come from `PUBLIC_SITE_ORIGIN`, defaulting to `https://www.pcasafe.com` (PUBLIC-0 confirmed the apex does not resolve).

The Arabic tree is a **path prefix** rather than a query parameter, because that is what makes per-locale `lang`/`dir` and `hreflang` expressible without a redirect — see §5.

### Release gating — one flag, not scattered conditionals

`RELEASE.authLive` is `false`. `resolvePrimaryCta()` therefore routes every primary CTA to `/download/` instead of `/signup/`, and `loginCta()` returns `null` so Login is absent from the header entirely. The five auth routes are declared in the route table but **not built**.

This is IA §4 implemented literally, and PUBLIC-0 proved it is not hypothetical: production signup returns `202` while the verification code never leaves the process, so a parent following a live signup CTA today dead-ends at `/verify-email` with no error. Flipping `authLive` to `true` is the only change Release B needs; **no page component hardcodes an auth destination**.

### Link gating — and a defect it caught

A route is linkable only when it is **both** release-enabled in `routes.mjs` **and** has a registered renderer. Using the route table alone silently produced footer links to approved-but-unimplemented routes, which served 404s. That shipped briefly and was caught by the new `assertInternalLinksResolve` gate; every same-origin `href` in the output is now proven to resolve to a file this build writes.

### Route decisions

| Decision | Outcome |
|---|---|
| `/cookies` | **Not built.** Per the owner ruling on CLM-055, it is required only if runtime evidence shows a real need. Release A sets no cookies beyond the URL-expressed language choice and loads no third-party resource, so the condition is unmet. Kept in the route table so the decision stays visible. |
| `/privacy-policy`, `/terms` | Built as route shells carrying the approved provisional drafts and a visible provisional notice. **`noindex, nofollow`, and excluded from `sitemap.xml`** — the two can never disagree, because robots and sitemap are both generated from the same `indexable` flag. Publication remains owner/legal-gated (BLOCK-3). |
| `/signup` vs `/register` | Recorded, not resolved. `parent-web` implements `/register`; the public IA specifies `/signup`. PUBLIC-9 must decide whether Release B hosts the form here or redirects. |
| Collisions on `/privacy`, `/download`, `/security`, `/` | Dissolved by the separate origin. No renaming needed. |

---

## 3. PUBLIC-5 — Design system

Light-default, calm, family-friendly. None of Design Guideline §2's prohibited directions (dark cyberpunk, hacker, surveillance, red-alert) exist in the token set — **there is no dark palette to fall into**.

### Colour — two decisions the owner should see

Design Guideline §3 is `OWNER_APPROVAL_PENDING` and explicitly permits proposing accessible values.

1. **Primary is `#1B5FA8`, not `platform-admin-web`'s `#4f8cff`.** PUBLIC-0 flagged that the operator console's accent already sits in the "calm medium blue" family §3 proposes; adopting a bright blue would visually merge the public brand with the internal admin realm, against Guideline §27. `#1B5FA8` is deeper, calmer, and used by neither console.
2. **Trust accent is `#0F766A` — `parent-web`'s existing teal.** §3 demotes teal to the trust/privacy role rather than removing it, so reusing the shipped hue there keeps continuity with the Parent console without either app re-deriving its accent chain.

### Contrast is computed, not commented

`assertContrast()` runs real WCAG 2.1 relative-luminance maths over **30 foreground/background pairs** on every build and fails below 4.5:1 for text / 3.0:1 for UI boundaries. Minimum measured: **3.25:1** (focus ring on warm surface, threshold 3.0). All 30 pass.

This directly answers a finding from PUBLIC-0: every WCAG ratio in `parent-web/src/styles/global.css` is a hand-written comment, and the only a11y gate runs axe under **jsdom, where `color-contrast` cannot produce a result at all**. One token was changed as a direct result — `--pca-slate-400` moved from `#8a99ad` to `#7d8ca0`, because the lighter value computes **2.90:1** against white and fails the 3:1 UI-component threshold.

**This does not satisfy CLM-054.** Computed ratios prove the token values, not the rendered page. CLM-054 stays `NOT_APPROVED_FOR_PUBLIC_CLAIM` per the ruling.

### Other enforced invariants

| Gate | What it does |
|---|---|
| `assertNoPhysicalCss` | Fails on any `margin-left` / `padding-right` / `left:` / `right:` box declaration. Both stylesheets are 100% logical properties. PUBLIC-0 found the equivalent invariant in `parent-web` guarded only by a Playwright spec CI never runs. |
| `assertNoRawTokenUse` | Components may never reference a Layer-1 `--pca-*` token. PUBLIC-0 found `parent-web`'s own version of this rule, kept only in a comment, already broken in four rules with seven direct references. |
| `assertClaimLabels` | No status label stronger than the claim register permits, in either locale. |
| `assertInternalLinksResolve` | Every internal link resolves to an emitted file. |
| `assertNoExternalRefs` | No third-party origin in any `href`/`src`. |

Also implemented that PUBLIC-0 found missing repo-wide: a `forced-colors` block (Windows High Contrast), `prefers-reduced-motion`, and a `.pw-sr-only` rule defined before first use.

### Fonts

System stack only — no `@font-face`, no Google Fonts, no self-hosted file. Three reasons: the CSP is `font-src 'self'`; a webfont is an LCP cost on a marketing site; and `parent-web` already proved this stack renders Arabic acceptably. `'Noto Sans Arabic'` and `'Dubai'` precede Tahoma. Adopting a hosted family is an owner decision with a CSP change attached — recorded for PUBLIC-12.

---

## 4. PUBLIC-3 / PUBLIC-4 — Bilingual content

All 27 approved content sections across 16 routes, transcribed from `PCA_PUBLIC_CONTENT_EN.md` / `_AR.md` v0.2. Written by 13 parallel writers under exact non-overlapping file ownership — each owned only `src/content/pages/<id>.{en,ar}.mjs` and `src/pages/<id>.mjs`, and no writer could touch `routes.mjs`, `claims.mjs`, `index.mjs`, `build.mjs` or any shared component.

**Session-limit interruption, and how it was handled.** The content run hit the account's usage limit partway through: 12 of 25 agents completed, and 13 — including 3 writers and almost every adversarial verifier — were killed. The three "failed" writers had already written their files and lost only their final report. **Nothing was trusted on that basis.** All 16 routes were registered and put through the full build gate set and a 74-check real-browser UAT, and the two defects in §6 were found by that verification rather than by the agents' own reports.

### Claim discipline is enforced, per locale

Rendered status labels, verified in the built output:

| Page | Labels |
|---|---|
| `/` | 8 × `Requires platform support` (CLM-028…035) + 1 × `Coming later` (CLM-024) |
| `/features/` | 11 labels + the four status-label definitions |
| `/download/` | 4 labels — Android and iOS both `Coming later`, **no store badge, no store link, no download action** |
| `/parents/` | 3 labels |
| `/how-it-works/` | 1 label (CLM-024 on the PCA Child step) |
| `/privacy/`, `/security/` | **0 labels** — correct: their claims are `EXTERNAL_SECURITY_REVIEW` and render design-language prose, never a pill |

### Arabic

Transcribed from the approved Arabic document, not machine-translated. **12 keys are recorded as `NATIVE_REVIEW_REQUIRED`** and the build prints them on every run and writes them to `dist/build-report.json`.

That is a deliberate contrast with the existing apps: PUBLIC-0 found `parent-web`'s `_arReviewPending` array of 127 keys is read by **no test, no lint rule and no CI step**, and that the PPR-2 ledger records its count incorrectly (115 vs 127). Here the list is executed.

**CLM-050 and CLM-051 remain `COMING_LATER`.** OD-12 native sign-off is outstanding.

---

## 5. Real-browser UAT — 74/74 clean

Run in real Chromium across every emitted page, both locales, with the mandated 320/375/390/768/1024/1280/1600 matrix on the homepage.

Checked and passing on all 74: correct served `lang`/`dir`, zero horizontal overflow, zero console errors, zero failed requests, exactly one `<h1>`, no heading-level skips, all touch targets ≥44px, no external links, no `<form>`, no `<img>` without `alt`, title + description + canonical present, and a forbidden-claim scan over **rendered text** (the build scans source).

### The UAT found four defects the build gates could not

1. **CSP-blocked inline style.** `home.mjs` used `style="list-style:none;…"` on the steps list; the production `style-src 'self'` correctly blocked it, leaving the list unstyled. Replaced with a `.pw-plain-list` class.
2. **16px (EN) / 18px (AR) horizontal overflow at 320px** — brand + language switcher + labelled menu button exceeding 280px of content width. The menu button is now a 44×44 icon-only control below 26rem, with its label kept in the accessibility tree.
3. **Sub-44px touch targets** — language switcher at 38px, footer links at 36px. Both raised to 44px.
4. **A permanent console error on every page.** `frame-ancestors` is ignored in a `<meta>` CSP per CSP Level 3, and Chrome logs that as an error on every load. `parent-web` keeps the directive in its meta tag anyway; the cost is a known-noise error that trains reviewers to ignore the console. It now lives only where it works — in `REQUIRED_RESPONSE_HEADERS`.

### Chrome extension: BLOCKED_EXTERNAL_TOOL

The Claude Chrome extension could not screenshot or read these pages — its injected script is blocked by `script-src 'self'`. That is the CSP working correctly. **The CSP was not weakened for tooling**; Playwright was used instead, which is what PUBLIC-13 mandates. The harness is now installed at `public-web/scripts/uat.mjs` (`npm run uat`) and borrows `parent-web`'s already-installed Playwright, so `public-web` stays zero-dependency.

---

## 6. Two content defects found and fixed

### Fixed — approved copy had been softened to satisfy my own scan

The `/access` writer changed the approved `No misleading "free forever" promise` into a vaguer `No misleading promises about plans or prices before approval`, in both locales, **purely because the forbidden-claim scan matches `free forever` wherever it appears**. The sentence is the *opposite* of the claim CLM-041 forbids.

This is the documented limitation of that scan biting: it deliberately does not distinguish an assertion from a negation. Rewriting owner-approved copy to satisfy a regex is the tail wagging the dog, so the approved wording was **restored in both locales** and an exemption mechanism added: `ALLOWED_EXACT_PHRASES` accepts only a **complete approved sentence**, never a substring, each with a written reason, **printed on every build** and recorded in `dist/build-report.json`. Two entries exist, both this sentence.

### Fixed — a dead-end CTA on `/download`

The PCA Parent card was titled **"Open PCA Parent"** with an `Available` label — an imperative inviting an action with no destination, since `app.pcasafe.com` serves a placeholder and external links are banned. IA §4 places `Open PCA Parent` in Release C. Retitled to the descriptive **"In your browser"** / **"من المتصفح"**; the `Available` label is retained because CLM-021 (browser use without installing) is genuinely `VERIFIED_AVAILABLE`.

---

## 7. DEF-1 — open defect requiring an owner decision

**Three sections of `/features/` currently print internal implementer directives as public copy.** Rendered today, verbatim:

> **AI** — "Production AI must not be advertised until formally activated, security/privacy reviewed and included in the claim register as verified."
>
> **Location** — "…Availability remains evidence-gated."
>
> **Camera/Proximity** — "Potential eye-distance/proximity protection is not an active public feature until runtime evidence confirms on-device ephemeral processing with no retained/uploaded frames."

**This is not a transcription error.** I verified it against `PCA_PUBLIC_CONTENT_EN.md` lines 286-298: the approved v0.2 document itself supplies these directives as the section body. The writer transcribed faithfully; the defect is in the source document.

Programme §2 rule 15 and the master prompt both require that a document conflict be **recorded and classified, not silently resolved in copy**, so I have not rewritten them. But "Production AI must not be advertised until…" is meaningless to a parent and reads as leaked internal process.

**Classification:** `BLOCKED_OWNER` — content authoring decision.
**Impact:** blocks `/features/` for Release A. No other page is affected. No claim is violated (CLM-038 is not asserted; nothing claims AI is active).
**Recommendation:** replace all three with short parent-facing sentences carrying the correct status label — e.g. for AI, a `Coming later` label plus one sentence stating PCA is not using AI protection in the current release. Requires owner-approved wording and a claim-register line for each.

---

## 8. Repository and infrastructure state

```
branch                pca-dev          HEAD 74e5ad5   (unchanged by this programme)
stash@{0}             intact, 48 files, DO NOT DROP — never touched
public-web/           untracked, as ruled
docs/public/          untracked
files staged          none
files committed       none
Azure                 UNCHANGED — no DNS, certificate, binding, container,
                      app setting or plan was modified
```

PPR-2 committed `74e5ad5` (CREATE_INVITATION free-basic enrollment) during this phase. **BLOCK-1 still stands:** the code landed but `PART M` is still absent from `docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` (the ledger still ends at Part L). CLM-041 and CLM-042 remain `NOT_APPROVED_FOR_PUBLIC_CLAIM`, and `/access` therefore carries values-level messaging only — which is what the approved copy says regardless, so no rework is pending on that page.

### Queued for serialized integration after PPR-2 lands

Both are single-line edits to files inside the PPR-2 ownership window. **Neither has been touched.**

1. `tooling/repo-checks/Invoke-RepositoryChecks.ps1:38` — add `public-web` to `$AllowedTopLevel`. Until then the package must stay untracked; the check fails on any unexpected tracked top-level path.
2. `.github/workflows/quality-gates.yml` — add a build job. Note the package needs **no** dependency-audit or SBOM entry, since it has no dependencies.

---

## 9. Phase state

| Phase | State |
|---|---|
| PUBLIC-0 Discovery | **COMPLETE** — owner ACCEPTED |
| PUBLIC-1 Brand/claims | **COMPLETE** — owner ACCEPTED_WITH_NOTES |
| PUBLIC-2 IA/routing | **COMPLETE** |
| PUBLIC-3 EN content | **COMPLETE_WITH_DEFECT** — DEF-1 |
| PUBLIC-4 AR/RTL content | **COMPLETE_PENDING_NATIVE_REVIEW** — OD-12 |
| PUBLIC-5 Design system | **COMPLETE** |
| PUBLIC-6/7/8 Page families | **COMPLETE** — folded into PUBLIC-3/4; all 16 routes built |
| PUBLIC-9 Auth shell | **BLOCKED_EXTERNAL** — no email provider |
| PUBLIC-10 Feedback | NOT_STARTED — net-new; needs a backend route ⇒ `WAIT_FOR_PPR2_PATH` |
| PUBLIC-11 PWA | **WAIT_FOR_PPR2_PATH** — Release C |
| PUBLIC-12 A11y/SEO/perf | **PARTIAL** — SEO complete (metadata, canonical, hreflang, sitemap, robots); performance well inside budget; accessibility needs a real axe run before CLM-054 can move |
| PUBLIC-13 Browser UAT | **PARTIAL** — 74/74 automated checks clean; keyboard-only traversal and screen-reader spot checks outstanding |
| PUBLIC-14 Adversarial review | NOT_STARTED |
| PUBLIC-15 Release readiness | NOT_STARTED |

```
PUBLIC_RELEASE_A = NOT_READY   (blockers: DEF-1; OD-12 native Arabic; OD-13 legal;
                                production security headers; PUBLIC-12/13/14 completion)
PUBLIC_RELEASE_B = BLOCKED     (no transactional email provider)
PUBLIC_RELEASE_C = NOT_READY   (PWA install UX greenfield; parent-web PPR-2-owned)
PUBLIC_RELEASE_D = NOT_READY   (Android COMING_LATER)
```

Nothing here is self-approved. This programme terminates at `READY_FOR_PRIMARY_CHATGPT_REVIEW`.
