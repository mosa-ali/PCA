# PUBLIC IA CONSOLIDATION — CHECKPOINT

**Authority:** Owner ruling, 2026-09-05 — simplify IA to three main pages, add two public videos, resolve DEF-1
**Programme:** continued, not restarted. PUBLIC-2…PUBLIC-5 work preserved and reworked in place.
**Generated:** 2026-09-05

---

## Requested checkpoint

```
PRIMARY_PUBLIC_PAGES         = 3        (Home, How PCA Works, Privacy & Safety)
UTILITY_ROUTES               = 5        (4 built + 404) ; +5 auth routes declared, gated off
VIDEO_1_STATUS               = SCRIPTED_PLACEHOLDER   (PCA Introduction, ~71s EN / ~66s AR)
VIDEO_2_STATUS               = SCRIPTED_PLACEHOLDER   (How to Enroll with PCA, ~80s EN / ~69s AR)
DEF_1                        = RESOLVED
CLM_041_STATUS               = NOT_APPROVED_FOR_PUBLIC_CLAIM   (blocker closed, status unchanged)
CLM_042_STATUS               = NOT_APPROVED_FOR_PUBLIC_CLAIM   (blocker closed, status unchanged)
BROWSER_UAT                  = 38/38 page checks clean (real Chromium)
CONTENT_DUPLICATION_FINDINGS = 0
```

---

## 1. PPR-2 truth refreshed

`origin/pca-dev` = `74e5ad5200e5614f0511e16292b804db78338420`, matching the expected SHA. Local HEAD identical.

**Part M is published** at `docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md:697` — *"PART M · FINAL OWNER DECISION — LICENSE/ENTITLEMENT RESOLVED, PPR-2 CLOSED"*. `CREATE_INVITATION.requiresLicense = false`, verified end to end against real MySQL on a genuinely fresh family (M3: backend non-DB 2184/2184; focused authz/invitation/slot 89/89; Parent/Admin realm separation re-confirmed 3/3).

**The stale BLOCK-1 is removed.** "Part M has not landed" is no longer a blocker anywhere in the programme.

### CLM-041 / CLM-042 re-evaluated, not promoted

Part M scopes itself explicitly:

> *"this is not a statement that every future PCA feature is free, only that the BASIC V1 protection tier must let a parent enroll a child device before any paid/premium entitlement exists."*

So it supports neither a permanent free plan nor finalized pricing. Both remain `NOT_APPROVED_FOR_PUBLIC_CLAIM` **on the evidence rather than on the blocker** — exactly as the ruling directed ("do not automatically promote them beyond what the claim evidence supports").

What Part M *does* support is registered as **CLM-056** — *"Basic child-device enrollment does not require a paid license"* — status `LIMITED`, and **deliberately not rendered anywhere**. `LIMITED` because no parent can reach the behaviour: Release B is blocked with no email provider, so account creation does not complete. Per the ruling it may enter copy only once the register approves exact wording.

---

## 2. The new information architecture

| Route | Kind | Absorbs |
|---|---|---|
| `/` | **main** | Why PCA, About, Features, For Parents, Access, Child Safety summary, FAQ summary |
| `/how-it-works/` | **main** | How It Works, Download, parent onboarding, enrollment, PWA install |
| `/privacy/` | **main** | Privacy, Security, Child Safety Principles |
| `/contact/` | utility | — |
| `/accessibility/` | utility | — |
| `/privacy-policy/` | legal | `noindex`, provisional |
| `/terms/` | legal | `noindex`, provisional |
| `404.html` | utility | — |

Primary navigation is exactly **Home · How It Works · Privacy & Safety · EN/العربية**. Nine routes were deleted: `/why-pca`, `/about`, `/features`, `/parents`, `/access`, `/faq`, `/child-safety`, `/download`, `/security`.

**16 routes × 2 locales (32 pages) → 7 routes × 2 locales (14 pages).**

### Why deleted rather than redirected

