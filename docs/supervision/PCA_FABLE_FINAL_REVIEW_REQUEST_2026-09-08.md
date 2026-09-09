# PCA — Final Handoff to FABLE for Independent Review

**Date of this pass:** 2026-09-09 (mission dated 2026-09-08; the pass itself ran into the next day; file name kept as originally specified)
**Branch:** `pca-dev`
**Baseline HEAD at mission start:** `f49b55e6e729f03262f9afbf9336191101b28aa6` (verified clean, in sync with `origin/pca-dev`)
**Final commit (this pass):** `574483852fa9c10a1c59e81399df37970eef310e`
**Remote HEAD after push:** `574483852fa9c10a1c59e81399df37970eef310e` (`origin/pca-dev`, fast-forward from `f49b55e`; `origin/main` untouched)
**Worktree:** clean at final commit; `stash@{0}` (48 files, pre-existing, unrelated to this pass) preserved untouched throughout — never touched, popped, or dropped

```
IMPLEMENTER = Claude Sonnet 5 (model id claude-sonnet-5)
```

**Correction to the mission's premise, stated plainly rather than silently substituted:** the mission brief names `IMPLEMENTER: CLAUDE OPUS 5`. This session ran on Sonnet 5 throughout (the operator's `/model` selection, confirmed by the system prompt's own model identification, and unchanged for the duration of the pass). Everything below was produced by Sonnet 5, not Opus 5. This is disclosed here rather than left for FABLE to discover, and rather than the report silently claiming an identity it does not have.

```
FINAL_INDEPENDENT_REVIEWER = FABLE
```

**Do not treat this document as self-certification.** No claim of `ENGINEERING_CLOSURE_CONFIRMED` or 100% appears anywhere below or was made during this pass, per the mission's explicit independence rule.

---

## A. Method

Ten parallel investigation agents (via the Workflow tool) each investigated exactly one of the 11 items named in commit `7f379cf`'s message and `docs/supervision/PCA_FINAL_GAP_ASSESSMENT_2026-09-08.md`, instructed to read current source (not trust the closure record), cite `file:line` evidence, and classify into IMPLEMENT_NOW / VALIDATION_ONLY / OWNER_DECISION / EXTERNAL_GATE / FUTURE_SCOPE / NOT_APPLICABLE. (One investigation covered two closely related items — the Android launcher icon and the icon/launch-screen portion of the iOS item — so 10 agents covered all 11 named bullets.) All actual implementation, testing, adversarial testing, and documentation was then done directly by the implementer, not delegated to the investigation agents, given the security-sensitive nature of the codebase.

G-41 (the one unexplained billing e2e observation) was investigated separately and directly: by reading the fixture/UI source for a logical-defect proof, then by live reproduction under real concurrent CPU load.

---

## B. Classification results for the 11 items

| # | Item | Classification | Outcome |
|---|---|---|---|
| 1 | FABLE-A050 residual gap (Android `familyId=""` UI-gating) | **IMPLEMENT_NOW** | Implemented, tested, adversarially verified |
| 2 | FABLE-A011 (in-memory `FamilyAuditRepository`) | **NOT_APPLICABLE** | No code change; closure record corrected (a durable, compliant path already exists) |
| 3 | FABLE-A012 (in-memory web-rule persistence) | **OWNER_DECISION** | No code change; sharper two-option decision memo recorded |
| 4 | FABLE-A013 (bare catches around Rejecting composers) | **IMPLEMENT_NOW** | Implemented, tested, adversarially verified |
| 5 | FABLE-A031 (retention route role check) | **OWNER_DECISION** (reclassified from crypto-gated-no-code-needed) | No code change; would break tested self-service behavior for zero real gain |
| 6 | FABLE-A053 (Android launcher icon) | **IMPLEMENT_NOW** | Implemented, lint-verified |
| 7 | FABLE-A034 icon/launch-screen portion (iOS) | **IMPLEMENT_NOW** | Implemented, structurally validated |
| 8 | FABLE-A033 (iOS extension target membership) | **IMPLEMENT_NOW** | Implemented, structurally validated (Xcode build verification stays external) |
| 9 | Real mutation harness (FABLE-A040 / G-38) | **IMPLEMENT_NOW** | Implemented, adversarially verified twice |
| 10 | Geofence zone authoring UI "(design/UX decision)" | **NOT_APPLICABLE** | No code change; duplicate reference to already-tracked G-08 crypto gate |
| 11 | Play/App Store metadata (legal facts and owner decisions) | **OWNER_DECISION** | No code change; scaffolding deliberately not created (would be half-finished ahead of legal facts — see rationale in the investigation) |

