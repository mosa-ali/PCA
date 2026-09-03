# PCA PPR-2 — OWNER DECISIONS

Entry baseline `cc5ae10d0ebed7e788af9ae00b4a0aa497d07b05`. Protected `main` unchanged.
This document records decisions the owner has **actually made**. Anything still open is marked
`OWNER_DECISION_PENDING` and must not be treated as approved.

---

## PART A — RATIFIED PROCESS DECISIONS

### A1 · `PBXPROJ_DECISION = DEFER`

Do not modify or publish `ios/PCA.xcodeproj/project.pbxproj` in PPR-2 unless the change is required
for a V1 deliverable **and** can be verified by xcodebuild/project validation. **iOS remains
POST_V1.**

**Deferred action, recorded exactly** (so the iOS phase need not re-derive it): the
`PCADeviceActivityMonitor` extension target's compile-sources phase (`project.pbxproj:208`, phase
`B1000000000000000000005C`) contains **one** file, which references **ten symbols compiled only into
the host-app module** — `CallbackObservationLog` (`:23`), `AppGroupCallbackObservationLog` /
`InMemoryCallbackObservationLog` (`:36`), `ShieldPolicyValidator` (`:81`), `ScheduleEngine.evaluate`
(`:92`), `DecodedSchedulePolicy` (`:117`), `ScheduleEvaluationInput` (`:121`), `OpaqueBlobStore`
(`:142`), `AppGroupBlobStore` (`:146-147`), `PolicySyncDecoder` (`:156`). An app extension is a
separate Swift module, so this is a hard `cannot find X in scope`; and because the host app has an
explicit dependency plus an embed phase on that extension, **the host app cannot build either**.

Two candidate fixes for the iOS phase: add ~6 `PBXBuildFile` entries reusing the existing file
references, or extract the six sources into a shared framework/static-library target. The other two
extensions are self-contained and unaffected.

**Consequence to state honestly meanwhile:** a CI job *existing* is not a job *passing*. Never write
that iOS builds, compiles, or passes CI.

**Not deferred, and independent of this:** filing the Apple **Family Controls entitlement
application** — the longest-lead item in the programme, required under every option including
POST_V1.

### A2 · `CI_FULL_TEST_POLICY_DECISION = APPROVED`

Backend full unit suite gates CI. Parent Web and Platform Admin unit suites gate CI **via stable
bounded shards, never one monolithic memory-sensitive batch.** Lint/typecheck as deterministic gates.
DB tests in a dedicated disposable-MySQL job. Android JVM its own job.
**Never modify production source solely to satisfy a non-reproducible batch failure.**

### A3 · `BROWSER_UAT_AUTH_DECISION = USE_LOCAL_DETERMINISTIC_QA_IDENTITIES`

Disposable Docker MySQL → all migrations from zero → real seeded QA data → backend → Parent Web and
Platform Admin in real-backend mode → Claude Chrome extension. Local/test credentials only, never
production, never committed as reusable secrets. **MFA is not weakened or bypassed** — a deterministic
LOCAL TOTP secret is seeded through the supported mechanism and the current code generated normally.
**REAL SEEDED DATABASE DATA, never `DEVELOPMENT_ONLY` synthetic fixtures.**

### A4 · `WEB_TEST_BATCH_FAILURE_RULE`

Before changing source in response to a batch failure: rerun the identical batch; run the failing file
alone; run the nearest affected subset; compare counts and stack traces; check whether the changed
source is actually exercised. If untouched files fail, or the count moves between identical runs, or
individual files pass → **`TEST_INFRASTRUCTURE_INSTABILITY`**. Do not touch product code.

*Measured cause, established in PPR-2:* the dominant lever is **concurrency**, not batch size or free
RAM. Vitest's forks pool defaults to `cpus/2` (8 jsdom forks on a 16-CPU host). Pinning
`--maxWorkers=2` made the same unsharded 31-file run pass 3/3 identical reruns at 668–958 MB free —
inside the band that failed unpinned.

---

## PART B — `PARENT_WEB_OWNER_UX_REVIEW_PART_1`

Owner reviewed the running Parent Web directly and issued authoritative UX/product decisions.
**These are owner-approved changes, in scope for PPR-2.** Constraint: no giant uncontrolled redesign —
one UX/design owner produces the spec, scoped writers implement, max 4 concurrent source writers.

