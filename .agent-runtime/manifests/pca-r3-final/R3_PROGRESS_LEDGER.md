# PCA R3 Progress Ledger

Generated from the completion matrix and repository evidence on 2026-08-21.

## Exact requirement counts

| Metric | Count |
|---|---:|
| Total matrix requirements | 375 |
| SOURCE_COMPLETE | 306 |
| PARTIAL | 44 |
| NOT_STARTED | 4 |
| NOT_APPLICABLE | 6 |
| UNMAPPED_PHASE_CROSSWALK_PENDING | 0 |
| Partial plus not-started | 48 |
| External-gate rows | 69 |
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
- Android full test: PASS (`testDebugUnitTest` on the integrated head); the SDK XML v4 warning is environment noise and production database policy is unchanged.
- Parent Web typecheck: PASS; test: PASS (61 files, 452 tests); production build: PASS; lint was not rerun on this head (prior focused lint evidence remains separate).
- Backend build and focused parent-control tests: PASS; full worker-mode suite is RUNNER_ENVIRONMENT_BLOCKED (spawn EPERM), and disposable MySQL validation is NOT_EXECUTED.
- iOS/macOS/Xcode and physical-device validation: EXTERNAL_GATE on Windows.

## Open work

- Source candidates: R3_SOURCE_BACKLOG.csv.
- Source backlog reconciliation: 77 rows; PCA-ADD-PA-041 is present and the count now equals PARTIAL + NOT_STARTED (72 + 5).
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

### Current-head database validation

- PRE_WAVE11_DB_BASELINE = PASS
- CURRENT_HEAD_0020_DB_VALIDATION = PASS
- MIGRATION_0020_APPLIED = YES
- MIGRATION_0020_SCHEMA_VERIFIED = YES
- MYSQL_STANDARD = PASS
- MYSQL_PRIVILEGE = PASS
- DB_CRITICAL_SKIPPED = 0
- Scope: disposable local MySQL 8.4 Compose only; no production or Azure database was used.
### Wave 12 source-boundary hardening

- Writer86 integrated `53a55980`: Safe Zone repository and Parent Web opaque-envelope validation, Android malformed-sample/key-epoch rejection, and focused tests.
- Writer89 integrated `ca0a3fd`: UTC-bounded dashboard growth, updated-at payment aging, valid enrollment exception filtering, and metadata-only redaction coverage.
- Writer84 integrated `1c75e5c`: fail-closed administration PIN and parent-approval/removal decision service/UI boundaries with focused tests; persistence, route, authority, and device composition remain open.
- Writer85 integrated `1eabce8`: non-weakenable Android/iOS enrollment defaults and focused source tests; Apple host/toolchain/device gates remain open.
- Writer88 integrated `9a8f7d8`: ephemeral Android face-frame ownership, coarse on-device geometry, and explicit enforcement gating with focused tests; camera session and permission/lifecycle wiring remain open.
- Writer87 integrated `33ef143`: local retention/export boundaries plus protected-state Delete Now correction; 32 focused Android tests and full `testDebugUnitTest` passed, while owner-authorized runtime composition, HTTP delivery, and per-row traceability remain open.
- Focused evidence: Parent Web Safe Zone tests 12/12; backend Safe Zone/domain/route/schema tests 28/28; Writer84 enrollment tests 11/11; Android geofence/receiver and proximity focused tests PASS; backend full suite 1,510/1,510. iOS XCTest is unavailable on Windows.
- `PCA-FR-063`, `PCA-FR-091`, `PCA-FR-135`, and `PCA-ADD-PA-041` remain `PARTIAL`/`REAL_SOURCE_GAP` where verified trust-set authority, reviewed crypto, browser/device delivery, or remaining authoritative dashboard sources are absent.
- `PCA-ADD-ENR-012`, `PCA-ADD-ENR-016`, `PCA-ADD-ENR-017`, `PCA-FR-008`, `PCA-FR-021`, `PCA-FR-023`, `PCA-NFR-044`, `PCA-PRIV-001`, and `PCA-ADD-ENR-010` remain partial/source-gap items where persistence, authority, Apple, camera, or device composition is incomplete.
- Current source backlog: 77 rows, including 29 exact `REAL_SOURCE_GAP` rows. Assignment coverage is exact: 29 assigned, 29 unique, no duplicates, no unassigned, no extraneous IDs.

