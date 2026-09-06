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
