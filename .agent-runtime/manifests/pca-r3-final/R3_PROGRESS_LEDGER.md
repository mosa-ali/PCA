# PCA R3 Progress Ledger

Generated from the completion matrix and repository evidence on 2026-08-17.

## Exact requirement counts

| Metric | Count |
|---|---:|
| Total matrix requirements | 371 |
| SOURCE_COMPLETE | 237 |
| PARTIAL | 94 |
| NOT_STARTED | 21 |
| NOT_APPLICABLE | 19 |
| UNMAPPED_PHASE_CROSSWALK_PENDING | 0 |
| Partial plus not-started | 115 |
| External-gate rows | 55 |
| Terminology audit rows | 209 |

Crosswalk control: 199 of 199 Base A-100 requirements have explicit programme/domain phases; UNMAPPED_IDS=0. These are ledger counts, not a completion claim. PARTIAL, NOT_STARTED, and UNMAPPED_PHASE_CROSSWALK_PENDING remain open until source, test, device, provider, owner, and independent-review evidence is present.

## Handoff review

- Reviewed range: abbb2f3..aa65d59
- Reviewed commits: 4cdf0ac, 6b4abd4, aa65d59
- Accepted handoff SHA: aa65d59bd1bbc0f9a31b686934b6b0708f0abf09
- Handoff verdict: VERIFIED_ACCEPTED_WITH_OPEN_BACKLOG
- PCA-FR-004A: OPTION_B / FREE_STARTER, 1 parent and 1 managed device.
- Protection states: STANDARD, PROTECTED, AUTHORIZATION_REQUIRED, NOT_SUPPORTED.
- PCA-ADD-ENR-019 remains PARTIAL; no real authorization transition is claimed.

## Validation evidence

- Android compileDebugKotlin: PASS.
- Android lintDebug: PASS.
- Android assembleDebug: PASS.
- Android full test: PASS after file-backed Robolectric tests use TRUNCATE journal mode; production database policy is unchanged.
- Parent Web typecheck, lint, test, and build: PASS.
- Parent Web test count: 49 files and 394 tests.
- Backend build and full unit/security suite: PASS, 1,495 tests. MySQL integration: BLOCKED before test start because PCA_DATABASE_URL and PCA_MIGRATION_DATABASE_URL are unset. No separate mutation command is declared in backend/package.json.
- iOS/macOS/Xcode and physical-device validation: EXTERNAL_GATE on Windows.

## Open work

- Source candidates: R3_SOURCE_BACKLOG.csv.
- Validation gaps: R3_VALIDATION_BACKLOG.csv.
- Terminology findings: R3_TERMINOLOGY_AUDIT.csv.
- Interface and dependency assumptions: R3_INTERFACE_CONTRACTS.md and R3_DEPENDENCY_GRAPH.md.





R3 Writer Wave 1 closure: six source-solvable rows moved to SOURCE_COMPLETE from executable evidence (AND-002, FR-037, FR-045, FR-031A, NFR-012, FR-123). The source backlog was reduced in that wave; ENR-019 remains partial pending the authorized Protected Mode provisioning decision.


R3 Writer Wave 2 closure: FR-040, FR-092, and FR-096 moved to SOURCE_COMPLETE from executable source/test evidence. Monitored child/device terminology was corrected in selected user-facing English/Arabic and Android surfaces; internal family authority, Family Trust Set, familyId, and E2EE terms remain unchanged.



## Writer Wave 3 closure
- PCA-FR-007: localized informed-consent summary is a distinct InvitationReady gate, with static structural proof.
- PCA-FR-044: Android status and YouTube surfaces map unsupported capabilities to localized unavailable labels, with static proof.
- PCA-FR-074A: offline travel above 50 km now produces one permission-guarded prayer-time verification notice per offline episode, with detector tests and production graph wiring.
- Counts after this wave: SOURCE_COMPLETE=237; PARTIAL=94; NOT_STARTED=21; source backlog=115.
- Focused Android gate: BUILD SUCCESSFUL; all three new test classes compiled and executed.