### Wave 13 continuous next-10 source leases

- Writers84-89 were re-leased against the remaining runtime-composition portions of their partially closed requirement clusters; Writers90-93 retain their exact ready assignments and are queued behind the current agent-pool capacity.
- Lease scope remains source-only and sequentially reviewable: coordinator ledgers, matrix, and external-gate claims are not writer-owned.
- The Parent Web current-head evidence is authoritative at 61 files and 452 tests; the former 449-count line was corrected.
- Accepted continuous-wave source commits: `12173db` (Android live capability/degradation and resolver-driven emergency floor), `b815de3` (removal trust-set epoch binding and default-off aggregate telemetry), `d326b69` (opaque protection-alert generator/ledger boundary), and `931b836` (local iOS recovery/alert models plus reachable Parent Web disclosure surfaces).
- The desktop agent pool exposed six active slots, so ten assignments were retained as exact leases but were processed in bounded batches; no ten-process activity claim is made. Remaining owner, authority, crypto, Apple/Xcode, runtime-graph, and device gates remain open.

### Wave 14 rolling source execution (2026-08-19)

- Ten logical leases remain registered in `R3_EXECUTION_SCHEDULE.csv`; the coordinator used a maximum of five worker slots and makes no claim that ten processes ran simultaneously.
- Writer88 completed `edf074f` (`feat(r3): compose camera permission lifecycle boundary`): Android permission state now distinguishes initial denial from post-grant revocation and fails closed on query failure; focused camera lifecycle tests passed with `BUILD SUCCESSFUL`. Foreground camera-session/runtime-graph and physical-device gates remain open.
- Writer84 completed the enrollment persistence portion of `31ea51e`: verifier-only PIN storage, durable approval state, and exact-request replay idempotency are source-backed; authenticated routes, verified authority, and device enforcement remain open.
- Writer86 completed the Safe Zone portion of `31ea51e`: accepted policy revisions clear the local membership/debounce baseline before monitoring resumes; verified authority, reviewed crypto, and parent-to-device delivery remain open.
- Writer91 completed `c5a444f` (`feat(r3): localize privacy and recovery disclosures`): Parent Web English/Arabic transparency categories and recovery acknowledgement copy were integrated; Parent Web typecheck, focused EN/AR/mutation tests (`14/14`), and production build passed.
- Writer92 completed the opaque alert producer at `c2c17ab` and the localized recovery integration at `c5a444f`; backend build and focused alert tests passed (`6/6`). Authenticated transport, trusted-parent decryption, Apple project/runtime, and approved crypto gates remain open.
- The shared source commit `31ea51e` also integrated durable enrollment-administration persistence: verifier-only PIN storage, SQL approval state, compare-and-set decision transitions, and policy-revision geofence baseline reset. Backend build plus focused enrollment persistence/approval tests passed (`17/17`), and the Android Safe Zone wildcard suite passed after a clean rerun (`BUILD SUCCESSFUL`). Authenticated routes, verified family authority, device enforcement, MySQL live migration validation, and real-device delivery remain open.
- Writers90 and 93 produced no source changes in their leases. Writers85, 87, and 89 remain queued or blocked on unavailable reusable handles. No queued lease is represented as completed.
- This wave adds source evidence but closes no remaining `REAL_SOURCE_GAP`; the authoritative source backlog remains 77 rows, including 29 exact `REAL_SOURCE_GAP` rows with exact assignment coverage.
- Current-head mutation evidence was rerun after the wave: 22 KILLED, 3 EQUIVALENT, 3 INVALID, and 0 SURVIVED at source entry `c5a444f96f51c8bb15ddee5f3dd809f39066a63b`.

### Current-head mutation validation

- MUTATION = NOT_EXECUTED
- VALID_MUTATION_SURVIVORS = NOT_EXECUTED
- Scope: bounded relay/privacy disclosure, Safe Zone envelope/recipient-authorization, and Android key-epoch mutants; temporary compiled modules are restored/deleted after each case.