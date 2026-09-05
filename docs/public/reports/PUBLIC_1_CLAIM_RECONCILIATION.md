# PUBLIC_1_CLAIM_RECONCILIATION

**Programme:** PCA Public Website + Product Identity + Parent PWA
**Phase:** PUBLIC-1 — Brand & Message Architecture (claim/evidence reconciliation half)
**Input:** `PCA_PUBLIC_CLAIM_REGISTER.csv` v0.2 (53 claims) × `PUBLIC_0_DISCOVERY_REPORT.md`
**Mode:** Documentation only. No source file touched. The register CSV itself is **not** edited — this document is the proposed delta for owner review.
**Generated:** 2026-09-04

---

## 1. Summary

PUBLIC-0 produced runtime evidence bearing on **19 of the 53** registered claims. No claim is promoted to a stronger status by this reconciliation. Three are **confirmed** at their existing `VERIFIED_AVAILABLE` status with evidence now attached; two need **qualifying conditions** added; four gain **hard blocks**; two **new claims** are required by pages in the approved content that no existing claim covers.

```
CLAIMS_REVIEWED              = 53
CLAIMS_WITH_NEW_EVIDENCE     = 19
STATUS_PROMOTIONS            = 0
STATUS_DOWNGRADES_PROPOSED   = 1   (CLM-043)
CONDITIONS_ADDED             = 5
NEW_CLAIMS_PROPOSED          = 2   (CLM-054, CLM-055)
RELEASE_A_PUBLISHABLE_NOW    = 6 of 53
```

---

## 2. Confirmed by PUBLIC-0 evidence (status unchanged, evidence now attached)

### CLM-046 — Parent and Platform Admin use separate security/session/RBAC realms
`SECURITY` · `VERIFIED_AVAILABLE` · **RISK=CRITICAL** · **CONFIRMED**

The register required "Route/auth/RBAC architecture and tests". PUBLIC-0 supplies all three:

- **Separate transports** — Parent accepts cookie *or* Bearer; Platform Admin is Bearer-**only** and has no cookie code path (`fastifyPlatformAdminAuthPlugin.ts:41-50` never imports `parseCookies`; `platformAdminAuthRoutes.ts` has zero `Set-Cookie`).
- **Separate token audiences** — `pa_`+43 chars vs bare 43 chars; each plane's plausibility check runs *before* any DB lookup, so a token from one plane can never reach the other's query.
- **Separate storage** — 7 dedicated tables, migration `0005`. **Separate RBAC** — closed 5-role matrix, disjoint from family authz.
- **Test** — `backend/test/platformadmin/crossRealm.test.mjs`, both directions 401.
- `/parent/admin`, `isAdmin`, `isPlatformAdmin`, `adminOverride`, `superuser`, impersonation: **all NOT_FOUND**; every repo-wide match is a negative-assertion test or a prohibition doc.

**Condition added — `PUBLIC-1-C1`:** both realms run on **one Fastify instance and port**, and the CORS hook is global with no `/platform-admin/*` exclusion. The boundary rests on token-audience separation, not transport or process isolation, and **no current test would catch** a future change adding cookie support to the admin plane or widening the CORS allowlist. Public `/security` copy may state the realms are separate; it must **not** state they are separately hosted or network-isolated.

### CLM-022 — PWA installation is not Trusted Browser authorization
`SECURITY` · `VERIFIED_AVAILABLE` · **RISK=HIGH** · **CONFIRMED**

Trusted Browser is a substantial, structurally independent subsystem: six-state machine, real non-extractable ECDSA P-256 key held **in memory only** (`trustedEndpointKeyStore.ts` — never written to any Web Storage, so a page reload resets to `BROWSER_NOT_TRUSTED`), backend device-registration routes, migration `0026`. **No shared module or state with any PWA code.** The separation is structural, not conventional. Install/standalone mode can never imply trust.

**Remediation required — `PUBLIC-1-R1` (owner: PWA/PPR-2, not this programme):** the shipped manifest description already couples install with trust language — *"family data stays E2EE, decrypted only in a trusted parent browser context"* (`parent-web/vite.config.ts:28-30`, verbatim in `dist/manifest.webmanifest`). Browsers surface this string in install UI, which brushes PWA Guideline §3's prohibited-claims list. The claim stays `VERIFIED_AVAILABLE`; the manifest copy must change before Release C.