Full investigation evidence (file:line citations, drift-from-record findings) is preserved in this session's workflow transcript; the classifications and outcomes above are what changed the repository.

---

## C. Implementation changes (this pass, commit `5744838`)

**FABLE-A050 residual gap** — `android/app/src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt`: `currentFamilyId` derivation now `?.takeIf { it.isNotBlank() }`, mirroring `WebProtectionIdentityContext`'s existing guard on the same field. New test: `android/app/src/test/java/org/pca/app/security/ui/AdminSecurityActivityFamilyIdBlankGatingTest.kt` (source-scan style, matching the codebase's own convention for an Activity that cannot be exercised by a plain JVM test). **Adversarial proof:** reverted the fix, re-ran the new test, confirmed it fails (`AssertionError`); restored the fix, confirmed it passes again.

**FABLE-A013** — new `backend/src/alerts/AlertComposeFailureLogger.ts` (interface + console-backed default, bounded fields only). Wired into `backend/src/http/routes/runtimeSyncRoutes.ts` (`emitProtectionDegradedAlert`, via a new optional `RuntimeSyncRoutesDeps.alertComposeFailureLogger`, threaded through `backend/src/http/buildServer.ts`) and `backend/src/invitation/InvitationService.ts` (`emitAlert`, new optional constructor parameter, default preserved). `backend/src/familyrbac/RemovalDecisionAuthority.ts`'s defensive signature-verification catch gets its own stricter `SignatureVerificationFailureLogger` (never logs `error.message`). Three new regression tests, one per file, each asserting the logger fires exactly once with the expected bounded fields and that the non-blocking/fail-closed outcome is unchanged. **Adversarial proof:** reverted each of the three catch-block changes in turn, re-ran the corresponding new test, confirmed each fails; restored all three, confirmed the full backend suite passes (2346/2346).

**Android + iOS icons** — new `android/scripts/generate-launcher-icons.mjs` (zero-dependency PNG encoder, same pattern as `parent-web/scripts/generate-icons.mjs`) generates placeholder `ic_launcher.png`/`ic_launcher_round.png` at 5 densities; `AndroidManifest.xml` gains `android:icon`/`android:roundIcon`. New `ios/scripts/generate_app_icon.py` generates a 1024×1024 RGB (no alpha channel — App Store Connect rejects an icon that has one) placeholder `AppIcon.png` + `AppIcon.appiconset` (modern single-size "universal" format); new `ios/scripts/wire_app_icon_and_launch_screen.py` wires `Assets.xcassets` into the `PCA` target's Resources phase and Navigator group, sets `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` (was `""`), and enables `INFOPLIST_KEY_UILaunchScreen_Generation = YES`. Same teal/shield placeholder motif as parent-web/public-web's existing placeholders. **Verification:** Android lint re-run clean (`MissingApplicationIcon` resolved; one benign `IconLauncherShape` design-guideline advisory, non-blocking); PNG headers verified programmatically (correct dimensions, correct color type) and rendered visually; iOS pbxproj change validated structurally (see below) and against `ios/scripts/static-safety-scan.sh` (clean).

**FABLE-A033** — new `ios/scripts/wire_device_activity_monitor_shared_sources.py` adds 7 new `PBXBuildFile` entries to `PCADeviceActivityMonitor`'s Sources build phase, each referencing an already-existing `PBXFileReference` the `PCA` host target already uses (`CallbackObservationLog`, `DeviceActivityCallbackHealth`, `FamilyActivitySelectionStore`, `ShieldSafetyValidator`, `ScheduleEngine`, `ScheduleModels`, `PolicySyncSchema`) — no new file, no `PBXGroup` edit. `docs/MAC_XCODE_VALIDATION_CHECKLIST.md` Section 0 updated with the exact Compile Sources entries a real Xcode session must now confirm. **Adversarial/structural proof:** a custom validator (brace/paren balance, duplicate-object-ID detection, dangling-reference detection) run before and after each pbxproj-editing script, confirming exactly the expected object-count delta (+7 for this change, +2 for the icon wiring) and zero new structural defects; the same one pre-existing false-positive (the commentless root `PBXGroup`) present in both the before and after state, not introduced by either change.

