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

---

## PART G · STEP 1 COMPLETE — OPAQUE CHILD REGISTRY BACKEND

Delivered solo, through direct tooling (subagent auth remained down throughout). Migration `0036`,
`backend/src/childprofiles/{ChildProfileRegistryRepository,MySqlChildProfileRegistryRepository,
ChildProfileService}.ts`, `backend/src/http/routes/childProfileRoutes.ts`, wired in `buildServer.ts`/
`main.ts`. `InvitationService.createInvitation` now checks an injected, optional membership resolver
before persisting — existing callers without one keep the pre-PPR-2 format-only behaviour unchanged.

**A real schema defect was found and fixed before it could reach a shared environment.** The
migration's first draft FK'd `family_child_memberships.family_id` to `families.family_id`. Applying
migrations from zero against a genuinely fresh disposable MySQL container (not the stale, 19-hour-old
QA container from an earlier session) failed outright: *"Referencing column 'family_id' and referenced
column 'family_id' in foreign key constraint … are incompatible."* `families.family_id` is
`CHAR(36) ascii_bin`; every other family-scoped table in this schema — `enrollment_invitations`,
`devices`, `device_challenges`, `relay_envelopes`, `recovery_envelopes`, `eye_protection_settings` —
uses `VARCHAR(128) utf8mb4_bin` and **none of them FKs to `families` either**. This repository's
established, consistent mechanism for a family-scoped column is an index, with family-scope
enforcement done at the application layer (`AuthzService.requiresFamilyScope`). The migration was
corrected to match that convention exactly; a corresponding test (`the schema layer does NOT reject an
unknown family_id`) now pins the real, verified behaviour instead of the behaviour I first assumed.

**No production data exists yet, so no backfill migration was performed** for the pre-PPR-2
`enrollment_invitations.child_profile_id` values (client-minted, some via a non-cryptographic fallback
format with no uniqueness guarantee). Documented in the migration's own header.

**A second deliberate, documented decision:** `CREATE_CHILD_PROFILE`/`LIST_CHILD_PROFILES` do **not**
require an active license, unlike `CREATE_INVITATION`. Independently verified: the `licenses` table
(migration `0001`) has **zero writers anywhere in this codebase**, in any environment, including
`seed-local.mjs` — `hasActiveLicense()` returns false for every account today, making
`CREATE_INVITATION` itself unreachable end to end in the real seeded stack. This is a **pre-existing
gap, orthogonal to this change**, not introduced or fixed here. Gating child-profile creation on the
same never-populated table would have made the owner-mandated new-family acceptance flow unreachable
for a reason that has nothing to do with child profiles.

**Verified by execution:** backend `tsc` clean · **2183/2183** non-DB tests (2145 baseline + 38 new,
zero regressions) · **9/9** DB integration tests against a genuinely fresh MySQL container, 36/36
migrations applied from zero · the mandatory readable-child-field regression guard **watched failing**
with an injected `displayName` field before being trusted, then watched passing again after the
revert · a real 8-way concurrent-create race against MySQL resolving to exactly one row, proving the
idempotency guarantee is the database's unique index, not application-layer logic.

`OPAQUE_CHILD_REGISTRY_CREATE = PASS` · `OPAQUE_CHILD_REGISTRY_LIST = PASS` ·
`CENTRAL_READABLE_CHILD_FIELDS = 0` · `INVITATION_REQUIRES_EXISTING_CHILD = PASS` (wired; not yet
exercised end-to-end through the real HTTP route in this step — that is Step 2/5).

---

## PART H · TRACKED — STEP 1 FOLLOW-UP ITEMS (owner-mandated, not yet resolved)

**H1 · `INVITATION_LICENSE_PATH = PRE_EXISTING_REPO_SOLVABLE_OR_OWNER_DECISION`.** `hasActiveLicense()`
returns false for every account in the real seeded stack (`licenses` has zero writers in source or
seed). `CREATE_INVITATION` is therefore unreachable end-to-end today — independent of and predating
this wave's child-registry work. Parent Web must not work around this and must not fake an active
license in production logic. **Before PPR-2 final closure**, an owner decision is required between:
(A) `CREATE_INVITATION` must not require an active paid license for the free tier, or (B) a real
license/entitlement bootstrap writer must exist for new/seeded accounts. `NEW_FAMILY_TO_DEVICE_ENROLLMENT
= PASS` cannot be claimed until this is resolved — invitation generation may remain blocked in Step 2/5
evidence, but only if reported as this explicit, separately-classified blocker, never silently.