### CLM-021 — Parents can continue using PCA Parent in the browser without installing the PWA
`FEATURE` · `VERIFIED_AVAILABLE` · **CONFIRMED (vacuously, today)**

True by construction: **zero install-prompt handling exists anywhere in the repo** — no `beforeinstallprompt`, no `appinstalled`, no install banner, no standalone detection. Browser use is currently the *only* path. The register's note "Must remain true after PWA implementation" becomes a PUBLIC-11 regression requirement.

### CLM-023 — Persistent Trusted Browser state across restart is not an approved capability
`FEATURE` · `COMING_LATER` · **CONFIRMED**

Evidence now exists for the register's "Current architecture is session/tab scoped per handover" note: `trustedEndpointKeyStore.ts` holds a non-extractable `CryptoKey` in memory only and is never persisted, so trust genuinely does not survive a reload. Status correct as written.

### CLM-025 / CLM-027 / CLM-048 — store availability and screenshot attachment
`NOT_APPROVED_FOR_PUBLIC_CLAIM` · **CONFIRMED**

No app-store or fastlane listing metadata exists under `android/` or `ios/`. No attachment/upload code exists in any feedback path (there is no feedback feature at all). No badge, link or control can be produced from this repository. Correct as written.

---

## 3. Conditions added

### CLM-018 — PCA Parent is a responsive web experience for phone, tablet and computer
`FEATURE` · `VERIFIED_AVAILABLE` · **CONDITION ADDED — `PUBLIC-1-C2`**

The claim about the *product's nature* holds: `parent-web` exists, uses logical-property CSS throughout, and has responsive tests. Two constraints on how it may be phrased:

1. **`app.pcasafe.com` currently serves the nginx default page.** No parent can use PCA Parent at any public URL today. Release A `/parents` copy must describe the experience **without implying it is reachable now**, and `Open PCA Parent` must not be an active CTA until Release C (IA §4 already requires this).
2. **Responsive evidence at the mandated widths does not exist.** The register asks for "Current Parent Web browser/UAT evidence"; PUBLIC-0 found **no Playwright/e2e job in CI at all**, and `Header.tsx:108-115` records a hand-measured 320px fit at *"exactly zero slack"*. Re-proof at 320/375/390/tablet/desktop/wide belongs to PUBLIC-13.

### CLM-045 — PCA Parent accounts are protected by MFA
`SECURITY` · `NOT_APPROVED_FOR_PUBLIC_CLAIM` · **CONFIRMED + CONDITION `PUBLIC-1-C3`**

Correct as written: the Parent plane is email + password only, with no second factor anywhere. **Important distinction to protect:** Platform Admin *does* have TOTP (`POST /platform-admin/auth/login` takes a 6-digit code). Public security copy must never let the operator console's TOTP imply parent-account MFA. Add to the forbidden-claim scan.

### CLM-017 — Central services retain only minimum operational and technical information
`PRIVACY` · `EXTERNAL_SECURITY_REVIEW` · **CONDITION `PUBLIC-1-C4`**

Full evaluation is PUBLIC-14 work, but PUBLIC-0 surfaced one fact that bounds the wording now: **`hashParentEmail` is an unkeyed, unsalted SHA-256** over the lowercased address (`backend/src/parentaccount/emailHash.ts:13-16`), with no pepper and no per-row salt — yet its own doc comment presents it as the privacy mechanism for `parent_accounts`. Against a mailing list, `parent_accounts.email_hash` is offline-enumerable from any dump or read replica. It is a lookup key, not a privacy control.

**Public copy must not describe parent identity as hashed-and-therefore-unrecoverable.** The approved wording in `PCA_PUBLIC_PRIVACY_MESSAGING.md` §19 — *"We keep the account information needed to let you sign in and operate PCA"* — is already correct and should be used unchanged.

### CLM-050 / CLM-051 — EN/AR from first release; Arabic pages support RTL
`AVAILABILITY` / `FEATURE` · `COMING_LATER` · **CONFIRMED + CONDITION `PUBLIC-1-C5`**

Both correctly remain `COMING_LATER`. Two gates are now evidenced:

- **Arabic is not release-approved.** 127 `parent-web` keys sit in an `_arReviewPending` array; `backend/src/i18n/messages/ar.ts:5-6` and `android/.../values-ar/strings.xml` carry the same warning; `PCA_PPR2_OWNER_DECISIONS.md:216` states this Arabic is **"NOT APPROVED FOR RELEASE"**. Nothing in code, tests or CI reads that list, so the flag cannot block a build. The ledger is also stale (says 115; the array holds 127). This programme's own `PCA_PUBLIC_CONTENT_AR.md` adds 19 further `NATIVE_REVIEW_REQUIRED` markers. **OD-12 gate stands.**
- **The RTL evidence mechanism itself is missing.** CLM-051 requires "RTL browser/UAT across required viewports". `quality-gates.yml` has **no Playwright job**, so every RTL spec — including the geometric sidebar assertion — never runs. PUBLIC-12/13 must create the evidence path, not just consume it.

---

## 4. Downgrade proposed

### CLM-043 — PCA provides account and information deletion controls
`FEATURE` · `REQUIRES_PLATFORM_SUPPORT` → **propose `NOT_APPROVED_FOR_PUBLIC_CLAIM` for Release A**

`PPR1R-D036` — *"No account-deletion path exists"* — is an **OPEN V1 blocker** in `docs/pre-production/PCA_PPR1R_DEFECT_REGISTER.csv`. `parent-web` has a `/privacy/delete` (`DeleteNow.tsx`) surface, but the register's required evidence is "UI/API/database/backups/queue deletion tests", and the backend account-deletion path does not exist. A UI route is explicitly not proof under Product Guideline §16.

Until D036 closes, no Release A page may state that PCA provides account deletion controls. `PCA_PUBLIC_PRIVACY_MESSAGING.md` §24's pre-proof wording covers this correctly.

---

## 5. Hard blocks

### BLOCK-1 — `/access` copy is blocked on PPR-2 Part M
**Affects CLM-040 (publishable), CLM-041, CLM-042.**

PPR-2's uncommitted change flips `CREATE_INVITATION` from `requiresLicense: true` to `false`, citing *"OWNER DECISION … Part M"*: basic/free V1 child-device enrollment must not require a paid license row. **That is a free-tier commercial commitment**, and therefore a direct input to:

- **CLM-041** *"PCA offers a permanent free plan."* — `NOT_APPROVED_FOR_PUBLIC_CLAIM` / HIGH, rationale *"No free-tier promise yet."*
- **CLM-042** *"PCA pricing is finalized and publicly available."* — `NOT_APPROVED_FOR_PUBLIC_CLAIM` / `COMMERCIAL_MODEL_PENDING`

**Part M does not yet exist** — `PCA_PPR2_OWNER_DECISIONS.md` ends at Part L. Three already-pushed PPR-2 evidence documents assert the opposite of the flip and go stale when it lands, and `parent-web/src/i18n/locales/en.json:230` ships a string asserting the license gate Part M removes — a string that is *also* inside `stash@{0}`.

**Action:** `/access` may use only CLM-040's values wording (*"designed with affordability and broad access in mind"*). **No statement about what is free, included, or priced** may be written until Part M is committed and CLM-041/042 are re-adjudicated. PUBLIC-7 must treat `/access` as content-frozen at the values level.

### BLOCK-2 — auth CTAs blocked on the email provider
**Affects Release A `Get Started` / `Create Account` / `Login`, and all of Release B.**

There is no transactional email sender. `RejectingEmailSender` throws in production and `ParentAccountService` **swallows the throw**, so registration returns `202` and the verification code never leaves the process. A user who follows a public signup CTA today dead-ends at `/verify-email` with no error and no way to obtain a code. Password reset fails identically.

**Action:** IA §4 already requires this — Release A must hide `Login` / `Get Started` or route them to an informational start page. PUBLIC-2 must specify **which**, and must note that `parent-web`'s router contains **no feature flag or env gate** to turn the existing auth routes off; they are live at `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` today.

### BLOCK-3 — `/privacy-policy` and `/terms` blocked on OD-13 and PPR1R-D035
`PPR1R-D035` (*"No privacy policy document, page or URL exists anywhere"*, COMPLIANCE_REQUIRED, OPEN, owner PRODUCT_OWNER) and `PPR1R-D034` (no parental-consent artifact) are open V1 blockers. `PCA_PPR1_OWNER_DECISIONS.md:339` (D13) records that the policy *"cannot be written without"* the data-controller ruling. OD-13 (legal entity/jurisdiction) is `OWNER_APPROVAL_PENDING`.

**Action:** PUBLIC-8 may build the route shells and integrate the provisional drafts from `PCA_PUBLIC_CONTENT_EN.md` §15/§16, clearly marked provisional and **not published**. Publication is owner/legal-gated, exactly as the IA states.