**Must be preserved throughout:** authorization · privacy invariants · **status honesty** · existing
working flows · test contracts. **No controlled capability may be removed for cosmetic
simplification.**

### Status ledger — no item may silently disappear

| # | Owner item | Status | Note |
|---|---|---|---|
| **UX-1** | Dark/black theme not accepted; move to a coherent lighter production design system (background, cards, sidebar, header, type, buttons, charts, status, alerts, forms). Do **not** simply invert. Dark mode may return later as an optional setting. | `IN_PROGRESS` | Design spec commissioned; implementation assigned to W-THEME. |
| **UX-2** | Current dashboard not accepted. Replace with a dynamic BI-style family dashboard: KPI row (Children · Active Devices · Protected Devices · Needs Attention · Pending Requests · Important Alerts), dynamic visuals, compact child cards. No trust/key-epoch language on the consumer surface. | `IN_PROGRESS` | Assigned to W-DASH. **Honesty rule binds:** never show protection ACTIVE when unverifiable; `pending delivery` / `limited` / `offline` / `cached` / `not verified` must each be visibly representable. |
| **UX-3** | Language selector must move to the global header (EN / العربية), available on every page; applies globally, preserves route, switches LTR/RTL, persists via the approved mechanism. | `IN_PROGRESS` | Assigned to W-HEADERNAV. **Correction from browser evidence:** the selector is *already in the header* — the real defect is that it renders at near-invisible contrast. Settings may still show current language. |
| **UX-4** | Device enrollment redesigned as a guided journey: select child → platform → available protection mode → create invitation → **visible setup code + link, Copy Code, Copy Link, expiry, status, short instructions** → download child app → install → paste/open → "Waiting for device…" → "Connected / paired". | `IN_PROGRESS` | Assigned to W-ENROLL. **iOS must not be offered** — POST_V1, and the backend now refuses `platform=IOS`. **Blocking sub-defect to resolve:** the child-profile dropdown reads "No child profiles available" with no path to create one, so a new family cannot start enrollment at all. |
| **UX-5** | Add a prominent **Download App** action to the main header, routing to an approved download surface. | `IN_PROGRESS` | Assigned to W-HEADERNAV. **Do not fabricate a production Play/App Store URL**, and do not expose an unavailable iOS download. Local/dev may route to a controlled instructions page. |
| **UX-6** | Break the device page into clear sections/tabs: Devices Overview · Add Device · Pending Setup/Invitations · Existing Devices · Protection & Removal · Advanced/Security. Administration PIN belongs in advanced, not the primary new-device flow. Device ID / policy revision / trust epoch / key epoch must not dominate parent UX. | `IN_PROGRESS` | Assigned to W-ENROLL. Confirmed in the browser: **six** workflows currently stacked on one page. |
| **UX-7** | Simplify first-level navigation into consumer groupings (HOME · FAMILY · PROTECTION · SAFETY & PRIVACY · ACCOUNT). Retention, Export, Delete Now, Audit, Roles & Permissions must be **regrouped, never removed**. | `IN_PROGRESS` | Assigned to W-HEADERNAV. A complete `current route → new group` mapping is required, with zero drops. |

### Owner-review context worth recording

The owner's review was performed against Parent Web on **`http://localhost:4000`**. That is the
default dev port, and `parent-web/.env` ships `VITE_PCA_DEMO_MODE=true`, so that instance was very
likely serving **synthetic fixtures**. This does **not** weaken the feedback — every item above
concerns visual system, hierarchy, information architecture, header and navigation, which are
identical in both modes. It is recorded only so that later evidence is not conflated: the PPR-2
validation stack runs on `:4212` with demo mode **off**, proven two independent ways
(see `PCA_PPR2_BROWSER_UAT_REPORT.md` §0).

### Validation required before any item may be marked `IMPLEMENTED`

Real seeded stack, not synthetic mode. Chrome-extension coverage across **desktop / laptop /
narrow-mobile** and **English / Arabic RTL**, checking console errors, failed network calls, broken
routes, overflow, alignment, contrast, button consistency, forms and keyboard usability. Parent Web
typecheck · lint · build · full unit suite under the `--maxWorkers=2` policy · affected E2E.
Backend tests re-run if any enrollment/download data contract changes.
**Tests must not be weakened to match new UI.**

---

## PART C — STILL OPEN

