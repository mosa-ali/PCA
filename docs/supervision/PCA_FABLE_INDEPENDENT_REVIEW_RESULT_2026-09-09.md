# PCA — FABLE Independent Engineering Acceptance Review: RESULT

**Reviewer:** FABLE (independent adversarial review pass, same underlying model — Claude Sonnet 5 — as the implementer, but a fresh review with no authority to self-fix; per the review mission's own Rule 19, this document ends in a stop for supervisor review, not further autonomous fixes)
**Reviewed implementation commit:** `574483852fa9c10a1c59e81399df37970eef310e`
**Reviewed handoff/CI-evidence commit:** `edb77857cd5534e1a48fb7aaa42c755c5049afd3` (HEAD at review time)
**Previous accepted baseline:** `f49b55e6e729f03262f9afbf9336191101b28aa6`
**Method:** 7 independent adversarial sub-reviews run in parallel (security, privacy, documentation/traceability, owner-decision re-derivation, requirement-matrix recomputation, G-41 falsification, mutation-harness EQUIVALENT/INVALID audit), each instructed to treat the implementer's own handoff documents as claims to verify, not facts, and to cite file:line evidence from direct inspection and — wherever practical — live re-execution (rebuilding, reverting fixes to prove regression tests are non-vacuous, re-running the actual TypeScript parser, independently recomputing the requirement matrix from raw JSON, querying the GitHub Actions API directly). All heavy test suites (backend, Android JVM+lint, parent-web Vitest+Playwright, platform-admin-web Vitest+Playwright, contracts, public-web, release-gate scoping negative controls, all 6 release-gate targets) were independently re-executed by the reviewing session outside the parallel review, not merely re-read.

**One integrity note about the review process itself, disclosed rather than hidden:** partway through this review, `git status` revealed that `backend/src/familyrbac/RemovalDecisionAuthority.ts` had an uncommitted local modification reintroducing the exact `error.message` logging this pass's own commit says was deliberately excluded — a stray leftover from an earlier adversarial-revert test in this same reviewing session that had not been cleanly restored after an interruption. It was found and reverted (`git checkout --`) before any independent test suite was re-run against it, and the committed content at `edb7785` was separately confirmed (via `git show`) to never have contained the leak. This is disclosed for completeness; it does not affect any finding below, all of which were checked against the actual committed HEAD.

---

## FINAL VERDICT

```
FABLE_REJECTED_REQUIRES_FIXES
```

**This is not a rejection of the underlying engineering.** All 5 IMPLEMENT_NOW code changes (FABLE-A050, FABLE-A013, the Android+iOS icons, FABLE-A033, the mutation harness's real-execution upgrade) are independently confirmed correct, secure, privacy-safe, and covered by regression tests proven non-vacuous by live revert-and-rerun. CI is genuinely 22/23 green with the sole failure being the pre-existing, byte-identical KNOWN_IOS_BLOCKER. The requirement-matrix tiers (340/369, 354/369, 0/369) are independently recomputed and match exactly. The js-yaml dependency fix is real, correctly scoped, and confirmed clean in both CI and a fresh local run.

**What fails acceptance is the closure PACKAGE around that work**: one genuine misclassification with an unescalated live compliance concern underneath it, and a cluster of evidence-provenance/honesty defects in how the mutation-harness result and the architecture docs were presented as current. Per the review mission's own bar, `ENGINEERING_ITEMS_OPEN=0` and `UNFIXED_P1=0` are both required for acceptance; this pass has one open P1-classification item and one open P2-evidence-integrity item that must be corrected (not merely acknowledged) before re-submission.

---

## G-ITEM VERDICTS (all 11 previously-deferred items)

| # | Item | Implementer's classification | **FABLE classification** | Note |
|---|---|---|---|---|
| 1 | FABLE-A050 | IMPLEMENT_NOW → CLOSED | **CLOSED** | Confirmed correct and non-regressive; regression test proven non-vacuous by live revert |
| 2 | FABLE-A011 | NOT_APPLICABLE | **CONFIRMED NOT_APPLICABLE** | No contradicting evidence found in any of the 7 sub-reviews |
| 3 | FABLE-A012 | OWNER_DECISION | **MISCLASSIFIED** | See Finding P1-1 below — doc 09 already answers the classification question; the "two free options" framing is inaccurate, and shipped code has a live, unescalated compliance concern |
| 4 | FABLE-A013 | IMPLEMENT_NOW → CLOSED | **CLOSED** | Confirmed correct via live adversarial mutation (added `error.message` back, watched the sentinel test correctly fail, reverted) |
| 5 | FABLE-A031 | OWNER_DECISION (reclassified) | **OWNER_DECISION, accepted with a required documentation correction** | Conclusion and technical reasoning are independently confirmed correct; the write-up must cite the pre-existing tracked decision (`RETENTION_OWNER_RBAC`, `PCA_COMPLETION_V2_MATRIX.json:7579-7584`, and D9 in `PCA_PPR1_OWNER_DECISIONS.md:335`) instead of presenting itself as fresh analysis of a previously-unnamed question |
| 6 | FABLE-A053 (Android icon) | IMPLEMENT_NOW → CLOSED | **CLOSED** | Lint re-verified independently: 0 `MissingApplicationIcon`, 0 Error/Fatal severities |
| 7 | FABLE-A034 (iOS icon/launch screen) | IMPLEMENT_NOW → CLOSED | **CLOSED** | pbxproj wiring independently re-validated (structural integrity + correct PNG color type for App Store) |
| 8 | FABLE-A033 (iOS extension target) | IMPLEMENT_NOW → CLOSED | **CLOSED** | Confirmed no duplicate object IDs, no dangling references, no signing/entitlement change; doc 30's own PCA-15 row was NOT updated to match (see Finding P2-3) |
| 9 | Mutation harness (A040/G-38) | IMPLEMENT_NOW → CLOSED | **REQUIRES_FIX** | The five real code/mechanism changes are sound (confirmed via live adversarial mutation: weakening a covering assertion correctly flips a mutant to SURVIVED). The EVIDENCE ARTIFACT is not: see Findings P2-1 and P2-2 |
| 10 | Geofence "design/UX decision" | NOT_APPLICABLE | **CONFIRMED NOT_APPLICABLE** | No sub-review found reason to doubt the original investigation (duplicate of already-tracked G-08) |
| 11 | Play/App Store metadata | OWNER_DECISION | **CONFIRMED OWNER_DECISION** | Independently searched for a pre-existing answer (D20, doc 25) and found none — genuinely needs real-world legal/business facts |

```
G_ITEMS_TOTAL=11
G_ITEMS_ACCEPTED=5   (A050, A013, A053, A034, A033)
G_ITEMS_REJECTED=2   (A012 misclassified; mutation-harness evidence trail)
G_ITEMS_OWNER_DECISION=2   (A031, store metadata)
G_ITEMS_EXTERNAL=0
G_ITEMS_NOT_APPLICABLE=2   (A011, geofence)
```

---

## G-41: DOWNGRADED FROM FLAKY_WITH_ROOT_CAUSE TO **UNRESOLVED**

```
G41=UNRESOLVED
```

The implementer's central logical claim — that `devBillingClient.ts`'s `simulateServerPaymentConfirmation` writes the APPROVED state and the invoice array in one unbroken synchronous block, making it logically impossible to observe one without the other — is **independently confirmed true**, traced line-by-line with zero counter-example found. The supporting claims (no caching in `useAsync`, no confusable "Approved" text, the documented `retries:1`-on-CI/prebuilt-preview-server precedent) are also all confirmed.

**What is not earned is the word "proven."** The implementer's own reproduction evidence — 140/140 local passes across 20 repeats deliberately run under concurrent CPU load, plus 0 recurrences across 3 CI runs — never once reproduced *anything* resembling the original symptom. That eliminates the leading alternative (a real product defect) with real confidence; it does not confirm the specific proposed mechanism (CPU contention during the webhook-confirmation window). The review mission's own instruction is explicit: **"Could not reproduce" is NOT sufficient for closure.** The original incident's forensic trace was already lost (acknowledged in the implementer's own prior-pass documentation), so there is no independent evidence pinning the actual cause.

A supplementary data point sharpens this rather than resolving it: an independent reproduction attempt during this review (5 repeats, `--retries=0 --workers=1`) produced one failure in this same spec file — but its signature (a whole-test 30-second timeout plus an internal Playwright trace-assembly error, on the first test of the batch) is a **different phenomenon** than G-41's original "Approved shown, Paid not visible" symptom, consistent with browser/worker cold-start overhead rather than CPU contention mid-webhook. This suggests the spec file may have more than one uncatalogued environmental flake source, which further weakens confidence that the implementer named *the* proven cause as opposed to *a* plausible theory never caught in the act.

**No code or test change is required by this downgrade.** The recommendation is a labeling correction only: record G-41 as `UNRESOLVED` (elimination of REAL_DEFECT well-supported; root cause not proven) rather than `FLAKY_WITH_ROOT_CAUSE`, until either the original symptom is actually caught with a trace, or a second full zero-retry pair of runs replicates the 2-of-2/1-of-2 pattern with the CPU-contention condition deliberately reproduced and forensically captured.

---

## DEFECT PACKAGE (per Rule 19 — not fixed in this review; for the implementer's next pass)

### P1-1 — FABLE-A012 misclassification + unescalated live compliance concern

- **SEVERITY:** P1
- **REQUIREMENT:** doc 09 (`docs/architecture/09_SECURITY_PRIVACY_E2EE.md`) Section 5.2 / PCA-SEC-023
- **FILE:** `docs/supervision/PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv` row `FABLE-A012`; `backend/src/web/WebRuleStore.ts:20-51`; `backend/src/http/routes/webRuleRoutes.ts`
- **ROOT_CAUSE:** The closure pass's memo frames FABLE-A012 as a symmetric two-option owner choice (E2EE-only vs. an eye-protection-style plaintext exception). Doc 09:142 already names "filter lists" explicitly as Section 5.2 content PCA infrastructure must not hold readable, and PCA-SEC-023 (doc 09:145) makes this a MUST. Option B is therefore already foreclosed by an approved architecture document unless that document is first formally amended via the doc 00 Section 9 change-entry process (a real, precedented, owner-approval-gated mechanism — e.g. `CHG-2026-09-04-01`) — not a routine pick between equals. Separately, and predating this pass entirely (introduced 2026-09-02, commit `1a93aa0`, not touched by this pass): `InMemoryWebRuleRepository` currently stores parent-authored domains in plaintext server-side, and `webRuleRoutes.ts` returns them in cleartext JSON — the exact class of exposure Section 5.2/PCA-SEC-023 prohibits, live in the current HEAD today. The "eye-protection settings" precedent the memo cites for Option B is itself unreviewed by doc governance (no doc 09/doc 00 change-entry backs it).
- **REPRODUCTION:** Read `docs/architecture/09_SECURITY_PRIVACY_E2EE.md:142,145`; read `backend/src/web/WebRuleStore.ts:20-51` and `backend/src/http/routes/webRuleRoutes.ts:78-80,160-218`; confirm no doc 00 change-log entry exists for an eye-protection Section-5.2 exception.
- **EXPECTED_BEHAVIOR:** FABLE-A012 should not be presented as an open, symmetric owner choice. It should be reclassified as EXTERNAL_GATE/FUTURE_SCOPE (Option A — the envelope-relay pattern already used by `childPolicyRoutes.ts` — is the only compliant path, and it is itself blocked on `PRODUCTION_CRYPTO_SUITE`), and the currently-live plaintext storage should be recorded as an acknowledged, standing compliance gap requiring explicit owner/security sign-off to accept-as-is for V1 (mirroring how other accepted gaps in this codebase, e.g. `RETENTION_OWNER_RBAC`, are formally tracked with a named decision ID and an owner recommendation on file) rather than left as a quietly-reframed "decision pending."
- **REQUIRED_FIX:** Correct the CSV row's framing (Option B is not currently available without a doc 09 amendment); either open a formal doc 00 change-entry to request that amendment, or record the live plaintext-domain-storage state as a named, tracked risk-acceptance item pending owner/security sign-off (matching the `RETENTION_OWNER_RBAC` pattern). No source code change is required to close this finding — a documentation/ledger correction is.
- **REQUIRED_REGRESSION:** None (documentation-only fix).
- **RELEASE_IMPACT:** None of the 6 release targets change state (all remain NOT_READY on other grounds), but PARENT_C's external-gate register should reflect this more precisely once corrected.

### P2-1 — Mutation-harness evidence artifact is stale and the harness's default invocation is broken at the actual final HEAD

- **SEVERITY:** P2
- **FILE:** `tooling/mutation/reports/current-head-mutation.json`; `tooling/mutation/mutation-scope.json:3`
- **ROOT_CAUSE:** The committed report's `mutationHead`/`entrySha`/`baseline` fields all read `f49b55e6e729f03262f9afbf9336191101b28aa6` (the pre-pass baseline), `baselineSource: "--baseline"`, `worktreeCleanAtRun: false`, `generatedAtUtc: "2026-09-08T15:07:48.584Z"` — roughly 9 hours before the implementation commit (`5744838`, authored `2026-09-09T00:26:04Z`) was made. The report was never re-generated and re-committed after the final source was actually committed. Separately, the handoff commit (`edb7785`) bumped `mutation-scope.json`'s `entrySha` to `5744838` specifically so "the mutation harness's default invocation... targets a current commit" — but since committing that bump necessarily makes HEAD one commit ahead of the value it just wrote, the default (no-flag) invocation fails immediately at the actual HEAD (`edb7785`) with a baseline-mismatch error. This is not a one-off slip: the same structural issue caused the pre-pass `entrySha` to go 62 commits stale before this pass, requiring an undocumented `--baseline` override to produce any report at all.
- **REPRODUCTION:** `node tooling/mutation/run-mutation.mjs` (no flags) at current HEAD → immediate `Error: mutation configuration error: runner must execute at baseline 574483852f..., found edb77857...`.
- **EXPECTED_BEHAVIOR:** The committed report should reflect a run against the actual final commit, and the default invocation should work at HEAD without an undocumented flag.
- **REQUIRED_FIX:** (a) Re-run `node tooling/mutation/run-mutation.mjs --baseline HEAD` at the true final HEAD once this defect package's other fixes are committed, and commit the resulting report. (b) Fix the structural entrySha-always-trails-HEAD problem — either document `--baseline HEAD` as the standing required invocation in the README (a one-line fix), or change the harness to accept the *parent* of a bump commit as implicitly valid, or move to a floating reference (e.g. "the last commit that touched backend/src or a mutant-covering test file") rather than a literal embedded SHA that can never describe its own commit.
- **REQUIRED_REGRESSION:** None new required; the existing `establishBackendTestBaseline`/`classifyBackendMutant` mechanism (already adversarially verified sound during this review) does not need to change, only its invocation/documentation.
- **RELEASE_IMPACT:** None directly, but the handoff document's mutation-testing evidence (Section E) currently cites an artifact that does not describe the code it claims to describe; this must be corrected before the artifact is cited as current evidence again.

### P2-2 — Handoff document's mutation-summary table row overstates evidentiary strength

- **SEVERITY:** P2
- **FILE:** `docs/supervision/PCA_FABLE_FINAL_REVIEW_REQUEST_2026-09-08.md` (Section E summary table, the "Mutation harness (backend, real execution)" row)
- **ROOT_CAUSE:** The row reports "22 KILLED / 3 EQUIVALENT / 3 INVALID / 0 SURVIVED / 0 manifestAnomalies" labeled "(backend, real execution)". These are the ALL-SURFACES totals (28 mutants: 10 backend + 10 parent-web + 8 android-static), not backend alone (which is only 10 mutants: 8 KILLED + 1 EQUIVALENT + 1 INVALID). 18 of the 28 counted mutants (14 KILLED + 2 of 3 EQUIVALENT + 2 of 3 INVALID) are classified by the pre-existing static-string-assertion method only — unchanged by this pass, and explicitly *not* real-execution-verified. The raw report JSON discloses this correctly per-surface (`executesTests`/`classificationMethod` fields); the human-facing handoff table does not.
- **REPRODUCTION:** Read `tooling/mutation/mutation-scope.json` and count mutants by `surface`; compare against the handoff doc's summary row.
- **EXPECTED_BEHAVIOR:** The summary table should either split the row by surface (e.g. "Mutation harness — backend (real execution): 8 KILLED/1 EQUIVALENT/1 INVALID/0 SURVIVED" and a separate "— parent-web/android (static assertion only, unchanged)" row) or explicitly caveat that only 10 of 28 mutants carry real-execution strength.
- **REQUIRED_FIX:** Edit the handoff document's Section E table (a documentation-only change).
- **REQUIRED_REGRESSION:** None.
- **RELEASE_IMPACT:** None.

### P2-3 — `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md`'s PCA-15 row is stale in 2 of 4 clauses

- **SEVERITY:** P2
- **FILE:** `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md:34`
- **ROOT_CAUSE:** The row still reads "The `PCADeviceActivityMonitor` extension target compiles one file referencing host-app-only types; no `DeviceActivityCenter.startMonitoring` call site; no `DEVELOPMENT_TEAM`, app icon or launch screen; entitlement/device gates open." Two of these four clauses are now false: the extension target's Sources phase compiles 8 files, not 1 (confirmed against `ios/PCA.xcodeproj/project.pbxproj:217`), and a placeholder app icon + generated launch screen now exist (`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`, `INFOPLIST_KEY_UILaunchScreen_Generation = YES`). The other two clauses (no `DeviceActivityCenter.startMonitoring` call site; no `DEVELOPMENT_TEAM`) remain accurate. This document was not touched by either commit of this pass, even though the FABLE ledger CSV (which correctly describes the same facts) was. Doc 30 itself states (line 65) that it is "regenerated from executed evidence at every assessment pass, never edited to match a wish" — that promise was not honored this pass.
- **REPRODUCTION:** Compare `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md:34` against `ios/PCA.xcodeproj/project.pbxproj` at HEAD.
- **EXPECTED_BEHAVIOR:** The row should read something like: "...now compiles all 8 files it needs (host-app-only types wired via `wire_device_activity_monitor_shared_sources.py`); no `DeviceActivityCenter.startMonitoring` call site; a placeholder icon and generated launch screen now exist (not final branding); no `DEVELOPMENT_TEAM`; entitlement/device gates open."
- **REQUIRED_FIX:** Edit the one row (documentation-only change).
- **REQUIRED_REGRESSION:** None.
- **RELEASE_IMPACT:** None (IOS_FUTURE remains NOT_READY on other, still-genuinely-open grounds).

### P2-4 — `AlertComposeFailureLogger.ts` doc comment overclaims the guarded failure is "ALWAYS" the composer's static string

- **SEVERITY:** P2 (documentation-accuracy; independently assessed practical leak risk is low, not zero)
- **FILE:** `backend/src/alerts/AlertComposeFailureLogger.ts:6-9`; call sites `backend/src/http/routes/runtimeSyncRoutes.ts:88-109`, `backend/src/invitation/InvitationService.ts:418-439`
- **ROOT_CAUSE:** The doc comment says "today that failure is ALWAYS the same static, variable-free string from `RejectingOpaqueProtectionAlertComposer`." Both call sites' `try` blocks also wrap `await alerting.resolveParentDevices(familyId)` — production-wired to `MySqlOwnerParentDeviceResolver`, which executes real MySQL queries (`FamilyAuthorityAttestationChainStore.findHead`/`findAttestationById`) that can throw on a genuine database failure, independent of and before the composer is ever reached. A DB-driver `error.message` can therefore also flow into the same `logger.warn(...)` call, under an event name that misleadingly implies a composer-specific failure. The queries are parameterized, so this is unlikely to leak secrets/PII in practice, but the stated safety invariant the doc comment relies on is factually incomplete.
- **REPRODUCTION:** Read the two call sites' `try` block scope; read `MySqlOwnerParentDeviceResolver.ts:35-41` and `MySqlAttestationChainStore.ts:147-162`.
- **EXPECTED_BEHAVIOR:** The doc comment should describe both possible throw sources (composer rejection and a `resolveParentDevices` DB failure), not claim the message is always the fixed composer string.
- **REQUIRED_FIX:** Correct the doc comment. Optionally (not required for this finding to close, since practical risk is low with parameterized queries): consider whether a DB-failure path deserves a distinct event name from a composer-rejection path, since they represent different operational conditions an on-call engineer would want to distinguish.
- **REQUIRED_REGRESSION:** None required to close the documentation-accuracy finding; optional if the event-name split is also implemented.
- **RELEASE_IMPACT:** None.

### P2-5 — FABLE-A031's write-up presents itself as fresh analysis of a previously-untracked question

- **SEVERITY:** P2
- **FILE:** `docs/supervision/PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv` row `FABLE-A031`
- **ROOT_CAUSE:** The exact question ("should retentionRoutes.ts get a server-side Owner-only role check") is already a formally tracked, named, OPEN decision: `docs/implementation/PCA_COMPLETION_V2_MATRIX.json:7579-7584`, `ownerDecisions[0] = {decisionId: 'RETENTION_OWNER_RBAC', status: 'OPEN', ...}`, with an existing recommendation at `docs/pre-production/PCA_PPR1_OWNER_DECISIONS.md:335` (D9: "Accept for V1, tighten after D5 [crypto review]"). The closure pass's "2026-09-09 re-investigation... reclassified from OPEN_CRYPTO_GATED" framing never cites this pre-existing decision ID or its ready-made recommendation, even though the landing conclusion (no code change; accept status quo) matches D9 exactly.
- **REPRODUCTION:** Read `PCA_COMPLETION_V2_MATRIX.json:7579-7584` and `PCA_PPR1_OWNER_DECISIONS.md:335`.
- **EXPECTED_BEHAVIOR:** The CSV row should cite `RETENTION_OWNER_RBAC`/D9 directly rather than presenting the reasoning as newly derived.
- **REQUIRED_FIX:** Edit the CSV row to cite the pre-existing decision ID and recommendation (documentation-only change). The technical conclusion itself does not change.
- **REQUIRED_REGRESSION:** None.
- **RELEASE_IMPACT:** None.

### P3 findings (do not block acceptance on their own; recorded for completeness)

- **G-41 relabeling** (see above): change `FLAKY_WITH_ROOT_CAUSE` to `UNRESOLVED` in the gap matrix and gap-assessment doc.
- **Requirement matrix omission:** the 5 rows citing `AdminSecurityActivity.kt` as source evidence (`PCA-FR-084`, `PCA-NFR-040`, `PCA-NFR-044`, `PCA-PRIV-001`, `PCA-ADD-ENR-014`) do not list the new `AdminSecurityActivityFamilyIdBlankGatingTest.kt` in `testEvidence` — a pre-existing matrix-granularity gap for this file (it also omits the older `AdminSecurityActivityAuditExportGatingTest.kt`), not a regression introduced by this pass, but worth closing alongside the other doc fixes above.
- **Mutation harness — `assertScope()` does not validate `mutant.source` path safety** before `path.join(context.root, mutant.source)`. Not exploitable today (the manifest is a reviewed, git-tracked file, not attacker input), but worth a defensive `path.join`/`path.resolve`-then-`startsWith` check for defense-in-depth.
- **Android INVALID mutant (`A-NFR060-INVALID-001`) could not be independently compiler-verified** in this review's sandbox (no `kotlinc` available); manual syntax analysis strongly suggests it is genuinely invalid, matching the parent-web case that WAS independently verified with the real TypeScript parser, but this remains unconfirmed by direct compilation.

---

## FULL DIMENSION RESULTS (sections 1–17 of the review mission)

| Section | Result |
|---|---|
| 1. Git/provenance | **CONFIRMED.** Branch `pca-dev`, local HEAD = origin HEAD = `edb7785`, worktree clean (after the stray-revert fix noted above), stash preserved untouched. Full diff `f49b55e..edb7785` reviewed file-by-file; no unrelated/unsafe changes found. |
| 2. 11 deferred items | See table above. |
| 3. G-41 | **UNRESOLVED** (downgraded from FLAKY_WITH_ROOT_CAUSE). See above. |
| 4. Every implemented change | Independently reviewed; the 5 code changes are sound. Two doc-comment/evidence-labeling defects found (P2-2, P2-4), not code defects. |
| 5. js-yaml finding | **CONFIRMED** exactly as claimed: `js-yaml` 4.3.1→4.3.2 in both `parent-web`/`platform-admin-web` lockfiles; `npm audit --audit-level=high` independently re-run, 0 HIGH/CRITICAL in both; only the pre-existing 2 MODERATE `@vitest/mocker` findings remain (require a breaking vitest v5 bump, correctly left alone); confirmed via `git ls-files '*package-lock.json'` that only 6 workspaces exist in the whole monorepo, all checked. |
| 6. Mutation harness | 6 of 6 audited EQUIVALENT/INVALID classifications independently confirmed correct on the merits (one, the real TypeScript-parser check on `W-NFR060-INVALID-001`, went further than the harness itself does). The classification MECHANISM for backend is sound (proven via live adversarial mutation — weakening real coverage correctly flips a mutant to SURVIVED). See P2-1/P2-2 for the evidence-provenance defects. |
| 7. Test evidence | **CONFIRMED**, independently re-executed, not re-read: backend 2346/2346 (rebuilt fresh); Android JVM full suite BUILD SUCCESSFUL, lint 0 errors/0 MissingApplicationIcon; parent-web Playwright 92/92; platform-admin-web Playwright 20/20; contracts 4 validators + 49/49 tests; public-web build-check + 6/6 tests; release-gate scoping 0 failures (isolated) + all 6 targets independently re-run, all correctly NOT READY. Platform-admin-web Vitest instability: see below. |
| 7a. Platform-admin Vitest instability | **RESOURCE/CONCURRENCY** (not REAL_DEFECT, not TEST_HARNESS in the sense of a fixable ordering bug). Independently re-ran the full batch: failure count and the SET of failing files differ completely from every prior run (64→56→58 failures, entirely different files each time) — the opposite of what a deterministic ordering/cleanup bug would produce. Isolated re-runs of two different previously-failing files (`StepUpContext.test.tsx`, `AccountsListSearchAndSort.test.tsx`) both pass 100% clean alone; one isolated run's own internal timing breakdown showed 66.6 of 122.9 total seconds spent in jsdom environment setup for a single file — extreme, resource-sensitive setup latency consistent with this project's own already-documented (pre-existing, cross-app) Vitest batch-instability finding. Zero platform-admin-web files were touched by this pass. Not repository-solvable within this pass's scope; does not block closure. |
| 8. False-green adversarial review | Release-gate ledger, derived-ledger `--check`, generated gate table, FABLE scope parity, and the 4 embedded node validators (`EXTERNAL_GATE_PARITY`, `ValidateR3EvidenceDiscipline`, `ValidateCanonicalTrustBoundary`, `ValidateSafeZoneMutationBoundary`) were independently re-run via `Test-ReleaseGateScoping.mjs`, which itself performs corrupt→fail→restore→pass negative controls for each — all passed, "ALL PASS (0 failures)". Console redaction (FABLE-A057 chain) confirmed completely untouched by this pass via empty `git diff --stat` on both apps' `security/` trees. Mutation-harness integrity: see P2-1 (a real, if narrow, false-green-adjacent gap — the harness's OWN evidence of itself is stale). |
| 9. Security review | No P0/P1 security defects found in the pass's actual code changes. Two P2 documentation-accuracy findings (P2-1-adjacent mutation report staleness; P2-4 doc-comment overclaim). All auth/authz/isolation/IDOR/crypto-fail-closed/error-leakage properties independently traced and confirmed intact. |
| 10. Privacy review | **CONFIRMED clean.** All logged fields (familyId/deviceId/actorDeviceId/requestId/trigger/error.message/errorConstructor) traced to their actual authenticated/durable origin at every call site; none can carry raw activity/location/browsing/content data. Live adversarial mutation (re-adding `error.message` to the strict logger) correctly flipped the sentinel test from pass to fail, then was reverted. |
| 11. iOS review | **CONFIRMED.** CI failure is byte-identical to every prior run (`Could not find test host for PCATests`), independently queried from the GitHub Actions API. No new iOS source failure introduced. Extension target and icon/launch-screen wiring both structurally correct (brace/duplicate/dangling-reference checks). No production-readiness claim was added — doc 30's staleness (P2-3) is in the *understating* direction, not an inflation. |
| 12. Requirement matrix | **CONFIRMED exactly**, via two independent methods (a from-scratch script over the raw JSON, and live execution of `RebuildR3DerivedLedgers.mjs --check`): 375 total rows, 340/369 = 92.1% SOURCE_COMPLETE-tier, 354/369 = 95.9% automated-evidence, 0/369 strict VALIDATED_COMPLETE (confirmed against the real `docs/release_readiness/uat_execution_log.json`: 0 of 54 cases logged). `PCA_COMPLETION_V2_MATRIX.json` is byte-identical between `f49b55e` and `edb7785` — this pass genuinely made zero changes to it, exactly as both supervision docs claim. |
| 13. Addendum 001/002 | Read and confirmed internally consistent with doc 30's Addendum table; this pass's changes do not touch either addendum's counted domain. |
| 14. Release gates | **CONFIRMED**, independently re-run for all 6 targets with no `-IgnoreExternalGates`: all 6 exit non-zero (NOT_READY), each naming real, genuine external-gate blockers. |
| 15. CI verification | **CONFIRMED**, independently queried from the GitHub Actions API (not the handoff doc): run `34295015290` for `5744838` = 22 success / 1 failure (iOS), matching exactly. |
| 16. Documentation/traceability | See P2-3 (doc 30 stale) and P2-1/P2-2 (mutation evidence). All other named documents (31, 32, 34, `PCA_IMPLEMENTATION_TRACEABILITY.md`, release-readiness docs, both FABLE ledger CSVs' other rows) checked and found consistent. |
| 17. Owner-decision items | See P1-1 (A012 misclassified) and P2-5 (A031 traceability gap). Store metadata confirmed correctly classified. |

---

## FINAL REPORT (Section 20 fields)

```
FINAL_REVIEWER=FABLE

REVIEWED_IMPLEMENTATION_COMMIT=574483852fa9c10a1c59e81399df37970eef310e
REVIEWED_HANDOFF_COMMIT=edb77857cd5534e1a48fb7aaa42c755c5049afd3

G_ITEMS_TOTAL=11
G_ITEMS_ACCEPTED=5
G_ITEMS_REJECTED=2
G_ITEMS_OWNER_DECISION=2
G_ITEMS_EXTERNAL=0
G_ITEMS_NOT_APPLICABLE=2

G41=UNRESOLVED

SOURCE_COMPLETE=340/369 (92.1%, independently recomputed, exact match)
AUTOMATED_EVIDENCE=354/369 (95.9%, independently recomputed, exact match)
STRICT_VALIDATED=0/369 (0%, independently confirmed against the real UAT execution log)

MUTATION=6 of 6 audited EQUIVALENT/INVALID classifications confirmed correct on the merits; backend mechanism (10 mutants) independently proven sound via live adversarial mutation; parent-web/android (18 mutants) remain static-assertion-only, unchanged, correctly disclosed at the artifact level but mislabeled in the human-facing handoff table (P2-2); the committed report artifact itself is stale and the harness's default CLI invocation is currently broken at HEAD (P2-1)
BACKEND=2346/2346 pass, independently rebuilt and rerun
ANDROID=JVM full suite BUILD SUCCESSFUL; lint 0 errors, 0 MissingApplicationIcon, independently rerun
PARENT_WEB=Vitest full suite pass (exit 0); Playwright 92/92, independently rerun
PLATFORM_ADMIN=Playwright 20/20, independently rerun; Vitest batch-instability = RESOURCE/CONCURRENCY (pre-existing, cross-app, zero files touched by this pass, isolated files pass 100% clean) -- not repository-solvable within this pass's scope, does not block closure
PUBLIC_WEB=build-check pass + 6/6 tests, independently rerun
CONTRACTS=4/4 validators + 49/49 tests, independently rerun
SECURITY=no P0/P1 code defects found; P2 doc-comment overclaim (P2-4)
PRIVACY=clean; no P0-P3 issues found in this pass's changes
RELEASE_TOOLING=trustworthy; scoping + all embedded negative controls independently re-run, 0 failures; all 6 release-gate targets independently re-run, all correctly NOT_READY with real named blockers
CI=independently queried via GitHub Actions API for both commits; 5744838 and edb7785 both 22/23 green, iOS the only failure, byte-identical KNOWN_IOS_BLOCKER in both

P0_OPEN=0
P1_OPEN=1   (FABLE-A012 misclassification + its unescalated live compliance concern -- P1-1)
P2_OPEN=5   (P2-1 stale mutation report/broken default invocation, P2-2 misleading handoff summary row, P2-3 doc 30 PCA-15 staleness, P2-4 AlertComposeFailureLogger doc-comment overclaim, P2-5 A031 traceability gap)

ENGINEERING_ITEMS_OPEN=2   (FABLE-A012 reclassification+escalation; mutation-harness evidence-trail repair)
UNEXPLAINED_ITEMS=0   (every finding above has a named root cause and reproduction)

PUBLIC_A=NOT_READY (confirmed, unchanged)
AUTH_B=NOT_READY (confirmed, unchanged)
PARENT_C=NOT_READY (confirmed, unchanged)
ANDROID_D=NOT_READY (confirmed, unchanged)
IOS_FUTURE=NOT_READY (confirmed, unchanged)
BILLING_FUTURE=NOT_READY (confirmed, unchanged)

ENGINEERING_CLOSURE=NOT_ACCEPTED_PENDING_FIXES
OVERALL_RELEASE_AUTHORIZATION=NOT_AUTHORIZED

FINAL_GIT_SHA=574483852fa9c10a1c59e81399df37970eef310e
REMOTE_SHA=edb77857cd5534e1a48fb7aaa42c755c5049afd3 (origin/pca-dev, confirmed matching)
WORKTREE=clean (confirmed at review time, after correcting one stray uncommitted artifact from this reviewing session's own earlier adversarial testing -- see integrity note above)
```

---

**Per Rule 19, this review does NOT proceed to fix any of the above.** All five required fixes (P1-1, P2-1 through P2-5) are documentation/ledger corrections plus one mutation-harness artifact regeneration — no new source-code behavior is required, and none touches a security-sensitive code path. Stopping here for supervisor review before any further action, as instructed.