### BLOCK-4 — no accessibility conformance evidence exists
**Affects the `/accessibility` page and see CLM-054 below.**

The repo's only a11y gate is `vitest-axe` running under **jsdom**, where axe-core's `color-contrast` rule **cannot compute a result** — no layout, no colour compositing. Every WCAG ratio in `parent-web/src/styles/global.css` is a hand-written comment. No contrast check exists anywhere in the repo, and there is no `forced-colors` or `prefers-contrast` handling.

**No conformance statement may be published** until PUBLIC-12 produces real browser-based contrast, keyboard and screen-reader evidence.

---

## 6. New claims required

Two pages in the approved content make material public statements that **no existing register row covers**. Per Product Guideline §16 and the master prompt's rule that no agent may create a stronger claim than the register permits, these must be registered before the pages are written.

### CLM-054 (proposed)

| Field | Value |
|---|---|
| `PAGE` | Accessibility |
| `CLAIM_TEXT_EN` | PCA Public public pages conform to WCAG 2.1 Level AA. |
| `CLAIM_TYPE` | ACCESSIBILITY |
| `TECHNICAL_EVIDENCE_REQUIRED` | Real-browser automated scan (not jsdom); measured contrast ratios for every token pair in use; keyboard-only traversal of every public route; screen-reader spot checks; reduced-motion and 200% zoom evidence; EN and AR/RTL |
| `CURRENT_STATUS` | **NOT_APPROVED_FOR_PUBLIC_CLAIM** |
| `RISK` | HIGH |
| `NOTES` | The repo's only a11y gate is vitest-axe under jsdom, where color-contrast cannot be evaluated. All documented ratios are comments. Until PUBLIC-12 supplies real evidence, `/accessibility` must state a commitment and a contact path, never a conformance level. |

### CLM-055 (proposed)

| Field | Value |
|---|---|
| `PAGE` | Privacy/Cookies |
| `CLAIM_TEXT_EN` | The PCA Public website does not use advertising trackers or third-party analytics, and sets no cookies beyond those required to remember your language choice. |
| `CLAIM_TYPE` | PRIVACY |
| `TECHNICAL_EVIDENCE_REQUIRED` | Network inspection of every public route in a clean profile; storage inspection (cookies, localStorage, IndexedDB); build-output audit for third-party scripts; confirmation that no analytics dependency is declared |
| `CURRENT_STATUS` | **REQUIRES_PLATFORM_SUPPORT** (pending implementation) |
| `RISK` | MEDIUM |
| `NOTES` | Becomes provable only once Release A is built. Directly resolves IA §13's conditional `/cookies` route: if the built site sets no cookies beyond a language preference and loads no third-party script, `/cookies` is not published and this claim is stated on `/privacy` instead. PUBLIC-0 confirms no analytics/tag-manager integration exists anywhere in the repo today. |

**Recommendation:** Release A should make **zero backend calls and load zero third-party resources**. That keeps it clear of the single-origin CORS constraint, the missing reverse proxy and the same-site cookie-shadowing surface, and makes CLM-055 straightforwardly provable.

---

## 7. Release A publishable set

Of 53 claims, **6** may appear in Release A copy today. Everything else is either gated, forbidden, or belongs to a later release.

| ID | Claim | Basis |
|---|---|---|
| CLM-001 | Protecting children in digital spaces. | OD-01 approved doctrine |
| CLM-002 | PCA began from a parent's concern about protecting his children online. | OD-04 approved; no founder biography |
| CLM-040 | PCA is designed with affordability and broad access in mind. | OD-03 values claim — **values level only**, see BLOCK-1 |
| CLM-046 | Parent and Platform Admin use separate security/session/RBAC realms. | Confirmed §2 — subject to `PUBLIC-1-C1` |
| CLM-022 | PWA installation is not Trusted Browser authorization. | Confirmed §2 |
| CLM-021 | Parents can continue using PCA Parent in the browser without installing the PWA. | Confirmed §2 — phrase as product design, not live availability |

CLM-018 is publishable **only** under condition `PUBLIC-1-C2` (describe the experience, do not imply it is reachable today).

All 8 `COMING_LATER` claims may appear **only** with an explicit *Coming later* status label, per the Features page status-label system in `PCA_PUBLIC_CONTENT_EN.md` §4. All 11 `REQUIRES_PLATFORM_SUPPORT` claims may appear only with the *Requires platform support* label. All 16 `EXTERNAL_SECURITY_REVIEW` privacy/security claims must use the design-language wording in `PCA_PUBLIC_PRIVACY_MESSAGING.md`, never the post-proof strong wording.