`OWNER_DECISION_PENDING` from the PPR-2 analysis lanes, unchanged by this review: D1 parental consent
(artifact/options), D2 account deletion (grace window, effect on other members, non-owner self-removal),
D3 privacy-policy URL authority, D4 Android background-launch shield (whether V1 requests
`SYSTEM_ALERT_WINDOW`), D7 production origin topology (four-part question, recommendation **Option A**),
D8 residuals, D9 requirement registration (12 proposed rows across 3 tiers), plus recovery/crypto
engagement scope and the AI/YouTube/iOS V1 scope packages.

**No PPR-2 final commit may be pushed until Part B is reconciled: implemented items tested, deferred
items carrying an exact reason, and Chrome UAT having reviewed the resulting Parent Web.**

---

## PART D — `PARENT_WEB_OWNER_UX_REVIEW_PART_1` — FINAL ACCEPTANCE LEDGER

Owner issued final acceptance direction (13 items). Status per item below.
Evidence: `PCA_PPR2_BROWSER_UAT_REPORT.md` §7 (live seeded-stack sweep) and the Playwright real-Chromium
suite. Legend: `IMPLEMENTED` · `PARTIAL` · `BLOCKED_EXTERNAL_TOOL` · `DEFERRED_WITH_REASON`.

| # | Owner item | Status | Evidence / reason |
|---|---|---|---|
| **1** | Light theme approved; do not reintroduce dark default | **IMPLEMENTED** | Light is the production default; dark exists only as a future `[data-theme="dark"]` layer, never `prefers-color-scheme`. Confirmed live on the seeded stack. Also corrected three shell surfaces outside the app that were still dark: browser `theme-color`, the PWA manifest `theme_color`/`background_color` (splash), and `offline.html`. |
| **2** | BI dashboard; unavailable is first-class; never unknown→zero; never stale-as-current | **IMPLEMENTED** | Six KPIs live, each unavailable one rendering **`—`, never `0`**, labelled *"We can't verify this right now"*. A freshness override mechanically downgrades any non-`LIVE` child to `unverified`, so a cached read cannot render green. **A real bug was caught and fixed here:** a fixture resolved successfully with a stale `12/60` while its own state said `UNAVAILABLE`; `usableScreenTime()` now rejects it and draws no bar. Weekly Trend ships as an honest unavailable card — **no placeholder curve** — because no historical data source exists. |
| **3** | Child cards compact; no technical identifiers on the primary dashboard | **IMPLEMENTED** | Cards carry name · device status · screen time · protection state · last sync + freshness · alerts · requests. The notice rendering `lastAppliedPolicyRevision` was **removed from the dashboard** and survives on the child detail pages. |
| **4** | Global EN/العربية; route stable; RTL correct; PCA locale for dates; no English months; no raw keys | **PARTIAL** | Header control live and confirmed. **Route stability confirmed live** (`?section=add` preserved across the switch). Date localisation **fixed at its real source** — the observed `ينتهي بتاريخ October 3, 2026` came from `toLocaleDateString(undefined, …)`, which selects the *host* locale; it now takes the active language explicitly, with a guard test banning new direct calls. RTL and Arabic rendering **PASS in Playwright real Chromium**; the extension did not apply the switch in-session — see item 11. |
| **5** | Download App global and visible; distinguish Android available / iOS unavailable; no fabricated store links | **PARTIAL** | The header action exists and correctly **refuses to fabricate a store URL**, but it is **absent when no URL is configured** — so on this stack it does not appear at all, which does not satisfy "must remain global and visible". **No surface yet distinguishes Android-available from iOS-coming-later.** Remediation: always render the action, routing to a controlled instructions page that states Android instructions and iOS unavailability; `VITE_PCA_ANDROID_APP_DOWNLOAD_URL` also needs documenting in `.env.example`. |
| **6** | Guided enrollment; honest ACTION REQUIRED on the trusted-browser gate; no unexplained disabled dropdown | **IMPLEMENTED** | `/family/devices` is now six tabs, one workflow at a time. **The dead end is gone:** Add device renders *"We can't read your family profiles on this browser yet"* with the honest explanation and a **"Set up this browser"** action — replacing the silent disabled *"No child profiles available"*. Administration PIN moved to Advanced & security. iOS is never offered. All six `PermissionGate` action strings survived the re-sectioning. |
| **7** | Child-profile persistence gap must not be hidden | **DEFERRED_WITH_REASON — OWNER/ARCHITECTURE ITEM** | **There is no backend child-profile create or list route at all**; `childProfileId` is only *accepted* at `invitationRoutes.ts:96`. No data model was invented. The UI shows an honest action-required state and **does not pretend child creation exists**. This needs an owner/architecture decision before enrollment can complete for a new family. |
| **8** | Simplified IA; `/wellbeing-messages` reachable; no controlled functionality removed | **IMPLEMENTED** | 5 groups / 19 entries, complete `current route → new group` mapping with **zero drops**; 19 nav paths, 19 unique, 0 missing from `App.tsx`, every row verified to reach a real page. **The `/wellbeing-messages` orphan is recovered.** Retention · Export · Delete Now · Audit · Roles & Permissions were **regrouped under Data & Privacy, never removed** — a test proves a Viewer still sees them named. |
| **9** | No raw account UUIDs as prominent identity text | **IMPLEMENTED** | Header trigger reads **"Your account"**; the identifier moved into the panel inside `<bdi class="iso">`. Confirmed live. *Note: the same defect exists independently on the Platform Admin console (UAT-03), where a field labelled "Email" renders a UUID — not in this lane's scope.* |
| **10** | No horizontal overflow at desktop / laptop / 375 / 320, in LTR and RTL; header fix covered by tests | **IMPLEMENTED** | Playwright real Chromium: **0 overflow at 320/390/480/768/900/1366 in both directions.** The header fix is covered — a CSS specificity bug (`.desktop-only` losing to `.app-header label`) caused 13 of 15 initial e2e failures and is now pinned by `responsive.spec.ts` and `rtl.spec.ts`. |
| **11** | Do not claim `CHROME_PARENT_UAT = PASS` until the extension reaches the seeded stack | **HONOURED** | `CHROME_PARENT_UAT = PARTIAL` — the extension **did** reach the real seeded stack and confirmed six substantive items (report §7 L1–L6), but the Arabic switch and the responsive sweep were not completed because the extension became unstable (screenshot timeouts, `document_idle` never firing, a reload at click time). **`PLAYWRIGHT_REAL_BROWSER = PASS` is preserved and the implementation is not downgraded.** No extension pass is claimed for what was not observed. |
| **12** | Live sweep when Chrome returns | **PARTIAL** | Access returned and the sweep ran — see report §7. Dashboard hierarchy, enrollment flow, navigation, account header, empty/error states and console/network **were** covered. Arabic switching, the responsive widths and Download App **were not** — carried into the next sweep. |
| **13** | Record as `PARENT_WEB_OWNER_UX_REVIEW_PART_1` with per-item status | **IMPLEMENTED** | This ledger. |

