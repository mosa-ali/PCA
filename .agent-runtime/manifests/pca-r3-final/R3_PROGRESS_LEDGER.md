# PCA R3 Progress Ledger

Generated from the completion matrix and repository evidence on 2026-08-18.

## Exact requirement counts

| Metric | Count |
|---|---:|
| Total matrix requirements | 375 |
| SOURCE_COMPLETE | 263 |
| PARTIAL | 74 |
| NOT_STARTED | 19 |
| NOT_APPLICABLE | 19 |
| UNMAPPED_PHASE_CROSSWALK_PENDING | 0 |
| Partial plus not-started | 93 |
| External-gate rows | 45 |
| Terminology audit rows | 209 |

Crosswalk control: 199 of 199 Base A-100 requirements have explicit programme/domain phases; UNMAPPED_IDS=0. These are ledger counts, not a completion claim. PARTIAL, NOT_STARTED, and UNMAPPED_PHASE_CROSSWALK_PENDING remain open until source, test, device, provider, owner, and independent-review evidence is present.

## Handoff review

- Reviewed range: 2937ad7..8002643
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
- Parent Web typecheck: PASS; lint: PASS from the prior focused validation; test/build: RUNNER_ENVIRONMENT_BLOCKED (spawn EPERM).
- Parent Web test count: 49 files and 394 tests.
- Backend build and focused parent-control tests: PASS; full worker-mode suite is RUNNER_ENVIRONMENT_BLOCKED (spawn EPERM), and disposable MySQL validation is NOT_EXECUTED.
- iOS/macOS/Xcode and physical-device validation: EXTERNAL_GATE on Windows.

## Open work

- Source candidates: R3_SOURCE_BACKLOG.csv.
- Validation gaps: R3_VALIDATION_BACKLOG.csv.

## Additive owner-controlled Wave 7: night lock and communication safety

Owner decision `PCA-NIGHT-COMMUNICATION-SAFETY-1` adds four controlled requirements and changes the controlled denominator from 371 to 375. The source contracts now cover the cross-midnight 21:30-07:00 baseline, a distinct non-emergency communication exception that pauses Break Shield recovery, and resolved communication-surface tokens without an OEM dialer assumption. Android source tests cover the pure boundaries; real call/SMS behavior, iOS public-capability limits, and physical-device enforcement remain separate gates. New rows: `PCA-FR-043B`, `PCA-FR-043C`, `PCA-FR-015A`, `PCA-AND-003A`.
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

## Writer Wave 4 reconciliation
- PCA-FR-002: independently closed at source level from the real parent-side QR renderer, bounded invitation lifecycle, Android deep-link parser, and focused component/unit/MySQL evidence. This does not close PCA-ADD-ENR-002, whose short fallback code is still absent.
- PCA-FR-014A: independently closed at source level from paired English/Arabic Break Shield resources, resource-driven rendering, and locale/resource-completeness evidence. Content-pack governance remains under PCA-FR-014.
- PCA-FR-121: independently closed at source level from the routed What Parents Can See page, English/Arabic disclosure content, and the real axe accessibility test.
- PCA-PRIV-002: independently closed at source level from the no-telemetry route regression guard and Android no-egress/privacy static coverage. PCA-NFR-014 remains open because optional aggregate telemetry consent is a separate requirement and is not implied by the absence of a transport.
- PCA-FR-101: independently closed at source level from the real `1_MONTH` default route, parent retention presentation, and route/accessibility evidence; browser session issuance and production validation remain separate gates.
- Counts after this reconciliation: SOURCE_COMPLETE=242; PARTIAL=89; NOT_STARTED=21; source backlog=110. Validation remains separate: the five closures are marked `SOURCE_COMPLETE_VALIDATION_PENDING`.

### Wave 4 validation and gate evidence (2026-08-17)

- Validation backlog reconciliation: all 202 validation rows were compared with the requirement audit; 1 stale status was aligned and 65 stale validation states were normalized to `SOURCE_COMPLETE_VALIDATION_PENDING` where the source audit is complete. Validation remains a separate gate and no external or real-device result was fabricated.
- Local release/UAT gate launcher: `pwsh tooling/release/Invoke-ReleaseGateCheck.ps1` ran and returned exit 1 with `VERDICT: NOT READY`. It reported `REAL_UAT: NOT_EXECUTED (0/50 cases logged)`, pending production crypto review, and the documented external gates. This is the expected honest result; it is not real-device UAT evidence.
- Source backlog classification after the five closures:

| SOURCE_SOLVABLE_CLASS | CURRENT_STATUS | ROWS |
|---|---:|---:|
| EXTERNAL_GATE | NOT_STARTED | 5 |
| EXTERNAL_GATE | PARTIAL | 28 |
| OWNER_OR_ENVIRONMENT_GATE | PARTIAL | 20 |
| SOURCE_TRIAGE_REQUIRED | NOT_STARTED | 16 |
| SOURCE_TRIAGE_REQUIRED | PARTIAL | 41 |
| **Total** |  | **110** |

## Writer Wave 5 source implementation