**Real mutation harness (`tooling/mutation/run-mutation.mjs`, `check-backend-boundaries.mjs`, `mutation-scope.json`, `README.md`)** — `classifyBackendMutant` now builds (`tsc`) the mutated copy and, if it compiles, runs the real non-DB backend suite (`scripts/run-tests.mjs`) against it. A per-context environmental baseline (`establishBackendTestBaseline`) runs the suite once against the pristine copy and records which test names fail there regardless of any mutation (discovered during this pass: `test/tooling/RebuildR3DerivedLedgers.test.mjs` calls `git rev-parse HEAD` unconditionally, which fails 100% of the time in a temp directory that was never `git init`-ed); every per-mutant classification then diffs against that baseline so only NEW failures count as a kill. **Adversarial proof #1:** temporarily removed a real covering assertion (`classifyCiphertextSize(1_024) === 'SMALL'` in `backend/test/mutation/privacyBoundaries.test.mjs`) and re-ran the harness's exact mechanism standalone — it correctly reported the corresponding mutant as SURVIVED (previously KILLED with the assertion present); restored the assertion. **Adversarial proof #2 (found, not manufactured):** the harness's own first real run surfaced a genuine stale-string bug in `check-backend-boundaries.mjs` (its Fastify-logger match, `Fastify({ logger: false })`, had gone stale relative to current `buildServer.ts` since commit `b8ddf26` added a `trustProxy` option — meaning this static check's baseline gate had been silently failing for a while) and the matching `mutation-scope.json` mutant text; both fixed. Final clean run: **22 KILLED, 3 EQUIVALENT, 3 INVALID, 0 SURVIVED, 0 manifestAnomalies.**

**Unrelated fix found during regression verification** — `parent-web/package-lock.json` and `platform-admin-web/package-lock.json`: `npm audit fix` (non-breaking) resolved GHSA-2883-xcg3-v3hh (HIGH, js-yaml transitive via `eslint@8.57.0`) in both workspaces, which would otherwise have failed the `dependency-audit` CI job's `Audit parent-web/platform-admin-web dependencies` steps on this push — confirmed independent of this pass's other changes (neither `package.json` was touched; the advisory was evidently newly indexed since the 2026-09-08 CI run). Two pre-existing MODERATE `@vitest/mocker` findings remain in both (fix requires `--force`, a breaking `vitest` 5.0.0 bump) — correctly below the gate's HIGH/CRITICAL threshold, left alone.

---

## D. Requirement IDs affected

None of this pass's changes altered a tracked requirement's `SOURCE_COMPLETE`/`VALIDATED_COMPLETE` status in `docs/implementation/PCA_COMPLETION_V2_MATRIX.json`. All five IMPLEMENT_NOW items closed FABLE-ledger action items (engineering-quality/honesty fixes inside already-source-complete areas) or repository tooling, not requirement-level source gaps. `RebuildR3DerivedLedgers.mjs --check` confirms the requirement counts are unchanged and self-consistent (375 total; 313 SOURCE_COMPLETE + 2 SOURCE_COMPLETE_VALIDATION_PENDING + 25 SOURCE_COMPLETE_EXTERNAL_GATE = 340 of 369 applicable = 92.1%, matching the prior baseline exactly). FABLE-ledger IDs affected: A011, A012, A013, A031, A033, A034, A040, A050, A053 (all updated in `docs/supervision/PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv`, with the exact evidence cited above). Gap-matrix rows affected: G-41 (resolved), G-49 through G-54 (new, one per IMPLEMENT_NOW item plus the dependency-audit finding) in `docs/supervision/PCA_FINAL_GAP_MATRIX_2026-09-08.csv`.

---

## E. Test evidence (this pass, all executed on this machine)