### Carried forward — nothing silently dropped

1. **Item 5 remediation** — always-visible Download App + an Android/iOS instructions surface.
2. **Item 7** — the child-profile persistence gap: an owner/architecture decision, not UX work.
3. **Arabic switch + responsive + Download App** re-verification through the extension.
4. **`_arReviewPending`** — 115 i18n keys carry machine-suggested Arabic awaiting **native reviewer sign-off**; not treated as approved copy.
5. **Pre-existing, outside this lane:** Requests, Members, ProtectionStatus and WellbeingAdmin still render `ErrorState` *before* their `<h1>`, so against the real backend they show "Something went wrong" with no heading — they have not adopted `ActionNeededState`. Real-mode sign-in also assigns role `VIEWER` (documented gap), leaving `/subscription` unreachable for a real signed-in owner.
6. **`table.data-table { min-width: 32rem }`** defeats `.responsive-cards` stacking below 640px (no page-level overflow).
7. **`useAsync` returns `error: string`, not the cause**, so pages route into the action-needed state by message matching rather than error code.

**PPR-2 is not complete until items 5, 7 and 12 are reconciled.** No final commit is pushed before then.

---

## PART E — OWNER DECISIONS, ROUND 2

### E1 · `CHILD_PROFILE_PERSISTENCE = REQUIRED_FOR_V1` *(supersedes Part D item 7's deferral)*

**Owner ruling:** child profile create/list is **required for V1, not deferred.** A new family cannot
complete the core Parent → Child → Device enrollment journey without a real child profile. The UI was
right to refuse to pretend the capability exists; the product needs it to exist.

**Governing constraint:** implement the *smallest coherent authoritative* capability using the
**existing** PCA family/child/member architecture. **Do not invent a second child identity model.**
**Do not infer profile fields from UX convenience** — a field with no controlled requirement behind it
is not permitted.

