# PCA Child-Focused Copy Audit — Gap Report (READ-ONLY MODE)

`COPY_MISSION_MODE = READ_ONLY` · `SOURCE_WRITES = 0` · `COMMITS = 0` · `PUSHES = 0`

Audited: 2026-09-04, against the working tree at `D:\PCA\pca-app` on branch `pca-dev`
(`HEAD` = `origin/pca-dev` = `cc5ae10`, with ~90 files uncommitted in-flight from a separate,
concurrently-active PPR-2 dashboard/enrollment redesign lane).

## Why this ran read-only

Pre-flight concurrency checks found PPR-2 already owns this exact task:

- Branch `pca-r2-writer82a-terminology-family-to-children-rewording-lane`, commit `2364b78`
  (`fix(i18n): reword genuine child-experience Family strings to Children wording (PCA-FR-112)`),
  performed a rigorous, individually-reasoned 81-row semantic audit of every family/child term inside
  the four locale JSON files and both Android `strings.xml` files, with a passing regression test
  (`parent-web/tests/i18n/terminologyFamilyToChildren.test.ts`). **Not yet merged into `pca-dev`.**
- Sibling branch `pca-r2-writer82b-i18n-rtl-accessibility-coverage-lane` covers related RTL/a11y test
  coverage. **Not yet merged into `pca-dev`.**
- The main worktree itself had a file (`parent-web/src/i18n/locales/ar.json`) modified ~5 minutes before
  this session started, and untracked `docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` /
  `PCA_PPR2_BROWSER_UAT_REPORT.md` documenting an active, owner-ratified UX program covering the same
  dashboard/enrollment surfaces.

Per owner instruction, this mission therefore produced a **read-only inventory only**: the CSV, the
glossary, and this gap report. No source file was modified, staged, committed, or pushed.

## What PPR-2 already owns (do not duplicate)

**81 rows**, `STATUS=PPR2_ALREADY_OWNS` in `PCA_CHILD_FOCUSED_COPY_AUDIT.csv` (`COPY-001`..`COPY-082`,
skipping row 1 = CSV header in the source audit). Covers, per-row, with individual rationale:

- `parent-web/src/i18n/locales/en.json` + `ar.json` — 43 rows (rows 2–45)
- `platform-admin-web/src/i18n/locales/en.json` + `ar.json` — 15 rows (rows 46–60)
- `android/app/src/main/res/values/strings.xml` + `values-ar/strings.xml` — 22 rows (rows 61–82)

Of these, 8 were reworded (child-experience/child-data copy corrected) and 73 were correctly left
unchanged (genuine account/authority/trust-boundary/billing scope, or genuine real-world family
references in wellbeing content). This session did not re-derive these classifications — they were
transcribed from the existing test file and spot-checked for internal consistency.

**This lane is high quality and should be merged, not redone.** Its main open risk is simply that it
is still sitting unmerged on a branch while a *different* PPR-2 lane is actively rewriting the same two
locale files in the main worktree right now (see next section) — a merge conflict is likely unless
someone reconciles the two lanes before either is pushed.

## What is NOT covered by PPR-2 — remaining gaps found by this audit

**53 new rows**, `COPY-200`..`COPY-252` in the CSV, from surfaces the PCA-FR-112 lane explicitly did not
touch (it scoped itself to locale JSON / strings.xml content only) plus the *new* keys the currently
in-flight dashboard rewrite is adding to those same locale files:

| Platform | Rows audited | Copy defects remaining | Legitimate (no action) |
|---|---|---|---|
| Parent Web (hardcoded strings + in-flight locale diff) | 13 | 6 (`COPY_DEFECT_REMAINING` ×4, `NOT_COVERED_BY_PPR2` ×2) | 7 |
| Android (Kotlin/Compose + other XML) | 21 | 15 | 6 |
| iOS (first full pass — previously unaudited) | 7 | 0 | 7 |
| Backend + Platform Admin | 12 | 9 (after coordinator reconciliation, see below) | 3 |
| **Total** | **53** | **30** | **23** |

### Highest-priority remaining defects

