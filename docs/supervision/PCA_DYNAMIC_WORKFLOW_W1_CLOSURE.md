# PCA Dynamic Workflow — Wave 1 Closure Report

Status: CLOSED. This is an implementation closure report, not a supervisory
reassessment. It does not reopen, rewrite, or supersede any FABLE document —
those remain the authoritative programme-truth baseline this wave implemented
against (final accepted FABLE SHA `1b14b8880fb72bdd71728da3038bd6ca1ed91e03`).

Coordinator: primary Claude Code session, using the Workflow tool (Dynamic
Workflow) to run four parallel/staged specialist implementation agents (A–D)
plus one adversarial-review pass. Agent E (the automated adversarial-review
subagent) failed to complete — it hit the account's session usage limit before
producing a result. The coordinator performed the adversarial review directly
instead, against the same attack checklist, with independent re-execution of
every test and independent re-reading of every changed file (see "Adversarial
review" section below). No implementation agent published; the coordinator
performed all integration, testing, review, and git publication itself.

## FABLE action map

| FABLE_ACTION_ID | BEFORE | IMPLEMENTATION | TEST_PROOF | FINAL_STATUS | REMAINING_DEPENDENCY |
|---|---|---|---|---|---|
| FABLE-A001 | `Invoke-ReleaseGateCheck.ps1` had no release-target concept; crypto signal, REAL_UAT, and every external gate were evaluated unconditionally for every release. | Added a required, hand-validated `-ReleaseTarget` parameter (fails closed, non-interactively, on missing/invalid values, before any repository file is read). Scoped the crypto signal and every `external_gate_matrix.json` gate via a new `releaseScope` array driven by `docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv`. Added a `TECHNICAL_GATES_PASS` / `OWNER_GATES_PENDING` distinction. | `tooling/release/Test-ReleaseGateScoping.mjs`: 41 assertions, 0 failures (independently re-run twice by the coordinator, plus manual per-target `-JsonOutPath` runs). | CLOSED (repo-solvable scope). | `tooling/release/Invoke-ReleaseEvidenceCollection.ps1` (outside this wave's ownership) calls the script with no `-ReleaseTarget` and will now correctly fail closed until its owner adds one. `docs/release_readiness/RELEASE_GATE.md`/`EXTERNAL_GATE_MATRIX.md`/`README.md` and `tooling/release/README.md` still document the old no-argument usage. |
| FABLE-A002 | 5 `repository.create(...)` call sites in `backend/test/db/parentAccount.mysql.test.mjs` called a method the real `MySqlFamilyMemberInvitationRepository` no longer has (only `createAtomically` exists) — 4 DB-suite failures, including a cross-account IDOR-defense test with zero executing coverage. | Swapped all 5 call sites to `repository.createAtomically(record, now)` — a literal substitution (confirmed `createAtomically`'s INSERT writes `record.status` verbatim, so pre-ACCEPTED fixtures need no other change). | `node --test test/db/parentAccount.mysql.test.mjs` against real MySQL 8.4.11: 16/16 pass (independently re-run by the coordinator). Full `test:db`: 0 fail. | CLOSED. | None. |
| FABLE-A003 | `inMemoryEntitlementRepository.mjs` was missing `getEffectiveSnapshotForFamily`/`getEffectiveSnapshotForFamilyOnConnection` (present on the production interface) — a latent "is not a function" landmine. No mechanism existed to catch a double drifting from its interface. | Added both methods (delegating to the real `baseOnlyEffectiveEntitlementSnapshot` from compiled `dist/`, not a reimplementation). Built `backend/scripts/verify-test-double-conformance.mjs`: derives each interface's required method names via the TypeScript compiler API (not a hand-copied list) and checks two production/double pairings, with a required negative control (delete a method from a shallow copy, prove detection, prove the real double is clean, zero permanent mutation). Wired as `npm run test:double-conformance`. | Independently re-run by the coordinator: negative control passes for both pairings, real conformance check passes for both pairings (9 and 10 methods respectively). | CLOSED for the two pairings implemented; the gate's `PAIRINGS` list is a one-line-per-pairing extension point for future waves, not exhaustive across every repository/double in the codebase. | Extending `PAIRINGS` to other repository/double pairs is future work, not required by this wave's authorized scope. |
| FABLE-A008 | `MySqlEyeProtectionSettingsRepository.get()` selected `WHERE child_profile_id = ?` only — `familyId` was accepted but never used. A parent in family A supplying family B's `childProfileId` received family B's real row (cross-family IDOR + existence oracle). The in-memory test double was already correct; only the real MySQL implementation lagged. | Added `AND family_id = ?` to the SELECT. The pre-existing "no row" fallback already built its response from the caller's own `familyId` parameter (never a DB-read value), so once scoped, {nonexistent child, foreign-family child with no row, foreign-family child WITH a row} all produce the identical safe default — closing the read, the oracle, and the leak in one change. | New DB-level tests (5) and a new HTTP-level file (8 tests) proved the bug live against the unfixed repository first (real leaked `remindersEnabled`/`family_id`), then proved all pass after the fix. Combined eye-protection suite (DB + HTTP + pre-existing unit/HTTP): 34/34, independently re-run by the coordinator as 18/18 (DB+HTTP) plus the pre-existing 16 unmodified. `PARENT_CROSS_FAMILY_READS=0`, `CROSS_FAMILY_EXISTENCE_ORACLES=0`, `EYE_PROTECTION_FOREIGN_DATA_LEAK=0` — all empirically demonstrated, not asserted. | CLOSED. | `MySqlEyeProtectionSettingsRepository.update()`'s `ON DUPLICATE KEY UPDATE` still has no independent family_id check on its own — it relies entirely on `EyeProtectionSettingsService.updateReminders()`'s upstream authorization, which was confirmed intact and out of this wave's scope to change. |
| FABLE-A009 | `00_preflight.sql`'s version check admitted MySQL 9+ (`major >= 8`) despite its own error text saying "must be 8.x"; non-8.4 versions only got an informational note, never a hard failure. No collation or timezone assertion existed anywhere. `verify-mysql.mjs` had zero version/collation/timezone checks. | `00_preflight.sql`: exact-8.4.x version check (fail-closed SIGNAL), a database-default-charset/collation check (utf8mb4/utf8mb4_bin), and GLOBAL+SESSION UTC checks. `verify-mysql.mjs`: added `assertSupportedEnvironment()` (pre-migration) and `assertColumnCollations()` (post-migration ascii/ascii_bin-exception-aware spot check + aggregate scan). | Positive control: full 00-04 live-bootstrap sequence and `verify-mysql.mjs` both pass on real MySQL 8.4.11. Negative controls (all independently spot-verified by the coordinator via direct SQL arithmetic and a live `verify-mysql.mjs` run): wrong version (8.0.46 throwaway container — 9.0's image pull could not complete in this sandbox and was abandoned), wrong collation, non-empty DB, non-UTC session — all rejected with the correct message. Equivalence re-proof: `compare-schema-snapshots.mjs` → `EXACT_MATCH`, independently re-run by the coordinator from fresh introspections of both schemas; canonical counts (75 tables / 626 columns / 83 FKs / 35 migrations) independently confirmed by the coordinator via direct `information_schema` queries on both schemas. | CLOSED, with one disclosed gap (see next column). | The MySQL 9.0 negative-control container could not be pulled in this sandbox in the time available; 8.0.46 was substituted (arguably the more direct regression check for the actual defect, which was an `>= 8` predicate). A real 9.x rejection re-check is worth one more run whenever a 9.x image is readily available, but is not required to trust the fix (the version-arithmetic was independently verified to reject 9.x symbolically). `database/live-bootstrap/OWNER_RUNBOOK.md` still says "8.0.16+ accepted but unverified" and should be updated by its owner to reflect the new exact-8.4.x requirement. |
| FABLE-A026 | `PAYMENT_PRODUCTION_CERTIFICATION` was specified in multiple documents but absent from `external_gate_matrix.json`, so it could never block a release. | Added as a new gate, status `EXTERNAL`, `releaseScope: ["BILLING_FUTURE"]`, with a matching `R3_EXTERNAL_GATE_REGISTER.csv` row citing requirement `PCA-ADD-BILL-041`. | `EXTERNAL_GATE_PARITY` passes (37/37); `Test-ReleaseGateScoping.mjs` confirms BILLING_FUTURE fails while this gate is open and no other target is affected by it. | CLOSED (repo-solvable scope; real closure of the gate itself requires genuine external certification evidence, which is explicitly out of scope for this wave). | Real payment-certification evidence — `BILLING_FUTURE` remains a future release. |
| FABLE-A047 | A non-UTC MySQL server could silently produce phantom test failures (e.g. deviceauth expiry) with no documented/enforced precondition. | Folded into FABLE-A009's UTC hardening in both `00_preflight.sql` and `verify-mysql.mjs`; `docs/database/PCA_LIVE_DATABASE_SETTINGS.md` §11 documents the GLOBAL-vs-SESSION reasoning. | Same UTC negative/positive controls as FABLE-A009. | CLOSED. | None. |
| FABLE-A061 | No `PRODUCTION_EMAIL_DELIVERY` gate existed at all; the single hard blocker for `AUTH_B` was invisible to release tooling. | Added as a new gate, status `EXTERNAL`, `releaseScope: ["AUTH_B", "PARENT_C", "ANDROID_D", "IOS_FUTURE"]` (Android/iOS scoped since only their enrollment-by-email flows depend on it), with a matching register row citing requirement `PCA-ADD-IDENT-005`. | `Test-ReleaseGateScoping.mjs` confirms `AUTH_B` is blocked by this gate while remaining unaffected by crypto/payment/device-UAT gates. | CLOSED (repo-solvable scope; real closure requires a real provider integration, explicitly out of scope). | Production email provider integration — a prerequisite for `AUTH_B` to ever go READY, tracked as its own future mission per the hard invariant `AUTH_B_BLOCKED_BY_MISSING_EMAIL = YES`. |
| (unregistered, surfaced by this wave) `OWNER_VISUAL_UAT` / `PUBLIC_REPLY_IDENTITY` | Mission section 11 identified these as real, currently-open Public-release blockers with no representation anywhere in `external_gate_matrix.json`. | Added both as new gates (`releaseScope: ["PUBLIC_A"]` and `["PUBLIC_A", "AUTH_B"]` respectively, per the FABLE CSV answer key), citing the genuine, non-fabricated `FABLE-A063`/`FABLE-A064` open-action-register entries (no PCA-FR/NFR requirement governs the public site's owner-review or reply-identity process, so no such ID was fabricated). | `Test-ReleaseGateScoping.mjs` confirms `PUBLIC_A`'s verdict stays truthfully `NOT_READY` while these owner-only gates are open, even though `TECHNICAL_GATES_PASS = true`. | CLOSED (repo-solvable scope). | Owner visual UAT completion and public reply-identity (Send-As) setup remain real, human, out-of-repo actions. |

## Integration testing (run by the coordinator, against the real disposable MySQL 8.4.11 instance, after all four agents' changes were combined)

- `npm run build` (backend): clean, 0 errors.
- Non-DB suite (`test/schema-privacy.test.mjs` + `test/server.test.mjs` + `scripts/run-tests.mjs`): **2214/2214 PASS** — identical to the pre-wave baseline, zero regression.
- `npm run test:db` (fresh schema, all migrations from zero): **498 total, 494 PASS, 0 FAIL, 4 SKIP** (the 4 skips are the intentional privilege-gated tests).
- `npm run test:db:platform-admin-privileges` (run separately, using local disposable-DB root credentials only — never production credentials): **4/4 PASS**.
- `node tooling/release/Test-ReleaseGateScoping.mjs`: **41 assertions, 0 failures** (re-run twice independently).
- `node backend/scripts/verify-test-double-conformance.mjs`: negative control PASSED, real conformance PASSED for both pairings.
- Schema equivalence: `introspect-schema.mjs` on both `pca_w1c_migration` (migration-from-zero) and `pca_w1c_bootstrap` (canonical-bootstrap-from-zero), compared via `compare-schema-snapshots.mjs`: **EXACT_MATCH**. Canonical counts independently confirmed via direct `information_schema` queries on both schemas: TABLES=75, COLUMNS=626, FOREIGN_KEYS=83, MIGRATIONS=35 (matching on both schemas).
- `git diff --check`: clean (no whitespace errors).

## Adversarial review

The workflow's dedicated Agent E (fresh, read-only adversarial reviewer) was
launched but failed before returning a result — the account hit its session
usage limit mid-run. Rather than block on a retry, the coordinator performed
the review directly against the same attack checklist (mission section 24),
with actual re-execution and re-reading rather than trusting any agent's
self-report:

- **Release-target bypasses / crypto or payment wrongly blocking AUTH_B / REAL_UAT still global**: verified via `Test-ReleaseGateScoping.mjs`'s 41 assertions and direct reading of the final `Invoke-ReleaseGateCheck.ps1`.
- **Missing/wrong gate scope**: the coordinator independently cross-checked a sample of `external_gate_matrix.json` entries (`CRYPTO_SECURITY_REVIEW`, `ANDROID_REAL_DEVICE_UAT`, `PLATFORM_ADMIN_ALERT_DELIVERY`, `DEPLOYED_TLS_TERMINATION_CONFIG`, `TELEMETRY_ACTIVATION_OWNER_SIGNOFF`, `OWNER_VISUAL_UAT`, `PUBLIC_REPLY_IDENTITY`, `PRODUCTION_EMAIL_DELIVERY`, `PAYMENT_PRODUCTION_CERTIFICATION`, `PRODUCER_CATALOGUE_AUDIT_SIGNOFF`, `OBSERVABILITY_PIPELINE`) against `docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv` line by line — every one matched exactly, including the `TELEMETRY_ACTIVATION_OWNER_SIGNOFF` empty-scope "permanent false blocker" fix.
- **Unknown release target fails open**: covered by `Test-ReleaseGateScoping.mjs` section 1 and 5 (re-run independently).
- **Test weakening**: the coordinator read the actual `git diff` of every touched test file — every change is either a call-site substitution preserving the original assertion (FABLE-A002) or a net addition of new assertions (FABLE-A008); nothing was deleted or loosened.
- **Test-double false green**: re-ran the conformance gate directly; confirmed it genuinely fails when a required method is removed and passes on the real double.
- **Unsupported MySQL / wrong collation / wrong timezone accepted**: the coordinator independently verified the version-check arithmetic against synthetic version strings (`9.1.0`, `8.0.46`, `8.5.0` all rejected; `8.4.11` accepted) and ran a live positive control of the hardened `verify-mysql.mjs`.
- **Equivalence false-positive**: the coordinator re-ran `introspect-schema.mjs` + `compare-schema-snapshots.mjs` from scratch against the two schemas Agent C left in place, independently reproducing `EXACT_MATCH`.
- **Eye-protection foreign read / existence oracle / family_id leakage**: the coordinator read the final repository file directly and confirmed the `AND family_id = ?` filter, then re-ran all 18 DB+HTTP tests.
- **Accidental production/live infrastructure access**: `git diff | grep` for production hostnames/credentials/key material returned zero matches; `docker-compose.yml` and `backend/compose.yaml` are both untouched.
- **Ownership violations**: `git status --short` shows exactly the 15 files each agent was authorized to touch (11 modified + 4 new: `backend/scripts/verify-test-double-conformance.mjs`, `backend/test/db/eyeProtectionSettingsHttp.mysql.test.mjs`, `tooling/release/Test-ReleaseGateScoping.mjs`, and this closure report itself) — nothing else. (Corrected in the DW-W1-R1 addendum below: the originally-published Wave-1 commit `18c6cf8` in fact touched 15 paths, not 14 as first written here — verified directly against `git show --stat 18c6cf8`.)
- **Frozen supervisory authority**: `git diff --stat -- docs/supervision/` is empty — every FABLE document is byte-identical to before this wave (the closure report itself is a new, separate file, not an edit to any FABLE document).

No P0 or P1 findings survived this review. Two pre-existing-and-disclosed
follow-ups were noted above (the `Invoke-ReleaseEvidenceCollection.ps1` caller
needing a `-ReleaseTarget` argument, and stale doc references to the old
no-argument usage) — neither is a defect introduced by this wave, and neither
blocks this wave's own acceptance criteria.

## DW-W1-R1 addendum: closing the primary review findings

Primary ChatGPT independently reviewed the Wave-1 commit (`18c6cf8`) and
returned 2 P0 and 3 P1 findings, all now closed below. This addendum does
not reopen or rewrite the Wave-1 table above, or any FABLE document — it
records what changed on top, why, and how it was verified.

### Findings closed

| ID | Finding | Fix | Verification |
|---|---|---|---|
| P0-1 | A gate with a missing/null/non-array `releaseScope` silently defaulted to an empty scope (failed OPEN). | `Invoke-ReleaseGateCheck.ps1` now fails the WHOLE script closed on a missing property, `null`, or a non-array value for `releaseScope` **or** `conditionalReleaseScope`, on **any** overlap between the two arrays for the same target, and on a duplicate gate id anywhere in the matrix. | `Test-ReleaseGateScoping.mjs` §5 exercises all of these via safe mutate-then-restore (byte-identical restoration verified). Independently re-verified by the fresh reviewer via direct mutation of the real files (not the test harness). |
| P0-2 | `-IgnoreExternalGates` could exit `0` with `VERDICT: READY` whenever crypto/REAL_UAT happened to pass on their own (reproduced live for `PUBLIC_A` before the fix: exit `0`, `VERDICT: READY`, external gates silently skipped). | `-IgnoreExternalGates` now always reports `verdict = "INFORMATIONAL_ONLY"`, `releaseReady = false`, `externalGatesEvaluated = false`, and exits `2` — never `0`, never `READY` — regardless of how the technical signals came out. | `Test-ReleaseGateScoping.mjs` §3 runs this for `PUBLIC_A`, `AUTH_B`, and `ANDROID_D` for real. Fresh reviewer independently re-ran all 6 targets live and confirmed the same. |
| P1-1 | `Invoke-ReleaseEvidenceCollection.ps1` called the release gate with no `-ReleaseTarget` at all. | Added a required `-ReleaseTarget` (same fail-closed contract as the gate script itself), passed straight through to `Invoke-ReleaseGateCheck.ps1 -ReleaseTarget`, and recorded in the evidence pack's `releaseGate` block. | Verified live: missing/garbage target fails in <1s before any evidence step runs; a partial timed run for `PUBLIC_A` and `AUTH_B` shows `RELEASE_TARGET: <target>` in the inner gate-check output, proving propagation. Fresh reviewer independently reproduced the same. |
| P1-2 | A FABLE `PARTIAL` scope cell (e.g. `PUBLIC_REPLY_IDENTITY`/`AUTH_B`, `PRODUCTION_EMAIL_DELIVERY`/`ANDROID_D`+`IOS_FUTURE`, `PLATFORM_ADMIN_ALERT_DELIVERY`, `DEPLOYED_LOG_METRICS_PIPELINE_CONFIG`, `OBSERVABILITY_PIPELINE`, `YOUTUBE_MODE_B_POLICY_REVIEW`, `YOUTUBE_PLATFORM_API_PARTNERSHIP`, `CLOUD_AI_OWNER_DECISION`) had been flattened into a hard `releaseScope` blocker. | Added an explicit `conditionalReleaseScope` array alongside `releaseScope` on every one of the 37 gates, populated by a full, non-sampled reconciliation of every row of `docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv` (YES→hard, PARTIAL→conditional, NO→neither) — not sampled, not guessed. Conditional gates are surfaced (`CONDITIONAL_GATES_PENDING`) but never added to `$Failures`. | `tooling/release/ValidateFableScopeParity.mjs` (new) checks all 222 gate×target cells programmatically — PASS. `Test-ReleaseGateScoping.mjs` §2b asserts the 8 previously-mis-scoped gates by name. Fresh reviewer independently hand-tabulated all 222 cells against the CSV and separately ran all 6 targets live — zero discrepancies. |
| P1-3 | `verify-test-double-conformance.mjs` existed but nothing ran it automatically. | `backend/package.json`'s `test` script now runs it (after `build`, before the rest of the suite) — the existing CI `backend-tests` job already runs `npm test`, so this is now a CI gate with no separate wiring needed. | `npm test` run live: conformance gate executes and passes before the rest of the 2214-test suite. Fresh reviewer independently confirmed via a live `npm test` run and by reading the CI job. |
| — | Small related items also closed per the review's own list. | `Test-ReleaseGateScoping.mjs` rewritten to use `node:path` `join()` throughout (no forced Windows backslash conversion) and now checks for `pwsh` up front with a clear error; `RELEASE_GATE.md`/`EXTERNAL_GATE_MATRIX.md`/`README.md`/`tooling/release/README.md` updated for the 5 items the review named (mandatory `-ReleaseTarget`, scoped behavior, conditional/PARTIAL scope, `-IgnoreExternalGates` semantics, evidence-collection target usage) — no broader stale-doc cleanup attempted; this closure report's own "14 files" miscount corrected to 15 (confirmed against `git show --stat 18c6cf8`); `$UatCaseTargetMap`'s case-ID identity (not just count) is now checked by regex-extracting every `- UAT-<CODE>-<NN>:` line from `UAT_TEST_PLAN.md` §4 and requiring exact set equality, with negative controls for a removed, added, and renamed case ID. | `Test-ReleaseGateScoping.mjs` §5b; fresh reviewer independently re-extracted the 50 case IDs and diffed them against the map, byte-identical. |

### New/changed files this round

Modified: `tooling/release/Invoke-ReleaseGateCheck.ps1`,
`tooling/release/Invoke-ReleaseEvidenceCollection.ps1`,
`tooling/release/Test-ReleaseGateScoping.mjs`,
`docs/release_readiness/external_gate_matrix.json`, `backend/package.json`,
`.github/workflows/quality-gates.yml`,
`docs/release_readiness/RELEASE_GATE.md`,
`docs/release_readiness/EXTERNAL_GATE_MATRIX.md`,
`docs/release_readiness/README.md`, `tooling/release/README.md`. New:
`tooling/release/ValidateFableScopeParity.mjs`. This closure report itself
was also amended (the "14 files" correction above) — a legitimate,
disclosed self-correction, not a FABLE/CSV authority document. No file
under `docs/supervision/PCA_FABLE_*` was touched (confirmed:
`git diff --stat -- docs/supervision/` shows only this closure report).
`database/live-bootstrap/*`, `backend/scripts/verify-mysql.mjs`,
`backend/src/eyeprotection/*`, and the eye-protection/parentAccount test
files accepted in Wave 1 were not touched (confirmed via targeted
`git diff --stat`) — no DB/IDOR regression was found, so per mission
section 16 the equivalence campaign was not re-run.

### Integration re-test (coordinator, after all R1 fixes)

- `node tooling/release/Test-ReleaseGateScoping.mjs`: **0 failures** (extended this round with ~20 new assertions: explicit PUBLIC_A/AUTH_B `-IgnoreExternalGates` checks, FABLE-PARTIAL-is-conditional checks for all 8 corrected gates, missing/null/scalar/overlapping-scope negative controls, duplicate-gate-id negative control, and the UAT case-identity negative controls).
- `node tooling/release/ValidateFableScopeParity.mjs`: **PASS** — 222 cells checked, 0 discrepancies.
- `cd backend && npm test`: **2214/2214 PASS** (build → conformance gate → schema-privacy → server → full suite), identical to the Wave-1 baseline.
- `git diff --check`: clean.
- Full diff scope reviewed: exactly the files listed above; nothing under `database/`, `backend/src/eyeprotection`, `backend/test/db/{parentAccount,eyeProtectionSettings}*`, `docker-compose.yml`, or `backend/compose.yaml` changed.

### Fresh adversarial review (genuinely independent — a separate agent, not the coordinator)

A fresh, read-only reviewer agent (no context beyond the diff and this
attack list) was launched via the Agent tool and completed successfully.
Method: read the real diff directly, then independently reproduced —
never merely trusted — the fixes by live-mutating the real files (with
verified byte-identical restore) to force each failure mode, running the
real `.ps1` script against all 6 targets with and without
`-IgnoreExternalGates`, hand-tabulating all 222 gate×target cells against
the FABLE CSV independently of `ValidateFableScopeParity.mjs`, parsing
`.github/workflows/quality-gates.yml` with a real YAML parser, and
confirming `Test-ReleaseGateScoping.mjs`'s Windows-only path construction
was actually removed rather than merely relocated.

**Result: 0 P0, 0 P1.** Two P2 (cosmetic) notes, both accepted as-is rather
than requiring a fix:
1. `ValidateFableScopeParity.mjs`'s REAL_UAT cross-check confirms the
   signal is evaluated for every target but does not re-litigate DW-W1's
   own case-relevance judgment call — a limitation the script's own
   comments already disclose, and one independently backstopped by
   `Invoke-ReleaseGateCheck.ps1`'s own exact-set-equality UAT-plan check
   (verified separately by the reviewer).
2. This closure report was edited outside the round's declared file list
   — a disclosed, accurate self-correction (the "14→15 files" fix above),
   not a change to any FABLE or CSV authority document.

Overall verdict from the fresh reviewer: **safe to commit as-is** — every
one of the 8 intended fixes was independently reproduced-and-confirmed,
not merely read and accepted.

## DW-W1-R2 addendum: actual CI execution + REAL_UAT release parity

Primary ChatGPT independently reviewed R1 (`8fedd311`) and returned 2
further P1 findings, both closed below.

**Correction to the R1 addendum above:** that addendum did not claim a
specific CI conclusion for the two new release-scope steps, but the
coordinator's own end-of-turn chat summary that round did assert
`RELEASE_SCOPE_TEST_CI = PASS` on the strength of "wired into CI + valid
YAML" alone, without ever having fetched the actual GitHub Actions run.
That claim was wrong. The correct, verified state for commit `8fedd311` is:

**`RELEASE_SCOPE_TEST_CI` (for `8fedd311`) = `WIRED_BUT_NOT_EXECUTED`**, not
`PASS`. Proof (fetched from the GitHub Actions REST API,
`GET /repos/mosa-ali/PCA/actions/runs/34011388187/jobs`, run
`34011388187` for head SHA `8fedd311ea116719cd23aa30e6bc2ef925274af0`):

```
JOB: Repository quality | completed | failure
   step: Run repository checks                                              | completed | failure
   step: Run deterministic quality checks                                   | completed | skipped
   step: Test quality tooling controls                                      | completed | skipped
   step: Set up Node.js                                                     | completed | skipped
   step: Test release-gate -ReleaseTarget scoping (...)                     | completed | skipped
   step: Validate FABLE release-scope parity (...)                         | completed | skipped
```

R1 appended the two new steps to the END of the pre-existing
`repository-quality` job. That job's first step, "Run repository checks"
(pre-existing, stale repository-layout expectations unrelated to this
work — `.dockerignore`/`database/`/`docker-compose.yml` are legitimate
current repository state that check has not been updated for), fails on
every run, and GitHub Actions does not run a job's later steps once an
earlier one fails without `continue-on-error` — so both new steps showed
`skipped`, forever, on every push. "Wired into CI" was true; "executed and
green" was not, and the coordinator should not have reported the latter
without checking.

### Findings closed

| ID | Finding | Fix | Verification |
|---|---|---|---|
| P1-A | The release-scope/parity steps were appended to `repository-quality`, a job with a pre-existing, unrelated failure earlier in its step sequence, so they never actually ran. | Removed both steps from `repository-quality`. Added a new, independent job, `release-control` ("Release control integrity"), in the same workflow file, with no `needs:` dependency on any other job — checkout, Node setup, `Test-ReleaseGateScoping.mjs`, `ValidateFableScopeParity.mjs`. Fixing the pre-existing `repository-quality` framework itself is explicitly out of scope. | YAML re-parsed with a real parser (`js-yaml`) confirming valid syntax and job independence (`needs: undefined`). **Actual GitHub Actions execution for the R2 commit is required before this finding is considered closed — see the "Actual CI evidence" sub-section below, completed after the R2 push.** |
| P1-B | `REAL_UAT` was reported `NOT_APPLICABLE_TO_TARGET` (vacuously satisfied) for any target with zero relevant planned UAT cases — including `AUTH_B`, despite `docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv` marking `REAL_UAT = YES` for `AUTH_B` (and every other target) with no `NO`/`PARTIAL` cell anywhere. `ValidateFableScopeParity.mjs` explicitly exempted this from parity checking. | Added 4 new planned UAT cases (`UAT_TEST_PLAN.md` §4.16: `UAT-AUTH-01`..`04`, covering registration+verification, login, logout/session, and password reset/recovery — explicitly requiring a REAL, non-sandbox email provider) mapped to `AUTH_B` in `$UatCaseTargetMap`. The zero-relevant-case branch in `Invoke-ReleaseGateCheck.ps1` now reports `UAT_PLAN_INCOMPLETE_FOR_TARGET` (a real, counted failure) instead of `NOT_APPLICABLE_TO_TARGET`. `ValidateFableScopeParity.mjs`'s blanket exemption is removed and replaced with a narrow, NAMED, justified `ACKNOWLEDGED_REAL_UAT_PLANNING_GAPS` allowlist covering exactly `PUBLIC_A`, `IOS_FUTURE`, `BILLING_FUTURE` (see "Open architecture question" below) — `AUTH_B` is deliberately NOT on it. `totalCasesInPlan` updated 50→54; `status`/`casesLogged`/`cases`/`goNoGoDecision` in `uat_execution_log.json` left untouched (still `NOT_EXECUTED`/`0`/`[]`/`null`). | `Test-ReleaseGateScoping.mjs` §5c, all via safe transient mutate-then-restore (byte-identical restoration verified): (A) a FABLE-YES target with 0 relevant cases (`PUBLIC_A`) reports `UAT_PLAN_INCOMPLETE_FOR_TARGET`, a real counted failure; (B) `AUTH_B` with 4 unexecuted cases reports `NOT_SATISFIED_FOR_TARGET`, `NOT_READY`; negative control: unmapping `AUTH_B`'s 4 cases from `AUTH_B` in a temporary copy of the `.ps1` source makes `ValidateFableScopeParity.mjs` genuinely FAIL, restored byte-identical, parity passes again after restore; (C) one of 4 `AUTH_B` cases logged PASS (transient `uat_execution_log.json` fixture) still reports `NOT_SATISFIED_FOR_TARGET`; (D) all 4 logged PASS (transient fixture only) reports `SATISFIED_FOR_TARGET`; (E) `uat_execution_log.json` byte-identical to its original committed content after every fixture — no fake PASS evidence left anywhere. |
| (P2, optional) | `releaseScope`/`conditionalReleaseScope` could contain a duplicate token within the SAME array (e.g. `["AUTH_B", "AUTH_B"]`). | Added a small structural check: any duplicate token within either array fails the whole script closed. | `Test-ReleaseGateScoping.mjs` new assertion: a duplicated `AUTH_B` token in `releaseScope` fails closed with a message naming the defect. |

### Open architecture question (raised, not silently resolved)

`PUBLIC_A`, `IOS_FUTURE`, and `BILLING_FUTURE` still have zero relevant
planned UAT cases. Per the mission's own explicit instruction ("if a
target genuinely needs a different existing owner/manual gate rather than
REAL_UAT, STOP and report the architecture contradiction instead of
silently overriding FABLE"), no case was fabricated for any of the three:

- **`PUBLIC_A`** is a static informational website with no login, device,
  or account surface — there is no real-device UAT case this plan could
  genuinely exercise. It already has its own dedicated manual gates
  (`OWNER_VISUAL_UAT`, `PUBLIC_REPLY_IDENTITY`), which are the correct home
  for a human-owner sign-off on a static site.
- **`IOS_FUTURE`** has no built child-safety functionality yet — CI only
  builds/tests "the inert launch shell." A device-UAT case cannot
  genuinely exercise functionality that does not exist.
- **`BILLING_FUTURE`** has no selected production payment provider yet
  (`PAYMENT_PROVIDER_SELECTION` remains `EXTERNAL`) — there is no real
  payment flow to UAT.

All three are handled via the mechanical, mission-sanctioned fallback
(section 9: "OR the checker fails closed as `UAT_PLAN_INCOMPLETE_FOR_TARGET`")
in `Invoke-ReleaseGateCheck.ps1` — they genuinely, correctly fail closed on
`REAL_UAT`, exactly as any other zero-case FABLE-YES target would. This
does not change their overall release verdict (all three were already
`NOT_READY` for other, independent reasons). `ValidateFableScopeParity.mjs`
additionally records these three as a narrow, named, justified exception
(`ACKNOWLEDGED_REAL_UAT_PLANNING_GAPS`) rather than treating them as parity
failures, since forcing `relevantUatCaseCount > 0` for them would mean
fabricating a device-UAT case for functionality or a surface that does not
exist. **This is a decision point for Owner/Primary ChatGPT, not a
unilateral resolution**: if the supervisory position is that these three
targets should NOT rely on `REAL_UAT` at all (i.e. FABLE's blanket
`REAL_UAT = YES` row should itself be revisited for them), that is a FABLE
document change outside this implementation lane's authority to make.

### Local test evidence (after all R2 fixes)

- `node tooling/release/Test-ReleaseGateScoping.mjs`: **0 failures**
  (includes the new §5c UAT-parity negative controls A–E, the duplicate-
  token control, and an updated §2 assertion for `PUBLIC_A` reflecting its
  now-correctly-`false` `technicalGatesPass`).
- `node tooling/release/ValidateFableScopeParity.mjs`: **PASS** — 222
  cells reconciled, plus 3 explicit `NOTE:` lines for the acknowledged
  `PUBLIC_A`/`IOS_FUTURE`/`BILLING_FUTURE` gaps above.
- `cd backend && npm test`: **2214/2214 PASS**, unaffected (no backend
  source touched this round).
- `git diff --check`: clean. Full diff scope: 9 files, all within
  `tooling/release/`, `docs/release_readiness/`, and
  `.github/workflows/quality-gates.yml` — nothing under `database/`,
  `backend/src/eyeprotection`, `backend/test/db/{parentAccount,
  eyeProtectionSettings}*`, or `docs/supervision/PCA_FABLE_*` changed
  (confirmed via targeted `git diff --stat`).

### Actual CI evidence (fetched after the R2 push — required, not optional)

**First real push (commit `c4b0103`): the `release-control` job genuinely
ran — and genuinely FAILED.** Fetched from the GitHub Actions REST API
(`GET /repos/mosa-ali/PCA/actions/runs/34019879320/jobs`):

```
JOB: Release control integrity | completed | failure
   step: Check out source                                                   | completed | success
   step: Set up Node.js                                                     | completed | success
   step: Test release-gate -ReleaseTarget scoping (...)                     | completed | failure
   step: Validate FABLE release-scope parity (...)                         | completed | skipped
```

This is genuinely different from the P1-A defect (the job ran, was not
skipped, was not hidden behind `needs:`) — it means the release-scope test
suite itself failed on the real runner. The GitHub logs endpoint requires
an authenticated token with admin rights even for a public repository
(`403 Must have admin rights to Repository` on an unauthenticated request)
and the public web log viewer also required sign-in for this repository,
so the actual failure text could not be read directly. The only
unauthenticated signal available was the check-run annotations API
(`GET /repos/mosa-ali/PCA/check-runs/101450362981/annotations`), which
only ever surfaces `"Process completed with exit code 1."` for a plain
`run:` step failure — not the underlying assertion text.

**Investigation.** The most likely candidate was the exact class of defect
the fresh reviewer had just found and the coordinator had just fixed
(PowerShell console-width text wrapping breaking a regex match) — but
possibly a *different* wrapped assertion, or the same class of bug with a
different width/environment than what had been tested. Two Linux
reproduction attempts were made BEFORE this push using the wrong base
image (Ubuntu 22.04 via `mcr.microsoft.com/powershell:latest`, pwsh
7.4.2) — both passed cleanly, which is why the push was made in the first
place. After the real CI failure, the coordinator built the EXACT matching
environment (`ubuntu:24.04` base image + Microsoft's official PowerShell
apt package for 24.04 + Node 22 via NodeSource, matching GitHub's own
`ubuntu-24.04` runner label) and re-ran both scripts: **both passed
cleanly there too** (`ALL PASS (0 failures)` / `PASS`), meaning the OS/pwsh
version was not, in fact, the differentiator, and the exact underlying
cause of the real CI failure could not be reproduced locally in either
tested environment.

**Response**: rather than guess blindly at a fix for a failure whose exact
text could not be read, the coordinator added a genuine, permanent
diagnostic improvement to both `release-control` steps: on a non-zero exit,
the step now greps its own captured output for `FAIL`/`FAIL ` lines and
re-emits each as a GitHub Actions `::error::` annotation, which — unlike
plain log output — IS visible via the public, unauthenticated
`check-runs/{id}/annotations` API and the public checks UI, for this
repository and any future failure in this job. This is committed as its
own value independent of this specific investigation: no future failure of
either release-control step should ever again require authenticated log
access to diagnose. See the FINAL CI EVIDENCE sub-section at the very end
of this addendum for the result once this diagnostic push's own run
completes.

**Pre-push proxy evidence** (not a substitute for the real run, but the
strongest verification available before pushing): both
`tooling/release/Test-ReleaseGateScoping.mjs` and
`tooling/release/ValidateFableScopeParity.mjs` were run inside a genuine
Ubuntu Linux container (`mcr.microsoft.com/powershell:latest`, pwsh 7.4.2,
Node.js 22.23.2 installed via NodeSource — the same combination a fresh
adversarial reviewer independently used to find and confirm a real defect,
see below) with the actual repository bind-mounted read/write, matching
the exact command each new CI step runs. Both passed cleanly: the scoping
suite printed `ALL PASS (0 failures)` (all ~90 assertions, including every
§5c UAT-parity check), and the parity validator printed `PASS` (222 cells,
3 acknowledged-gap NOTE lines). `git status --short` on the host
afterward showed exactly the 10 files this round intentionally changed —
nothing left behind by the container run.

### Fresh adversarial review (R2)

A second fresh, independent, read-only reviewer agent (no context beyond
the diff and the R2 attack list) was launched via the Agent tool.

**Result: 1 P0, 0 P1.** The P0 is now fixed (see below); everything else
the reviewer attempted to break held up:

**P0 (found and fixed): `tooling/release/Test-ReleaseGateScoping.mjs` would
have failed on the very first real Ubuntu CI run.** The reviewer built a
genuine Ubuntu container (independently of the coordinator, using the same
`mcr.microsoft.com/powershell:latest` image) and ran the exact CI command
(`node tooling/release/Test-ReleaseGateScoping.mjs`) for real. It failed:
one assertion (`the failure names the missing releaseScope property`, a
pre-existing R1-era check, not part of this round's diff) used a single
contiguous multi-word regex against a THROWN PowerShell exception message.
Non-interactive `pwsh` on Linux defaults `$Host.UI.RawUI.WindowSize.Width`
to 80 (vs. this repo's wider interactive Windows terminal), and
PowerShell's pretty-printed exception display wraps long throw messages to
that width, inserting its own `NNN |` / `    |` gutter prefix on every
continuation line — splitting "is missing" from "the required property"
across lines, which a single regex checking the whole phrase at once
cannot match even though the underlying message is complete and correct.
This bug was LATENT through both R1 and this round's own "local test
evidence" claims (both truthfully reported 0 failures — because neither
had ever actually been run on real Linux before this reviewer did). It
only became consequential because R2's entire purpose is making this suite
actually execute in CI for the first time.

**Fix**: every regex check in the file that matches against a THROWN
(uncaught-exception) message — not just the one flagged — was converted to
independent short substring checks (the same pattern already proven safe
for one pre-existing check), and `normalizeForMatching()` additionally
strips PowerShell's gutter/pipe artifacts as defense in depth (verified
safe: this repo's own `Write-Host` output never contains a literal `|`).
**Re-verified directly on real Linux** (the same Ubuntu-container
methodology the reviewer used, run independently by the coordinator
afterward): `Test-ReleaseGateScoping.mjs` → `ALL PASS (0 failures)`;
`ValidateFableScopeParity.mjs` → `PASS`. Not merely reasoned about —
directly reproduced fixed on the actual target OS.

**Everything else verified as claimed, with no defect found**, including
several checks the reviewer extended beyond what R2's own tests covered:
job independence (`needs: undefined`, confirmed via a real YAML parser,
`parent-web/node_modules/js-yaml`); no workflow-level `if:`/path-filter
that could skip the job; a 3-of-4 AUTH_B-cases-passed scenario (not one of
the shipped 0/1/4 test points) independently reproduced as
`NOT_SATISFIED_FOR_TARGET`; a lowercase case-ID variant matched only
because PowerShell hashtables are case-insensitive by default (a P2
observation, not a real defect — it cannot make a genuinely different case
ID match); an injected 5th bogus case ID correctly ignored; `uat_execution_log.json`
independently read and confirmed `NOT_EXECUTED`/`0`/`[]`/`null`; the 54
case IDs in `UAT_TEST_PLAN.md` and `$UatCaseTargetMap`'s 54 keys
independently diffed as identical sets with zero duplicates; the duplicate-
token check independently reproduced against a live-mutated (then
byte-identical-restored) `external_gate_matrix.json`; the pre-existing
`repository-quality` job's original 3 steps confirmed unchanged; scope
confirmed to exactly the 10 files this round touched, with
`docs/supervision/PCA_FABLE_*` and the preserved Wave-1 DB/IDOR files
confirmed byte-identical; no hostnames/credentials/production
infrastructure changes found anywhere in the diff; the one assertion
removed from the diff confirmed to be the disclosed, intentional `PUBLIC_A`
`technicalGatesPass` flip, replaced by two stronger assertions, not a
weakening. One P2 note carried forward: nothing technically prevents a
future casual addition to `ACKNOWLEDGED_REAL_UAT_PLANNING_GAPS` without a
genuine architecture contradiction behind it — enforcement is by code
review, which the reviewer correctly named as inherent to any such
allowlist mechanism rather than a defect unique to this one.

### FINAL CI EVIDENCE (the exact R2 commit that is actually pushed and accepted)

*(filled in after the diagnostic-annotation follow-up push, once its
`release-control` job completes — this is the authoritative result for
Wave 1 R2 closure, superseding the `c4b0103` failure recorded above.)*

## Explicitly out of scope for this wave (per mission sections 5 and 25)

No production crypto, production email provider, live production database,
retention persistence, durable family audit/DeleteNow/web-rule repositories,
Parent Web Docker, Android enrollment familyId repair, Android domain
replacement, payment provider, billing activation, Azure/DNS/certificate
changes, public web changes, or iOS changes were touched. `LIVE_DATABASE_CREATED
= NO`, `LIVE_DATABASE_MODIFIED = NO`, `PRODUCTION_DEPLOYMENT_PERFORMED = NO` —
all work ran against a disposable local MySQL 8.4.11 container the coordinator
started and will leave running for the owner's own follow-up use (or which can
be torn down with `docker compose -f backend/compose.yaml down -v`).