**Discovery precedes implementation.** The authoritative model is being traced across requirements,
contracts, all 35 migrations, backend services, family membership, `ChildProfileMembershipResolver`,
Parent Web, device enrollment, child requests, retention/export/delete-now, family RBAC and audit —
specifically to answer whether create/update/delete semantics already exist in source and merely lack
HTTP routes, and which fields are controlled.

**The tension that must be resolved explicitly, not glossed:**
`docs/architecture/39_CHILD_PROFILE_SCOPE_AUTHORITY.md:26` states the module *"does not ship a
**readable central child-profile directory** merely to make the pre-check convenient."* A create/list
capability must not become the thing that document prohibits. The spec must reconcile this with quotes,
or escalate it.

**Scope:** LIST · CREATE · GET are in. **UPDATE only if the controlled model already has editable
fields.** **DELETE is NOT to be added** unless retention / account-deletion / family-history rules
prove it safe — if unsafe, return the correct controlled status rather than inventing destructive
behaviour.

**Authorization — before data access, with these negative cases mandatory:** unauthenticated → denied ·
parent from another family → denied **without enumeration** · role lacking child-management authority →
denied · unknown family → **non-distinguishing** · unknown child → non-distinguishing where appropriate ·
cross-family child id → denied. **A Platform Admin session must never authorize a Parent-family
mutation, and Platform Admin RBAC must not be reused.**

**Privacy:** controlled fields only · no central plaintext wellbeing/history/location · creation
implicitly opts into **no** telemetry, AI, marketing or commercial tracking · audit through the existing
family-audit model · retention/export/delete-now parity checked.

**Acceptance evidence required (real seeded stack, fresh disposable MySQL, migrations from zero, a
family with NO children):** register/login → empty family → *Add your first child* → child appears →
Add Device → child selectable → invitation generated. No page reload if normal state refresh suffices.

### E2 · `DOWNLOAD_APP_UI = IMPLEMENT_NOW` *(resolves Part D item 5)*

The header action is **always visible** — never hidden because no production store URL exists. Click
opens an internal *Download PCA Child App* surface stating, honestly:
**Android** — *"Android app download is not configured yet for this environment."* (a genuine local/test
APK may be offered if one actually exists and is safe to expose). **iOS** — *"iOS app is planned for a
later release."*, with **no active installation action**.
**No fabricated Play Store or App Store URL.**
`ANDROID_PRODUCTION_DISTRIBUTION = EXTERNAL/RELEASE_PHASE` · `IOS_DOWNLOAD = POST_V1`.

### E3 · `ARABIC_NATIVE_REVIEW_REQUIRED = YES`

Machine-suggested Arabic stays marked **NOT APPROVED FOR RELEASE** and is tracked in `_arReviewPending`.
Source implementation is **not blocked** on native-copy review. The UI must still pass key parity, RTL,
no raw keys, date-locale correctness, and layout/overflow. Production sign-off is external native review.

### E4 · Chrome extension instability is a TOOL failure, not a product defect

Recorded separately from product state, and **not** reproduced through another browser path.
`PLAYWRIGHT_REAL_BROWSER = PASS` · `CHROME_PARENT_UAT = PARTIAL` until a stable seeded-stack pass
completes. **Product source must never be modified to chase browser-tool instability.**

### E5 · PPR-2 EXIT CRITERIA (owner-set)

```
CHILD_PROFILE_CREATE            = PASS
CHILD_PROFILE_LIST              = PASS
NEW_FAMILY_TO_DEVICE_ENROLLMENT = PASS
DOWNLOAD_APP_GLOBAL_ACTION      = PASS
OPEN_SECURITY_FINDINGS          = 0
VALID_MUTATION_SURVIVORS        = 0
REPO_SOLVABLE_OPEN              = 0
all affected tests green
```
Then complete the PPR-2 final report. **Do not merge main. Do not start PPR-3 automatically.**

**Reconciliation note carried into exit:** `VALID_MUTATION_SURVIVORS = 0` reproduces at HEAD, but PPR-2
established that the harness **executes zero tests** — it makes string assertions over source, each
mutant paired with an assertion for its own anchor text, and `EQUIVALENT` is manifest-asserted rather
than derived. The number will be reported **with that caveat attached**, never as standalone assurance.
Likewise `OPEN_SECURITY_FINDINGS` must be re-derived, not inherited: of the 13 found in Phase 0, seven
are fixed and verified; the remainder are owner-decision, production-infra or external-review gated and
must be classified as such rather than silently counted to zero.