---

## 8. Forbidden-claim regression scan — seed set

For the PUBLIC-3 mechanism required by `PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md` §7. Any match in public source, content, metadata or alt text is a build failure.

**Absolute claims (CLM-052):** `zero data`, `collects no data`, `100% private`, `100% secure`, `unhackable`, `military-grade`, `complete anonymity`, `never processes`

**Store availability (CLM-025, CLM-027):** `Google Play`, `App Store`, `Available on iPhone`, `Download for Android`, `Available now`, `play.google.com`, `apps.apple.com`, store badge image references

**Gated features (CLM-038, CLM-039, CLM-037):** `AI protection` / `AI-powered` without a *Coming later* label, `Mode B`, `YouTube Mode B`, camera/proximity described in the present tense

**Commercial (CLM-041, CLM-042, BLOCK-1):** `free plan`, `free forever`, `always free`, `per month`, `pricing`, `$`, `USD`, `SAR`, any numeric price, `Pricing` as a nav label (OD-03 requires **Access**)

**Trust coupling (CLM-022):** `install` co-occurring with `trusted` / `trust this device` / `secures this browser` / `remember your encryption key`

**Account security (CLM-045, `PUBLIC-1-C3`):** `MFA`, `two-factor`, `2FA`, `authenticator` on any Parent-facing page

**Deletion (CLM-044, CLM-043):** `immediately`/`irreversibly` near `delete`; `deletes all records`; any present-tense account-deletion capability statement

**Feedback (CLM-048):** `attach a screenshot`, `upload a file`, `attach files`

**Relay/E2EE (CLM-053, CLM-016):** post-proof strong wording — `cannot read`, `never sees`, `zero-knowledge` — used without the design-language qualifier

**Accessibility (CLM-054):** `WCAG`, `AA compliant`, `fully accessible`, `Section 508`

**Structural:** any `EN` string in a public surface without an `AR` counterpart; any metadata claim stronger than its page body (Programme §7).

---

## 9. Doctrine statements re-verified as technically possible

Product Guideline §21 lists owner-approved statements that PUBLIC-1 must confirm remain technically achievable. PUBLIC-0 found **no contradiction** with any of them. Two are now positively evidenced (CLM-046, CLM-022). One needs the wording discipline in `PUBLIC-1-C4`. The nine locked privacy invariants and CLM-053 remain `EXTERNAL_SECURITY_REVIEW` — PUBLIC-0 was discovery, not a crypto or data-flow audit; that is PUBLIC-14 work and nothing found so far weakens them.

One supporting (not proving) observation for CLM-016/CLM-053: the parent-web service worker sets `runtimeCaching: []` with an explicit comment citing `docs/architecture/09_SECURITY_PRIVACY_E2EE.md` that API responses carrying encrypted family data are never cached. That is consistent with the invariant. It is **not** proof of the relay claim.

---

## 10. Outstanding owner decisions carried forward

| ID | Decision | Status | Blocks |
|---|---|---|---|
| OD-11 | Feedback retention (90-day recommendation) | `OWNER_APPROVAL_PENDING` | PUBLIC-10 retention copy |
| OD-13 | Legal entity / jurisdiction | `OWNER_APPROVAL_PENDING` | BLOCK-3 — `/privacy-policy`, `/terms` publication |
| OD-06 | Parent/guardian eligibility wording | `APPROVED_PROVISIONALLY` | Final legal wording on `/signup` |
| Design Guideline §3 | Primary brand colour — *"calm medium blue"* vs shipped teal `#0f766a` | `OWNER_APPROVAL_PENDING` | PUBLIC-5 token set |
| PPR-2 Part M | Free-tier enrollment | **Uncommitted, not yet written** | BLOCK-1 — `/access` |
| PPR-2 D3 | Privacy-policy URL authority | Open | `/privacy-policy` route ownership |
| PPR-2 D7 | Production origin topology | Open | PUBLIC-2 origin contract; overlaps the Azure question raised in PUBLIC-0 §12 |

```
PUBLIC_1_CLAIM_RECONCILIATION = COMPLETE
REGISTER_CSV_MODIFIED = NO (delta proposed for owner review)
CLAIMS_PUBLISHABLE_IN_RELEASE_A = 6 (+1 conditional)
```