**H2 · Step 2 session-local label rule (binding on the implementation about to start).** Parent Web may:
collect the readable label locally; call CREATE with no readable name; map the returned opaque
`childProfileId` to a current-session local label; show that label immediately. Parent Web must NOT:
send `displayName` to the backend; write plaintext `localStorage`/`sessionStorage`; persist trust
across reload; expose the raw UUID as primary UI. Expected reload behaviour remains
`SETUP_REQUIRED_EXPECTED`.

**H3 · Step 1 evidence retained verbatim, not summarized down:** 36/36 migrations from zero · 9/9 DB
integration · 2183/2183 backend non-DB · one real 8-way concurrent-create race resolving to exactly one
row · the readable-field regression guard watched failing (injected `displayName`) then watched passing.

**H4 · Step 2 must not be finalized on mock data.** Acceptance must exercise the real backend route
against the fresh seeded stack: no child → Add first child → local readable label → child appears →
Add Device → child selectable. Invitation generation may be reported blocked only under H1's explicit
classification — never presented as a full pass while `CREATE_INVITATION` is unreachable.

## PART I · STEP 2 COMPLETE (DEV-FIXTURE / COMPONENT-TEST LAYER) — REAL BACKEND ACCEPTANCE STILL PENDING STEP 5

**Scope of this claim, precisely:** implementation + component/unit-test verification of the Parent
Web child flow is done and clean. This is NOT a claim that H4's real-backend/fresh-seeded-stack
acceptance has run — that is Step 5's job and has not started. Nothing here should be read as
`NEW_FAMILY_TO_DEVICE_ENROLLMENT = PASS`.

**H2 compliance, verified, not asserted:** `tests/component/AddChildFlow.test.tsx` spies on the real
`createChildProfile` call arguments and asserts the request body has no `displayName` property and its
JSON serialization never contains the typed name; the resolved label is confirmed present in the
session-local store (`src/domain/childLabels.ts`) only AFTER the server-minted id returns, never
before/guessed. `childLabels.ts` is backed by a plain in-memory `Map`, never `localStorage`/
`sessionStorage` — see that file's own header for why this deliberately does not survive reload
(mirrors `trustedEndpointKeyStore.ts`'s own tab-lifetime design, per this Part's H2 ruling above).

**A real product bug was found and fixed while writing this flow's tests, not papered over in the
test:** `AddDeviceWizard.tsx`'s step-0 gate (`childProfilesLoading` / `childProfilesError` /
"no children yet") was unconditional — it fired on every render regardless of which wizard step the
parent was actually on. Because `advanceFromChildStep()` calls `reloadChildProfiles()` (a real network
round-trip) every time step 0 is left, a slow or merely-in-flight reload while the parent had already
moved on to platform/protection/review would flash the ENTIRE wizard back to a loading spinner or "Add
your first child" over content that had nothing to do with the child list anymore. Fix: the gate is now
scoped to `stepIndex === 0`, and the "no children yet" branch additionally excludes the moment right
after this family's first child was created (`justCreatedChild`, set synchronously from the CREATE
response) so a registry-list reload that hasn't caught up yet cannot contradict what the session already
knows to be true. Both changes are in `src/pages/family/devices/AddDeviceWizard.tsx`.

**A second issue was found and correctly classified as TEST-INFRASTRUCTURE-ONLY, not a product defect:**
`tests/utils/renderWithProviders.tsx` mounts `AuthProvider` directly, without `AppLayout`'s own
`if (loading) return null` gate (`src/components/shell/AppLayout.tsx:71`) that real routing always
applies before any `/family/devices` route can render (see `src/App.tsx`'s route tree — `Devices` is
nested under `<Route element={<AppLayout />}>`). Real routing therefore NEVER lets `DevicesTabs.tsx`
read `session?.familyId ?? ''` before that gate clears, so `familyId` is never `''` in production. In
this test harness it briefly is, which raced `AddChildFlow.test.tsx`'s interactions against a background
registry refetch. Fixed by awaiting the same two async calls (`getSession()`, then `listChildProfiles`)
the app itself is already mid-flight on, before the test ever queries the DOM — no production code
changed for this half of the fix, and no other existing test file needed it (they all start from an
already-populated child list, which never takes the empty-registry code path this race lived in).