- PCA-ADD-ENR-002: added a SHA-256-derived 12-character display-only fallback identifier to the one-time parent enrollment reveal, with English/Arabic labels and copy support. It is never persisted and is not accepted as an enrollment credential.
- PCA-ADD-ENR-003: added focused privacy coverage proving the fallback identifier does not expose family data or the full raw bearer token; the full token remains the only authorization path.
- Focused Parent Web gate: `DeviceEnrollmentPanel.test.tsx`, 10 tests passed. Existing React `act(...)` warnings from asynchronous QR/panel updates remain non-failing test hygiene findings.
- Counts after this implementation: SOURCE_COMPLETE=244; PARTIAL=87; NOT_STARTED=21; source backlog=108. Validation remains separate: the two closures are marked `SOURCE_COMPLETE_VALIDATION_PENDING`.
- Source backlog classification now: `EXTERNAL_GATE/NOT_STARTED=5`, `EXTERNAL_GATE/PARTIAL=28`, `OWNER_OR_ENVIRONMENT_GATE/PARTIAL=20`, `SOURCE_TRIAGE_REQUIRED/NOT_STARTED=16`, `SOURCE_TRIAGE_REQUIRED/PARTIAL=39`; total `108`.

## Writer Wave 6 retention implementation

- PCA-FR-093: the Parent Web retention panel now exposes the real family retention policy contract and preserves the authenticated backend boundary.
- PCA-FR-102: the panel now exposes `CURRENT_LAST_ONLY` or a separate location-history window; windows longer than general retention are disabled in the UI and rejected by the backend.
- Focused validation: Parent Web retention component tests `2/2` passed; backend retention route tests `17/17` passed; backend TypeScript build passed.
- Counts after this implementation: SOURCE_COMPLETE=246; PARTIAL=89; NOT_STARTED=21; source backlog=110. Validation remains separate: the two closures are marked `SOURCE_COMPLETE_VALIDATION_PENDING`.
- Source backlog classification now: `EXTERNAL_GATE/NOT_STARTED=5`, `EXTERNAL_GATE/PARTIAL=28`, `OWNER_OR_ENVIRONMENT_GATE/PARTIAL=20`, `SOURCE_TRIAGE_REQUIRED/NOT_STARTED=16`, `SOURCE_TRIAGE_REQUIRED/PARTIAL=41`; total `110`.

### Wave 8 correction: night communication safety

Reviewed commit range 35cb793..9b34f72 and corrected the source slice without changing the controlled total or four requirement statuses. The 21:30-07:00 owner baseline is always unioned with parent BEDTIME windows; answered-call timing is the only Break Shield pause; SMS delivery is not a generic interactive allowlist; and the public Android call observer is permission-gated, idempotent, and composed through PcaRuntime. FR-043B remains PARTIAL because a real per-app/device enforcement consumer is not present; physical telephony/SMS, iOS entitlement, security review, and REAL_UAT remain external.

### Wave 9: schedule enforcement consumer and call-state permission UX

- Entry base: 64bd626c4e7ad112c708229a7bc4238c11a91988.
- Implemented the foreground-package handoff, live device-owner package-suspension consumer, and child-visible enforcement outcome.
- Preserved emergency, incoming-call, and SMS transport surfaces without creating a generic Messages UI exemption; public Android package APIs cannot narrow call UI separately.
- Added transparent one-shot READ_PHONE_STATE UX with settings fallback after denial; no SMS permission is requested.
- Focused and full Android gates passed: testDebugUnitTest, lintDebug, and assembleDebug.
- Physical device-owner provisioning, restart/offline enforcement proof, and native call/SMS delivery remain external validation gates; release readiness remains NOT READY.

### Wave 10: Settings-return permission refresh and source-status normalization

- Added lifecycle-aware `MainActivity.onResume()` handling for the Android Settings permission round-trip. A denied-to-granted transition refreshes the live call-state observer once; a still-denied return does not prompt again or crash.
- Added focused `CallStatePermissionPromptPolicy` coverage for granted, unchanged-denied, and already-granted transitions. The focused Gradle invocation was run with the shared wrapper cache; no real-device permission result is claimed.
- Normalized PCA-FR-043B, PCA-FR-043C, PCA-FR-015A, and PCA-AND-003A to `SOURCE_COMPLETE` with explicit device-owner, telephony/SMS, iOS, and physical-device external gates. Their validation rows remain open and do not imply real-device proof.
- SMS remains delivery-preserved but not an unrestricted Messages UI exemption; this is a documented public-Android capability limit.

### Wave 11 database validation

- PRE_WAVE11_DB_BASELINE = PASS
- CURRENT_HEAD_0020_DB_VALIDATION = PASS
- MIGRATION_0020_APPLIED = YES
- MIGRATION_0020_SCHEMA_VERIFIED = YES
- MYSQL_STANDARD = PASS (392/392, 0 fail, 0 skipped, 0 todo; 19 migrations including 0020 and 0021)
- MYSQL_PRIVILEGE = PASS (4/4)
- DB_CRITICAL_SKIPPED = 0
- Scope: disposable local MySQL 8.4 Compose only; no production or Azure database was used.
### Current-head mutation validation

- MUTATION = PASS (3/3 mutants killed)
- VALID_MUTATION_SURVIVORS = 0
- Scope: bounded Safe Zone privacy and recipient-authorization mutants; temporary compiled modules are restored/deleted after each case.