1. **`WebReasonCodes.kt` (Android, child-facing) + `backend/src/i18n/messages/{en,ar}.ts` (backend,
   parent/child-facing) — one conceptual defect, two locations.** Both say "blocked/allowed by your
   family's [allow list / block list / content category rule / schedule rule / explicit-content rule]"
   on the text shown directly on the child's Safe Browser block screen, even though the underlying
   `WebReasonId` enum is explicitly `PARENT_ALLOWLIST` / `PARENT_DENYLIST` / etc. — a parent-set rule,
   not a family-wide one. Android hardcodes its own copy of this text ("mirrors verbatim by design" per
   the Android agent's own finding), so **both files need the same fix** or the client and backend will
   drift. 10 Android strings (5 EN + 5 AR) + 6 backend catalogue entries (EN+AR combined) = 16 CSV rows.
2. **In-flight dashboard rewrite is introducing new instances of the exact pattern the Owner flagged**,
   in the same PR that's also fixing some of them: `dashboard.sections.family` ("Your family" /
   "عائلتك" over a list of children), `dashboard.recentActivity` ("Recent family activity" over a
   per-child timeline), `deviceEnrollment.familyDataUnavailableTitle` (the exact example the Owner
   originally cited), and `privacyHub.exportDesc` ("Get a copy of your family's data" on the data-export
   page — arguably the single highest-risk string in the whole app for the fear/overreach concern, since
   it's literally about what data leaves the system). The backend mirrors the same `exportDesc` mistake:
   `export.COMPLETED` says "Your family data export completed successfully" in both `en.ts` and `ar.ts`.
3. **Two static HTML files never go through i18n at all**: `parent-web/index.html`'s meta description and
   `parent-web/public/offline.html`'s cached-data reassurance both say "family" where only children's
   data/screen-time is meant — `NOT_COVERED_BY_PPR2` because no locale-file lane would ever reach them.
4. **Minor Android translation drift and inconsistent wording**: `persistence_strings.xml`
   `delete_now_description` (AR) says "عائلية" (familial) while its own EN sibling and neighboring
   `delete_now_scope_family` value already correctly say "children's"/"الأطفال" — a straightforward
   `TRANSLATION_FIX`. Two `wellbeing_control_strings.xml` entries similarly say "family" where the same
   file's other strings already say "a parent" / "custom (parent-authored)".

### Coordinator reconciliation applied

The backend research agent initially classified the `web.PARENT_ALLOWLIST`/`PARENT_DENYLIST`/
`CATEGORY_RULE`/`SCHEDULE_RULE`/`CLASSIFIER`/`ai.CATEGORY_RULE_MATCHED`/`DOMAIN_BLOCKED_NOTICE` backend
catalogue strings as `KEEP_LEGITIMATE_FAMILY_TERM` ("names the rule owner, not personal data"). The
Android agent, auditing the *identical* text mirrored verbatim in `WebReasonCodes.kt`, correctly
identified it as defective because it renders on a **child-facing** screen where the actual rule owner
is a parent, not the family. The coordinator sided with the Android agent's audience-aware reasoning and
reclassified all 7 of these backend rows to `COPY_DEFECT_REMAINING` / `REWRITE_FOR_CLARITY` so the CSV is
internally consistent (see each row's `TEST_EVIDENCE` column for the reconciliation note).

### iOS

First-ever audit of this platform (previously untouched by any lane). Result: clean. iOS's real
localizable surface is small (3 rendered SwiftUI screens, 32 catalogue keys, 2 recovery-secret copy
models not yet wired to any view) and every family-word hit found is either Apple's actual `Family
Controls` framework/permission name (a legitimate technical term, not owner-facing scope) or a genuine
multi-child account/recovery concept. Zero defects, zero gaps. iOS remains POST_V1 — this is an
inventory only, not a build-readiness claim.

### Platform Admin

Zero hardcoded, non-i18n user-facing defects found outside the already-PPR2-owned locale files. Platform
Admin is operator-facing, so the large volume of `familyId`/"family account" terminology there is
correctly legitimate and was left alone by both the PCA-FR-112 lane and this audit.

## Explicit gap classification (as required)

- `PPR2_ALREADY_OWNS`: 81 rows — done and tested on an unmerged branch.
- `NOT_COVERED_BY_PPR2`: 2 rows — static HTML, never reachable by a locale-file audit.
- `LEGITIMATE_FAMILY_TERM`: 23 rows (new-lane) + 73 rows (within the PPR2-owned 81) = 96 total across the
  whole app — confirmed correct, no action needed.
- `COPY_DEFECT_REMAINING`: 28 rows (new-lane; includes the reconciled backend rows and the in-flight
  dashboard additions) + 8 rows already fixed within the PPR2-owned 81 = defects identified either as
  still-open or already-resolved-by-PPR2.

## Handoff sequence (per owner instruction — do not start until this happens)

1. Fetch latest `origin/pca-dev`.
2. Verify the working tree is clean (no PPR-2 lane still mid-edit).
3. Re-run this audit against the new `HEAD` — the in-flight dashboard rewrite may have already fixed or
   further changed the 4 `COPY_DEFECT_REMAINING` Parent Web rows found here; re-check before assuming
   they're still open.
4. Subtract everything PPR-2 already fixed (both the `writer82a` 81-row lane, once merged, and whatever
   the in-flight dashboard lane lands with).
5. Implement only the remaining gaps, using the 5-writer structure originally assigned.
6. Test and publish as a separate, clean copy-remediation change — not bundled into PPR-2's own commits.

`OPEN_COPY_FINDINGS` (this pass) `= 30` (28 new-lane defects + 2 not-covered) — **not zero**, as expected
for a mission that intentionally did not write anything. This number will change at handoff once PPR-2's
two lanes land.

`PCA_CHILD_FOCUSED_COPY_AUDIT = NOT_COMPLETE` (by design — `COPY_MISSION_MODE = READ_ONLY` this pass).

---

## ADDENDUM — PPR-2 STEP 3 REMEDIATION PASS (2026-09-04)

`COPY_MISSION_MODE = WRITE` this pass. Re-ran the handoff sequence above against the current tree
(now well past `cc5ae10`, with the child-registry/opaque-profile work from PPR-2 Steps 1–2 also
in-flight uncommitted) rather than waiting for a clean tree, per the owner's Step 3 instruction to
audit "against the current tree."

**`writer82a` branch (`2364b78`) was NOT merged.** Checked first: its merge-base with `pca-dev` is
`abbb2f3`, several PPR-1/PPR-1R/PPR-2 commits behind current `pca-dev` — merging it now risked
conflicts or reintroducing since-superseded copy. Instead, each of the 8 rows this report flagged as
`(already implemented — text shown in CURRENT_TEXT is the corrected wording)` (COPY-016, 019, 021,
039, 042, 044, 073, 082) was independently re-verified directly against the current working tree
(`grep` against the live `en.json`/`ar.json`/`strings.xml`), not against the branch. All 8 hold. No
merge was needed or performed.

**All 28 `COPY_DEFECT_REMAINING` + 2 `NOT_COVERED_BY_PPR2` rows (30 total) were fixed directly on the
current tree.** Highest priority first, per owner instruction: the child-facing Safe Browser wording
(COPY-218–227 in `WebReasonCodes.kt`, COPY-241–246 + COPY-250 in `backend/src/i18n/messages/{en,ar}.ts`)
now reads "your parent's [allow list / block list / …]" in both locations, matching the underlying
`WebReasonId`/`MessageId` semantics exactly. The in-flight dashboard rewrite's new family-framed keys
(COPY-207–209, 212), the two static HTML files (COPY-200, 201), and the remaining Android translation
drift (COPY-213–217) followed. Full row-by-row detail — old text, new text, and file/line — is in
`PCA_CHILD_FOCUSED_COPY_AUDIT.csv`; every fixed row's `STATUS` is now `FIXED_PPR2_STEP3`.

**Verification, not just edits:** every backend string here is exercised by a real assertion, not just
present in the catalogue — `test/i18n/translate.test.mjs`, `test/safebrowser/SafeBrowserNavigationPolicy.test.mjs`
(both EN and AR routes through the real decision path), `test/export/pipeline.test.mjs`, plus 3 fixture
files that embedded the old string as mock data (`WebFilteringDashboardCardProvider`,
`BlockDecisionStateStore`, `ParentUnblockRequestService` test files) were all updated and re-run:
2183/2183 backend non-DB tests pass. Parent Web: full `tsc --noEmit` and `eslint . --max-warnings=0`
clean; `tests/i18n/` (15 files, 61 tests, including the strict EN/AR leaf-key-parity check) and every
Dashboard-surface component test (7 files, 32 tests) pass. No test in either repo hardcoded the old
Android XML strings, so no Kotlin test needed updating; both edited `wellbeing_control_strings.xml`
files and the edited `persistence_strings.xml` were confirmed well-formed XML.

**One dead-code finding, noted but out of Step 3's scope to act on:** `deviceEnrollment.familyDataUnavailableTitle`
(COPY-209) is no longer referenced anywhere in Parent Web source — PPR-2 Step 2's child-registry
rewrite of `AddDeviceWizard.tsx` removed the `getDashboard()`-sourced fail-closed path this key used
to serve. Its wording was still corrected (harmless, and correct if anything ever reactivates it), but
whether to delete the now-orphaned key is a separate cleanup decision, not a copy-correctness one.

`OPEN_COPY_FINDINGS` (after this pass) `= 0`. `COPY_AUDIT_REMAINING_OPEN = 0`.

`PCA_CHILD_FOCUSED_COPY_AUDIT = COMPLETE` for the 134 rows this audit covered. This is not a claim that
no other family/child terminology exists anywhere in the app outside the surfaces this audit's original
pass scoped itself to (Parent Web, Android, iOS, Platform Admin, backend-generated user text) — see the
original audit's own methodology for that scope.