**Regression sweep after both fixes, run twice each (individually, then in `--maxWorkers=2` batches per
[[A4 · WEB_TEST_BATCH_FAILURE_RULE]]):** discovered along the way, 3 PRE-EXISTING test files were
already broken by this wave's `getDashboard()` → `listChildProfiles()` data-source swap and had not yet
been caught (`DeviceEnrollmentConsentStepFocus.test.tsx`, `DeviceEnrollmentPlatformOptions.test.tsx`,
`tests/i18n/deviceEnrollmentRtl.test.tsx` — all fixed with the same `__seedDevChildProfile` dev-fixture
pattern already used elsewhere). Final state, verified clean on repeat runs:
- `AddChildFlow.test.tsx`: 5/5, confirmed stable across 5 consecutive full-file runs.
- Full device-enrollment surface (7 files): 61 tests, stable across 3 consecutive runs.
- Full parent-web suite: 137/137 test files, run individually where regression-relevant and in 8
  `--maxWorkers=2` shards of ≤15 files for the rest — all green, no untouched-file failures, no
  failure-count drift between identical reruns (the two discriminators [[A4]] names for a real defect
  vs. memory-pressure noise).
- `tsc --noEmit`: clean. `eslint . --max-warnings=0`: clean, whole project.

**H1 remains explicitly OPEN and unresolved by this Part.** No attempt was made to work around it;
`CREATE_INVITATION` is still unreachable end-to-end pending the owner's (A)/(B) decision above.

**Files touched, Parent Web (beyond what Part G/earlier Step 2 work already listed):**
`src/pages/family/devices/AddDeviceWizard.tsx` (step-0 gate scope fix), `tests/component/AddChildFlow.test.tsx`
(race fix + assertion fix), `tests/component/DeviceEnrollmentConsentStepFocus.test.tsx`,
`tests/component/DeviceEnrollmentPlatformOptions.test.tsx`, `tests/i18n/deviceEnrollmentRtl.test.tsx`
(dev-fixture seeding added to each).

## PART J · STEP 3 COMPLETE — COPY / TERMINOLOGY REMEDIATION

**Source audit:** `docs/pre-production/PCA_CHILD_FOCUSED_COPY_AUDIT.csv` +
`PCA_CHILD_FOCUSED_COPY_GAP_REPORT.md` (committed at `5e0b62d`, a prior read-only-mode mission — 134
rows across Parent Web, Android, iOS, Platform Admin, backend-generated text). Re-ran the report's own
handoff sequence against the **current** tree, per this Part's instruction, rather than waiting for a
clean worktree (Step 2's child-registry work was still in-flight uncommitted at the time, which is
exactly the "in-flight dashboard rewrite" the original audit already anticipated and scoped 4 of its
open rows around).

**`writer82a` (`2364b78`, the unmerged 81-row semantic pass) was not merged and did not need to be.**
Its merge-base with `pca-dev` is `abbb2f3` — several PPR-1/PPR-1R/PPR-2 commits stale. Instead, each of
the 8 rows the audit flagged as "already implemented" was independently re-verified against the live
`en.json`/`ar.json`/`strings.xml` (not the branch) — all 8 hold. The other 73 of the 81
`PPR2_ALREADY_OWNS` rows were always `(no change)` — legitimate account/authority/billing terminology,
never defects. No branch merge occurred; none was needed.

**All 30 open rows (28 `COPY_DEFECT_REMAINING` + 2 `NOT_COVERED_BY_PPR2`) fixed directly, highest
priority first per owner instruction:**

1. **Child-facing Safe Browser wording — the priority item.** `android/app/src/main/java/org/pca/app/feature/webprotection/policy/WebReasonCodes.kt`
   (5 EN + 5 AR strings) and `backend/src/i18n/messages/{en,ar}.ts` (`web.PARENT_ALLOWLIST`/`PARENT_DENYLIST`/
   `CATEGORY_RULE`/`SCHEDULE_RULE`/`CLASSIFIER`, `ai.CATEGORY_RULE_MATCHED`, `DOMAIN_BLOCKED_NOTICE` — 7
   EN+AR pairs) now say "your **parent's** [allow list / block list / rule]" instead of "your family's,"
   matching what `WebReasonId`/`MessageId` actually mean: a parent-set rule shown on the child's own
   block screen, not a family-wide one. Both locations changed together so client and backend stay in
   sync, as the original audit flagged they must.
2. **In-flight dashboard rewrite's new family-framed keys** (`dashboard.sections.family`,
   `dashboard.recentActivity`, `deviceEnrollment.familyDataUnavailableTitle`,
   `privacyHub.exportDesc`) and the matching backend `export.COMPLETED` — reworded to children-specific
   language in both `en.json`/`ar.json` and `backend/src/i18n/messages/{en,ar}.ts`.
3. **Two static HTML files that no locale-file audit would ever reach:** `parent-web/index.html`'s meta
   description and `parent-web/public/offline.html`'s cached-data reassurance.