The ruling permits redirects for compatibility/SEO. **None are needed, and this is evidenced, not assumed:** PUBLIC-0 established that nothing has ever been deployed — all five pcasafe.com hostnames serve Azure's placeholder container, no deployment source is configured, and `pcasafe` appears in zero non-docs files. There are no indexed URLs, no inbound links and no legacy traffic. Redirect stubs would create exactly the duplicate-content maze the ruling forbids, for visitors who cannot exist. Recorded in `routes.mjs` so the decision stays auditable.

### Login / Get Started

`RELEASE.authLive` remains `false`, so Get Started routes to `/how-it-works/` (the informational start page IA §4 permits) and Login is absent from the header. This is the same gate the owner accepted previously, and PUBLIC-0's evidence still holds: production signup returns `202` while the verification code never leaves the process. Flipping one flag turns both into real account actions. **Flagged because the ruling's navigation spec lists both** — they are implemented, just gated.

---

## 3. Videos

| | Video 1 | Video 2 |
|---|---|---|
| Name | PCA Introduction | How to Enroll with PCA |
| Placement | Home, section B | How PCA Works |
| Owner target | 60–90s | 60–120s |
| Scripted length | ~71s EN / ~66s AR | ~80s EN / ~69s AR |
| Script (EN + AR) | ✅ authored, 8 scenes | ✅ authored, 10 scenes |
| Storyboard | ✅ in file header | ✅ in file header |
| Transcript | ✅ renders as visible text | ✅ renders as visible text |
| Poster | ✅ renders | ✅ renders |
| Recording | ❌ none | ❌ none |
| Caption files | ❌ none | ❌ none |
| Status label | `Coming later` (CLM-059) | `Coming later` (CLM-059) |

**No broken player.** While `available: false`, no `<video>` element is emitted at all — the block renders a poster, a `Coming later` label, the title, a summary and the full transcript. When a recording lands, the same block emits `<video controls preload="none">` (no autoplay, nothing fetched on first paint) with a caption track per locale.

`assertVideoAssets()` **fails the build** if `available: true` without the real file and both caption files, so the flag and reality cannot drift.

**No caption files were fabricated.** A `.vtt` is a list of cue timings; inventing timings for a video that does not exist would be manufacturing evidence of an asset. Scripts and storyboards exist now; captions are generated from them when the recordings land.

Accessibility is satisfied without the video: the transcript renders in both states, so every step is readable as text. Nothing critical is video-only. Visual direction explicitly forbids fear, hacker, hooded-figure, distressed-child and surveillance imagery, recorded in the file headers so a later producer cannot reintroduce them. No real Android screenshots or physical-device footage are described — those replace mock visuals only after physical-device UAT.

---

## 4. DEF-1 = RESOLVED

Internal implementation directives no longer appear as parent-facing copy anywhere. Replacements use the owner-approved language:

| Was (verbatim, from the approved v0.2 document) | Now | Claim |
|---|---|---|
| "Production AI must not be advertised until formally activated, security/privacy reviewed and included in the claim register as verified." | "AI-supported features are planned for a later release." | **CLM-057** `COMING_LATER` |
| — | "Advanced YouTube protection is planned for a later release." | **CLM-058** `COMING_LATER` |
| "**Coming Later.** Do not show App Store badges or download links before real publication." | "iPhone and iPad child protection is planned for a later release." | **CLM-026** `COMING_LATER` |
| "…is not an active public feature until runtime evidence confirms on-device ephemeral processing…" | Plain statement that it is planned for a later release | **CLM-037** `COMING_LATER` |
| "Availability remains evidence-gated." | Dropped — the visible status label already says it | **CLM-036** |
| "Availability must be verified by platform before publication." | Dropped — the visible status label already says it | **CLM-028** |

**Docs realigned with code.** `docs/public/PCA_PUBLIC_CONTENT_CORRECTIONS_v0.2.1.md` records every superseded string, its replacement, its governing claim and the rationale. It is an **addendum rather than an in-place edit** because the v0.2 package ships `SHA256SUMS.txt` and all 13 files verified OK at load; editing them would destroy the integrity evidence for the accepted baseline. v0.2 stays byte-intact; the addendum carries the corrections.