---

## PART F — `CHILD_PROFILE_PRIVACY / CENTRAL_REGISTRY` (owner decision, supersedes E1's open question)

Discovery established the contradiction: `FamilyMember` (doc 10 §3.2) is already the authoritative
readable child entity and its `displayName` is *"sensitive — local plaintext only; **never included in
any central-service-visible field**"*, while the owner's UX direction forbids exposing child UUIDs as
primary UI. No implementation satisfied both. **The owner resolved it without weakening the privacy
model.**

```
CHILD_PROFILE_V1               = REQUIRED
CHILD_PROFILE_CENTRAL_REGISTRY = APPROVED   (opaque only)
CHILD_PROFILE_ID               = SERVER_MINTED
CHILD_PROFILE_CENTRAL_NAME     = PROHIBITED
CHILD_DISPLAY_NAME             = FAMILY-SIDE / BROWSER-LOCAL PRIVATE DATA
CHILD_PROFILE_CREATE / LIST    = IMPLEMENT_NOW
CHILD_PROFILE_UPDATE           = NOT_APPLICABLE_V1
CHILD_PROFILE_DELETE           = DEFER_PENDING_LIFECYCLE/RETENTION
CONTROLLED_DOC_CHANGE          = APPROVED, NARROW OPAQUE REGISTRY ONLY
```

**The architecture, stated as the owner did:**

```
CENTRAL SERVICE          familyId ── childProfileId
                                        │  opaque reference only
TRUSTED PARENT CONTEXT   childProfileId ── "Ahmed" / "Sara" / "Mohammed"
```

The parent sees **Ahmed**; the server sees only the opaque identifier.

**Permitted centrally:** `childProfileId`, `familyId`, and only technically necessary
lifecycle/integrity metadata (`createdAt`, `updatedAt`, `status`) where proven required.
**Forbidden centrally:** displayName · nickname · dateOfBirth · age · gender · school · avatar/photo ·
wellbeing · location · usage/activity · any readable child-profile content. **No encrypted child-name
column "for convenience"** either.

**Why this design is worth the effort, in the owner's words:** a full compromise of the central
database must not yield *"Family 123: Ahmed 11, Sara 14, Mohammed 8"* — only opaque relationships.

**The registry must not become a disguised child profile over time.** It answers exactly one question:
*which opaque child ids belong to this family?* Naming in code and docs must make that unmistakable —
an `opaque child membership / existence authority`, never a readable `ChildProfile` record.
`FamilyMember` remains the authoritative readable entity.

**Server-minted ids are load-bearing, not stylistic:** a caller-supplied id under a global primary key
turns a duplicate-entry error into a **cross-family existence oracle**.

**The device-before-child inversion is fixed:** invitation creation must reference an **existing**
authorized `childProfileId` rather than implicitly minting the child identity as a side effect.

**Cross-browser:** readable child content flows only through the approved encrypted family-side path,
**never** a central readable label. Where this browser holds no label, show honest copy
(*"Child profile — finish browser setup to view details"*), **never the raw UUID as the primary label**.
Where a browser cannot yet persist trusted child data, **do not silently fall back to central storage** —
show the setup/trust requirement.

**Controlled-document change approved, bounded to this sentence:**
> *"The central service may maintain an opaque child-profile membership registry consisting of a
> server-minted childProfileId bound to familyId. No readable child-profile content is permitted in the
> central service."*

Documents: doc 10 §7 and §7A · doc 00 §9 conflict register · doc 39 (whose prohibition on a readable
central child-profile directory **survives**) · doc 18 §2 for the new Parent child-management operation.
The wording must prevent a later developer using this approval as precedent for names, DOBs or photos.

**A hard regression test is required** scanning the central schema/DTO/API for readable child fields
(`displayName`, `childName`, `nickname`, `firstName`, `lastName`, `dateOfBirth`, `dob`), so a future
deliberate addition fails loudly and forces controlled review.

**Acceptance:** CREATE and LIST pass · no central readable child fields · server-minted id ·
cross-family enumeration denied · Parent RBAC pass · Platform Admin cross-realm denied · invitation
references an existing child · new-family flow (create child → readable local label → select child →
Android invitation) passes · fresh-DB migration passes · backend, Parent Web and real E2E green ·
Chrome seeded-stack flow reported honestly as PASS or PARTIAL.