4. **Android translation drift:** `persistence_strings.xml` (AR) `delete_now_description` now matches
   its own EN sibling's "children's" wording instead of "عائلية" (familial); two
   `wellbeing_control_strings.xml` entries (EN+AR) that said "family" now say "custom"/"your," matching
   the same file's neighboring strings.

**Verification:** every backend string here is exercised by a real assertion, not just present in the
catalogue. `test/i18n/translate.test.mjs` and `test/safebrowser/SafeBrowserNavigationPolicy.test.mjs`
(both EN and AR routes through the *real* decision path, not a stub) were updated and re-run, plus 3
fixture files that had embedded the old string as mock input data
(`WebFilteringDashboardCardProvider`/`BlockDecisionStateStore`/`ParentUnblockRequestService` test
files). Full backend regression: **2183/2183 non-DB tests pass** (unchanged from Step 1's number — no
regression). Parent Web: `tsc --noEmit` clean, `eslint . --max-warnings=0` clean, `tests/i18n/` (15
files/61 tests, including the strict EN/AR leaf-key-parity check) and every Dashboard-surface component
test (7 files/32 tests) pass. Android: no Kotlin test hardcoded the old strings (none needed updating);
all 3 edited XML resource files confirmed well-formed.

**One dead-code finding, correctly left out of scope:** `deviceEnrollment.familyDataUnavailableTitle`
is no longer referenced anywhere in Parent Web source — Step 2's `AddDeviceWizard.tsx` rewrite removed
the `getDashboard()`-sourced fail-closed path this key used to serve. Wording was still corrected
(harmless either way), but whether to delete the now-orphaned key is a separate cleanup call, not a
copy-correctness one — not acted on here.

**Full row-by-row detail** (old text, new text, exact file/line, per-row test evidence) is in
`PCA_CHILD_FOCUSED_COPY_AUDIT.csv`, `STATUS = FIXED_PPR2_STEP3` for all 30; narrative addendum in
`PCA_CHILD_FOCUSED_COPY_GAP_REPORT.md`.

`COPY_AUDIT_REMAINING_OPEN = 0`. `PCA_CHILD_FOCUSED_COPY_AUDIT = COMPLETE` for the 134 rows this audit
covers (Parent Web, Android, iOS, Platform Admin, backend-generated text) — not a claim of exhaustive
coverage of every family/child word in the whole codebase outside that scope.

**Files touched beyond Part I's list:** `backend/src/i18n/messages/{en,ar}.ts`,
`backend/test/i18n/translate.test.mjs`, `backend/test/export/pipeline.test.mjs`,
`backend/test/safebrowser/{SafeBrowserNavigationPolicy,BlockDecisionStateStore,ParentUnblockRequestService}.test.mjs`,
`backend/test/parentpanel/WebFilteringDashboardCardProvider.test.mjs`,
`android/app/src/main/java/org/pca/app/feature/webprotection/policy/WebReasonCodes.kt`,
`android/app/src/main/res/values{,-ar}/wellbeing_control_strings.xml`,
`android/app/src/main/res/values-ar/persistence_strings.xml`, `parent-web/index.html`,
`parent-web/public/offline.html`, `parent-web/src/i18n/locales/{en,ar}.json`,
`docs/pre-production/PCA_CHILD_FOCUSED_COPY_AUDIT.csv`, `docs/pre-production/PCA_CHILD_FOCUSED_COPY_GAP_REPORT.md`.

## PART K · STEP 4 COMPLETE — SECURITY + MUTATION RE-DERIVATION

**Full detail:** `docs/pre-production/PCA_PPR2_SECURITY_AND_MUTATION_REPORT.md`. Everything
in it was re-derived against the current tree this Step, not inherited from PPR-1R, earlier
PPR-2 runs, or writer reports, per the owner's explicit instruction.

**Headline result:** `STEP4_SECURITY_MUTATION = COMPLETE`. `OPEN_SECURITY_FINDINGS = 0`,
`VALID_MUTATION_SURVIVORS = 0` (5/5 mutants killed, 0 equivalent, 0 invalid),
`CENTRAL_READABLE_CHILD_FIELDS = 0`, `VIEW_DEVICE_ENROLLMENT_SCOPE = PASS`,
`INVITATION_REQUIRES_EXISTING_CHILD = PASS`, `PLAINTEXT_CHILD_LABEL_PERSISTENCE = 0`.