No claim ids, security-review workflow, activation instructions or the phrase "claim register" reach a parent. *(One residual: `data-claim` attributes appear in view-source on status pills. They are machine-readable audit anchors the build gate asserts against, not visible text. Retained deliberately — flagged for the owner as a view-source-only disclosure.)*

---

## 5. Verification

### Build gates — all executed, all green

```
content parity        EN 181 / AR 181 keys, exact
contrast              30 pairs computed, min 3.25:1, all pass
duplicate content     0 findings
home reading size     468 EN words (ceiling 900 ≈ 2-3 min)
pages emitted         14 (7 routes × 2 locales)
SVG well-formedness   pass
video assets          pass
review-list liveness  pass
claim-scan exemptions 0 (the /access exemption was removed with the route)
```

### Browser UAT — 38/38 clean

Real Chromium, every page, both locales, the mandated 320/375/390/768/1024/1280/1600 matrix on Home. Zero console errors, zero horizontal overflow, all touch targets ≥44px, correct served `lang`/`dir`, one `<h1>` per page, no external links, no forms, no broken images, legal drafts `noindex`.

### Payload

| | raw | gzipped |
|---|---|---|
| Home HTML | 16.9 KB | **4.0 KB** |
| How It Works HTML | 12.7 KB | 3.3 KB |
| Privacy HTML | 15.3 KB | 4.0 KB |
| CSS | 29.9 KB | 7.9 KB |
| JS | 2.1 KB | 1.0 KB |
| **Whole site** | **261 KB** | — |

**First load ≈ 13 KB gzipped.** No fonts, no third-party requests, no video bytes before interaction.

---

## 6. Defects found and fixed during this pass

Four were found by verification rather than by the writers' own reports — the value of adversarial checking and a real browser.

1. **`build.mjs` was a SyntaxError, so four gates had silently never run.** A patch wrote a literal newline into a regular expression, and a second lost a regex backreference. Duplication, reading-time and video-asset gates were dead from the moment they were added. This is precisely the failure mode recorded against this repository, and it was mine. `npm run build` and `npm run check` now run `node --check` first, so a syntax error can never again masquerade as a passing build.
2. **Both video posters and the favicon were unrenderable.** All three contained `--` inside an XML comment, which is illegal in XML. All three served HTTP 200 with the correct `image/svg+xml` type and the build was green — and all three rendered as a broken-image icon. Fixed, plus two new gates: `assertSvgAssetsAreWellFormed()` in the build, and a `naturalWidth > 0` assertion for every `<img>` in the browser UAT, which catches the whole class rather than this one cause.
3. **Real cross-page duplication.** The duplication gate — once it could actually run — caught the AI FAQ item published on both Home and Privacy. Three further overlaps that the gate *cannot* see (reworded around a shared verbatim clause) were found by the verifiers: the messages explanation, the photos/files explanation, and the end-to-end-encryption explanation shared between Privacy and How It Works. All resolved; Privacy owns the detail, the other pages summarise and link.
4. **Claim drift in Arabic.** `privacy.ar` dropped the "is designed to" hedge on CLM-008, asserting as present fact what English hedged — CLM-008 is `EXTERNAL_SECURITY_REVIEW` and requires design language. `home.ar` kept the hedge, proving it was a slip. Also "opaque" identifiers had become "unreadable" (CLM-017 carries PUBLIC-1-C4 against exactly that).

Two smaller content defects: `/privacy/` directed parents to a *"Security Concern option on Contact"* that does not exist (Contact ships no form; its real label is "Report security concern", and the two locales disagreed), and the trust page's **hero primary CTA pointed at a `noindex` provisional legal draft**. Both fixed.

### Gates added this pass, each proven to bite