| Suite | Result |
|---|---|
| Backend non-DB (`npm test`) | **2346/2346 pass** (0 fail) — includes 3 new FABLE-A013 regression tests, each adversarially verified |
| Backend MySQL | Not re-run this pass — no DB-touching change in scope (schema, migrations, and DB-backed code paths are untouched) |
| Android JVM full suite | **BUILD SUCCESSFUL**, all tests pass (includes 1 new FABLE-A050 regression test, adversarially verified) |
| Android lint (debug) | **BUILD SUCCESSFUL** — `MissingApplicationIcon` resolved; one benign `IconLauncherShape` advisory for the placeholder (non-blocking) |
| iOS | Not built (no Xcode in this workspace — unchanged, expected); pbxproj changes structurally validated (brace/paren balance, no duplicate object IDs, no dangling references) and against `ios/scripts/static-safety-scan.sh` (clean) |
| parent-web Vitest | Full suite, exit 0 (no failures) |
| parent-web Playwright | **92/92 pass** at `--retries=0 --workers=2` |
| platform-admin-web Vitest | Full-batch run shows the pre-existing, already-documented batch-instability pattern (56–64 of 155 tests intermittently fail in a full run); the one specific failing file checked (`tests/unit/StepUpContext.test.tsx`) passes 4/4 in isolation, confirming the documented phantom pattern per this repo's own established diagnostic procedure — zero platform-admin-web files touched this pass, so this is pre-existing test-infrastructure instability, not a regression |
| platform-admin-web Playwright | **20/20 pass** at `--retries=0 --workers=2` |
| Contracts (4 validators + tests) | All 4 validators OK; 49/49 tests pass |
| Release tooling | `Test-ReleaseGateScoping.mjs` 0 failures (run in isolation — one BILLING_FUTURE JSON-summary failure on a run made under heavy concurrent CPU load from 3 other background suites did not reproduce when re-run alone, matching this repo's own documented resource-contention pattern); `RebuildR3DerivedLedgers.mjs --check` OK; `GenerateExternalGateMatrixMd.mjs --check` OK; `RegenerateTraceabilityTables.mjs --check` OK; `ValidateFableScopeParity.mjs` PASS (234 cells); `Invoke-ReleaseGateCheck.ps1` correctly reports NOT READY for all 6 targets (PUBLIC_A, AUTH_B, PARENT_C, ANDROID_D, IOS_FUTURE, BILLING_FUTURE), each naming its real external-gate blockers, no gate weakened or bypassed |
| Repository / quality / security tooling | `Invoke-RepositoryChecks.ps1` PASS (2494 files); `Test-RepositoryChecks.mjs` PASS incl. negative control; `Invoke-QualityChecks.ps1` PASS; `Invoke-QualityToolingTests.ps1` PASS; `Invoke-SecurityChecks.ps1 -EmitDependencyInventory` PASS; `Test-SecurityChecks.mjs` PASS incl. 11 negative controls |
| Dependency audit (6 npm workspaces) | backend / parent-sdk×3: 0 vulnerabilities; parent-web / platform-admin-web: fixed (see section C) — all 6 now pass `npm audit --audit-level=high` |
| public-web | `npm run check` PASS; `npm test` 6/6 pass |
| Mutation harness (backend, real execution) | 22 KILLED / 3 EQUIVALENT / 3 INVALID / 0 SURVIVED / 0 manifestAnomalies |

---

## F. G-41 final classification

**FLAKY_WITH_ROOT_CAUSE.**

- **Code-level proof of no logical defect:** `parent-web/src/api/dev/devBillingClient.ts`'s `simulateServerPaymentConfirmation` sets `state: 'APPROVED'` and creates the invoice (`invoices = [invoice, ...invoices]`) in the same synchronous JS execution block with no `await` between them — it is logically impossible for the fixture to let the UI observe "Approved" while the invoice is missing from its in-memory store. `parent-web/src/hooks/useAsync.ts` has no caching layer that could serve stale invoice data (every mount re-fetches). No confusable "Approved" text exists elsewhere on the `CheckoutReturn` page at the relevant moment (`subscription.requestState.APPROVED` is the only string, and the pending/confirming states use distinct copy).
- **Reproduction attempt:** ran the full `billing.spec.ts` file 20 times (140 test executions total) at `--retries=0 --workers=2`, deliberately alongside the full backend test suite (~90s, genuinely CPU-heavy) running concurrently in the background — the same class of adversarial condition (repository scans running concurrently) present when the original single failure occurred. **140/140 passed, 0 failures.**
- **Precedent in the same file:** `parent-web/playwright.config.ts`'s own comment already documents fixing one prior instance of exactly this class of flake in this same spec file (switching from the Vite dev server to a prebuilt preview server, because "under this suite's fullyParallel worker load, the dev server's on-demand/HMR module compilation... caused intermittent timeouts on otherwise-correct assertions... a real flakiness source from cold-compile latency under concurrency, not a product or test defect").
- **CI evidence:** this exact spec has never failed across 3 recorded CI runs (34195289791, 34218368386, 34219540299); CI additionally runs with `retries: 1` (`playwright.config.ts`), a further backstop this local zero-retry diagnostic deliberately does not have.
- **No code change made.** The diagnostics already added in the prior pass (asserting the invoices URL and heading before the invoice row, to distinguish "navigation did not happen" from "invoice missing" on any future recurrence) are the correct hardening and are left as-is; adding a timeout/retry hack here would be exactly the kind of retry-masking this repository's own conventions warn against.

---

## G. Unresolved items (repository-side)

None outstanding from this pass's scope. All 5 IMPLEMENT_NOW items are closed and verified; G-41 is classified with a definitive root cause.

## H. External gates (unchanged by this pass)

All 39 external gates from the prior assessment remain open; none were closed, weakened, or bypassed by this pass. `Invoke-ReleaseGateCheck.ps1` re-confirms NOT READY for all 6 release targets this pass, each naming its real blockers (see section E). FABLE-A012, FABLE-A031, and the Play/App Store metadata item are now OWNER_DECISION with sharper, more actionable framing (see section C investigation summaries preserved in the workflow transcript) but remain genuinely blocked pending a human decision — no code change was made or should be made unilaterally.

## I. Future scope

Extending the real mutation-testing harness beyond backend to Parent Web (Vitest) and Android (JVM/Gradle, much heavier per-mutant cost) — not started, explicitly recorded as future scope in `tooling/mutation/README.md`.

---

## J. Exact evidence paths

- `docs/supervision/PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv` — updated rows: A011, A012, A013, A031, A033, A034, A040, A050, A053
- `docs/supervision/PCA_FINAL_GAP_MATRIX_2026-09-08.csv` — updated row G-41; new rows G-49–G-54
- `tooling/mutation/reports/current-head-mutation.json` — final clean mutation-harness report (committed)
- `tooling/mutation/README.md` — updated to describe the real backend execution path and its limitations
- `docs/MAC_XCODE_VALIDATION_CHECKLIST.md` — updated Section 0 (PCADeviceActivityMonitor Compile Sources; Assets.xcassets/AppIcon)
- This session's workflow transcript (10 parallel investigation agents) — full file:line evidence and drift-from-record findings for all 11 classified items; not copied verbatim into a repository file, since it is a process artifact rather than a durable project record, but every conclusion it reached is reflected in section B/C above and in the FABLE ledger CSV rows it fed into

---

## K. CI evidence

**Run observed for this pass's commit** (`574483852fa9c10a1c59e81399df37970eef310e`, workflow "Quality gates", run `34295015290`): **22 of 23 jobs green, iOS the only red.**

| Job | Result |
|---|---|
| Contracts validation | success |
| Backend build and unit tests | success |
| Repository quality | success |
| Security controls | success |
| Dependency vulnerability audit | success (confirms the js-yaml fix in section C works in the real CI environment, not just locally) |
| Release control integrity | success |
| parent-web unit tests (8 shards) | success (all 8) |
| platform-admin-web unit tests (4 shards) | success (all 4) |
| public-web build and content gates | success |
| Android build, lint, and unit tests | success (confirms the icon wiring + A050 fix build and lint clean in the real CI environment) |
| Web production demo-mode gate | success |
| Web real-browser e2e (Playwright, Chromium) | success |
| iOS build and unit tests | **failure — KNOWN_IOS_BLOCKER, byte-identical to every prior run.** Confirmed via the job's own annotations: `xcodebuild: error: Failed to build project PCA with scheme PCA.: Could not find test host for PCATests: TEST_HOST evaluates to "/Users/runner/.../PCA.app/PCA"` — the exact, pre-existing CI-environment limitation recorded in every prior run of this workflow, unrelated to and unaffected by this pass's FABLE-A033/A034 pbxproj changes. No new or different iOS failure was introduced. |

Every non-iOS job is green on CI for this commit, including the two jobs most directly exercising this pass's changes (Android build/lint/test — the icon wiring and the A050 fix — and Dependency vulnerability audit — the js-yaml fix).

---

**Do not treat this document as `ENGINEERING_CLOSURE_CONFIRMED`.** It is a handoff record for FABLE's independent review, not a self-certification. FABLE should independently verify the classifications in section B, the adversarial proofs cited in section C, and the CI result in section K before forming its own conclusion.