**A real, previously-unproven coverage gap was found and closed, not assumed covered:**
`backend/test/db/http.mysql.test.mjs` constructs `InvitationService` with one argument, so
its own passing invitation-creation tests never exercised the PPR-2 existing-child check at
all despite running against a real database. A new file,
`backend/test/db/childProfileInvitationBindingHttp.mysql.test.mjs`, wires `InvitationService`
exactly as `main.ts` does in production and proves the full nonexistent-child / foreign-family-child
/ real-child flow end to end against a real, freshly-migrated MySQL instance — mutation-killed
and restored, not merely written and trusted.

**A real, previously-unproven false-negative was found and fixed in the ONE new
render-based frontend test written this Step, not shipped as-is:** a first draft of a
`VIEW_DEVICE_ENROLLMENT` DOM-level test (added because the only existing coverage was a
string-position scan, exactly what the owner said not to rely on) seeded an existing child,
which meant `AddDeviceWizard`'s own inner `CREATE_DEVICE_INVITATION` gate masked the outer
gate's removal — the test kept passing even with `VIEW_DEVICE_ENROLLMENT` deleted from
`DevicesTabs.tsx`. Caught by actually removing the gate and watching the test not fail;
fixed by rendering an empty registry instead (exposes the one path — "Add your first
child" — with no inner gate at all); reconfirmed failing with the gate removed, passing
with it restored.

**Two genuine, pre-existing Step-1 gaps in this wave's OWN DB verification tooling were
found and fixed** (both caught only because this Step ran the full, from-zero `npm run
test:db` — no earlier PPR-2 pass had): `scripts/verify-mysql.mjs`'s hardcoded expected-table
list never included `family_child_memberships` (migration 0036), so `npm run test:db`
could not complete its own first step since Step 1 landed; `schema-privacy.mysql.test.mjs`'s
"*key*"-column allowlist never included `creation_request_key` (same class as the
already-allowlisted `idempotency_key`). Both fixed with one line each, review comments
matching each file's existing documentation convention, re-verified against a fresh
database afterward.

**Two mutation attempts on the most central, most widely-shared authentication/authorization
primitives were blocked by the harness's own safety classifier** (disabling
`requireServiceSession`'s missing-token rejection, and disabling
`AuthzService.authorize()`'s family-scope status check) — both reverted immediately, `git
diff` confirmed clean, a full rebuild against restored source succeeded. Not reported as
survivors (never ran to a result); their correctness rests on zero lines of either file
being touched by Steps 1–3, plus passing pre-existing coverage
(`crossRealm.test.mjs`, `authz/service.test.mjs`, `http.mysql.test.mjs`'s
revoked/disabled-account tests) and passing tests specific to the new child-profile routes.

**`LICENSE_ENTITLEMENT_STATUS = OWNER_DECISION_REQUIRED`, re-derived independently, same
conclusion as Part H's original finding:** zero writers to `licenses` anywhere in `src/`
(re-confirmed by fresh grep), no alternate/bootstrap path exists in the separate
entitlements/complimentary-grant subsystem, `CREATE_INVITATION` confirmed unreachable
end-to-end on a genuinely new account. The smallest concrete choice remains: (A)
`requiresLicense: false` for `CREATE_INVITATION` (free tier needs no license), or (B) build
a real bootstrap license writer (itself needing an owner decision on its trigger). Not
decided here; not silently worked around.

**Four findings discovered this Step and explicitly classified as pre-existing, unrelated
to PPR-2 Steps 1–3 (not fixed, not hidden inside `OPEN_SECURITY_FINDINGS`):** two
host-timezone-dependent test artifacts in unrelated session/challenge-expiry tests (an
existing, widespread `NOW(3)`-vs-driver-UTC pattern affecting ~18 pre-existing test files,
none touched by this wave); a `repository.create` vs `createAtomically` method-name drift
in `parentAccount.mysql.test.mjs` (4 failing tests, all about family-*member* invitations,
a file and repository never touched by this wave); and one architectural observation
(role-based UX restriction has no backend-enforced equivalent — a pre-existing,
self-documented, intentional design already symmetric between `CREATE_INVITATION` and this
wave's `CREATE_CHILD_PROFILE`/`LIST_CHILD_PROFILES`, not a new gap).

**Regression evidence:** backend non-DB suite 2183/2183 (unchanged from Step 1's number);
full `npm run test:db` from a genuinely fresh MySQL instance, migrated from zero, 473/479 —
the 6 failures are the pre-existing, unrelated findings above, none touching PPR-2 code;
`tsc --noEmit` clean on both `backend` and `parent-web`; `eslint . --max-warnings=0` clean
on `parent-web` (backend has no lint script configured); the three device-enrollment
component-test files stable across 2 consecutive runs (45/45 both times).

**Files touched, full list in the security report's own closing section.**