`assertSvgAssetsAreWellFormed`, `assertReviewListsAreLive`, `assertAllowlistIsLive`, `findDuplicateContent`, `homeWordCount`, `assertVideoAssets`, plus browser-side broken-image detection. **Each was verified by deliberately reintroducing the defect and confirming the build fails** — not by assuming.

`assertReviewListsAreLive` deserves a note: the consolidation deleted nine pages and immediately stranded two keys in the Arabic-review list. A review list naming deleted keys is worse than none — it reports work that cannot be done and hides work that can. That is the parent-web `_arReviewPending` failure mode (127 keys, read by nothing, miscounted in the ledger) reproducing itself here within one session. It now fails the build.

---

## 7. Serialization items — done

PPR-2 is closed and both paths were verified clean, in sync with `origin/pca-dev`, and absent from `stash@{0}` **immediately before editing**.

| File | Change |
|---|---|
| `tooling/repo-checks/Invoke-RepositoryChecks.ps1:38` | one array entry: `'public-web'` added to `$AllowedTopLevel` |
| `.github/workflows/quality-gates.yml` | one job appended: `public-web-build` |

Both verified working: `Invoke-RepositoryChecks.ps1` passes (**2241 tracked files**), and the CI job's exact command (`npm run build`) runs green. The job needs **no `npm ci`, no lockfile cache and no dependency-audit or SBOM entry** — the zero-dependency architecture pays for itself here.

**Uncommitted.** These two files are now modified in the working tree. No commit was made; committing is an owner decision that has not been given.

---

## 8. State

```
branch          pca-dev
HEAD            74e5ad5   (= origin/pca-dev, unchanged by this programme)
stash@{0}       intact, 48 files, DO NOT DROP — never touched
modified        .github/workflows/quality-gates.yml
                tooling/repo-checks/Invoke-RepositoryChecks.ps1
untracked       public-web/ , docs/public/
staged          none
committed       none
Azure           UNCHANGED — no DNS, certificate, binding, container, app setting
                or plan modified. Not deployed.
```

### Phase state

| Phase | State |
|---|---|
| PUBLIC-0 · PUBLIC-1 | **COMPLETE** — owner accepted |
| PUBLIC-2 IA/routing | **COMPLETE (rev 2)** — 3 main pages |
| PUBLIC-3 EN content | **COMPLETE** — DEF-1 resolved |
| PUBLIC-4 AR/RTL content | **COMPLETE_PENDING_NATIVE_REVIEW** — 23 keys, OD-12 |
| PUBLIC-5 Design system | **COMPLETE** — + video component |
| PUBLIC-6/7/8 Page families | **COMPLETE** — folded into the three main pages |
| PUBLIC-9 Auth shell | **BLOCKED_EXTERNAL** — no email provider |
| PUBLIC-10 Feedback | NOT_STARTED |
| PUBLIC-11 PWA | NOT_STARTED — Release C |
| PUBLIC-12 A11y/SEO/perf | **PARTIAL** — SEO complete; performance well inside budget; real axe run outstanding before CLM-054 can move |
| PUBLIC-13 Browser UAT | **PARTIAL** — 38/38 automated; keyboard-only traversal and screen-reader spot checks outstanding |
| PUBLIC-14 Adversarial review | NOT_STARTED |
| PUBLIC-15 Release readiness | NOT_STARTED |

```
PUBLIC_RELEASE_A = NOT_READY
  remaining: OD-12 native Arabic sign-off (23 keys)
             OD-13 legal entity / jurisdiction  (PPR1R-D035 open)
             production security headers (predeploy blocker, owner-accepted)
             CLM-054 real accessibility evidence
             PUBLIC-12/13/14 completion
             video recordings (not blocking — placeholder state is shippable)
PUBLIC_RELEASE_B = BLOCKED     (no transactional email provider)
PUBLIC_RELEASE_C = NOT_READY
PUBLIC_RELEASE_D = NOT_READY
```

Nothing self-approved. Terminates at `READY_FOR_PRIMARY_CHATGPT_REVIEW`.
