# PCA Parent Authentication + Authority — Continuous Pursuing Goal

## TODO-19 exact-head CI + TODO-20 access recheck — 2026-10-08

Quality Gates run `37802124920` completed SUCCESS 27/27 at `173d5c31232e2093a735772374c173eed3252977`. Since product-source checkpoint `4e722cde2a590916cb02e18fca83428e0ac1c135`, the range contains only the three mission ledgers. TODO-20 DNS resolves `pca-mysql.mysql.database.azure.com` to `4.161.89.178`, but TCP/3306 fails; Azure Flexible Server/firewall inspection returned `AADSTS50078` because cached MFA expired. No live SQL/grant read, firewall change, database mutation, or deployment occurred. Parent remains 15 PASS / 4 IN_PROGRESS (12/14/15/20) / 4 TODO (18/21/22/23); TODO-14 remains `NOT_YET_PROVEN`; Platform remains `HOLD_PARENT_DEPENDENCY`. Continue TODO-20 when authorized reachable access is available and continue TODO-12/14/15 only where their reviewed contracts make implementation safe. Physical-device, owner localhost, live DB, Azure, and production gates stay distinct.

## TODO-19 latest ledger CI result — 2026-10-08

Published docs-only ledger checkpoint `f963a79e3b7ded0e9836c59b65b1ed236a188066` passed Quality Gates run `37800886221` 27/27. The source tree is unchanged from `4e722cde2a590916cb02e18fca83428e0ac1c135`; latest post-push fetch/direct server equality and excluded-file preservation are recorded in both master TODOs. No product, database, deployment, or acceptance state changed.

## Re-entry checkpoint — 2026-10-08

CONTINUITY_STATUS = PASS; branch `pca-dev`; fresh fetch and direct server lookup verify `LOCAL_HEAD = ORIGIN_HEAD = SERVER_HEAD = c6945079f0e2f1de56de9ec587618118bcc9502a`. The c694 commit updates only the three ledgers; product source remains at `4e722cde2a590916cb02e18fca83428e0ac1c135`. Five excluded untracked files remain preserved.
EXACT_HEAD_CI = Quality Gates run `37798823066` completed SUCCESS 27/27 at c694; the product-source checkpoint run `37797038084` passed 27/27 at 4e.
TODO20 = Fresh read-only DNS/TCP preflight resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`, with TCP/3306 false. No live credentials, SQL, schema/grant read, or mutation occurred.
CHILD_APP_RELEASE_ROUTES = Read-only GETs returned `/child-app/` 404, `/enroll/` 404, and `/.well-known/assetlinks.json` 403 on `www.pcasafe.com`; source/build exists, but deployment and App Links remain open.
TODO12_14_15 = Five independent mobile/security reviewers found no safe ordinary Trust Set submission/retry or recipient policy-application change under current contracts. R1's source-only baseline does not define the ordinary request/retry contract; its Parent Genesis design is superseded by DEC-037. Existing codecs, vectors, scope checks, and fail-closed composition remain; no source changed. TODO-14 remains `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`.
MISSION_STATE = Parent 15 PASS / 4 IN_PROGRESS (12/14/15/20) / 4 TODO or owner/release gated (18/21/22/23) / 0 BLOCKED. Platform remains `HOLD_PARENT_DEPENDENCY`. Physical-device, live DB, owner localhost acceptance, Azure and production gates remain separate/open; `READY_FOR_AZURE_DEPLOYMENT=NO`.
NEXT = Continue TODO-20 live schema/grant comparison when its approved endpoint is reachable; continue authority/device implementation only when the required crypto, custody and wire contracts have been reviewed. No Azure or production deployment is authorized by this checkpoint.

## TODO-19 post-push verification — 2026-10-08

Ordinary fast-forward push of `4e722cde2a590916cb02e18fca83428e0ac1c135` succeeded under the owner's existing checkpoint authorization. Fresh fetch and direct server lookup prove `LOCAL_HEAD = ORIGIN_HEAD = SERVER_HEAD`; ahead/behind counts are zero and all five changed tracked paths exist remotely. Exact-head Quality Gates run `37797038084` completed SUCCESS 27/27 at the pushed SHA. This ledger sync records the CI result and changes no product source. Five excluded untracked files remain preserved. TODO-12/14/15/20 and the owner, Platform, device, Azure, and production gates remain open.

## TODO-19 owner-authorized publication recheck — 2026-10-08

The user-provided checkpoint attachment states `OWNER_CHECKPOINT_PUSH_AUTHORIZATION = YES` and `TARGET_BRANCH = pca-dev`, directing normal fast-forward publication after fetch/ancestry reconciliation, followed by post-push equality and exact-head CI. At pre-push head `351814664990d4a5d68045db454b6e2d675e67b2`, local was seven commits ahead of fresh `origin/pca-dev` / server `c4b05a8bfac419d49ac65fd58b2006d67fefd824`. This correction-ledger commit is documentation-only; refresh ancestry and publish the resulting candidate under the existing authorization. No force push or history rewrite is authorized.

## TODO-15 relay paging and callback attribution validation — 2026-10-08

At local validation head `da30a3c5f9bd4647a83de4577949f45575072cfa`, the focused Android reconnect suite passed 26/26 with zero failures, errors, or skips; it covers bounded relay cursor continuation, restart from a saved cursor, empty-page continuation, and rejected-cursor recovery. Nine iOS relay/custody/callback implementation and test files passed `swiftc -frontend -parse` in an isolated process. Source inspection verifies callback-health observations are bound to the active monitor activity and installation generation; stale/foreign events use a bounded diagnostic ring. Xcode is unavailable, so no iOS XCTest/typecheck is claimed. TODO-12/15 crypto, authority and device gates remain open; TODO-14 aggregate, TODO-19 exact-head CI and TODO-20 live DB access remain open. This ledger synchronization changes no product source.

## TODO-15 local iOS fixture syntax recheck — 2026-10-08

The changed `ios/PCATests/ProductionIntegrationTests.swift` parsed successfully with `swiftc -frontend -parse` (exit 0) from an isolated child process with normalized environment. A direct parser launch crashed before parsing because Swift reported duplicate `Path` environment keys. `xcodebuild` is unavailable, so no XCTest/typecheck result is claimed. The source correction remains the fixture-only commit `73524a4e`; published CI at `c4b05a8` still fails on those three tests, and the unpublished candidate still needs exact-head CI. This ledger update follows precheck head `9976f3fb10b6f88b715407d5a543ae0cff9b7c27` and changes no source.

## TODO-19 published-head CI recheck — 2026-10-08

Quality Gates run `37788211532` completed FAILURE at published `c4b05a8bfac419d49ac65fd58b2006d67fefd824`; the iOS job alone failed on three stale enrollment test fixtures. The local correction is in `73524a4e`. The current local snapshot `7d05241cf35a745aaa96f86127e5199723b48023` was four commits ahead with a clean tracked worktree; this ledger-only follow-up adds one local documentation commit and still has no exact-head CI. `TODO-19 = IN_PROGRESS`; the existing owner checkpoint amendment authorizes ordinary fast-forward publication to `pca-dev` after a fresh ancestry check, followed by exact-head CI inspection. Parent route audit remains 56/56 locally at source head `fedcdd56`; global aggregate remains `NOT_YET_PROVEN`. TODO-20 live TCP/3306 is unreachable; no live DB operation occurred.

## Current implementation checkpoint — TODO-14 current-source route audit — 2026-10-08

AUDIT_SOURCE_HEAD = `fedcdd56bfc0720a166b28c3a7170be45ac1ae9c`. Fresh fetch and direct server lookup verify `origin/pca-dev = SERVER_HEAD = c4b05a8bfac419d49ac65fd58b2006d67fefd824`; at audit time local was three commits ahead and a fast-forward descendant. Preserve the five owner-excluded untracked paths in the Parent master TODO.
TODO14 = Current-source disposable Parent route audit passed backend build and 56/56 tests, zero failures/skips, on loopback MySQL 8.4.11. It applied all 63 migrations through 0065, covered 52/52 declarations in 146/146 matched scenarios, reported zero missing/undeclared keys and zero unexpected status outcomes, and retained `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`. The generated ignored report is `.agent-local-artifacts/parent-route-audit-fedcdd56-20261008-mysql8411.json`, SHA-256 `D1C71BBA2566BE9C316C50FC6CEA9680027546D7708D80C5CEE7E3B7EBE59B59`. The schema was verified absent and the temporary server/datadir removed.
TODO20 = Fresh bounded live TCP/3306 probe timed out after DNS resolved the host to `4.161.89.178`; no live credentials, SQL, grant read, or mutation. Local disposable schema/grant evidence remains through 0065.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform stays `HOLD_PARENT_DEPENDENCY`. Physical-device, owner acceptance, live DB, Azure, and production gates remain distinct; `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Keep TODO-14 aggregate and the seven authority/service/crypto/optional dispositions open. Continue locally implementable Parent/Platform work and retain external gates until direct evidence/authorization arrives.

## Current implementation checkpoint — TODO-14 crosswalk correction and TODO-20 reachability — 2026-10-08

CONTINUITY = At this source/documentation checkpoint, branch `pca-dev` commit `4bdc2960d17d709b5a6d54f377966e1e4fe75464` was two commits ahead of the directly verified `origin/pca-dev` / server head `c4b05a8bfac419d49ac65fd58b2006d67fefd824`, which was its ancestor. Commit `73524a4e` contains the iOS test-only correction; `4bdc2960` contains the Web Rules crosswalk correction and initial ledger checkpoint. This ledger-only follow-up records the post-commit state. Preserve the five owner/excluded untracked paths listed in the Parent master TODO.
TODO14 = Corrected the stale integrated-evidence sentence to separate route authentication (Parent session/family, Administrator role, actor-device; CSRF on mutations) from action-level `EDIT_CHILD_POLICY` authorization. A missing service returns `503 not_configured` after the former checks and before the latter, persistence, or mutation payload validation. Source and tests confirm the order; no runtime behavior changed.
VALIDATION = `git diff --check` passed with CRLF normalization notices. This is documentation-only; no tests were run. The preceding iOS test-harness correction passed sanitized Swift frontend parsing; XCTest and exact-head CI remain pending.
TODO20 = Fresh DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; bounded TCP/3306 timed out. No credentials or live SQL were used. Local disposable schema/grant evidence through migration 0065 remains local-only; live schema/grants remain unverified.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open and TODO-14 aggregate remains `NOT_YET_PROVEN`. Platform remains `HOLD_PARENT_DEPENDENCY`. Physical-device, owner acceptance, live DB, Azure, and production gates remain separate/open; `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue the earliest repository-implementable Parent requirement with settled authority/security semantics. Keep publication/exact-head CI and live DB reconciliation pending their evidence gates; do not infer external acceptance.

## Current implementation checkpoint — iOS enrollment-test harness corrections — 2026-10-08

CONTINUITY = Approved read-only fetch and direct server query verify LOCAL_HEAD = ORIGIN_HEAD = SERVER_HEAD = `c4b05a8bfac419d49ac65fd58b2006d67fefd824`. Preserve five untracked owner/excluded paths listed in the Parent master TODO.
IMPLEMENTATION = Corrected three iOS test harnesses without production changes: awaited route-specific abandonment/rescan, suspending `/prepare` before ownership mutation and asserting recoverable/no-bootstrap, and route-specific `PAIRING_PENDING` profile response. Five independent mobile specialists reviewed the diff.
VALIDATION = Sanitized Swift frontend parsing passed and `git diff --check` passed with CRLF normalization warnings only. Apple XCTest and a fresh exact-head CI run remain unverified; run `37788211532` at `c4b05a8` had a failed iOS job and was IN_PROGRESS overall at last query.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform stays `HOLD_PARENT_DEPENDENCY`. TODO-20 disposable MySQL schema/grants passed through migration 0065; live TCP/3306 remained unreachable, with no live SQL. Physical Android/iOS, owner acceptance, Azure and production remain separate/open; `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Commit the scoped correction, recheck remote refs and the direct server head before publication, then verify source blobs and exact-head CI after ordinary fast-forward. Android pending/family durability is already implemented in `94a721dc`, with focused 59/59 and full Android unit validation (0 failures, 1 existing skip); the Android job on `37788211532` was PASS at last observation. After exact-head CI, continue TODO-12/14/15 only where existing authority and wire contracts define safe behavior; retain the signed-epoch, recipient-enforcement, encrypted-delivery, pinned-root and physical-device gates.

## Current implementation checkpoint — iOS suspended-response test transport — 2026-10-08

CONTINUITY = Branch `pca-dev`; source commit `61453aed0f1869faf4246ca4cec16b3ac73b6e6f` is one commit ahead of the last fresh origin/server head `df5eef23ca7a7dc769831a8f2137c4f5982a9a19`. Refresh refs before publication and preserve five untracked owner/excluded files.
CI_AND_IMPLEMENTATION = Run `37787153627` at `df5eef23` has an iOS job failure for the missing return after an early branch in `SuspendedEnrollmentTransport.send(_:)`; the full run remained in progress at last inspection. The current commit adds `return` before the checked continuation, preserving request behavior.
REVIEW_AND_VALIDATION = An independent mobile reviewer confirmed the minimal correction. Swift frontend parsing and `git diff --check` passed; full Xcode build/XCTest remains pending the next exact-head CI. A fresh read-only TODO-20 probe resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178` and TCP/3306 failed; no live SQL or mutation occurred.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform remains `HOLD_PARENT_DEPENDENCY`. Owner acceptance, physical Android/iOS, live DB, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Update the canonical ledgers, refresh direct remote ancestry, publish by ordinary fast-forward, verify remote equality, and close the next exact-head CI run.

## Current implementation checkpoint — iOS integration test compile fixes — 2026-10-08

CONTINUITY = Branch `pca-dev`; local commit `222fb7dac7be8ce196521e2a115c205addd14244` is one commit ahead of the last freshly verified origin/server head `868323e5c8be63d9ae638951be0cc86df2c8fd76`. Refresh refs before publication; preserve five untracked owner/excluded files.
CI_AND_IMPLEMENTATION = Exact-head run `37782124895` failed only the iOS job after the app-level actor-isolation failure was cleared. It reported three `makeEnrollmentModel` label-order errors and one double-optional request-body unwrap. The current commit swaps the labels at those three calls and unwraps the `[Data?]` entry and `Data` separately.
REVIEW_AND_VALIDATION = Three independent mobile reviewers confirmed the argument ordering and optional semantics. Swift frontend parsing passed for all three changed iOS files; `git diff --check` passed with line-ending notices. Full Xcode build/XCTest remains pending the next exact-head CI; no device evidence is claimed.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED, with TODO-12/14/15/19/20 open. Platform remains `HOLD_PARENT_DEPENDENCY`; live `pca_pro` remains unreachable and uninspected. Owner acceptance, physical Android/iOS, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Record this checkpoint, refresh remote ancestry, publish the validated source/ledger candidate by ordinary fast-forward, confirm remote equality, and continue through exact-head CI.

## Current implementation checkpoint — iOS main-actor initializer repair — 2026-10-08

CONTINUITY = Branch `pca-dev`; source commit `d79e5cb764f52659879a4b142676184adbf46724` is one fast-forward commit ahead of freshly verified `origin/pca-dev` and server head `d778d11f5693336e75438bc274d1d018a4110c44`. Five pre-existing untracked owner/excluded files remain preserved.
IMPLEMENTATION = Removed the main-actor factory from `ContentView`'s default argument, moved construction into actor-isolated `init()`, retained `init(model:)` injection, and marked the existing launch smoke test `@MainActor`. The production app still injects its shared model.
CI_AND_REVIEW = Previous exact-head run `37780141275` completed FAILURE only in the iOS build due to the actor-isolated default argument. Five independent mobile specialists approved the correction. Swift frontend parsing for both changed files and `git diff --check` passed; a fresh exact-head CI run is pending. Apple SDK typecheck and physical iOS validation remain unclaimed.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED, with TODO-12/14/15/19/20 open. Platform remains `HOLD_PARENT_DEPENDENCY`. The previous fresh disposable DB replay and runtime grant tests passed; live `pca_pro` remains unreachable and uninspected. Owner acceptance, physical Android/iOS, Azure, and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Commit the ledger checkpoint, recheck direct remote ancestry, publish by ordinary fast-forward, verify the exact remote source and new exact-head CI, then continue the same mission.

## Latest implementation checkpoint — iOS callback evidence isolation — 2026-10-08

CONTINUITY = Fresh `git fetch origin pca-dev` and direct `git ls-remote` both verify `94a721dcbd0306c7fd59c1b3546533c1be304218` after local source commit `d40f8ca3`. Local is two commits ahead/zero behind and remote is its direct ancestor. The ordinary fast-forward push remains pending.
WORKTREE = Tracked tree was clean immediately after source commit `d40f8ca3`; preserve the five untracked owner-excluded files listed in the Parent ledger. This ledger update is the current tracked delta.
IMPLEMENTATION = iOS callback observations without a valid owning installation, including absent/corrupt manifests and invalidated installations, now go to a separate bounded diagnostics ring so they cannot evict anchor health receipts. Valid `.starting` anchor callbacks remain eligible after activation. Negative/non-finite callback grace values return unknown/no expectations; added ring-isolation and freshness-boundary tests. Corrected the Mac checklist to describe missing/ambiguous callbacks as `.unknown`.
VALIDATION = Five mobile specialists participated and final iOS lifecycle review approved. Swift frontend parse and full `git diff --check` passed; Swift typecheck lacks Windows SDK `stdlib.h`, and Apple XCTest/device validation are unclaimed. Fresh disposable MySQL 8.4.11 replayed 63 migrations through 0065; 96 tables/834 columns matched fingerprint `sha256:2143678ea123e129b1a7eb958a9271651be0834282fcf375fcc10911c4cc6050`. Post-validation found all non-reference tables empty; disposable runtime grant checks passed 8/8 and the test schema and temporary instance were removed.
MISSION_STATE = Parent 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform `HOLD_PARENT_DEPENDENCY`. The live DB port probe timed out; no live SQL or grant check/mutation. Owner acceptance, physical Android/iOS, exact-head CI/publication, Azure and production remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Commit this ledger checkpoint, recheck remote ancestry, and publish the exact candidate by ordinary fast-forward; then verify remote source and exact-head CI. Continue the same mission while keeping physical-device, live DB, owner acceptance, Platform and production gates separate.

## Latest implementation checkpoint — Android bounded enrollment 404 classification — 2026-10-08

CONTINUITY = Branch `pca-dev`; LOCAL_HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached ORIGIN_HEAD `94a721dcbd0306c7fd59c1b3546533c1be304218` (one ahead, zero behind). Latest fetch could not write `.git/FETCH_HEAD`; direct `git ls-remote` could not reach GitHub through the configured localhost proxy, so SERVER_HEAD remains unverified. Worktree remains 69 tracked modifications and eight untracked paths, none staged. No commit/push.
IMPLEMENTATION = Android prepare/bootstrap/recovery accept only the exact bounded raw-byte `{"error":"invitation_unavailable"}` envelope as the semantic 404, permitting JSON whitespace only. Any unrecognized or unreadable 404 remains ambiguous. Added duplicate/extra/malformed/HTML/trailing/oversized/non-JSON-whitespace body cases and two real-socket coordinator regressions proving malformed prepare and recovery 404s cannot clear the PREPARED attempt or delete key aliases.
VALIDATION_AND_REVIEW = Focused Android `HttpDeviceBootstrapApiClientTest` and `EnrollmentCoordinatorTest` passed 108/108, zero failures/errors/skips. Five independent mobile specialists approved the final code and test coverage; one fake-server list race finding was corrected using atomic path collection. Scoped `git diff --check` passed with a CRLF normalization notice.
TODO20_READ_ONLY = Live `pca_pro:3306` was unreachable. Read-only loopback inspection found separate MySQL 8.4.11 `pca_test`, 95 tables and migration history through 0063, authenticated as `pca_test_app@%`; grants are global USAGE plus ALL PRIVILEGES on `pca_test` only. This is not retained owner-UAT or live runtime-grant evidence. No local or live DB mutation occurred; Docker Engine is inaccessible.
TODO_BOARD_AND_GATES = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform stays `HOLD_PARENT_DEPENDENCY`. Exact-head CI/publication, owner localhost acceptance, physical Android/iOS, live DB, Azure deployment and production remain separate/unproven. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue the same mission, taking the next source task only where its authority/security contract is settled. Retry TODO-20 live read-only reconciliation when reachable; keep Platform dependent work and all external gates separate. No commit or push.

## Latest implementation checkpoint — iOS ambiguous enrollment recovery — 2026-10-08

CONTINUITY = Branch `pca-dev`; LOCAL_HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached ORIGIN_HEAD `94a721dcbd0306c7fd59c1b3546533c1be304218` (one ahead, zero behind). Latest fetch failed because `.git/FETCH_HEAD` is not writable; direct `git ls-remote` failed through the localhost proxy, so SERVER_HEAD is not freshly verified. Worktree remains 69 tracked modified and eight untracked paths, none staged; no commit/push.
IMPLEMENTATION = iOS enrollment now retains a recovery-only durable state after malformed 2xx responses, ambiguous preflight recovery, and any 404 that is not the exact backend one-field `invitation_unavailable` JSON envelope. The status action resolves only the exact durable attempt through recovery, including after restart when device ID was saved before profile confirmation. Two exact not-found envelopes are required before the existing prepared-attempt release path can run. Duplicate JSON keys and extra envelope fields are rejected.
VALIDATION_AND_REVIEW = Swift frontend parsing passed for six changed Swift files; iOS source guard passed 6/6; localization catalog JSON validation and `git diff --check` passed. `xcodebuild` is unavailable, so iOS XCTest, Apple SDK typecheck and physical-device evidence are not claimed. Five mobile specialists participated; final independent re-reviews confirmed strict envelope matching, restart recovery, exact attempt custody, and no bootstrap retry after ambiguity. The Android full-suite result remains documented in the prior checkpoint.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 stay open. Platform remains `HOLD_PARENT_DEPENDENCY`. The last known bounded live database probe could not reach `pca_pro:3306`; no live SQL or grant mutation occurred here. Current-head CI, physical-device UAT, owner localhost acceptance, Azure, and production remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue the earliest repository-implementable TODO-12/14/15 work. Resume TODO-20 live read-only reconciliation when reachable; keep TODO-19 publication/current-head CI and all external acceptance gates open. No commit or push occurred.

## Latest implementation checkpoint — iOS enrollment DTO parity and custody — 2026-10-08

CONTINUITY = Branch `pca-dev`; LOCAL_HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; fresh fetched origin and direct SERVER_HEAD `94a721dcbd0306c7fd59c1b3546533c1be304218`. Local is one commit ahead and zero behind. Worktree remains 67 tracked modified and eight untracked paths, none staged; no commit or push.
IMPLEMENTATION = iOS bootstrap/recovery strictly decode required device/key/status strings, nonblank identifiers, recognized profile enums, exact `PAIRING_PENDING`, and a present nullable `childProfileId`. Added malformed DTO matrices and bootstrap/recovery custody integration checks. Malformed outcomes retain the exact durable attempt and key aliases and do not publish identity/profile; successful profile confirmation retains the child-profile ID.
VALIDATION_AND_REVIEW = Swift frontend syntax parsing and `git diff --check` passed. `xcodebuild` is unavailable, so iOS XCTest/typecheck and physical-device evidence are unclaimed. Three read-only iOS specialists reviewed this patch; a permanent-versus-recoverable error expectation caught in review was fixed and re-reviewed. The prior five-specialist Android review and full Android suite result remain in the preceding checkpoint.
MISSION_STATE = Parent remains 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 stay open. Platform remains `HOLD_PARENT_DEPENDENCY`. The last fresh bounded live DB probe could not reach `pca_pro:3306`; no live SQL or grant mutation. Current-head CI, physical-device UAT, owner localhost acceptance, Azure, and production remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue the earliest repository-implementable TODO-12/14/15 work. Resume TODO-20 live read-only reconciliation when reachable; keep TODO-19 publication/current-head CI and all external acceptance gates open. No commit or push occurred.

## Latest implementation checkpoint — Android enrollment response contract — 2026-10-08

CONTINUITY = Local branch `pca-dev`; LOCAL_HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; ORIGIN_HEAD/SERVER_HEAD `94a721dcbd0306c7fd59c1b3546533c1be304218`; one local-only commit ahead, zero behind. Worktree is 67 tracked modified paths plus eight untracked paths, none staged. Preserve all existing/owner-excluded work; no commit or push.
IMPLEMENTATION = Android enrollment bootstrap/recovery require typed server strings and valid age/policy enums, including a present nullable child-profile property; missing, blank, coerced, or invalid values are ambiguous. Successful recovery clears only in-memory rescan/replay bearer state; the exact durable attempt and keys remain for profile confirmation.
VALIDATION = Full `:app:testDebugUnitTest` passed 1,686 tests in 265 suites, zero failures/errors, one existing skip. Focused `HttpDeviceBootstrapApiClientTest` and `EnrollmentCoordinatorTest` passed 105/105, zero failures/errors/skips. Five read-only mobile specialist reviews checked the cross-platform contract and custody behavior; final reviews found no remaining implementation blocker. `git diff --check` passes with existing CRLF notices.
MISSION_STATE = Parent 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. Platform `HOLD_PARENT_DEPENDENCY`. Live pca_pro TCP/3306 remains unreachable; no live DB inspection or mutation. Current-head CI, physical-device UAT, owner localhost acceptance, Azure, and production remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue the earliest implementable TODO-12/14/15 repository work. Retry TODO-20 live read-only inspection when reachable. TODO-19 publication and exact-head CI remain outstanding; no push occurred.

## Terminal resume — fresh remote continuity — 2026-10-08

CONTINUITY_STATUS = PASS. `git fetch origin` and `git ls-remote origin refs/heads/pca-dev` both succeeded. LOCAL_HEAD is `9205590febe0fa043e249587db50eac80ef7eb44`; ORIGIN_HEAD and freshly verified SERVER_HEAD are `94a721dcbd0306c7fd59c1b3546533c1be304218`. Local is one commit ahead and zero behind. Earlier terminal entries saying fetch/server verification failed are historical and superseded by this check.
WORKTREE = 67 tracked paths modified and eight untracked paths, none staged; preserve the existing edits and owner-excluded files. No commit/push occurred in this resume.
TODO_BOARD = Parent 14 PASS / 5 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/19/20 remain open. TODO-19 is IN_PROGRESS because the current local head/worktree is ahead of the previously published checkpoint and lacks exact-head CI. Platform `HOLD_PARENT_DEPENDENCY`; `READY_FOR_AZURE_DEPLOYMENT = NO`.
TODO20_LIVE = DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 failed a bounded 4-second probe. No live SQL, grant inspection, or mutation.
VALIDATION = Backend build, test-double conformance, schema-privacy tests and server tests passed. After registering the new migration-recovery test, the repository-supported serial per-file campaign passed 297/297 registered files. Five child-spawning suites then passed 33/33 in an approved serial rerun; focused migration-recovery, migration-resumability, iOS guard, certification and registration checks passed 30/30. `git diff --check` passes with existing CRLF notices. Current-head CI is not available.
NEXT = Review and scope the publication candidate, then close TODO-19 with ordinary fast-forward and exact-head CI after authorization for the exact commit/remote/branch. Continue bounded TODO-12/14/15 implementation where contracts are defined, and retry TODO-20 live read-only inspection only when reachable. The terminal handover file is absent. Keep device, live DB, owner acceptance, Platform, Azure, and production gates separate.

## Terminal resume — migration crash recovery and iOS guard validation — 2026-10-08

CONTINUITY = Continued on local `pca-dev`, HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached `origin/pca-dev` `94a721dcbd0306c7fd59c1b3546533c1be304218`. Fresh fetch remains blocked by `.git/FETCH_HEAD` permissions and the configured localhost proxy; server head remains unverified (last supplied `4f16b29ee434b090e95a48888ab319fde8b3d795`).
IMPLEMENTATION = Fixed the iOS source guard for the current bootstrap/recovery attempt names and exact-attempt profile confirmation, including before/after ownership checks and conditional clearing in both attempt-store implementations. Added fail-closed migration-0064 state recovery around its single atomic `ALTER TABLE`; made migration 0065's tombstone-table creation resumable with `IF NOT EXISTS`; corrected the production-path certification entry to match current PREPARED recovery behavior.
VALIDATION = Focused guard/resumability/recovery/certification tests passed 24/24; backend build passed. Fresh disposable MySQL 8.4.11 applied all 63 migrations and the Parent identity DB suites passed 4/4 in single-process mode. A second disposable run simulated the DDL/journal interruption for 0064/0065; the runner recovered the complete 0064 schema, safely re-applied 0065, and the owned schema was removed. Four read-only iOS reviews found no custody defect, and the source guard was strengthened for the one coverage gap. Full backend per-file run before fixes was 293/296; all three failing files passed focused rerun, but the full run was not repeated. Nested child launches hit Windows `spawn EPERM`; no current-head CI result.
WORKTREE = 66 tracked paths modified, eight untracked, none staged. Preserve all owner-excluded and pre-existing work. No commit or push.
TODO20_LIVE = Fresh DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 remained unreachable after a 3-second read-only probe. No live credentials, SQL, grant inspection or mutation occurred. Disposable local migration evidence does not close live `pca_pro` parity.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/20 remain open. Platform `HOLD_PARENT_DEPENDENCY`; physical Android/iOS, owner localhost acceptance, live DB, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue bounded TODO-12/14/15 source work where the authority, recovery, encrypted delivery and attestation contracts determine safe behavior. Retry TODO-20 live read-only reconciliation when reachable and keep all external release gates separate.

## Terminal resume — migration 0065 grants and family identity verification — 2026-10-08

CONTINUITY = Continued on local `pca-dev`, HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached `origin/pca-dev` `94a721dcbd0306c7fd59c1b3546533c1be304218`. Fetch failed at `.git/FETCH_HEAD` permissions and GitHub was unreachable through the configured localhost proxy; live server head remains unverified.
IMPLEMENTATION = Added migration-0065 immutable tombstone grants (`SELECT`/`INSERT` only), static grant-policy coverage, a real disposable MySQL privilege-boundary case, and an explicit disposable runner target retaining the migration credential only for this privileged lane.
VALIDATION = Backend build PASS; grant-policy suite 19/19; fresh disposable MySQL 8.4.11 replayed 63 migrations and privilege suite passed 8/8. The temporary runtime principal exercised tombstone insert/read and database-denied update/delete; owned schema was removed. Fresh schema fingerprint already recorded through 0065 as `sha256:2143678ea123e129b1a7eb958a9271651be0834282fcf375fcc10911c4cc6050` (96 tables, 834 columns; no application/reference fixture data). `git diff --check` passes with existing CRLF warnings.
FAMILY_IDENTITY_VALIDATION = Backend Parent identity/service and Platform identity route/lookup tests passed 88/88; Parent identity UI 12/12; Platform Account Detail/projection tests 6/6; Parent/Platform typechecks and targeted Platform lint passed. A disposable MySQL 8.4.11 replay through migration 0065 passed Parent identity projection and Parent Email family lookup 4/4, then removed its owned schema.
WORKTREE = 62 tracked paths modified, six untracked, none staged. Preserve all owner-excluded and pre-existing work. No commit or push.
TODO20_PREFLIGHT = DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 timed out. No live SQL/grant query or mutation. Live schema and grants remain open.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/20 remain open. Platform `HOLD_PARENT_DEPENDENCY`; physical Android/iOS, owner localhost acceptance, live DB, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue bounded TODO-12/14/15 source work only where established signed epoch-N/request-retry, receiving-device, encrypted-delivery and attestation contracts determine safe behavior. Resume TODO-20 live read-only reconciliation when reachable; preserve all external release gates.

## Terminal resume — prepared enrollment recovery UX — 2026-10-08

CONTINUITY = Continued the existing mission on local `pca-dev`. Fresh fetch failed at `.git/FETCH_HEAD` with permission denied and GitHub could not be reached through the configured localhost proxy. Local HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached `origin/pca-dev` `94a721dcbd0306c7fd59c1b3546533c1be304218`; server head unverified (last supplied `4f16b29ee434b090e95a48888ab319fde8b3d795`).
IMPLEMENTATION = Android `BootstrapResultUnknown` now exposes separate explicit recovery and exact replay actions. Recovery can resolve a completed result or authoritative abandonment; the client retains custody on unresolved results. Bilingual copy explains checking status, exact replay, and rescanning after abandonment.
VALIDATION = Android coordinator + static-scan suites passed 85/85; `git diff --check` passed with existing CRLF warnings. Earlier in this continuation the TypeScript build passed, and fresh disposable MySQL 8.4.11 replayed 63 migration files through 0065 before enrollment and HTTP DB suites passed 82/82; the DB was removed. Six independent mobile reviews plus two read-only follow-ups found no remaining scoped blocker after corrections. No current-head CI or physical-device evidence.
WORKTREE = 58 tracked paths modified, six untracked, none staged. Preserve the four owner-excluded paths and all existing edits. No commit or push.
TODO20_PREFLIGHT = DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 timed out. No live SQL/grant query or mutation. Live DB reconciliation remains open.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/20 remain open. Platform `HOLD_PARENT_DEPENDENCY`; physical Android/iOS, owner localhost acceptance, live DB, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
ROLLOUT_GATE = Upgrade/retire older clients that send bootstrap without prepare, and reconcile migrations 0064/0065 plus runtime grants before deployment. Fleet compatibility and live grants remain unverified.
NEXT = Continue the same mission from the earliest implementable TODO-12/14/15 repository work; resume TODO-20 live read-only reconciliation only when reachable.

## Terminal resume — prepared enrollment required — 2026-10-08

CONTINUITY = Continued the existing mission on local `pca-dev`, HEAD `9205590febe0fa043e249587db50eac80ef7eb44`; cached `origin/pca-dev` `94a721dcbd0306c7fd59c1b3546533c1be304218`. The configured localhost proxy prevents fresh server-head verification; last supplied value remains `4f16b29ee434b090e95a48888ab319fde8b3d795`.
IMPLEMENTATION = Bootstrap requires the exact previously committed `PREPARED` reservation; unprepared legacy requests are generic 404 with no device, attempt, or invitation mutation. Attempt completion updates only the reserved row. Duplicate-key failure leaves the prepared request recoverable so the caller can abandon it before creating a fresh tuple.
VALIDATION = TypeScript build passed; coordinator 36/36, slot 4/4, audit 11/11; disposable MySQL 8.4.11 replayed 63 migrations and enrollment+HTTP suites passed 82/82. The disposable DB was removed. A standard child-process launch hit Windows `spawn EPERM`; one-process verification completed successfully. Current-head CI/publication was not run.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-12/14/15/20 remain open; Platform stays `HOLD_PARENT_DEPENDENCY`. Physical Android/iOS, live DB, owner localhost acceptance, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
ROLLOUT_GATE = Existing direct-bootstrap client binaries must be retired or upgraded before the API contract is deployed. No deployment, commit, push or live DB action occurred.
NEXT = Continue the earliest implementable Parent TODO-12/14/15 repository work and resume TODO-20 live read-only reconciliation only when reachable.

## Terminal resume — iOS enrollment restart and attempt ownership — 2026-10-08

CONTINUITY = Continued on `pca-dev`; local HEAD `9205590febe0fa043e249587db50eac80ef7eb44`, cached `origin/pca-dev` `94a721dcbd0306c7fd59c1b3546533c1be304218`. Fetch exited 0 without moving the cached ref; direct `git ls-remote` failed through the configured localhost proxy. Server head remains unverified; last supplied independent value is `4f16b29ee434b090e95a48888ab319fde8b3d795`.
WORKTREE = 57 tracked paths modified, six untracked, none staged. Preserve the four owner-excluded untracked paths and all existing edits. No commit/push.
IMPLEMENTATION = iOS foreground refresh preserves pending child confirmation. After restart, the app recovers the exact unresolved bootstrap attempt even if its device identity was saved before the crash, verifies the recovered device ID, and re-presents the server-authorized profile. If the profile was persisted but attempt clear failed, a matching recovery reconciles the attempt; replacement attempts are retained. The attempt store now provides serialized `performIfCurrent` semantics with a post-operation ownership recheck. Keychain wrappers share process-local locking.
REGRESSIONS = Added foreground preservation, restart recovery, mismatch rejection, confirmed-profile cleanup after restart, cross-wrapper serialization and reentrant replacement tests. Abandonment tests wait for durable attempt removal.
VALIDATION_AND_REVIEW = Swift frontend syntax parsing passed for 11 changed Swift files and `git diff --check` passed. Five distinct read-only mobile specialists reviewed; actionable lifecycle, custody and test-synchronization findings were corrected. XCTest/typecheck/current-head CI remain unrun because `xcodebuild` is unavailable on this Windows host.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/20 remain open. Platform remains `HOLD_PARENT_DEPENDENCY`; physical Android/iOS, live DB, owner localhost acceptance, Azure and production gates remain separate/open. `READY_FOR_AZURE_DEPLOYMENT = NO`.
NEXT = Continue remaining implementable TODO-12/14/15 work and the legacy direct-bootstrap compatibility gate. TODO-20 live `pca_pro` reconciliation remains pending reachable read-only access. No current exact-head CI, commit, push or external acceptance is claimed.

## Terminal resume — enrollment attempt outcome resolution — 2026-10-08

CONTINUITY_STATUS = Continued the existing mission on pca-dev. Fetch was denied at .git/FETCH_HEAD; direct git ls-remote could not reach GitHub through the workstation proxy.
LOCAL_HEAD = 9205590febe0fa043e249587db50eac80ef7eb44; cached origin/pca-dev = 94a721dcbd0306c7fd59c1b3546533c1be304218. Server head was not freshly verified; last supplied independent verification is 4f16b29ee434b090e95a48888ab319fde8b3d795.
WORKTREE = 57 tracked paths modified, none staged; six untracked paths include migrations 0064/0065 and four owner-excluded paths. Preserve .vscode/, root 0, PARENT_FIRST_DEVICE_TRUST_SET_PROTOCOL_REVIEW.md, and ios/scripts/__pycache__/. No commit or push.
IMPLEMENTATION = Migrations 0064/0065 add durable attempt resolution and hash-only abandoned-attempt tombstones. Server prepare/bootstrap/recovery serialize on invitation ownership. Android and iOS resolve prepare rejection before bootstrap; definitive abandonment clears only the exact unsent attempt and owned key aliases. Android alias deletion proceeds independently. Existing digest binding, exact-tuple retries, link admission and replay-audit behavior remain in place.
LOCAL_VALIDATION = Previous focused Android Debug suite 137/137; this continuation's Android coordinator, Wave 6C, root-store, and trust-root-coordinator tests passed 118/118 (71/10/16/21). Added checks cover absent/unreadable and malformed-alias root handling, custody-conflict rescan/recovery-only UI state, stale pending ownership, and shared-lock cleanup/seed-capture serialization. The PREPARED restart regression asserts the full invitation/platform/DSK/DEK/attempt/recovery-token tuple. Backend coordinator/audit 46/46; MySQL enrollment 25/25; Parent authority diagnostics 63/63; canonical schema drift 5/5; TypeScript build and disposable bootstrap artifact checks passed. Disposable MySQL 8.4.11 replayed 63 migrations; 96 tables/834 columns. Post-validation passed fingerprint sha256:2143678ea123e129b1a7eb958a9271651be0834282fcf375fcc10911c4cc6050, scanned all 834 column names and confirmed 91 non-reference tables empty. Owned disposable DBs were removed; no seed/business rows were added.
IOS_AND_REVIEW = Apple XCTest/typecheck and current-head CI were not run. Three fresh read-only mobile specialists found prepare-404 stranding, lost abandonment-response history, missing wire tests, alias-cleanup independence, and legacy direct-bootstrap compatibility risk. Three follow-up reviews confirmed the Android custody guard, alias binding, conflict UI, and recovery-only rescan behavior with no remaining blocker in those areas. Prior five-specialist mobile review remains recorded below.
LEGACY_CLIENT_ROLLOUT_GATE = The server still accepts `/v1/enrollment/bootstrap` without a prior PREPARED reservation. An older binary can therefore race its direct bootstrap against recovery; old code may release local attempt/key custody on a recovery 404 before bootstrap commits. Before rollout, retire/gate direct-bootstrap clients or implement a recovery contract that proves safe for them. This remains open and blocks enrollment rollout.
BASE_CI = Quality Gates run 37719634712 failed at cached base 94a721dcbd0306c7fd59c1b3546533c1be304218: 418 iOS tests, 6 skipped, 2 assertions failed in testMissingDskOrDekPublicMaterialKeepsEnrollmentAttemptBehindSecurityGate. No current-worktree CI result exists.
TODO20_LIVE_PREFLIGHT = Last bounded probe resolved pca-mysql.mysql.database.azure.com to 4.161.89.178; TCP/3306 timed out. No live SQL, grant inspection/change, firewall action or mutation occurred. Disposable migration evidence does not prove retained UAT or live pca_pro parity.
TODO_AND_GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-12/14/15/20 remain open. Platform remains HOLD_PARENT_DEPENDENCY. Physical Android/iOS, live DB, owner localhost acceptance, Azure and production gates remain distinct and open; READY_FOR_AZURE_DEPLOYMENT = NO.
NEXT = Continue remaining implementable TODO-12/14/15 work and TODO-20 live schema/grant reconciliation when reachable read-only access is available. Resolve the legacy client compatibility contract before enrollment rollout. No commit or push; current remote cannot be verified.
## iOS enrollment cancellation checkpoint — 2026-10-08

SOURCE_BASE = `94a721dcbd0306c7fd59c1b3546533c1be304218`; prior Android/local-DB checkpoint published and remote verified. Exact-base Quality Gates run `37719634712` completed FAILURE; see the terminal-resume checkpoint above for its test summary. No current-head PASS is claimed.
IMPLEMENTATION = Enrollment bootstrap/recovery preserve CancellationError rather than network classification. Cancellation is checked before HTTP send, after response, and before mapping other transport errors; application paths check before consuming enrollment input and immediately after client awaits before seed, identity, key-cleanup or profile mutation. Cancellation exposes recoverable state and retains existing attempt/key custody. Normal transport-error classification, PAIRING_PENDING validation and crypto/authority gates are unchanged.
REGRESSIONS = Added both-endpoint tests for precancelled zero-send, explicit cancellation, cancellation-insensitive success, canceled timeout/unknown errors, and ordinary error classifications. Model fixtures cancel the actual enrollment task then return success: retained credentials, no root/identity/disclosure/profile/key-cleanup publication, and same-attempt recovery after restart are asserted. Bootstrap setup avoids scheduling recovery and asserts the exact endpoint. Fixture aliases do not prove physical Secure Enclave key survival.
VALIDATION_AND_REVIEW = Swift frontend syntax parse and git diff whitespace check PASS. XCTest runtime/typecheck requires Apple CI; Windows SDK headers are unavailable locally. Five read-only mobile specialists reviewed contract, tests, security, adversarial errors and integration; reported test determinism/error-classification findings corrected. No scene/background task ownership or lifecycle cancellation was added or claimed.
NEXT_REPOSITORY_TASK = Review confirmed an independent overlapping-enrollment gap: bootstrap/recovery tasks can overwrite the sole saved attempt while an earlier HTTP call is suspended, then publish stale identity or clean up another attempt's keys. Implement shared enrollment admission/single-flight, preserve unresolved attempt ownership, synchronize router access and revalidate exact persisted ownership after awaits. Add suspended-transport and externally replaced/unreadable-attempt regressions. Do not treat cancellation hardening as closure of this concurrency gap.
TODO20_LIVE_PREFLIGHT = Fresh DNS resolves pca-mysql.mysql.database.azure.com via pca-mysql.privatelink.mysql.database.azure.com to 4.161.89.178; bounded TCP/3306 failed. No live SQL read/mutation, grant change, firewall action or deployment. Local schema/grant reconciliation remains proven in previous checkpoint; live parity remains open.
BOARD_AND_GATES = Parent board retained: 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-12/14/15/20 remain open. Physical Android/iOS, live DB, owner LOCALHOST ACCEPTED, Platform HOLD_PARENT_DEPENDENCY, Azure and production gates remain separate/open. READY_FOR_AZURE_DEPLOYMENT = NO.

## Android enrollment durability / local exact-grant checkpoint — 2026-10-08

BASE_AND_CI = Published iOS checkpoint `72b6e34340ba020faef99eb9b9913e8376e10767` passed exact-head Quality Gates run `37716773833` SUCCESS 27/27. Excluded paths preserved.
ANDROID = Pending/family records now require shared-lock serialization, synchronous flush and exact readback. Writes attempt verified rollback; uncertain restoration blocks all enrollment wrappers sharing the backing identity. Pending/family persistence failure blocks coordinator actions with EN/AR UI and no action buttons. Every bootstrap/recovery confirms pending durability; definitive cleanup clears durably before deletion and preserves any family/ceremony key custody. Malformed pending cannot become absent. Partial-confirmation restart retains recovery; a recovery response cannot replace another committed device. Authority, crypto and activation gates unchanged.
REVIEW_AND_TESTS = Five distinct mobile specialists reviewed durability, QA, security, restart custody and API/cancellation; findings corrected and re-reviewed. Focused PASS 59/59: coordinator 47, durability 5, family store 7. Full Android unit result: 1641 tests, 0 failures/errors, 1 existing skip. lintDebug, compileReleaseKotlin and compileDebugAndroidTestKotlin PASS; full campaign terminal exit 0 (14m 14s). Exact-publication CI pending.
TODO20_SCHEMA = Fresh retained local UAT and actual repository migration replay schema match exactly across 95 tables, columns/indexes/constraints/FK actions. All 61 migration journal entries through 0063 present. Disposable test phase: 707 PASS, 0 failures, 10 skips out of 717. Original process stopped before certification; after verifying absence, only certification resumed on the same owned DB. Production-path certification PASS 280/280 with 0 skips/failures.
TODO20_GRANTS = Dedicated local runtime principal validated against official exact grant plan on the owned disposable DB first, including append-only DELETE denial, then reconciled on retained UAT. Exact 95 table grants verified; no global admin, grant options or roles; retained table row counts unchanged; root admin preserved; no retained seed data. No schema migration required. Exact existing source used: backend/scripts/provision-runtime-db-grants.mjs and backend/scripts/db/runtimeGrantPlan.mjs. Credential remains in ignored private local artifacts.
LOCAL_AVAILABILITY = API restored on 127.0.0.1:4001 with existing synthetic-account keys and dedicated principal. /health/db HTTP 200; actual runtime-principal pool connection observed. Parent 127.0.0.1:4000 and Platform 127.0.0.1:4100 return HTTP 200 HTML. This is technical availability, not authenticated-action coverage or owner acceptance. Owned disposable database cleanup PASS after verifying no active sessions; retained UAT and its runtime principal remain intact.
BOARD_AND_GATES = Parent 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-12/14/15/20 remain open. Local DB progress does not establish live pca_pro parity. Physical Android/iOS, live DB, owner LOCALHOST ACCEPTED, Platform HOLD_PARENT_DEPENDENCY, Azure and production gates remain separate/open. READY_FOR_AZURE_DEPLOYMENT = NO.
NEXT = Publish scoped source/tests/ledgers, verify remote and exact-head CI, then continue the same mission.

## Continuation checkpoint — iOS queued cancellation and local DB reconciliation — 2026-10-08

CHECKPOINT_BASE = `8ec677b41cecb74e18f511ffc8d64c45dfab6f10`; fresh fetch and direct server ref agree. Exact-base Quality Gates run `37715329409` completed SUCCESS. Existing owner-excluded untracked paths are preserved.
IMPLEMENTATION = FirstDeviceSingleFlightGate checks task cancellation after acquiring its FIFO gate and before invoking ceremony work, inside the existing unlock-on-error boundary. Regression asserts cancellation is preserved, the operation is skipped, and the gate remains reusable. This does not alter authority, cryptography, submission ambiguity handling, or device activation.
LOCAL_VALIDATION = Swift frontend syntax parsing of both changed files PASS; git diff whitespace check PASS. Windows executable Swift validation could not compile because Windows SDK C headers are absent; it is not counted as a passing runtime test. Apple XCTest and exact-publication CI remain pending.
SPECIALIST_REVIEW = Five distinct read-only mobile specialists reviewed Android storage, iOS contracts, backend/relay contracts, enrollment durability, and cancellation. The final cancellation diff was approved by the fifth specialist. Coordinator remains sole implementation writer.
NEXT_REPOSITORY_WORK = Android pending-attempt and family-state adapters currently write asynchronously before bootstrap submission or pending cleanup. Implement synchronous flush/exact-readback, verified rollback and shared uncertainty blocking, with coordinator recovery/key-cleanup handling and failure-injection tests. Preserve keys on uncertain storage; clear pending durably before definitive key deletion. No ordinary Trust Set submission or iOS usage binding is invented.
TODO20_LOCAL = Actual retained synthetic UAT MySQL is reachable on loopback port 33061, version 8.4.11, with 95 tables and all 61 migration journal entries through 0063; no pending or unknown migrations. The documented runtime principal is root@% with global administrative grants. A full all-certified campaign is running in a separately owned disposable database before correcting UAT to a dedicated exact-grant runtime principal. Retained UAT data and grants have not yet been changed; campaign completion and cleanup remain unproven at this checkpoint.
TODO_BOARD_AND_GATES = Existing Parent board remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-12/14/15/20 stay open; TODO-19 base evidence is PASS, new publication evidence pending. Platform HOLD_PARENT_DEPENDENCY, physical Android/iOS, live pca_pro, owner LOCALHOST ACCEPTED, Azure and production gates remain separate and open. READY_FOR_AZURE_DEPLOYMENT = NO.

This is the live mission history. The canonical TODO-01…TODO-23 board remains in `docs/pca_independent_senior_reviewer/PARENT_CODEX_MASTER_TODO.md`; continue the same mission and retain its history. The 2026-10-04 owner amendment assigns Codex overall implementation ownership and authorizes continuing repository engineering. External device, live database, owner acceptance, Platform, Azure, and production gates remain separate.

## Current checkpoint — 2026-10-08

```text
PURSUING_GOAL = PCA Parent Authentication + Authority — Continuous Completion
OWNER = Codex coordinates and implements the continuing Parent mission
MISSION_STATUS = IN_PROGRESS
BRANCH = pca-dev
CONTINUITY_STATUS = PASS
LOCAL_HEAD_AT_CI = 0b6932db29c372459c63ce725f9d9895a4f1e0c9
ORIGIN_HEAD_AT_CI = 0b6932db29c372459c63ce725f9d9895a4f1e0c9
SERVER_HEAD_AT_CI = 0b6932db29c372459c63ce725f9d9895a4f1e0c9
PRODUCT_SOURCE_CHECKPOINT = 3ffc62b3d286a257b912a2bd947dea5106fa9167; subsequent 6c18d2a8 and 0b6932db publications updated mission/TODO documentation only.
EXACT_HEAD_CI = Quality Gates run 37714585409 completed SUCCESS 27/27 at 0b6932db29c372459c63ce725f9d9895a4f1e0c9, including full disposable-MySQL, Android, iOS, and real-backend browser E2E. Prior run 37713556780 passed 27/27 at 6c18d2a87415d892ce73fa62b0e88a3bb3a1143b. Runs 37713055890 at cc47c42c and 37713389129 at 3ffc62b3 were cancelled after superseding fast-forwards.
LOCAL_ANDROID_TESTS = Focused UsageSyncPortTest 2/2, DeviceSessionManagerTest 9/9, and ReconnectSyncOrchestratorTest 26/26 passed (37/37 total).
WORKTREE_STATUS_AT_REENTRY = No tracked changes; four pre-existing untracked paths remain preserved: .vscode/, root file 0, docs/pca_independent_senior_reviewer/PARENT_FIRST_DEVICE_TRUST_SET_PROTOCOL_REVIEW.md, and ios/scripts/__pycache__/.
PARENT_TODO_BOARD = 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-19 is PASS at run 37713556780; TODO-12/14/15/20 remain open.
TODO14 = Route status evidence exists for all 52 declarations; GLOBAL_AGGREGATE_STATUS remains NOT_YET_PROVEN because gated/service-dependent outcomes are not functionally proven.
TODO20_REPOSITORY_LOCAL = Repository/disposable validation is through migration 0063. Live pca_pro was last schema-verified at 0059. Fresh DNS resolved pca-mysql.mysql.database.azure.com through pca-mysql.privatelink.mysql.database.azure.com to 4.161.89.178; a bounded TCP/3306 probe timed out. Azure MySQL resource enumeration returned AADSTS50078 because cached MFA had expired; no logout, interactive login, live SQL read, or mutation occurred.
PLATFORM = HOLD_PARENT_DEPENDENCY
EXTERNAL_GATES = Physical Android/iOS, live DB schema/grants, owner localhost acceptance, Platform dependency, Azure deployment, and production acceptance remain separate and open. READY_FOR_AZURE_DEPLOYMENT = NO.
NEXT_IMPLEMENTABLE_TASK = Resume TODO-20 with read-only live preflight when the approved target is reachable. No safe source-only TODO-12/14/15 change emerged without the reviewed Trust Set authority, key-custody, and encrypted-delivery contracts.
```

## Historical checkpoint — 2026-10-05 (superseded by the 2026-10-08 checkpoint)

```text
PURSUING_GOAL = PCA Parent Authentication + Authority — Continuous Completion
OWNER = Codex coordinates and implements the continuing Parent mission
MISSION_STATUS = IN_PROGRESS
BRANCH = pca-dev
VERIFIED_REMOTE_HEAD = 86b2fac0bde15b22570b636acc865713f108c369 (last successful live remote check in the prior continuation; local HEAD and cached `origin/pca-dev` still match; no new live fetch is claimed)
LOCAL_IMPLEMENTATION_COMMIT = 23487319 (bounded Trust Set compare-and-append); CHECKPOINT_SYNC_COMMIT = 6f983f6c; CI_CORRECTION_COMMIT = 86b2fac0
EXACT_HEAD_CI = run 37238320816 completed SUCCESS at 86b2fac0: 27/27 jobs succeeded, 0 failed, 0 skipped, including Backend build/unit tests, full disposable-MySQL, Android, iOS, browser E2E, security, release controls, and web suites. The preceding run 37237189482 failed 1/27 because a static source guard rejected the resolver class name in a route comment; that comment-only correction is in 86b2fac0.
VALIDATION = Backend build passed. Exact-head CI run 37238320816 at 86b2fac0 passed 27/27. Current local MySQL 8.4.11 `test:db:full-certified` applied all 61 migrations through 0063; inner lane passed 696/706, 0 failed, 10 explicit privilege-only skips; populated production-path lane passed 276/276, 0 skipped/failed; the focused least-privilege/runtime/append-only gate passed 7/7. The earlier 95-table snapshot/manifest comparison remains historical schema evidence. Temporary schemas and generated principals were cleaned; both temporary servers were stopped.
CAS_REVIEW = Seven reviewers approved the scoped CAS diff with 0 blocker/major/minor; source now enforces the shared `0..INT32_MAX` protocol bound over the unsigned 32-bit persisted column before ordinary ingestion is considered
PARENT_TODO_BOARD = 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO or owner/release gated (18,21,22,23) / 0 BLOCKED
TODO14 = 49/52 integrated; aggregate NOT_YET_PROVEN
PLATFORM = HOLD_PARENT_DEPENDENCY
REPOSITORY_SCHEMA = 0063 (61 migration files)
DISPOSABLE_MYSQL = Latest campaign used fresh extracted MySQL 8.4.11 on loopback 127.0.0.1:33362 with UTC timezone; the wrapper applied all 61 migrations, completed full and populated production-path certification, removed the owned schema, and the server was stopped with its temp datadir retained. The earlier task-owned 33062 container was not used or changed in this campaign.
TODO20_LOCAL = YES for repository/disposable validation through migration 0063: 61 migrations; 706 inner tests (696 passed, 0 failed, 10 explicit privilege-only skips); 276/276 populated production-path tests with no skips/failures; focused runtime grant and append-only boundary 7/7. The latest Parent route audit passed 55/55 across 139 scenarios and 49/52 declarations; its aggregate remains NOT_YET_PROVEN. A read-only scan of loopback `pca_test` covered 13 numeric epoch columns (6,680 column cells): zero values were negative or above INT32_MAX. The connection used `root@%` global administrative grants, so it is not evidence of application runtime grants. The scan made no writes or seed data. Disposable campaign schemas and generated grant-test users were removed; temp datadirs were retained.
LATEST_CHILD_APP_DISTRIBUTION = Owner selected the public landing-page model at `https://www.pcasafe.com/child-app/`. Focused Child App landing/enrollment-fallback/asset-links/nginx tests passed 8/8; Parent Download App components passed 21/21 in the elevated local runner; Public Web production build passed and emitted 20 EN/AR routes with exact 219/219 key parity, including this route. 63 new copy keys still need review and Arabic native review remains pending OD-12. The Parent production URL stays unset until live route verification; installer/signing/assetlinks/enrollment gates remain open.
LIVE_PCA_PRO = Last verified at migration 0059 versus repository 0063. Fresh DNS resolved to 4.161.89.178; a bounded TCP/3306 probe timed out this turn. No live SQL session/query/mutation occurred and repository/live parity remains NO.
LOCAL_OWNER_UAT = Retained local owner-UAT schema last recorded at 0061; literal owner `LOCALHOST ACCEPTED` remains NOT GIVEN.
REAL_DEVICE_GATES = Android and iOS physical-device proof OPEN; production Android and Apple attestation configuration OPEN.
RELEASE_GATES = Platform, Azure, deployment, and production remain HOLD.
CURRENT_WORKTREE_BASE = 86b2fac0bde15b22570b636acc865713f108c369 (local HEAD = cached `origin/pca-dev`); Parent/Android/Public Web/Platform continuation changes are local-only, uncommitted, and have no exact-head CI result. The latest live remote refresh was blocked by the workstation proxy.
CURRENT_PRODUCTION_READINESS = Reuse the existing Public Web host `https://www.pcasafe.com` for `/child-app/`, `/enroll/` and `/.well-known/assetlinks.json`; no new domain is required. The owner selected `https://www.pcasafe.com/child-app/` as Parent's public installation-information destination. Parent copy identifies it as an options/status page, not proof of installer availability. Parent and backend have separate explicit production readiness gates, both closed by default; backend denies authorized Android invitation creation before step-up or writes when closed. The landing page still needs deployment and an approved signed installer destination; release signing/fingerprint are absent.
CURRENT_DOMAIN_MAP = PUBLIC_WEB_DOMAIN=https://www.pcasafe.com; PARENT_WEB_DOMAIN=https://parent.pcasafe.com; PLATFORM_WEB_DOMAIN=https://platform.pcasafe.com; API_DOMAIN=https://api.pcasafe.com; PROPOSED_CHILD_APP_LINK_HOST=www.pcasafe.com; REUSES_EXISTING_DOMAIN=YES; NEW_DOMAIN_REQUIRED=NO.
CURRENT_LOCAL_VALIDATION = Parent Web full serial suite passed 154/154 files and 1106/1106 tests; its route matrix passed 73/73. Route-level lazy loading and vendor chunking produced a 401 kB app entry and 296 kB vendor chunk, with no chunk-size warning. Parent production build passed with `https://www.pcasafe.com/child-app/` and enrollment readiness false; focused Download App/header/Add Device tests passed 23/23 and Chromium Download App E2E passed 6/6. Backend build passed and focused bootstrap service/routes/proof/commit/canonical-vector, attestation-verifier, and production-wiring tests passed 56/56. Source enforces the shared `0..INT32_MAX` bound; ordinary acceptance remains unwired. This local validation does not replace exact-head CI. iOS XCTest remains unavailable on this Windows host. Nginx runtime checks remain unavailable because Docker Desktop's Linux engine pipe denies access.
CURRENT_SAFE_ZONE_GUARD = Safe Zone PATCH/DELETE now check current Administrator membership before reading family rows, then retain the verified device-session bearer, recipient ownership, and shared Trust Set-backed policy check before mutation. Stable Viewer/revoked requests receive 403 for existing or absent zone IDs; a membership-change-during-lookup regression also proves consistent 403. This closes the ID-existence oracle but does not establish receiving-device signed-envelope acceptance or complete TODO-12.
CURRENT_EXTERNAL_GATES = Earlier direct GETs on 2026-10-05 returned Public `/child-app/` 404, `/enroll/` 404 and assetlinks 403; Parent/Platform roots 200 HTML; Platform `whoami` 401 JSON; API health and health/db 200 (`database=connected`). A later browser-tool recheck could not access the Child App routes, so no new live status is inferred. The new handlers remain source-only. Fresh read-only Azure inventory confirms Public/Parent/Platform apps and HTTPS host bindings; the API CNAME target is not represented by an API app/custom-host binding in the accessible subscription. Live `pca_pro` remains last verified at 0059 vs repository/local 0063; fresh TCP/3306 returned false and no SQL query/mutation occurred. Android signer and usable installer destination, assetlinks publication, API ownership, owner acceptance, Platform activation and production release remain HOLD.
CURRENT_GIT = No commit, push or deployment performed. Existing dirty/untracked work was preserved; `.vscode/`, root `0`, and the independent review artifact remain untouched. The cached tracking ref matches local HEAD, but today's live GitHub refresh failed through the workstation proxy.
NEXT_PRODUCTION_READINESS = Continue the deployment-grade route/action/runtime audit for the owner-selected Parent information page at `https://www.pcasafe.com/child-app/`; configure the downstream signed installer/store destination and real signing fingerprint, prove nginx behavior and token-free logs, recheck deployed domain routing, diagnose live DB connectivity/parity read-only, run cross-surface production builds/tests, and close page/button/action gaps before the separate Azure deployment gate. The landing-page choice is settled; live route verification, signed installer, signing, App Links publication and Azure remain release holds.
NEXT_REPOSITORY_WAVE = Cross-surface `INT32_MAX` epoch-bound enforcement is in progress. Backend raw-input ordering, durable-row checks, Family Envelope, Trust Set, recovery, owner-attestation, removal, audit, tamper, alerts, Safe Zones and routes have focused implementation/tests. Android schedule snapshots, receipts, Family Envelope wire codec, Safe Zone receipt, local family state and recovery-envelope storage now share the range with field-specific positive minimums and zero sentinels preserved. Sync Receipt ingestion checks all durable rows in a family before using its sequence floor. `DeviceEntity` has no production upsert callsite; its current readers use member/device IDs rather than epoch fields, so its stored epoch columns remain part of the pre-deployment local-store inspection without a constructor guard that could obstruct recovery/deletion of legacy rows. Remaining work is confirmation of other protocol entry points and the pre-deployment read-only persisted-row scan because MySQL columns are `INT UNSIGNED`. iOS XCTest is unavailable locally; prior iOS source changes still require CI/device evidence.
```

### 2026-10-05 — Parent full-suite and first-device checkpoint refresh

PARENT_WEB = Full serial Vitest passed 154/154 files and 1106/1106 tests; the route matrix passed 73/73. The prior full-suite-only timeout on the CHILD `/privacy/delete` denial assertion was addressed with a 5-second async-query timeout; the exact denial assertion remains unchanged. Route-level lazy loading and vendor chunking build cleanly at 401 kB plus 296 kB, with no oversized-chunk advisory; Download App Chromium E2E passed 6/6.
FIRST_DEVICE = Backend build and focused bootstrap service/routes/proof/commit/canonical-vector, attestation-verifier, and production-wiring tests passed 56/56. Source implements and composes the 6B/R1 ceremony plus Android 6C and iOS 6D attestation clients behind fail-closed production configuration. Android/iOS physical-device evidence and production pinned roots/configuration remain open. Ordinary epoch-N acceptance, general mobile submission/retry, signed policy application and receiving-device enforcement remain separate gates.
CHILD_APP = Owner selected `https://www.pcasafe.com/child-app/` as the public landing-page destination. Parent production build passed with that local build input and enrollment readiness false; the live Public route remains unverified, and installer/signing/assetlinks gates remain open.
LOCAL_STATE = Local HEAD and cached `origin/pca-dev` equal `86b2fac0bde15b22570b636acc865713f108c369`; current worktree contains 243 dirty status entries and no staged paths. No commit, push, deployment, live DB access/mutation, or owner acceptance occurred. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Continue TODO-12/14 through independently executable source/evidence work. Do not activate ordinary Trust Set ingestion or device lifecycle transitions until their mobile protocol and receiving-device proof are complete; retain Platform, live DB, localhost owner acceptance, and production gates.

### Source-to-ledger implementation matrix — 2026-10-05

| Item | Current source and test state | External dependency | Code still required | Can implement now / priority |
|---|---|---|---|---|
| Safe Zone Parent policy writes | This continuation wires the shared Trust Set-backed `EDIT_CHILD_POLICY` precheck and verified device-session actor into POST/PATCH/DELETE; reads retain active Parent membership checks. Focused route tests passed 7/7 and Parent client tests passed 7/7. | Trust Set acceptance and receiving-device signature/application proof remain separate gates. | Keep this guard intact; reconcile remaining actor/member audit attribution and test durable audit evidence before TODO-12 promotion. | Local route bypass fix complete; TODO-12 remains IN_PROGRESS. |
| Ordinary Trust Set epochs | Backend canonical decode, signature/owner validation, floors, MySQL storage, expected-head CAS and shared `0..INT32_MAX` bounds are present across backend/mobile policy boundaries; migration 0060 uses unsigned 32-bit columns, with source enforcing the narrower common protocol maximum. No production ordinary-acceptance caller exists. | General mobile epoch-N API/signing/retry contract and physical-device evidence; approved genesis/root remains separate. | Connect ordinary acceptance only after byte-level mobile request/retry semantics are resolved; retain direct-candidate and durable-row bounds and keep genesis exclusive to first-device bootstrap. | Numeric bound source work complete; ordinary ingestion remains gated. |
| First-device root | Android hardware-backed DSK/Key Attestation, iOS Secure Enclave DSK/App Attest, and backend bootstrap ceremony exist. | Genuine devices and operator-pinned roots/configuration. | No source reimplementation; collect external proof. | Repository source exists; evidence stays open. |
| Device lifecycle | Registration is `PAIRING_PENDING`, owner confirmation reaches `PAIRED`, and revocation exists; no Trust Set-authoritative `PAIRED -> ACTIVE` writer. | Reviewed activation semantics and mobile receipt path. | Add only a server-authoritative transition justified by accepted Trust Set state. | Candidate after epoch protocol; priority 3. |
| Schedule-policy authorization | Parent session Administrator/CSRF plus actor-device checks precede shared Trust Set authorization; the production resolver reads accepted epochs and fails closed. The route relays ciphertext as pending and does not apply policy. | A committed Trust Set and receiving-device enforcement. | Preserve authority separation and add DB-backed route evidence once ordinary epochs work. | Part of priority 1; not yet integrated. |
| Web Rules delivery | Production Web Rules service is absent; the three routes return `503 not_configured`. | Reviewed encrypted persistence and delivery contract. | Implement the storage/delivery path after its security contract is resolved. | Later wave. |
| Recovery | Recovery engine has tests, but no production recovery route; all-device-loss authority recovery remains gated. | Reviewed recovery authority protocol. | Safe status/restart/revocation handling can be separately implemented without authority recreation. | Later wave. |
| Mobile ordinary update | Android and iOS currently expose genesis bootstrap only; no generic epoch-N encoder, submission API, accepted-head projection, or byte-stable ordinary retry. | Physical-device certification remains external. | Define and implement cross-platform canonical model/signing/API/retry behavior. | Yes, paired with priority 1. |

### 2026-10-05 — local validation and Safe Zone authorization update

PARENT_WEB = Final serial Vitest run passed 153/153 files and 1103/1103 tests; `npm run typecheck` and `npm run lint` passed. The full isolated fixture Playwright suite passed 101/101, including the six Download App scenarios. Earlier full runs caught the editorial wording issue and then two stale assertions; the wording and assertions were corrected before the final pass.
SAFE_ZONE = Backend build passed and the focused Parent Safe Zone route suite passed 7/7, including actor bearer derivation, policy-authorizer denial before writes, missing bearer, mismatched legacy actor header, role checks, and recipient ownership. Focused Parent browser-client tests passed 7/7. This is local evidence only and no real accepted Trust Set or recipient-device application was exercised.
PUBLIC_WEB = Node tests 24/24 and the static production build passed. The container verifier's distribution expectation comes from `dist/child-app/index.html`, avoiding a false result when Docker build args and verifier process env differ. The current built artifact remains in the truthful unavailable state because no owner-approved signed installer/store destination is configured.
ROUTES_AND_RELEASE = The owner selected `https://www.pcasafe.com/child-app/` as Parent's information page. Direct web-tool reads of `/child-app/`, `/.well-known/assetlinks.json` and `/enroll/` were inaccessible; the prior Edge check showed `/child-app/` not found, so the Parent production URL remains unset until deployment and verification. The downstream installer/store destination, signing fingerprint and assetlinks publication remain open. No current Docker nginx proof, live database access, commit/push, Azure deployment or production action.

### TODO-14 remaining integrated-evidence gaps — source dispositions

1. `GET web-rules`: service/storage/delivery gate; production service absent and route returns 503.
2. `POST web-rules`: service/storage/delivery gate; production service absent and route returns 503.
3. `POST web-rules/remove`: service/storage/delivery gate; production service absent and route returns 503.
4. `POST removal-decisions/:requestId/decide/signed`: crypto/device gate; keep fail-closed pending signing-key binding.
5. `POST removal-decisions/:requestId/decide/authorized-recovery`: recovery-protocol gate; all-device-loss authority recreation remains outside this wave.

`POST schedule-policy` has integrated fail-closed MySQL HTTP evidence: a real Parent session with no accepted signed Trust Set epoch receives 403 and causes no relay. It remains authority-gated for successful action until the reviewed epoch-N protocol and receiving-device enforcement are implemented. `GET dashboard` is still an optional, unconsumed route, but its same-family read and truthful limited capability states are now integrated.

NEXT_REPOSITORY_ACTION = Continue TODO-12/14/15 from current source and ledgers. First-device bootstrap architecture is implemented; operator roots, real-device attestation, ordinary epoch-N request/retry semantics, receiving-device policy enforcement and encrypted policy/audit gates remain open. Local TODO-20 certification is complete; live parity remains open. Do not activate Platform, deploy, or claim owner acceptance.
### 2026-09-28 02:34 UTC — status report reconciled; publication and exact-head CI passed

REPORT = The attachment's `0daf660` failure snapshot, `399304c` checkpoint, and live migration-0050 claim are historical. Current `origin/pca-dev` is `dfefe27c277c0e225ee1f1a50e38f00871dc8082`; live `pca_pro` was already reconciled through migration 0059 with exact schema/grant postflight and row-count preservation.
GIT = Three reviewed fast-forward commits (1056546e, 6b7bf8e, dfefe27c) are pushed. Fresh fetch, local HEAD, `origin/pca-dev`, and `git ls-remote` agree. Unrelated `.vscode/` and root `0` were preserved outside the commits.
CI = Quality Gates run `36369764525` completed SUCCESS at exact HEAD `dfefe27c`: 27 jobs passed, none failed, including integrated real-backend browser, disposable-MySQL full DB, Parent/Platform browser, Android, iOS, security, builds and unit tests.
GATES = TODO-17/19 are PASS for this checkpoint; TODO-12/14/15 and TODO-18 literal owner localhost acceptance remain open. TODO-20 remains PASS. Platform stays `HOLD_PARENT_DEPENDENCY`; no activation, deployment, production smoke or owner UAT occurred.
NEXT_ACTION = Continue the same mission from TODO-12/14/15; retain fail-closed crypto/policy boundaries and the owner acceptance gate.

### 2026-09-28 02:47 UTC — authentication TODO-02…09 re-evaluated

CI = Quality Gates run `36370514236` completed SUCCESS at exact HEAD `739133e9fe7b8240f4f104b1ba8d4879efc3e234`; all 27 jobs passed, including Parent auth/migration DB, first-owner bootstrap, full MySQL, MFA/browser, Parent Web, Platform and integrated real-browser jobs.
TODO02_09 = Promoted to PASS in both master and canonical boards because their stated login, verification, provisioning, browser assurance, 72-hour MFA, TOTP setup, known-browser and unknown-browser criteria are covered by the exact-head integrated suites.
REMAINING = TODO-10 still depends on TODO-14 route/action closure. TODO-12/14/15 and TODO-18 literal owner acceptance remain open. TODO-20 remains PASS through live migration 0059. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Continue from TODO-10's TODO-14 dependency and the active TODO-12/14/15 authority and device-security work.

### 2026-09-28 03:09 UTC — exact-head owner-flow 429 diagnosed; test correction pending

CI = Exact-head Quality Gates run `36371470989` at `a6fbc745bb153aa11f92a72d20e94e6475f6c67e` completed FAILURE: 26/27 jobs succeeded; the real-backend browser job failed.
FINDING = The owner acceptance journey exceeded the shared 60/minute per-IP auth-attempt budget; `GET /api/parent/session` returned 429 at `/settings`, and the page redirected to sign-in. The suite's previous monitor counted 401/403 but not 429, masking the test-bucket problem until the Settings heading assertion. The separate cross-family test passed.
CORRECTION = Added a dedicated TEST-NET forwarded address to the long acceptance journey through the disposable loopback proxy and expanded the monitor to fail on 429. Production rate limits/proxy trust remain unchanged. Parent Web typecheck and strict TypeScript compilation of the changed real-E2E spec pass; `git diff --check` and JSON parse/disposition coverage also pass. The local browser rerun could not use `test.db.env`'s port 33061 credentials; a separate local MySQL 9.7 instance was rejected by the pinned MySQL 8.4 gate and its task-owned database/directory were removed. The fix awaits real-backend CI validation.
TODO17_19 = IN_PROGRESS pending published correction and fresh exact-head CI. Previous run 36370514236 at 739133e9 passed 27/27 but is not the latest exact-head result.
NEXT_ACTION = Complete review/validation, publish only the intended paths fast-forward, verify refs, and inspect the next exact-head run.

### 2026-09-28 03:25 UTC — owner-flow correction passed exact-head integrated CI

CI = Quality Gates run `36373007968` completed SUCCESS at exact source/test HEAD `3ace68d92792e25de169d3dcb7cf6f1fd9b7075a`; 27/27 jobs passed. The certified owner-acceptance browser flow passed 2/2, zero skipped/unexpected/flaky, including the route that previously returned 429. Full MySQL, Android/iOS, Parent/Platform browser, security, build and unit jobs passed.
LOCAL_CAMPAIGN = Backend build PASS; TODO-14 route/action suites PASS 154/154, zero skips; Parent Web typecheck and changed E2E spec strict typecheck/lint PASS.
REPORT_RECONCILIATION = The supplied report's `0daf660`/`399304c` refs, runs `36350073129`/`36356186069`, and live migration-0050 snapshot are historical. Current remote checkpoint was `3ace68d9`; live reconciliation is recorded through migration 0059. Parent TODO-13 and TODO-17 are PASS on current evidence; TODO-12/14/15, TODO-18 and dependent Platform gates remain open.
ARCHITECTURE_CLARIFICATION = PCA-DEC-028 intentionally keeps BonusGrantLedger process-local; its optional active-grants read is classified unconsumed. Revoke browser exposure remains deferred because Parent actor provenance has no reviewed encrypted FamilyAudit delivery path. Do not add plaintext grant persistence.
NEXT_ACTION = Publish this matrix clarification and exact run/test evidence to both master ledgers, then resume TODO-12/14/15 while preserving the Platform hold.

### 2026-09-28 03:32 UTC — evidence sync pushed; follow-on exact-head CI queued

GIT = Documentation-only commit `baf3358f148bba17323c0ecbe4d79beb51a5c9f6` was fast-forward pushed to `origin/pca-dev`; fresh fetch, local HEAD, origin tracking ref and `git ls-remote` all agree. Only unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36374085095` is queued on exact current HEAD `baf3358f`; the preceding source/test checkpoint `3ace68d9` passed run `36373007968` 27/27.
NEXT_ACTION = Inspect run `36374085095`; continue the same goal at TODO-12/14/15 and keep TODO-19 active until its current-head evidence is complete.

### 2026-09-28 03:40 UTC — evidence-sync exact-head CI passed

CI = Quality Gates run `36374085095` completed SUCCESS at exact HEAD `baf3358f148bba17323c0ecbe4d79beb51a5c9f6`; 27/27 jobs passed.
GATES = TODO-17 remains PASS with the corrected Parent owner flow passing 2/2 in run `36373007968`, and its full integrated gate also passed at `baf3358f`. TODO-19 remains IN_PROGRESS while this CI-result synchronization is published. TODO-12/14/15 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Publish this result sync, then continue the earliest executable authority/device-security work in the same mission.

### 2026-09-28 03:45 UTC — CI-result ledger sync pushed; next exact-head run queued

GIT = Documentation-only commit `55c9067bd80c8debbcb8959caed7594f8d44b2f9` was fast-forward pushed; fresh fetch, local HEAD, tracking ref and `git ls-remote` agree. Only unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36374962516` is queued at exact HEAD `55c9067b`. Its parent `baf3358f` passed run `36374085095` 27/27.
NEXT_ACTION = Inspect run `36374962516`; continue TODO-12/14/15 and keep TODO-19 active until the current-head evidence is complete.

### 2026-09-28 04:00 UTC — exact-head E2E selector failure diagnosed

CI = Quality Gates run `36374962516` completed FAILURE at exact HEAD `55c9067b`: 26/27 jobs passed; only Real-backend browser E2E failed. The owner-acceptance flow reported 1 passed / 1 failed. The failing check used unscoped `getByRole('status')`; Settings simultaneously exposed the identity-loading status and the revoke-all confirmation status. The E2E JSON report was absent because that Playwright command exited nonzero, so later certified browser jobs were not run; their empty-report assertions are downstream failures.
FIX = Updated `parent-web/e2e-real/acceptance-flow.spec.ts` to target the exact confirmation copy. Parent Web typecheck and ESLint for that spec pass locally. No product source, authorization, rate-limit or database behavior changed.
GATES = TODO-17 is IN_PROGRESS until a fresh exact-head Quality Gates run passes. TODO-19 remains IN_PROGRESS; TODO-12/14/15 and owner TODO-18 remain open. TODO-20 stays PASS through migration 0059. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Commit/push the narrow E2E selector fix and updated ledgers, verify remote alignment, and inspect the new exact-head run before resuming the remaining Parent authority/security items.

### 2026-09-28 04:11 UTC — exact-head browser correction passed

GIT = The exact confirmation-text E2E selector and three mission-ledger snapshots were committed and pushed fast-forward as `4a1b372dd959596938ce6477f6262c2d3afb2118`; fresh fetch, local HEAD, tracking ref, and `git ls-remote` matched. Unrelated `.vscode/` and root `0` remain excluded.
CI = Quality Gates run `36376318648` completed SUCCESS at exact HEAD `4a1b372d`; all 27 jobs passed, including real-backend browser E2E and full disposable-MySQL certification. This resolves the prior selector ambiguity without changing product behavior.
GATES = TODO-17 is PASS for this integrated campaign. TODO-19 remains IN_PROGRESS until this result sync is published and its follow-on exact-head CI is inspected. TODO-12/14/15 and TODO-18 literal owner localhost acceptance remain open; TODO-20 remains PASS through live migration 0059. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Publish this result synchronization, then resume TODO-12/14/15; retain fail-closed crypto/policy boundaries and the owner acceptance gate.

### 2026-09-28 04:28 UTC — ledger-sync CI and authority/device review

GIT = CI-result ledger sync `678b1d33937c62e7b47da65ef88919f0209b523c` is pushed and matches fresh fetch, tracking ref and `git ls-remote`; unrelated `.vscode/` and root `0` remain excluded.
CI = Quality Gates run `36377167205` passed 27/27 at `678b1d33`; source/test checkpoint `4a1b372d` passed run `36376318648` 27/27, including real-backend E2E and full disposable-MySQL.
AUTHORITY = Specialist review confirmed schedule-policy, Web Rules, Parent actor audit, and configurable Family RBAC still require signed Trust Set/E2EE policy/audit protocol work. Existing surfaces stay fail-closed; no plaintext storage, bearer removal, actor sentinel substitution, or piecemeal policy flip.
DEVICE = Mobile review found no additional safe source change: production verifiers, durable Trust Set/key epochs, attestation, and signed first-policy receipt/activation remain unimplemented; current epoch/revocation controls remain fail-closed.
GATES = TODO-17 PASS. TODO-12/14/15 remain IN_PROGRESS, TODO-18 literal owner localhost acceptance is outstanding, and Platform remains `HOLD_PARENT_DEPENDENCY`. TODO-20 remains PASS through live 0059.
NEXT_ACTION = Publish review findings, then continue TODO-14 runtime route/action evidence without crossing the protocol gates.

### 2026-09-27 — authorized checkpoint inventory and pre-commit evidence

```text
CHECKPOINT_MISSION = PCA CURRENT WORKTREE -> LOGICAL COMMITS -> pca-dev REMOTE ALIGNMENT
OWNER_CHECKPOINT_PUSH_AUTHORIZATION = YES (checkpoint sync only)
MISSION_STATUS = IN_PROGRESS
CURRENT_TODO = TODO-12, TODO-14, TODO-15, TODO-17, TODO-19, TODO-20 and owner-gated TODO-18; TODO-21/22/23 pending; TODO-01…11/13/16 PASS
NEXT_TODO = TODO-12 remaining Parent authority/device boundaries; then TODO-17 integrated regression
BRANCH = pca-dev
PRE_CHECKPOINT_LOCAL_HEAD = e9c93a78497a5e536ceb23d56c5ac825640810b2
PRE_CHECKPOINT_REMOTE_HEAD = e9c93a78497a5e536ceb23d56c5ac825640810b2
REMOTE_ADVANCED_DURING_CHECKPOINT = NO at the completed fetch; fetch again immediately before push
DIRTY_PATHS_BEFORE_CLASSIFICATION_FILE = 330 (227 modified tracked, 103 untracked, 0 deleted, 0 staged)
CLASSIFICATION_ROWS = 331 (the 330 initial paths plus this classification record)
CLASSIFICATION = 244 CURRENT_PCA_MISSION; 61 SHARED_PEER_LEGITIMATE assessment snapshot files; 23 REPOSITORY_SUPPORT; 2 MACHINE_LOCAL_OR_TEMP; 1 UNRELATED_OR_UNKNOWN
PATH_CLASSIFICATION = docs/PCA_CHECKPOINT_PATH_CLASSIFICATION_2026-09-27.md
LOCAL_ONLY_COMMITS = 0
FOCUSED_BACKEND_CAMPAIGN = PASS 188/188, zero failures/skips
BACKEND_BUILD = PASS
PARENT_WEB_TYPECHECK = PASS
PLATFORM_WEB_TYPECHECK = PASS
SCHEMA_MIGRATION_STATIC_CHECK = PASS (55 numbered files through 0057; duplicate numbers 0; no generated snapshot committed)
TEST_HARNESS_CHECKS = migration-0057 recovery 3/3 PASS; test registration + production-path certification 14/14 PASS (27 certified, 20 accurately tracked gaps)
FULL_MISSION_TEST_STATE = see TODO-17; no claim of overall PASS
FIRST_TEST_RETRY = two Node test commands initially returned environment spawn EPERM; bounded serial rerun completed, then exposed and fixed two real registration gaps before 14/14 pass
MYSQL = BLOCKED; local Docker service stopped and 127.0.0.1:33061 refused connections; no MySQL tests executed by this checkpoint
LIVE_PCA_PRO = NOT INSPECTED OR MUTATED
SCHEMA_SNAPSHOTS = backend/schema/current_schema.sql and schema_manifest.json retained dirty but excluded: generated contents place device_session_epoch on the wrong table and omit 0057 actor objects; regenerate only from a migrated disposable schema
ASSESSMENT_DOCS = 61 peer snapshot files retained as separately classified, dated evidence; do not reuse recorded results as current validation
MACHINE_LOCAL = .vscode/settings.json and .vscode/tasks.json excluded
UNRELATED_OR_UNKNOWN = root path `0` excluded and preserved
STASH_USED = NO; RESET_HARD_USED = NO; GIT_CLEAN_USED = NO; FORCE_PUSH_USED = NO
LOCALHOST_ACCEPTED = NO (not offered; owner response still required)
OWNER_PRODUCTION_ACCEPTANCE = NOT OFFERED
AZURE_DEPLOYMENT = NOT AUTHORIZED BY THIS CHECKPOINT
PUSH_RESULT = PENDING
EXACT_PUSHED_SHA = PENDING
EXACT_HEAD_CI = PENDING
NEXT_ACTION = review exact staged path lists, create logical commits, fetch/reconcile and push only to origin/pca-dev, verify remote source and CI, update this ledger, then resume the same mission
LOCAL_IMPLEMENTATION_COMMITS = 7 (file count 324 before the two checkpoint-ledger files)
LOCAL_IMPLEMENTATION_COMMIT_LIST = 309af06b feat(parent): add identity and authority migrations; adeff69d fix(test): isolate disposable database credentials; 3ea73df3 feat(parent): integrate authentication and family authority; 24603231 feat(platform): add family-scoped parent projection; 1e7f5c9d feat(parent-web): integrate auth identity and authority; 2fde86de feat(platform-web): add parent identity and directories; 514a5bbe docs: preserve pre-production assessment snapshots
PRE_PUSH_LOCAL_HEAD_BEFORE_LEDGER_COMMIT = 514a5bbea0049970a13ff9656b506ef2ff725d55
LEDGER_COMMIT_AND_PUSH = still required before checkpoint completion
```

### 2026-09-27 — checkpoint push and remote verification

```text
CHECKPOINT_PUSH_RESULT = PASS
TARGET = origin/pca-dev
PRE_PUSH_LOCAL_HEAD = 3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e
PRE_PUSH_REMOTE_HEAD = e9c93a78497a5e536ceb23d56c5ac825640810b2
AHEAD = 8
BEHIND = 0
DIVERGED = NO
REMOTE_ONLY_COMMITS_RECONCILED = 0
COMMITS_CREATED = 8
COMMIT_LIST = 309af06b; adeff69d; 3ea73df3; 24603231; 1e7f5c9d; 2fde86de; 514a5bbe; 3d31cb5b
FILES_COMMITTED_TOTAL = 326 (all classified commit-yes implementation/support/peer/ledger paths)
POST_PUSH_LOCAL_HEAD = 3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e
POST_PUSH_REMOTE_HEAD = 3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e
LOCAL_REMOTE_EQUAL = YES
REMOTE_SOURCE_VERIFIED = YES (Parent authentication, Parent authority, migrations 0051–0057, schema.ts, DB tests, identity profile, Platform projection, device binding, Parent Web, Platform Web and canonical ledger all exist at origin/pca-dev)
PARENT_LOCAL_ONLY_FILES_REMAINING = 0
PARENT_UNPUSHED_COMMITS_REMAINING = 0
PLATFORM_LOCAL_ONLY_FILES_REMAINING = 0 for committed existing projection/UI work; new dependent specialist work remains HOLD_PARENT_DEPENDENCY
PLATFORM_UNPUSHED_COMMITS_REMAINING = 0
EXACT_PUSHED_SHA = 3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e
CI_RUN = 36337455750 (Quality gates)
CI_HEAD_SHA = 3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e
EXACT_HEAD_CI = QUEUED at last inspection; monitor; not claimed green
POST_PUSH_DIRTY_PATHS = 5: two stale generated schema snapshots, two machine-local .vscode files, and unrelated root fragment 0; all retained and explicitly classified
PCA_LEGITIMATE_FILES_LEFT_DIRTY = 0
STASH_USED = NO; RESET_HARD_USED = NO; GIT_CLEAN_USED = NO; FORCE_PUSH_USED = NO
PEER_WORK_PRESERVED = YES
LEGITIMATE_CHANGES_LOST = 0
LIVE_DB_MUTATED_BY_THIS_CHECKPOINT = NO
NO_SEED_DATA = YES
LOCALHOST_ACCEPTED = NO (literal owner response still required)
OWNER_PRODUCTION_ACCEPTANCE = NOT OFFERED
AZURE_DEPLOYED_BY_THIS_CHECKPOINT = NO
PURSUING_GOAL_STATUS = IN_PROGRESS
CURRENT_TODO = TODO-12, TODO-14, TODO-15, TODO-17, TODO-19, TODO-20 and owner-gated TODO-18; TODO-21/22/23 pending; TODO-01…11/13/16 PASS
NEXT_ACTION = continue the earliest unfinished Parent authority/device and integrated-regression work; keep Platform activation held until TODO-18 and literal LOCALHOST ACCEPTED=YES
```

### Parallel agents

```text
COORDINATOR = current Codex agent
COORDINATOR_STATUS = TODO-12 implementation/integration; owns shared authority files, canonical ledger, validation, gates, Git, DB reconciliation, and closure

AGENT-1_AUTH_BROWSER = AGENT-1 auth_browser
ASSIGNED_TODOS = TODO-02/03/05/06/07/08/09
STATUS = COMPLETED; implementation/test follow-up delivered, coordinator review pending
FILES_OWNED = backend/test/db/parentLoginStepUp.mysql.test.mjs; parent-web/e2e-real/parentMfa.spec.ts; parent-web/e2e-real/optionalMfaSetup.spec.ts
LAST_RESULT = added OTP expiry/latest-code/attempt-limit/generic-denial DB cases; corrected unknown-browser OTP→TOTP browser specs with distinct codes and final HttpOnly-cookie assertions; read-only flow audit complete

AGENT-2_FAMILY_AUTHORITY_IDENTITY = AGENT-2 family_authority_identity
ASSIGNED_TODOS = TODO-04/10/11/12/13/14/16
STATUS = COMPLETED; isolated resolver delivered and coordinator-integrated; validation pending
FILES_OWNED = delivered backend/src/device/DeviceChildBindingRepository.ts; backend/src/familyrbac/RemovalTargetResolver.ts; backend/test/familyrbac/RemovalTargetResolver.test.mjs; coordinator owns route/composition integration
LAST_RESULT = added family-scoped enrollment-to-invitation-to-child binding, membership, and fresh protective-status resolution with typed fail-closed outcomes; current device self-report is explicitly not hardware attestation

AGENT-3_MOBILE_CHILD_DEVICE = AGENT-3 mobile_child_device
ASSIGNED_TODOS = TODO-15; mobile/device portions of TODO-14 and TODO-17
STATUS = COMPLETED; source and lifecycle design reviews read-only
FILES_OWNED = none in the latest review
LAST_RESULT = confirmed device/family current-state session gates; found no safe PAIRED→ACTIVE/first-policy path with current rejecting production crypto/trust wiring; bounded bootstrap design recommendation delivered, no implementation guessed

AGENT-4_DB_MIGRATION_PCA_PRO = AGENT-4 db_migration_pcapro
ASSIGNED_TODOS = database portions of TODO-04/06/07/16/17 and TODO-20; QA evidence map for TODO-17/19
STATUS = COMPLETED; read-only local schema/grant and disposable-harness audit
FILES_OWNED = none during this audit; backend migrations/schema/grant tooling and DB evidence are read-only
LAST_RESULT = no live pca_pro access or DB mutation; schema/grant discrepancies and runtime-grant caution documented

AGENT-5_QA_E2E_GIT = AGENT-5 integrated_qa
ASSIGNED_TODOS = TODO-17 and evidence support for TODO-01…16/19
STATUS = COMPLETED for runner, DB-fixture triage, action audit, and focused TODO-12 HTTP regression update
FILES_OWNED = none active; delivered backend/scripts/with-disposable-db.mjs, backend/package.json, backend/test/http/childRequestRoutes.test.mjs
LAST_RESULT = added safe local Parent MFA browser runner; mapped Parent action gaps; updated child-request HTTP tests for session-only Parent actions and preserved child-device binding; coordinator focused service/HTTP campaign passed 60/60

AGENT-6_PLATFORM_ENROLLMENT = AGENT-6 platform_enrollment
STATUS = HOLD_PARENT_DEPENDENCY; acknowledged; no source inspection or writes
FILES_OWNED = none until coordinator activation

AGENT-7_PLATFORM_QA_RELEASE = AGENT-7 platform_release_qa
STATUS = HOLD_PARENT_DEPENDENCY; acknowledged; no source inspection, tests, Git, or Azure activity
FILES_OWNED = none until coordinator activation

FILE_COLLISIONS = 0
UNREVIEWED_AGENT_CHANGES = Agent-1 OTP DB tests and Parent MFA browser specs still need coordinator review; Agent-2 removal-target resolver files received source review and are integrated but await build, focused, and MySQL validation; Agent-5 local E2E runner/fixtures remain under coordinator review
IDLE_AGENT_WITH_AVAILABLE_WORK = Parent first-pass reviews complete; Agent-5 completed the TODO-12/TODO-14 map; Agent-3 completed a read-only device-authority review and recommended a separate Parent-session authorizer; Agent-6 and Agent-7 are intentionally held
THREAD_LIMIT_NOTE = five Parent lanes retained; two additional Platform lanes created as explicitly requested and held until TODO-01…17 PASS, TODO-16 projection PASS, TODO-18 PASS, and literal LOCALHOST ACCEPTED=YES
```

### Current source inventory

The initial worktree contains 86 backend paths, 94 Parent Web paths, 11 Platform
Admin Web paths, 2 database-bootstrap paths, 22 Parent/Platform assessment
paths, 39 API/mobile assessment paths, and 2 `.vscode` paths. Backend and
database-bootstrap paths are shared until reviewed at file/action level. The
API/mobile assessments and `.vscode` files are retained as unrelated or peer
work and are not part of a Parent commit without later proof of necessity.

The repository's prior Parent/Platform assessment reported no P0 and recorded
pre-production findings PP-F01, API-F01/R-PP-05, PP-F03, R-PP-01, R-PP-07,
PP-F02/R-PP-04, R-PP-03/R-PP-06, and PP-F04/PP-F05. Those are inherited
assessment evidence, not yet revalidated as current implementation findings.

### 2026-09-30 00:30 UTC — DeepSeek controlled stop; Codex handover checkpoint

STOP = The owner stopped DeepSeek development on 2026-09-30 and assigned the next workflow to Codex. No new wave may be started by DeepSeek; this entry is the handover reconciliation only.
CURRENT_WORK_AT_STOP = Wave 5C (real child-profile membership resolver for the second TODO-12 authority gate). Baseline verified PASS (local = origin = server = 91f7f6d4dc9b7d141f09da1f73906a295fd31cfc; only `.vscode/` and root `0` untracked). §4 contract review complete: CONTRACT_CONFLICT = NO (doc 39 §3/§10 anticipate the later resolver binding as an async trusted-source implementation; the registry comment's "frozen/no-registry" reading is superseded; privacy/oracle constraints remain binding). Implementation design prepared; Android specialist smoke review returned ANDROID_IMPACT = NONE. NO implementation files were changed; NO tests were run; NO commits were created by Wave 5C.
COMPLETED_BEFORE_STOP = Waves 5A (`6cefdf1e`) and 5B (`91f7f6d4`) are committed, pushed and certified (runs 36505757047 and 36519047489 SUCCESS 27/27). Wave 5B local evidence: unit suite 2734/2734; disposable MySQL lane inner 666 pass / 0 fail / 8 pre-existing skips + certified production paths 273/273; both PCA-SEC020 mutation negative controls KILLED; closure gate 7/7 APPROVE.
LOCAL_UAT = A local disposable owner UAT environment was prepared on 2026-09-29 (isolated auxiliary mission; zero repository changes): database `pca_local_owner_uat` (local Docker MySQL 127.0.0.1:33061; all 58 migrations; head 0060; 94 tables); services backend `http://127.0.0.1:4001`, Parent Web `http://localhost:4000`, Platform Admin `http://localhost:4100`; synthetic Platform Owner and Parent accounts (credentials live ONLY in `.agent-local-artifacts/local-uat-mission/PCA_LOCAL_UAT_HANDOFF.md`, which is untracked and must never be committed). Live `pca_pro` was inspected read-only (0 mutations): head 0059, 92 tables, zero column differences on shared tables; the only delta is the two additive 0060 tables.
DATABASE = REPOSITORY_SCHEMA_HEAD = 0060; LOCAL_UAT_SCHEMA_HEAD = 0060; LIVE_SCHEMA_HEAD = 0059; CURRENT_REPO_LIVE_PARITY = NO (intentional hold; LIVE_APPLICATION_AUTHORIZED = NO).
GIT = Worktree clean apart from the two excluded untracked items; no uncommitted mission files. This handover checkpoint updates the three canonical documents (continuous goal + both master TODOs); its commit SHA and exact-head CI are reported to the owner with the handover report.
OWNER_GATES = TODO-18 literal `LOCALHOST ACCEPTED` has NOT been given; the local UAT environment is ready for the owner; TODO-21/22/23 remain pending.
NEXT_WORKFLOW = CODEX. Re-establish the continuous goal per the `## CODEX RESTART CHECKPOINT` section at the end of this document.

## Historical TODO implementation snapshot

The rows below preserve the original implementation evidence snapshot. Current
statuses, owners, blockers, and completion conditions are maintained in the
Parent master TODO linked above; do not use these historical status labels as
the current checkpoint.

| TODO | Status | Owner | Files | Evidence | Blocker | Done when |
|---|---|---|---|---|---|---|
| TODO-01 — Preserve and reconcile current multi-session worktree | PASS | Coordinator | All 256 initial dirty paths; exact inventory above | Local and freshly fetched remote both `e9c93a78`; 166 modified, 90 untracked, none staged; authorized Parent/Platform/shared paths retained; API/mobile assessment and `.vscode` paths preserved outside scope | None identified | Legitimate work classified and preserved; no peer work lost |
| TODO-02 — Reconcile `d3759d89` Parent authentication baseline | PASS | Coordinator | `backend/src/parentaccount/**`, Parent auth routes, email/outbox, `parent-web/src/pages/auth/**` | Reference source compared; backend build PASS; in-memory auth/email/route campaign 80/80; OTP/TOTP regression 3/3; disposable MySQL campaign 43/43; login notification and session creation covered | None for accepted baseline | Approved login, verification, notification, session behavior preserved/restored; newer fixes preserved |
| TODO-03 — Verified-email activation | PASS | Coordinator | Parent account service/repository/routes and auth UI | In-memory and real-MySQL checks cover activation-only verification, pending-account denial, invalid/replayed/expired code, attempt limit, and no session at verify | None for accepted flow | Unverified Parents remain restricted; verified Parents proceed safely; negative cases pass |
| TODO-04 — Atomic Parent family provisioning | PASS | Coordinator | Provisioning service/repository, family schema/migrations, MySQL tests | Disposable MySQL first-login asserts exactly one family/admin/scope; 16 concurrent calls observe one family; database uniqueness and cross-account service-identity refusal pass | None for accepted flow | Real MySQL proves exactly one family/admin across retry/concurrency, with no cross-account or partial state |
| TODO-05 — First-login trusted-browser creation | PASS | Coordinator | Parent login service, MFA/trust persistence, auth client/UI | First successful login issues a hashed-at-rest account-bound grant; real-MySQL first login and unknown-browser completion pass; in-memory end-to-end pass | None for accepted flow | Required successful login automatically creates account-bound browser trust without a setup ceremony |
| TODO-06 — Three-day TOTP enrollment policy | PASS | Coordinator | Parent MFA schema/service/repository/routes and login UI | Server-side grace constant is 72 hours; real-MySQL 12-way start preserves one deadline; expired grace requires setup; local boundary checks pass | None for accepted flow | One server-side 72-hour deadline survives logout, other browsers, and cookie clearing |
| TODO-07 — TOTP setup and activation | PASS | Coordinator | Parent MFA service/routes/UI, encryption/config, tests | Disposable MySQL verifies sealed secret, recovery hold/session revocation, enrollment ticket single-use, and migration replay; focused setup tests pass | None for accepted flow | Encrypted pending secret, local QR, rate-limited valid confirmation, secure ACTIVE state |
| TODO-08 — Known-browser login | PASS | Coordinator | Parent login service, MFA/trust repository, security email | Real-MySQL and focused tests prove known browser does not require routine TOTP after activation; subsequent login notice is queued | None for accepted flow | Known browser uses email/password and receives the successful-login notification, including with active TOTP |
| TODO-09 — New/unknown-browser login | PASS | Coordinator | Parent login/OTP/TOTP flows and browser trust | Real-MySQL tests prove email OTP + active TOTP, account-bound trust, and one winner under 8 concurrent completions; fixed ordering regression passes 3/3 | None for accepted flow | Email OTP and enrolled TOTP are enforced as specified before trust and console access |
| TODO-10 — Remove Genesis from Parent authentication/authorization | PASS | Coordinator | Parent auth, family authority, routes, UI and tests | Source search found only explanatory comments in Parent backend; no Parent Web Genesis reference; MySQL provisioning creates no family-authority/device rows | None for the audit; separate cleanup migration remains authorized only | No ordinary Parent runtime path needs Genesis, Genesis challenge, or Parent-owner crypto chain |
| TODO-11 — Migrate Trusted Browser away from family authority | PASS | Coordinator | Parent trust/session providers, repositories, routes and UI; Platform family suspension | MySQL-backed test proves family suspension atomically revokes linked Parent sessions, daily-login grants, pending email login challenges, and family-bound sensitive step-up grants; `completeLoginStepUp` rejects suspended families; reactivation requires fresh email verification for the old browser grant; `/security/trusted-browser` redirects away from pairing UI | Cross-browser listing/individual-device management is a nonblocking follow-up; current logout and revoke-all endpoints provide revocation | Trust is automatic, account-bound, revocable/expirable, and login assurance only |
| TODO-12 — Complete normal Parent authority migration | IN_PROGRESS | Coordinator | Parent route/action authority and role checks across backend and web | Source/action matrix reviewed; ordinary family routes use session/family/membership roles; Parent child-request decisions/direct grants/revokes now have a distinct session-only path with 60/60 focused service/HTTP checks; successful bonus-grant revokes retain process-local Parent actor/time metadata (BonusGrantLedger 9/9 and childRequestRoutes 17/17 run separately; build PASS); eye-protection reads and writes use durable async child-profile membership; removal create/PIN/local-decision mutations require active Administrator and operation-scoped single-use TOTP step-up; removal actor fields persist and are omitted from Parent DTOs; Wave 5C adds the production async opaque-registry membership resolver shared by Parent authorization and child-request routes, validated by build, focused suites 81/81, adjacent policy/request suites 70/70, MySQL 8.4.11 58-migration gate, and child-profile registry DB tests 10/10 with disposable DB cleanup; exact-head CI is pending because `.git` writes are denied. Schedule-policy still depends on Trust Set acceptance authority; Web Rules are `503 not_configured`; signing/recovery authorities reject | TODO-11; exact-head CI and publication for Wave 5C; production Trust Set ingestion/root-of-trust composition; schedule-policy cryptographic/device-authority boundary; encrypted Web Rules/FamilyAudit/policy protocols; mobile first-policy activation | Normal same-family actions use session + membership + ACTIVE Administrator; browser trust is irrelevant; all negative child membership outcomes collapse to the same deny; device/Trust Set authorities remain fail-closed |
| TODO-13 — Sensitive-action TOTP step-up | PASS | Coordinator | Step-up schema/service/routes/UI and classified sensitive actions | Canonical Parent master maps all ten issuable high-risk operations to consuming routes and fresh operation-scoped TOTP; ownership-transfer and recovery-material operations remain non-issuable and have no consumers; focused step-up/consumer HTTP suites passed 64/64 with exact-head regression evidence | No blocker for currently implemented operations; future transfer/recovery workflows remain separately disabled | Fresh TOTP gates each classified high-risk mutation; unused operations are removed from runtime issuance or have a real consumer; negative cases pass |
| TODO-14 — Full Parent route/action audit | IN_PROGRESS | Coordinator | Parent routes/pages/actions and authority matrix evidence | Agent-2 source-mapped route/action matrix completed; commercial mutations follow PCA-DEC-030 with active family Administrator plus fresh operation-specific TOTP (the old owner-attestation chain is retired); eye-protection membership gap closed and focused route suite passes 8/8; removal create/PIN/local-decision routes now have active Administrator and TOTP checks; resolver and route tests pass 26/26; enrollment binding SQL passes within 22/22 disposable tests; integrated route/action evidence and aggregate unexpected 401/403 counts still need integrated rerun; unavailable Trust Set/web-rule authority and durable Parent actor provenance remain explicit | TODO-12, TODO-13; schedule-policy cryptographic authority, web-rule production wiring, durable actor attribution | All required surfaces audited; zero unexpected 401/403 or authority/trust/Genesis blocks |
| TODO-15 — Preserve child-device cryptographic security | IN_PROGRESS | Coordinator | Shared backend device routes/services, Parent enrollment clients, focused tests | Pair confirmation correctly requires TOTP; MySQL/current-session identity checks reject revoked devices and suspended families; family suspension/reactivation now advances a durable device-session epoch so old in-memory sessions stay invalid; paired-session seed now supplies `familySessionEpoch: 1` and the 13-test device-session suite passes with a structurally valid record; Parent-auth disposable DB campaign after migration 0056 passed 61/61; full DB suite validates the integrated 54-migration baseline; no safe PAIRED-to-first-policy-to-ACTIVE path exists with current rejecting device verifier and unavailable durable FTS/key-epoch resolver | TODO-12; production crypto/trust/policy bootstrap architecture | Device identity, signatures, replay protection, revocation, first-policy activation, and wrong-device rejection are proven end to end |
| TODO-16 — Identity/profile integration + Platform family identity projection | PASS | Coordinator | Parent identity APIs/UI, migrations, Platform read model/routes/UI and tests | Family-scoped projection source and exact four-field DTO are reviewed; Parent identity/UI tests 15/15 and backend identity/projection routes 11/11 pass; disposable MySQL 61/61 includes provisioning precedence, zero-admin fail-closed, nullable phone, and two-family isolation | TODO-04, TODO-12; broader authority audit remains open in TODO-12…15 | Required names + email and nullable phone work; Platform projection is minimal, family-scoped, authorized and fail-closed on zero/multiple candidates |
| TODO-17 — Full MySQL/security/browser regression | PASS | Coordinator | Backend, Parent Web, Platform tests and E2E | Quality Gates run `36751605072` SUCCESS 27/27 at `cb9d9e1b`; includes full disposable MySQL, backend, Android/iOS, security, web, and real-browser suites. Parent MFA browser proof: session cookie, `/api/parent/session` 200, and `/dashboard` navigation. | TODO-12/14/15 authority/device gates and owner/release gates remain separate; regression campaign itself is green | Integrated regression is green and remaining external device/owner gates are accurately separated |
| TODO-18 — Owner localhost acceptance | TODO | Owner + coordinator | Local Parent/API journey and acceptance evidence | Not offered; implementation is not yet ready | TODO-17 | Owner manually validates the full required journey and replies literal `LOCALHOST ACCEPTED` |
| TODO-19 — Git reconciliation + exact-head CI | PASS | Coordinator | Approved Parent + Platform source/tests/migrations/docs | Result-ledger commit `8d6fb0b458b69d70438a6492d65d33dac2b3a016` was pushed by ordinary fast-forward; fresh fetch and `git ls-remote` proved local/tracking/server equality; exact-head run `36753042327` passed 27/27. `.vscode/` and root `0` remain excluded. | None for Git reconciliation; TODO-18 acceptance and dependent Platform validation are separate owner gates | Local/remote align, approved files are remote, exact-head CI passes, and all paths are classified |
| TODO-20 — Live schema / DB grants reconciliation | IN_PROGRESS | Coordinator | Repository schema/migrations, local disposable MySQL, live `pca_pro`, runtime grants | Repository/disposable MySQL 8.4.11 certification now passes through migration 0063 (61 migrations): 696/706 inner DB tests passed with 10 explicit privilege-only skips; 276/276 populated production-path tests and the focused runtime grant/append-only gate 7/7 passed. Previous local 95-table schema snapshot/manifest comparison remains historical. Live `pca_pro` was last verified at 0059; fresh DNS resolves, but TCP/3306 is unreachable. No live SQL ran; live parity/grants remain unverified. | Reachable authorized live connection context for fresh read-only preflight; then apply only locally tested additive/corrective DDL and reconcile grants per the existing owner authorization | Repository/local/live schema and grants match, required migrations tested locally and live-applied only after fresh preflight, no seed data, DATA_LOSS=0 |
| TODO-21 — Azure deployment | TODO | Coordinator + owner | Exact approved API/backend, Parent Web and Platform Web artifacts | No deployment attempted; the final release must be coordinated and from the approved exact head | TODO-19, TODO-20, rollback baseline and deployment gate | API, Parent Web and Platform Web deployed from one approved release candidate and running revisions verified |
| TODO-22 — Owner production acceptance | TODO | Owner + coordinator | Combined Parent + Platform production journey evidence | Not offered | TODO-21 | Owner validates Parent auth/authority/step-up/device and Platform Enrollment identity/RBAC/privacy flows |
| TODO-23 — Final closure | TODO | Coordinator | Ledger, all Parent TODOs and dependent Platform work package | Mission remains active | TODO-01…TODO-22 and Platform package closure | Every prior TODO and Platform dependent work passes, P0/P1 are zero, exact CI/schema/deployment/owner gates are proven, final architecture statement is truthful |

## Amendment authorization and controls

- Git: authorized to fetch `origin/pca-dev`, reconcile legitimate work, and
  fast-forward push the combined approved Parent + Platform state to `pca-dev`
  after the required owner acceptance and final validation. Before Platform
  writes, preserve accepted Parent work, create safe local checkpoint commit(s)
  if needed, fetch/compare/reconcile the branch, and preserve peer files. No
  force push, reset, stash, clean, or unrelated inclusion.
- Database: authorized to inspect repository/local/live `pca_pro` schema and
  grants read-only, and to create, locally validate, and apply a migration only
  after a proven mismatch and a fresh live preflight. No seed data, unrelated
  schema changes, blind pushes, or destructive migration without proved need.
- The literal `LOCALHOST ACCEPTED` gate precedes Platform activation, final
  combined push, and deployment. Exact-head CI, refreshed rollback baseline,
  the one combined API + Parent Web + Platform Web release, production smoke,
  and combined owner UAT remain separate later gates.

## Platform dependent work package — amendment 2026-09-27

```text
PLATFORM_ACTIVATION_GATE = HOLD_PARENT_DEPENDENCY
GATE_REQUIREMENTS = TODO-01…TODO-17 PASS; TODO-16_PLATFORM_PROJECTION PASS; TODO-18 PASS; literal LOCALHOST ACCEPTED=YES
AGENT-6_STATUS = HOLD_PARENT_DEPENDENCY (created and acknowledged; no inspection or writes)
AGENT-7_STATUS = HOLD_PARENT_DEPENDENCY (created and acknowledged; no inspection, tests, Git or Azure activity)
PLATFORM_IMPLEMENTATION_STARTED = NO
PARENT_PROJECTION_READY = PASS (source review; backend identity routes 11/11; real MySQL precedence, zero-admin, nullable-phone and two-family checks passed)
PARENT_PROJECTION_FIELDS = Name, Email, Phone (nullable)
PLATFORM_IDENTITY_SOURCE = PARENT_FAMILY_PROJECTION
DUPLICATE_PARENT_IDENTITY_LOGIC = 0 (current consumer calls family-scoped projection)
ENROLLMENT_COLUMNS = NOT_STARTED
ENROLLMENT_FOCUSED_TESTS = Parent projection source/route/MySQL evidence PASS; Platform Enrollment implementation remains held
PLATFORM_SUITE = NOT_RUN
PLATFORM_TYPECHECK = PASS (existing projection slice; no new Platform source changes)
PLATFORM_LINT = NOT_RUN
PLATFORM_BUILD = NOT_RUN
CLEAN_SNAPSHOT = NOT_RUN
RBAC_PRIVACY = existing route/UI checks PASS; complete Enrollment acceptance pending activation
CROSS_FAMILY_DISCLOSURE = 0 in source and verified by the real two-family MySQL regression
UNAUTHORIZED_IDENTITY_ACCESS = 0 in route tests; full package acceptance pending
EXTRA_PII_OR_COMMERCIAL_FIELDS = 0 in exact-field route tests
PLATFORM_FILES_CHANGED = none by Agents 6/7; previously dirty projection files remain under coordinator review
PLATFORM_COMMIT = none
COMBINED_REMOTE_HEAD = not aligned yet
EXACT_HEAD_CI = not run
ROLLBACK_BASELINE_CAPTURED = NO
API_DEPLOYMENT = NOT_STARTED
PARENT_WEB_DEPLOYMENT = NOT_STARTED
PLATFORM_WEB_DEPLOYMENT = NOT_STARTED
PRODUCTION_SMOKE = NOT_RUN
OWNER_PARENT_UAT = NOT_OFFERED
OWNER_PLATFORM_UAT = NOT_OFFERED
PLATFORM_WORK_PACKAGE_STATUS = HOLD_PARENT_DEPENDENCY
```

## Checkpoint history

### 2026-09-26 — mission and amendment intake

- Read the supplied continuous-goal prompt and Git/database amendment.
- Created one active Pursuing Goal; canonical numbering remains TODO-01…TODO-23.
- Fresh `git fetch origin pca-dev` succeeded after sandbox elevation; fetched
  `FETCH_HEAD` equals local `HEAD` at `e9c93a78497a5e536ceb23d56c5ac825640810b2`.
- No source, schema, database, production, staging, or remote branch mutation.
- Ownership assessment continues at TODO-01; no tests have been run yet.

### 2026-09-27 — initial source review and OTP/TOTP correction

- TODO-01 inventory completed without changing pre-existing Parent, Platform,
  shared, or peer files. The assessment and VS Code paths outside the
  implementation scope remain intact.
- Compared Parent login, verification, email notification, and session logic
  against `d3759d89` and the attached final architecture. Existing source sends
  a `FIRST_LOGIN` notice on the first successful login and `LOGIN_SUCCESSFUL`
  notices on subsequent successful logins; email dispatch is best-effort and
  covered by the focused email suite.
- Reproduced an unknown-browser security defect: a valid TOTP counter was
  consumed before the submitted email OTP hash was checked. Moved email-code
  attempt/hash validation ahead of TOTP verification. The corrected flow still
  consumes the email code only after all required factors pass.
- Validation: `npm run build` PASS; focused Parent auth/email/routes campaign
  before the correction 80/80 PASS; the new regression failed before the fix
  with `MFA_INVALID` on its valid-code retry, then the rebuilt focused login
  suite passed 3/3 after the fix.
- A normal sandbox run of the MySQL campaign hit `spawn EPERM` after creating
  and removing its scratch schema. The approved elevated retry passed all 43
  tests on MySQL 8.4.11 and removed its uniquely named disposable database.
- TODO-11 review found that family suspension blocked new login but left
  existing Parent sessions, daily-login grants, and outstanding login codes
  usable later. Suspension now revokes those credentials and family-bound
  sensitive step-up grants transactionally; the Parent OTP completion path
  also fails closed while the family is suspended.
- The first rerun exposed an incorrect test expectation (the first-login path
  had issued one, not two, email challenges). After correcting that assertion,
  the complete disposable MySQL campaign passed 43/43, including the suspend,
  stale-session rejection, old-grant revocation, blocked pending code,
  reactivation, and fresh-browser verification checks. The disposable schema
  was removed. No `pca_pro` data was inspected or changed.
- No `pca_pro`, production, remote branch, commit, or push mutation. The fresh
  fetch remains aligned at `e9c93a78`; the local implementation is still dirty.
- NEXT: complete TODO-12 route/action authority review and continue through TODO-23 without
  reopening the goal or resetting its board.

### 2026-09-27 — TODO-12 validation and specialist lanes

- Rebuilt the backend and ran the focused HTTP/Parent authority campaign: 213/213
  passed, including the dashboard child-role denial and current family-role gates.
- The expanded disposable MySQL Parent-auth campaign first caught an invalid
  suspended-family test fixture. After adding the required admin actor,
  suspension timestamp, and reason, the fresh campaign passed 56/56 on MySQL
  8.4.11; the harness removed its scratch schema. No live `pca_pro` access.
- Started Agent-1 Auth/Browser, Agent-2 Family/Authority/Identity, Agent-3
  Mobile/Child Device, and Agent-4 DB/Migration/`pca_pro` lanes with explicit
  file ownership. Agent-1 and Agent-3 completed initial reviews; Agent-2 is
  implementing TODO-16, and Agent-4 is performing read-only schema/CI evidence
  review. The runtime rejected attempts to create or reactivate an additional
  agent thread, so the requested QA lane's evidence map is assigned to Agent-4
  and integrated QA execution remains with the coordinator.
- Agent-3 identified that device revocation and family suspension do not
  invalidate already-issued in-memory device sessions; TODO-15 remains open
  pending coordinator disposition and negative-test evidence. Agent-1 reported
  missing replay/expiry/reissue/attempt-limit coverage in the current MySQL
  login-step-up test; that coverage requires a focused regression review.
- Agent-2's initial TODO-16 review found the Platform identity lookup conflates
  family IDs and Parent account IDs and returns additional metadata. Its
  implementation now resolves identity by selected family with provisioned
  Parent precedence or unique active Administrator, fails closed on ambiguity,
  and returns only names, email, and nullable phone; Platform detail UI and
  tests remain in progress.
- No TODO status is upgraded by these test runs or specialist source reports.
  Coordinator review and integrated cross-lane validation remain required.

### 2026-09-27 — Parent MFA browser evidence and Platform hold amendment

- Continued the same mission and TODO-01…TODO-23 ledger. No reset, stash,
  cleanup, commit, push, remote fetch, `pca_pro` access, or deployment occurred.
- Re-ran the Parent-auth database campaign through
  `with-disposable-db.mjs parent-auth`: MySQL 8.4.11 and 52 migrations verified,
  61/61 tests passed, and the uniquely named scratch database was dropped. This
  run included the new OTP expiry, latest-code invalidation, attempt-limit, and
  generic-denial cases, but preceded Agent-2's three new projection assertions.
- Focused pairing/session tests passed 19/19; backend identity and Platform
  route tests passed 11/11; Parent identity UI tests passed 15/15. Parent Web
  and Platform Admin `tsc --noEmit` passed. The Playwright test-list command
  found the two Parent MFA specs; no browser E2E has run yet.
- Agent-1 corrected the real-browser flow to exercise unknown-browser email
  OTP before TOTP, uses distinct deterministic OTP values, and verifies the
  final HttpOnly session/daily-grant cookies. The optional setup CI step now
  disables traces because its UI displays the disposable TOTP setup secret.
- Coordinator repaired E2E fixture grant propagation: the disposable first
  login now returns its actual `rawDailyLoginGrantToken` for the browser
  fixture. The safe local MFA browser runner is being added as a separate
  disposable-DB target; its preflight must refuse occupied Vite port 4002 and
  its cleanup must remove only its own temp artifacts.
- Agent-2 added MySQL assertions for an existing zero-admin family, a real
  nullable-phone projection, and isolation between two existing families.
  These changes have not yet been rerun.
- Agent-3 confirmed there is no usable `PAIRED`→first-policy→`ACTIVE` path in
  production with the current rejecting device verifier and unavailable FTS/
  key-epoch wiring. Ordinary runtime-sync remains fail-closed; TODO-15 is still
  open. Reactivation also makes an unexpired session for an already ACTIVE
  device eligible again; intended suspension semantics remain unconfirmed.
- The new amendment created Agent-6 and Agent-7 in
  `HOLD_PARENT_DEPENDENCY`. Neither has inspected or changed Platform source.
  The activation gate remains closed until Parent TODO-01…17 and the specific
  TODO-16 projection evidence pass, then TODO-18 receives the literal
  `LOCALHOST ACCEPTED` response.
- New source/test changes remain dirty and unstaged. No live schema/grants,
  production data, Azure resource, or remote branch was accessed or changed.

### 2026-09-27 — integrated Parent web, MySQL, and MFA browser checkpoint

- Full Parent Web Vitest suite passed: 151 files, 1065/1065 tests.
- Rebuilt the backend and reran `npm run test:db:parent-auth` against a new
  UUID-named local disposable schema. MySQL 8.4.11, 52 migrations, and 61/61
  tests passed; this run included the zero-admin, nullable-phone, and two-family
  identity projection assertions. The wrapper dropped the schema.
- Added and ran `npm run test:e2e:parent:mfa:real`. It preflights localhost:4002,
  allocates and probes an API port, provisions private fixtures into a separate
  disposable schema, restarts the backend between specs, rejects skipped/flaky
  results, runs with traces disabled, and removes the schema and private temp
  artifacts. Parent MFA unknown-browser login passed 1/1; optional setup plus
  unknown-browser TOTP relogin passed 1/1. Both reports had zero skips and zero
  flaky tests; the schema was dropped.
- The browser run exposed that a seeded fixture's enrollment TOTP counter was
  immediately replayed by the first login attempt. The fixture now records its
  counter, and local/CI E2E wait for a strictly newer counter, preserving the
  server's forward-only replay defense. The optional setup spec now enters via
  the signed-in grace reminder and both specs use a fresh browser context for
  their second unknown-browser login.
- Runner and fixture `node --check` passed; `git diff --check` passed with only
  existing CRLF normalization warnings. Parent Web regression passed after the
  earlier translation and test-contract corrections.
- After the final E2E edits, `pnpm exec tsc --noEmit` passed and Playwright
  discovery listed exactly the two certified MFA specs.
- TODO-16 projection is now PASS. TODO-17 remains IN_PROGRESS because the
  Parent action-authority and child-device lifecycle decisions remain open and
  the owner localhost journey has not been offered. TODO-18 remains unoffered;
  Agents 6 and 7 remain on hold.
- No commit, push, remote fetch, live `pca_pro` access, Azure operation, or
  localhost owner acceptance occurred.

### 2026-09-27 — Platform takeover amendment and invitation-creation step-up

- Reviewed the new Platform takeover/two-agent amendment. It matches the
  existing dependent-work package, activation gate, combined release sequence,
  and TODO-19…TODO-23 ordering; the Parent TODO numbering remains unchanged.
- Reconfirmed AGENT-6 and AGENT-7 are both `HOLD_PARENT_DEPENDENCY`. Neither
  inspected or changed Platform source, ran tests, or performed Git, database,
  or Azure operations.
- Closed the TODO-13 device-invitation creation gap with a distinct
  `family.device.enrollment.create` operation. The API consumes its exact
  single-use grant before invitation creation; the Parent wizard now requests
  fresh TOTP step-up; migration 0055 extends the grant CHECK constraint without
  changing existing rows or adding seed data.
- Backend build and focused invitation authority tests passed (10/10). Parent
  Web typecheck passed; focused enrollment UI/client tests passed (75/75).
  The disposable Parent-auth MySQL campaign applied 53 migrations and passed
  61/61, then removed its UUID-named schema.
- The full disposable backend DB suite applied 53 migrations and completed
  609/612 tests. Failures were two commercial-notification HTTP assertions
  (expected 404, got 403) and one device-session test fixture rejected by the
  family suspension FK. The scratch database was removed. These failures are
  outside the invitation-creation route; their causes remain to be reviewed.
- `git diff --check` passes with only known CRLF warnings. No commit, push,
  fetch, live `pca_pro` access or mutation, Azure operation, or owner localhost
  acceptance occurred.

### 2026-09-27 — device-session invalidation across family reactivation

- Added migration 0056 with an additive `families.device_session_epoch` counter;
  existing families start at 1, and no session table or personal data is added.
- Family suspend and reactivate transitions each increment the counter. Device
  sessions capture it at issuance and compare it with active durable family and
  device state on every validation, so reactivation cannot restore an old token.
- The focused session suite passes 13/13, including suspend→reactivate; backend
  TypeScript build passes. The migration/privacy/environment gate passed on
  MySQL 8.4.11 with 54 migrations.
- The Parent-auth disposable runner's first attempt hit Windows `spawn EPERM`
  and cleaned its owned schema. An elevated retry executed the migration gate
  and began the Parent-auth tests, but streaming output ended before the suite
  summary; the owned scratch schema was confirmed absent afterward. A further
  elevated retry was rejected because automatic approval review returned 401
  Unauthorized. Parent-auth MySQL completion therefore remains unverified.
- TODO-15 remains open: the PAIRED→first-policy→ACTIVE device bootstrap path is
  still unavailable under the production crypto/trust wiring. No commit, push,
  remote fetch, live `pca_pro` access/mutation, Azure operation, or owner
  localhost acceptance occurred.
- Agent-5's read-only regression review traced the commercial-notification
  authorization denials to its MySQL fixture creating a service scope without
  the now-required active Parent account, family, and membership. The fixture
  helper now creates that valid authorization relationship. The review also
  found that the prior report of two expected-404 failures does not match the
  current file (one 404 assertion plus a 200 round-trip using the same helper);
  exact full-suite failure names still need reconciliation after the rerun.
- Source review corrected the TODO-14 ledger: commercial mutations explicitly
  implement PCA-DEC-030 Administrator + operation-specific fresh TOTP, not an
  unattested Administrator bypass. No authorization route behavior was changed
  in this checkpoint.

### 2026-09-27 — Parent action authority gap audit

- Agent-5 completed the TODO-12/TODO-14 read-only action map. It confirmed that
  Parent child-request decisions and schedule-policy mutations still require a
  device-session bearer and Trust Set actor resolution after checking the
  Parent session/role; production's unavailable Trust Set resolver makes
  ordinary Administrator actions fail closed. The Parent Web clients also
  require trusted-browser/device state for those calls.
- The audit additionally mapped unresolved child-profile membership checks,
  local-only family-content reads, accepted-member discovery, and the explicitly
  retired Web Rules surface. These remain unavailable/fail-closed and do not
  count as ordinary Parent actions passing TODO-14.
- Agent-3's read-only mobile/device review confirmed the safe boundary:
  introduce a distinct Parent-session authorizer for ordinary Parent actions,
  but retain child-device-session binding for child request submission and
  application acknowledgements, plus receiver-side signed-envelope, epoch,
  wrong-device, and replay checks. Never map a Parent account to a device ID
  or replace the Trust Set resolver globally.
- The policy relay currently trusts a verified device-session sender; no
  independently authorized signing credential is available to replace it.
  Schedule-policy delivery therefore remains blocked until a valid signing
  path exists, and child-profile target resolution remains fail-closed until
  family membership can be verified without trusting client-supplied IDs.
- No Parent route behavior changed in this audit. Parent TODO-12/14 remain
  IN_PROGRESS; TODO-15 remains IN_PROGRESS; Agents 6 and 7 remain held. No
  tests, database operation, Git mutation, owner localhost journey, or Azure
  operation occurred.

### 2026-09-27 — Parent Web integrated regression refresh

- The first full serial Vitest run reported 1064/1065 tests, with the sole
  failure in `DeviceEnrollmentPanel.test.tsx` timing out while awaiting the
  Viewer pairing lookup. The complete file passed 16/16 in isolation, showing
  the lookup path itself was intact.
- Increased only that test's async lookup wait from the Testing Library
  default to 5 seconds. The complete affected file passed 16/16, and the
  subsequent serial full-suite rerun passed 151/151 files and 1065/1065 tests.
- No product behavior changed. Parent TODO-12/14 trust-set action gaps,
  TODO-15 first-policy lifecycle, Parent-auth MySQL after migration 0056, and
  the full backend DB rerun remain open. No commit, push, database, Azure, or
  owner-acceptance action occurred.

### 2026-09-27 — Platform takeover / two-agent amendment

- Accepted the amendment as part of this ongoing mission. The five Parent
  specialist lanes and TODO-01…TODO-23 remain intact; the combined Platform
  release work package is dependent on the Parent gates and does not renumber
  or replace the TODO board.
- AGENT-6 (`platform_enrollment`) and AGENT-7 (`platform_release_qa`) already
  exist and remain `HOLD_PARENT_DEPENDENCY`. No duplicate agents were created.
  Their current file ownership is empty, writes are disabled, and no Platform
  implementation or release QA work has been assigned to them.
- `PLATFORM_ACTIVATION_GATE = NOT_PASS`: TODO-12/14/15 and TODO-17 remain open;
  TODO-18 localhost owner acceptance has not occurred. Therefore the required
  TODO-01…17 PASS, TODO-16 projection PASS, TODO-18 PASS, and literal
  `LOCALHOST_ACCEPTED = YES` conditions are not met. Do not activate AGENT-6 or
  AGENT-7 until the coordinator proves every condition.
- Existing dirty Platform Admin paths and the Parent identity projection work
  are preserved as inherited/shared work and remain under coordinator review.
  They are not evidence that AGENT-6 or AGENT-7 started implementation. Before
  activation, the coordinator will record exact AGENT-6, AGENT-7, shared,
  Parent read-only, and Platform file ownership, with one active writer per
  file and shared edits serialized.
- After Parent localhost acceptance, the next Platform prerequisite is a safe
  Git baseline: preserve accepted Parent and peer work, then fetch and compare
  `pca-dev`, reconciling only legitimate advancement without dirty-tree pulls,
  stash, reset, clean, or force push. This has not been performed for this
  amendment. Exact-commit push, exact-head CI, live `pca_pro`, deployment,
  production smoke, and combined owner UAT remain future gates.
- No source, Git, database, Azure, or owner-acceptance operation was performed
  for this amendment. The amendment does not change the current Parent action
  authority and device-cryptography findings recorded above.

### 2026-09-27 — Parent MFA HTTP contract refresh

- The focused `parentMfaRoutes.test.mjs` run exposed stale assertions left by
  the current unknown-browser contract: first login now starts the 72-hour
  `GRACE` posture; an unknown browser must complete email OTP before TOTP;
  after the grace deadline, email OTP leads to required setup; and lockout
  must be exercised through the login step-up route.
- Added a deterministic test-only Parent identity encryption key to the shared
  Parent MFA test kit, which already initializes the test-only MFA key. The
  HTTP contract now covers exact Grace expiry, email-only rejection for an
  enrolled account, valid email OTP + TOTP completion, post-deadline setup,
  and five-step TOTP lockout through one valid email challenge.
- Focused verification passed: `NODE_ENV=test node --experimental-test-isolation=none --test --test-concurrency=1 test/http/parentMfaRoutes.test.mjs` — 7/7 tests.
  This is local HTTP contract evidence only; it does not close the complete
  backend campaign or any TODO integration/localhost gate.
- The refreshed 271-file non-DB backend campaign could not start: the Windows
  environment returned `spawnSync C:\nvm4w\nodejs\node.exe EPERM` for the
  nested runner. The initial `npm test` run also had the same Node child-process
  limitation. This is not reported as a backend pass or product-test failure;
  the broader backend suite remains unverified.
- The local Parent identity/Platform projection suite passed 11/11 across the
  Parent identity route, identity-profile, and identity-contact tests. This
  confirms the focused auth/RBAC/whitelist mapping and unit contracts, but the
  MySQL authority-selection cases remain in the database campaign and Platform
  Enrollment has not been activated under the amendment gate.
- The bounded Parent-auth disposable MySQL campaign then passed 61/61 on a
  fresh harness-owned database after the MySQL 8.4 environment and privacy gate
  applied 54 migrations. Coverage included 16-way single-family provisioning,
  the final family identity projection's explicit-provisioning precedence,
  legacy single-admin fallback, zero-admin and multi-admin fail-closed cases,
  nullable phone, and Parent MFA/login-grant cases. The harness removed its
  uniquely named database after the pass. This is disposable local evidence;
  live `pca_pro` remains uninspected and unchanged.
- No product route behavior changed. Parent action authority, first-policy
  lifecycle, full backend DB rerun, TODO-17, and TODO-18 remain open. No commit,
  push, database, Azure, or owner-acceptance action occurred.

### 2026-09-27 — Platform takeover amendment reconsidered

- Re-read the attached amendment against the active worktree and mission
  ledger. It remains a dependent work package under TODO-19…TODO-23 and does not
  change Parent architecture, numbering, prior evidence, or the activation
  gates.
- Rejoined AGENT-6 (`platform_enrollment`) and AGENT-7
  (`platform_release_qa`) by their existing specialist task paths; both
  acknowledged `HOLD_PARENT_DEPENDENCY`. No Platform source inspection,
  QA, Git, database, or Azure operation was assigned or performed.
- Current branch is `pca-dev`; the worktree remains extensively dirty and
  shared. No fetch or Git reconciliation was performed. Preserve all existing
  work and defer the fresh `pca-dev` comparison until after Parent localhost
  acceptance and before Platform writes.
- `PLATFORM_ACTIVATION_GATE = NOT_PASS`: Parent TODO-12/14/15/17 remain open and
  TODO-18 owner localhost acceptance is outstanding. Both Platform agents
  remain held until TODO-01…TODO-17, TODO-16 projection, TODO-18, and literal
  `LOCALHOST_ACCEPTED = YES` are proven; coordinator declaration is required
  before either agent starts.
- The amendment's combined release ordering remains applicable: integrated
  Parent/Platform validation, schema/local/live `pca_pro` reconciliation,
  ownership-scoped commits, exact `pca-dev` push and exact-head CI, rollback
  baseline, API + Parent Web + Platform Web deployment, production smoke, and
  combined owner UAT precede TODO-23 closure. None of those external gates was
  advanced by reviewing this amendment.

### 2026-09-27 — Parent-session child-request actions

- Added a separate `ParentSessionChildRequestAuthorizer` path for Parent
  decisions and proactive bonus-time grants. Production checks the active
  same-family Administrator role and verifies FAMILY or CHILD_PROFILE targets;
  the latter uses the async MySQL child-profile registry. Device and accepted
  member targets remain fail-closed until a verified family-scoped lookup is
  available.
- Parent decisions record `decidedByAccountId` with `decidedByDeviceId = null`.
  Parent-created grants record `createdByParentAccountId`, use
  `childDeviceId = null`, and are authorized against the prospective target
  before any request is persisted. Viewer, cross-family, unresolved-target,
  and CSRF denials are covered. Child-facing DTOs hide Parent account actor
  identifiers.
- Removed the device bearer requirement from Parent request decision, direct
  grant, and revoke routes. Revoke/read still require the active Parent family
  role and successful child-profile membership resolution. Child submission
  and `/applied` acknowledgement still require the same verified device bearer;
  wrong-device, replay, and missing-bearer checks remain covered.
- Updated Parent Web `RealRequestClient` so decide/direct-grant calls use the
  Parent session and CSRF without trusted-browser device state. Backend build
  passed; focused ChildRequestService + child-request HTTP suites passed
  60/60; Parent Web typecheck passed; focused `realRequestClient.test.ts` passed
  6/6. The first Vitest launch hit Windows `spawn EPERM`; the approved bounded
  retry passed.
- TODO-12/14 remain IN_PROGRESS: Parent schedule-policy mutation routes still
  depend on the unavailable Trust Set/device path; device/member target
  resolution and account attribution for the in-memory bonus-grant revoke
  ledger need review. TODO-15, TODO-17, and TODO-18 remain open. No commit,
  fetch/push, live `pca_pro` access/mutation, Azure operation, or owner
  localhost acceptance occurred.

### 2026-09-27 — integrated database rerun and session-revocation concurrency

- Corrected `commercialNotificationsHttp.mysql.test.mjs`'s `family()` fixture
  to return the schema's required 36-character UUID; the helper had prefixed
  UUIDs and caused the `families.family_id` `CHAR(36)` insert failure.
- Full disposable backend DB campaign passed its MySQL 8.4/privacy gate and
  applied 54 migrations. It completed 612 tests with 611 passing and one
  failing in Platform Admin's simultaneous logout/revoke-all race; all other
  Parent identity, MFA, family, enrollment, commercial, and Platform database
  tests passed. The harness removed its uniquely named scratch schema.
- Added bounded, whole-transaction retries for InnoDB deadlocks in both
  single-session and account-wide Platform Admin session revocation. Updated
  the concurrency test's failure output to include any rejected operation.
  The isolated Platform Admin auth campaign passed 11/11 on a new disposable
  schema after the change; the broader rerun after this fix remains pending.
- The Parent-auth disposable campaign on migration 0056 passed 61/61,
  including free-access HTTP routes and Parent identity projection. A full
  `611/612` run and a focused `11/11` run are separate evidence; they do not
  establish the integrated full suite as green.
- A subsequent post-fix full disposable backend DB campaign completed 612/612
  tests with zero failures, cancellations, or skips after the MySQL 8.4/privacy
  gate applied 54 migrations. This includes the concurrent session-revocation
  case; the wrapper removed its exact scratch schema at completion.
- The mobile specialist identified that the manually seeded paired-device
  session omitted required `familySessionEpoch`, so its intended lifecycle
  assertion could reject for a malformed record. Added epoch `1`, matching the
  in-memory family default; `DeviceSessionService.test.mjs` then passed 13/13.
  This proves only the local paired-device rejection path, not production
  device crypto or first-policy activation.
- A separate rerun attempt lost its execution handle before returning test
  results. A read-only MySQL inventory found two unconnected
  `pca_test_codex_*` schemas from interrupted attempts; both exact names were
  rechecked and removed, and the inventory then returned zero remaining
  disposable schemas. No result is claimed for that attempt.
- No commit, fetch/push, live `pca_pro` access/mutation, Azure operation, or
  owner localhost acceptance occurred. TODO-17 and TODO-18 remain open.

### 2026-09-27 — Platform amendment and specialist audit reconciliation

- Applied the Platform takeover amendment to this same mission. AGENT-6
  (`platform_enrollment`) and AGENT-7 (`platform_release_qa`) remain
  `HOLD_PARENT_DEPENDENCY`, with no Platform source inspection, tests, Git,
  database, or Azure activity. Both wait for coordinator activation after
  TODO-01…TODO-18 and literal `LOCALHOST ACCEPTED=YES`.
- The amendment preserves combined release ordering: after Parent acceptance,
  reconcile the latest `pca-dev` before Platform writes; then validate and
  release API, Parent Web, and Platform Web as one candidate; do not pass
  TODO-23 until dependent Platform work and combined owner UAT close.
- Read-only Parent authority audit confirms schedule-policy writes still
  require device authorization and return only `PENDING`; production Trust Set
  resolution and Web Rules remain unavailable. Ownership-transfer and
  recovery-material step-up operations have no backend consumers. Corrected
  `ADD_ADMINISTRATOR`'s default step-up operation to `family.member.add`; the
  focused Parent Family Actions suite passed 4/4. TODO-12/13/14 remain open.
- QA audit confirms the 612/612 disposable DB suite is separate from
  `backend npm test`, which includes the child-request HTTP route test. A safe
  isolated Parent MFA browser runner exists; the legacy real-browser runner's
  fixed port lacks a readiness preflight. Existing 1/1 MFA and 1/1 optional
  setup browser results remain distinct evidence; full current-tree backend,
  Platform, mobile, and owner journeys remain pending.
- Read-only source/schema audit found 54 migrations through `0056` (files
  `0009` and `0010` absent). Corrected the canonical header, recorded migration
  `0055` in altered-migration metadata, and added its
  `family.device.enrollment.create` CHECK value to `current_schema.sql`.
  `canonicalSchemaDrift.test.mjs` passed 5/5. The manifest generator does not
  capture CHECK constraints; phone E.164 and token-hash CHECK charset
  expressions still differ textually between schema.ts and current_schema.sql
  and need fresh disposable-schema introspection. Local/live DB schema and
  grants remain uninspected; TODO-20 remains open.
- No commit, fetch/push, live `pca_pro` access/mutation, Azure operation, or
  owner localhost acceptance occurred. Platform activation remains
  `NOT_PASS`; TODO-17, TODO-18, and TODO-20 remain open.

### 2026-09-27 — backend serial regression and disposable migration validation

- Full backend `npm test` was rerun with the Node test runner bounded to one
  file at a time. It completed 2,647/2,648 tests; the only failure was the
  production-path certification analyzer not tracing the dynamic target chosen
  by `scripts/with-disposable-db.mjs`. The 20 scrypt failures and OOM/exit-134
  failures from the prior concurrent run did not recur.
- Updated the certification analyzer to read the disposable wrapper's own
  `requestedTarget` dispatch and follow its selected package script. The
  production-path certification test passes 8/8, including all certified
  stores' CI-execution claims. A post-fix full backend run remains pending.
- Made pending migrations 0054 and 0055 resumable: each inspects the named
  CHECK constraint and only widens it when its operation is missing; an
  interrupted/retried migration sees the already widened constraint and does
  not drop it again. The structural resumability gate passes.
- Regenerated the two disposable MySQL bootstrap SQL artifacts from the
  canonical schema. Their drift test passes along with the migration,
  enrollment, Safe Zone, and audit regression group (33/33).
- Corrected stale iOS enrollment and Safe Zone route fixtures to provide the
  current family-membership, Parent step-up, and recipient-device dependencies.
  The Safe Zone route now returns an explicit 503 when its membership authority
  method is absent. Updated the audit fixture to model an active device for
  device-session issuance. These focused regressions now pass.
- Ran a new full disposable MySQL campaign through all 54 migrations. It
  completed 612/612 tests with zero failures, cancellations, or skips; the
  wrapper confirmed removal of exact scratch database
  `pca_test_codex_f9d9693416da4149875086df76ddea4c`.
- No live `pca_pro` access or mutation, commit, fetch/push, Azure operation, or
  owner localhost acceptance occurred. TODO-17 remains open for the post-fix
  full backend rerun and integrated browser/mobile/owner evidence. TODO-20
  remains open for local/live schema and grant reconciliation. Platform
  agents remain held; activation gate is `NOT_PASS`.

### 2026-09-27 — post-fix backend suite closure

- Reran the full serial backend `npm test` after the CI-path analyzer update.
  All 2,648 tests passed with zero failures, cancellations, or skips.
- The backend unit/integration and disposable MySQL evidence is green. TODO-17
  remains `IN_PROGRESS` because it also requires the current Parent/Platform
  browser, mobile/API, and owner localhost evidence; this backend run does not
  substitute for those gates.
- The earlier paragraph's post-fix rerun was pending when recorded and is now
  satisfied by this result. No commit, fetch/push, live `pca_pro` access or
  mutation, Azure operation, or owner localhost acceptance occurred. TODO-20
  remains open; Platform activation remains `NOT_PASS` and both dependent
  agents stay held.

### 2026-09-27 — Parent eye-protection membership wiring and reserved step-up closure

- Replaced the eye-protection route's use of the frozen synchronous
  `ChildProfileMembershipResolver` with the existing durable async
  `ChildProfileRegistryRepository.resolveMembership` contract. The existing
  production composition already passes this registry to `buildServer`; the
  route now receives the same repository and verifies membership before both
  reads and writes. The resolver contract and device crypto paths are unchanged.
- Unknown and foreign child IDs now share the same `family_scope_forbidden`
  response. Missing membership wiring returns 503. Focused checks cover active
  Viewer reads, active Administrator writes with CSRF and no device bearer,
  and no settings access or write for denied targets. The eye-protection
  Parent route suite passed 8/8 after `npm run build` passed.
- The source audit confirmed that ownership-transfer and recovery-material
  step-up values have no working consumers. Public Parent MFA issuance now
  accepts only the ten sensitive operations with real consumers and rejects
  those two reserved values. Their DB CHECK/type vocabulary remains for
  migration compatibility; no Owner model or unsupported workflow was
  invented. The Parent MFA route suite passed 7/7 with the required
  `test.env` and Node's single-process test mode; its backend build passed.
- TODO-12/13/14 remain IN_PROGRESS: schedule-policy authorization, removal
  authorities, Web Rules, the remaining action matrix, explicit Owner binding
  for any future transfer/recovery consumer, and integrated unexpected-status
  counts remain open. No full backend rerun, commit, fetch/push, live
  `pca_pro` access/mutation, Azure operation, or owner localhost acceptance
  occurred. TODO-17 remains open and Platform activation remains `NOT_PASS`.

### 2026-09-27 — current full backend regression

- Default `npm test` completed its build and preflight gates, but Node's test
  runner could not spawn one worker per file in the restricted environment
  (`spawn EPERM`). A first global single-process attempt exposed cross-file
  state leakage and was not counted as a pass.
- Added `PCA_TEST_PER_FILE=1` as an opt-in to `scripts/run-tests.mjs`. It runs
  each already-registered non-DB test file in a dedicated single-process Node
  test runner, preserving file isolation. The standard runner path is unchanged.
- Elevated `npm test` with that option passed all 272/272 registered backend
  test files. Build, conformance, schema-privacy, and server preflight gates
  also completed successfully. DB-backed tests remain the separately recorded
  612/612 disposable MySQL campaign; browser/mobile/owner integration remains
  pending.
- TODO-17 remains IN_PROGRESS for integrated browser, mobile/API, Platform,
  and owner evidence. No commit, remote, live database, Azure, or acceptance
  action occurred.

### 2026-09-27 — Parent eye-protection membership wiring

- Replaced the eye-protection route's use of the frozen synchronous
  `ChildProfileMembershipResolver` with the existing durable async
  `ChildProfileRegistryRepository.resolveMembership` contract. The existing
  production composition already passes this registry to `buildServer`; the
  route now receives the same repository and verifies membership before both
  reads and writes. The resolver contract and device crypto paths are unchanged.
- Unknown and foreign child IDs now share the same `family_scope_forbidden`
  response. Missing membership wiring returns 503. Focused checks confirm
  active Viewer reads, active Administrator writes with CSRF and no device
  bearer, no settings access for denied reads, and no writes for denied targets.
- `npm run build` passed. The first Node test invocation hit Windows `spawn
  EPERM` before running the file; rerunning with
  `node --experimental-test-isolation=none --test --test-concurrency=1
  test/http/eyeProtectionRoutes.test.mjs` passed 8/8 with zero skips.
- TODO-12/14 remain IN_PROGRESS: schedule-policy authorization, removal
  authorities, Web Rules, remaining action coverage, and integrated
  unexpected-status counts remain open. No full backend rerun, commit,
  fetch/push, live `pca_pro` access/mutation, Azure operation, or owner
  localhost acceptance occurred. TODO-17 remains open and Platform activation
  remains `NOT_PASS`.

### 2026-09-27 — Parent bonus-grant revoke actor attribution

- Added separate `BonusGrantLedger` metadata for successful active-grant
  revocations, recording the grant, child-profile, timestamp, and authenticated
  Parent account ID. Inactive, naturally expired, unknown, and cross-family
  attempts do not create attribution; metadata reads return a defensive copy,
  and replaying the same grant ID clears stale revoke metadata before it can be
  attributed to a later lifecycle.
  The existing `BonusGrant` DTO and child-device identity remain unchanged.
- The Parent revoke route supplies its already-authenticated session account
  ID. `npm run build` passed; the ledger suite passed 9/9 and the HTTP route
  suite passed 17/17 when run in separate Node processes. Combining both files
  in one `--experimental-test-isolation=none` invocation caused shared-process
  fixture interference and is not counted as evidence.
- This ledger is process-local, so the metadata is volatile and not a durable
  audit trail. Durable revocation history remains a separate storage decision.
  No commit, fetch/push, live database, Azure, or owner acceptance action was
  performed.

### 2026-09-27 — Parent removal mutation role gates

- Added fail-closed active `ADMINISTRATOR` role checks before removal-request
  creation, local Administration PIN decisions, and PIN configuration. The
  existing session, family, CSRF, local PIN, and unavailable signing/recovery
  proof boundaries remain enforced.
- Viewer denial, role-lookup failure, Administrator behavior, and existing
  signed/recovery fail-closed checks passed in
  `removalDecisionRoutes.wiring.test.mjs` (13/13); `npm run build` passed.
- Target-to-child binding, caller-supplied protection-level semantics,
  Parent-account actor provenance, and production protection-status
  availability remain open TODO-12/14 gaps. No commit, remote, database,
  Azure, or owner-acceptance action occurred.

### 2026-09-27 — Parent removal TOTP integration checkpoint

- Removal-request creation, local-PIN decisions, and Administration PIN
  configuration now require fresh Parent session-bound step-up grants with
  operation scopes derived from the requested/stored removal operation. The
  Parent protection panel and device-list entry point request those grants and
  serialize them through the real actions client.
- Backend `npm.cmd run build` passed. The route suite passed 16/16 when run
  with `NODE_ENV=test`, matching its `pca_family_session` fixture cookie. An
  unset `NODE_ENV` selects the production `__Host-` cookie name and gives this
  fixture 401 responses, so that invocation is invalid as route evidence.
- Parent typecheck and focused Vitest retry could not complete in this
  checkpoint: Node processes failed with native/heap OOM while reported free
  memory was about 163 MB. The last recorded focused client suite was 3/3 and
  typecheck passed before this checkpoint; current full Parent Web regression
  is still outstanding and must be rerun when resources permit.
- No commit, fetch/push, live `pca_pro` access or mutation, Azure operation, or
  owner localhost acceptance occurred. TODO-12/13/14 and TODO-17 remain open;
  Platform activation remains `NOT_PASS`.

### 2026-09-27 — Parent removal target binding follow-up

- A read-only source audit found the conditional durable edge
  `devices → enrollment_bootstrap_attempts → enrollment_invitations →
  child_profile_id`. Null/legacy invitation bindings, devices without a
  completed enrollment attempt, and multiple distinct child bindings must
  fail closed. The family membership registry provides the separate family
  membership check.
- AGENT-2 added a family-scoped binding repository and typed resolver that
  require an active Android/iOS device, one usable enrollment child binding,
  current family membership, and fresh PROTECTED/DEGRADED status. Null/legacy,
  ambiguous, inactive, missing, stale, and non-protective states fail closed.
- The coordinator integrated the route and production composition to persist
  only resolver-derived child and protection-level values. Client `childId`
  and `protectionLevel` are no longer required or trusted by removal creation;
  unresolved targets return a generic 409 and resolver failures return 503.
  Protection status remains a device-session-authenticated self-report, not
  hardware attestation.
- Integration is not validated: a fresh backend build failed with native Node
  out-of-memory while system free memory had fallen to about 2 MB. The resolver
  unit file and SQL binding query still need focused and disposable-MySQL
  validation. No migration, live database, or external action was performed.
- AGENT-6 and AGENT-7 have re-acknowledged `HOLD_PARENT_DEPENDENCY` under the
  full Platform amendment. TODO-12/14/15/17 and TODO-18 remain open, so no
  Platform source work is authorized to start yet.

### 2026-09-27 — Amendment reconfirmation and removal resolver validation

- The newly supplied Platform takeover amendment matches the amendment already
  applied above. The dependent Platform package remains gated by Parent local
  completion and literal owner `LOCALHOST_ACCEPTED = YES`; no Platform writes,
  Git mutation, live database operation, or Azure action was started.
- Re-ran the integrated backend TypeScript build after the resolver integration:
  `npm.cmd run build` passed.
- Ran `RemovalTargetResolver.test.mjs` and
  `removalDecisionRoutes.wiring.test.mjs` serially with `NODE_ENV=test`:
  26/26 passed. This proves the resolver's unit cases and current route wiring,
  but not the repository's SQL against MySQL or live database state.
- The earlier OOM remains historical evidence only; the current build and
  focused test evidence supersede it for this integration. Disposable-MySQL
  SQL validation and the broader Parent TODOs remain outstanding.

### 2026-09-27 — MySQL coverage for removal target binding

- Added disposable-MySQL cases to the existing enrollment database suite for a
  persisted invitation-to-child binding, cross-family device lookup, a null
  child binding, and a non-active device. The fixture uses the real enrollment
  service to create the device, bootstrap attempt, and invitation relationship;
  it advances only the isolated fixture device to ACTIVE for resolver checks.
- `node --check test/db/enrollment.mysql.test.mjs` passed, and `git diff
  --check` passed with only pre-existing CRLF normalization warnings.
- The database run is not validated yet. The ordinary `npm run test:db`
  stopped during TypeScript build with native Node out-of-memory. Directly
  invoking the disposable wrapper created and removed its exact scratch DB,
  then Windows returned `spawn EPERM` before migrations/tests. An elevated
  retry again failed during build with native Node out-of-memory, before the
  wrapper or database ran. No test result is claimed for the new MySQL cases.
- The earlier successful backend build and 26/26 resolver/route tests still
  validate the TypeScript integration and in-memory behavior; they do not
  replace this pending MySQL query validation.

### 2026-09-27 — focused binding SQL pass and eye-protection regression follow-up

- Added `test:db:enrollment-binding` and its inner target to the disposable
  MySQL runner so the enrollment repository suite can run independently of
  unrelated Platform authentication and Parent password-hashing cases.
- Ran `node --env-file=test.env --env-file=test.db.env
  scripts/with-disposable-db.mjs enrollment-binding`. The wrapper's 54-migration
  MySQL 8.4/privacy gate passed, all 22 enrollment database tests passed (both
  new binding SQL cases included), and the exact scratch database was removed.
- A full disposable `all` suite run reached completion but FAILED overall.
  Multiple unrelated tests reported `Deriving bits failed` and
  `Platform Administration authentication failed`; the MySQL eye-protection
  route fixture also returned 503 because it still used the retired membership
  dependency. This result is not a green suite and is not used to close TODO-17.
- Updated the eye-protection MySQL fixture to provide the current family-scoped
  registry contract and to expect the same 403 response for foreign and
  nonexistent child IDs. Owner/viewer/write fixtures now provide membership
  where their test scenario requires it. These fixture edits remain
  UNVALIDATED: the authority-diagnostics disposable run's Node child crashed
  before migrations/tests with native memory/process errors; its exact scratch
  database was removed.
- The latest build attempts also failed with native Node out-of-memory, and
  subsequent process launches were refused because the Windows paging file was
  exhausted. Do not infer a source build failure from these resource failures;
  but do not claim fresh build or eye-protection MySQL PASS until rerun.

### 2026-09-27 — Parent eye-protection membership regression follow-up

- The authority-diagnostics MySQL target passed its 54-migration environment
  gate and completed 62 tests with 61 passes. Its single failure exposed a
  stale Viewer fixture that supplied the default ADMINISTRATOR session role.
- Corrected that fixture to use a VIEWER session while retaining an authorized
  child membership; the owner fixture remains ADMINISTRATOR. The route-level
  eye-protection unit suite passed 8/8, covering Viewer reads, denied Viewer
  writes, membership rejection, and the unavailable-authority case. Both
  changed MJS files pass `node --check`; `git diff --check` passes with only
  existing CRLF warnings.
- The corrected database fixture has not yet been rerun. The latest attempt
  failed before creating a scratch schema because `127.0.0.1:33061` refused the
  MySQL connection; Docker CLI also reports its engine is not running. The prior
  61/62 result is not promoted to PASS for the corrected fixture. Docker Desktop
  service inspection showed a demand-start LocalSystem service; Windows denied
  service startup with Access Denied. The hidden Desktop process started for
  diagnosis was closed gracefully; no elevation bypass or database mutation
  was attempted.

### 2026-09-27 — Durable Parent actor attribution for removal decisions

- Added authenticated Parent-account attribution to the durable removal
  request/decision record. The create and local-PIN/recovery routes pass the
  account ID taken from the validated session; the signed device-decision path
  keeps its device actor separate and leaves the Parent-account actor null.
  Request and decision account IDs are internal persistence fields and are not
  included in any Parent-facing DTO. A spoofed body account ID regression
  proves the server session remains the source of truth.
- Added nullable `requested_by_parent_account_id` and
  `decided_by_parent_account_id` columns with `parent_accounts` foreign keys in
  migration 0057 and the canonical schema; regenerated the disposable and live
  bootstrap DDL. Historical and device-only rows remain null; no business data
  or seed rows were written. Added a real-MySQL Parent-auth test for create/read
  and compare-and-set decision persistence.
- `npm.cmd run build` passed. Removal-decision authority, device-revocation,
  route-wiring, and canonical migration tests passed 56/56 with
  `--experimental-test-isolation=none`; the default test invocation first hit
  Windows `spawn EPERM`, which is an execution-environment failure. Schema
  privacy tests passed 30/30, disposable bootstrap artifact `--check` passed,
  and `git diff --check` passed with existing CRLF warnings.
- The MySQL persistence case is added but not run: a fresh local check of
  `127.0.0.1:33061` timed out. Migration 0057 is therefore not yet proven against
  MySQL. The pre-existing dirty `backend/schema/current_schema.sql` and
  `schema_manifest.json` remain unrefreshed because they are live introspection
  artifacts and no migrated database was available. No live `pca_pro`, remote
  Git, Azure, or owner acceptance action occurred.

### 2026-09-27 — Platform takeover amendment and specialist hold confirmation

- Applied the Platform takeover / two-agent amendment to the existing active
  mission. The Parent TODO numbering and current board are unchanged; the goal
  remains active. The combined release gates remain downstream of Parent
  TODO-01…18, including literal `LOCALHOST ACCEPTED=YES`.
- AGENT-6 (Platform Enrollment / Parent Projection) and AGENT-7 (Platform QA /
  Release / Azure Validation) both acknowledged `HOLD_PARENT_DEPENDENCY`.
  Neither inspected files, ran tests, edited source, or performed Git, DB, or
  Azure actions. Platform implementation remains not started.
- Refreshed AGENT-1 read-only review found the auth service/test behavior aligned;
  the notable browser evidence gap is missing daily-login-grant cookie
  assertions in two successful flows in `parentMfa.spec.ts`. Carry this into
  TODO-17 integration evidence; no source changes were made by the specialist.
- Refreshed AGENT-3 read-only review confirms Parent child-request decisions
  use the authenticated Parent actor while child submission remains device
  scoped. Schedule-policy delivery still lacks an approved signed-envelope
  contract and production Trust Set resolver; nonce/key epoch are dropped by
  the current relay mapping. Keep TODO-12/14/15 open as recorded and do not
  weaken the device-security boundary to bypass these blockers.
- Next: continue Parent TODO-12…18 and resolve or explicitly retain the security
  and integrated-evidence gates. Do not activate Platform agents before the
  stated Parent localhost acceptance gate.

### 2026-09-27 — unknown-browser cookie assertions follow-up

- Verified `parent-web/e2e-real/parentMfa.spec.ts` asserts both
  `pca_family_session` and `pca_parent_daily_login_grant` cookies exist and are
  HttpOnly after each of the two successful unknown-browser logins (lines
  92–98 and 124–130). `git diff --check` for the file passes.
- The focused real-browser case was not run: all four required
  `E2E_REAL_MFA_PARENT_*` fixture variables are absent in this shell. This is
  added coverage, not a browser PASS.
- Previously observed Node processes 1844 and 20364 are still alive, but their
  command lines cannot be read (`Get-CimInstance Win32_Process` returns Access
  Denied); CPU and working sets remained flat. They were left untouched, and
  no suite was restarted without a recoverable process handle or attributable
  test-runner evidence.

### 2026-09-27 — migration 0057 Parent-actor foreign-key regression coverage

- Added a Parent-auth MySQL regression in `backend/test/db/parentAccount.mysql.test.mjs`
  that verifies both requester and decider foreign keys reject unknown account
  IDs and that a rejected decider update leaves the approval pending with no
  actor recorded.
- `node --check backend/test/db/parentAccount.mysql.test.mjs` and
  `git diff --check` for the file pass. The live disposable-MySQL test remains
  unrun because `127.0.0.1:33061` is still unreachable; this is syntax and diff
  hygiene evidence only, not MySQL evidence.

### 2026-10-02 01:38 UTC — Wave 6B: first-device trust-root bootstrap foundation (backend-only; stopped for owner review)

SCOPE = Backend + migration + tests only, per the owner authorization. Owner rulings D4/F4/F5 applied: dedicated `family.device.bootstrap.root` step-up; dual-domain proof model (bootstrap proof `PCA_FIRST_DEVICE_BOOTSTRAP_V1` over the exact epoch-1 byte digest + the certified epoch-1 signature by the same DSK — neither substitutes for the other); "child device" = the PCA-managed endpoint being enrolled, in its canonical pre-bootstrap lifecycle state.
IMPLEMENTATION = Migration 0062 (additive): `family_first_device_bootstrap_ceremonies` (one-time challenge state, anchor linkage, idempotent committed-result recovery), the widened step-up operation CHECK, and the anchor `signature_scheme` discriminator. New modules: canonical bootstrap proof, bootstrap service (provisioned-owner + ACTIVE Administrator + same-family eligibility; fresh dedicated step-up; single-use challenge; dual-signature verification; fail-closed attestation boundary; atomic commit; ceremony-ID idempotent recovery with conflicting-payload rejection), MySQL bootstrap store (ONE transaction: challenge consume + anchor insert + epoch-1 append + floors advance; one root per family by PK + floors latch), device/parent HTTP routes, main.ts/buildServer wiring, regenerated canonical schema/grant/bootstrap artifacts. No private keys persisted; no server family key; no browser root; no recovery envelope; Wave-5B acceptance untouched.
VALIDATION = Unit suite 2790/2790; Wave-6B focused unit suites 33/33; migration-from-zero through 0062 PASS; 0061→0062 upgrade/replay/constraint backstop 3/3; ceremony acceptance 11/11 (byte-exact root, concurrency exactly-one-root, idempotent replay, rollback leaves no partial authority, suspended-owner refusal, cross-family isolation); full DB lane inner 694 tests / 684 pass / 0 fail / 10 privileged-mode skips; certified production paths 276/276 (0 skipped, 0 failed); privilege gate 7/7; security checks + negative controls PASS; contracts PASS; focused temp-copy kill-run: control 44/44 pass and all six PCA-SEC-022 mutants behaviorally killed; `git diff --check` clean.
STOP = WAVE_6B_STOPPED_FOR_OWNER_REVIEW = YES. Wave 6C/6D, route activation, ordinary epoch ingestion, recovery, Platform, live DB and Azure remain NOT authorized.

### 2026-10-02 03:30 UTC — Wave 6B-R1: first-device trust-root seven-specialist security closure (backend-only; stopped for owner review)

SCOPE = Controlled correction + adversarial certification per the owner R1 directive. Findings closed: R1-01 (committed payload digest omitted proofSignature; LF-delimiter ambiguity; null/'' aliasing), R1-02 (attestation VERIFIED did not bind the expected DSK identity), R1-03 (durable auditability of the canonical PCA_FIRST_DEVICE_BOOTSTRAP_V1 statement).
IMPLEMENTATION = `FirstDeviceBootstrapCommit.ts` (canonical `PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1` identity; 7 netstring fields incl. proofSignature and an internal evidence presence flag); attestation contract + service equality checks (expected DSK in, attested DSK out, evidence digest chain unchanged; no blind echo; MUST-NOT obligations documented for 6C/6D); migration 0063 (`bootstrap_proof_sha256` + `attestation_evidence_sha256`, four ffdbc_* CHECKs; digests only -- raw proof bytes and raw evidence are never stored); regenerated canonical artifacts (61 migrations, 95 tables, 830 columns, 312 checks) incl. snapshot/manifest/live-bootstrap/disposable pair/privacy CSV/canonical report; post-validate fingerprint re-pinned to the from-zero migrated 0063 reference.
VALIDATION = Unit suite 2801/2801; focused unit 44/44; from-zero through 0063 PASS; 0062→0063 upgrade/legacy-preservation/replay/backstop PASS; ceremony DB suite 14/14 incl. COMMITTED IDENTITY + AUDIT RECONSTRUCTION + EVIDENCE VARIANTS; full DB lane inner 698 tests / 688 pass / 0 fail / 10 privileged-mode skips; certified production paths 276/276 (0 skipped, 0 failed); canonical schema drift + disposable-bootstrap --check PASS; security checks + negative controls PASS; contracts PASS; focused temp-copy kill-run v3: control 58/58 pass and all sixteen B-SEC022-001..016 mutants behaviorally killed; `git diff --check` clean.
STOP = WAVE_6B_100_PERCENT_CLOSED = YES. Wave 6C/6D, NO DOWNSTREAM PARENT-POLICY / ORDINARY TRUST-SET / DEVICE-ACTIVE ROUTE ACTIVATION, recovery, Platform, live DB and Azure remain NOT authorized.

### 2026-10-03 00:44 UTC — Wave 6C: Android first-device trust-root activation (Android-only; real-device attestation gate open; stopped for owner review)

SCOPE = Controlled Android-only implementation + adversarial certification per the owner 6C directive, on top of the certified 6B/R1 ceremony. One DSK lifecycle: AndroidKeyStore-generated (StrongBox-first, TEE fallback, hardware-asserted, non-exportable, create-once) -> attested via Android Key Attestation chains (challenge `PCA_ANDROID_DSK_ATTESTATION_V1|<attemptId>` baked at generation) -> signs the canonical PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof and the epoch-1 statement -> family root only after server acceptance. No iOS source change (IOS_PRODUCT_DIFF = 0); no new migration; no downstream route activation.
IMPLEMENTATION = Android security + `firstdevice/` ceremony stack + enrollment capture; backend Android-only verifier/adapter (`KeyAttestationDer`, `AndroidKeyAttestationVerifier`, `PlatformAttestationVerifier`, `main.ts` router wiring, enrollment key-id delivery on /bootstrap + /recover); shared canonical golden vectors exercised by BOTH lanes; tooling pins updated for the new production composition with extended permissive-verifier and PEM-literal bans.
VALIDATION = Backend unit suite 2833/2833 (0 fail). Disposable MySQL full certification green: inner 698 tests / 688 pass / 0 fail / 10 privileged-mode skips (incl. migration-0063 audit suite + first-device ceremony suite), 61 migrations from zero, certified production paths 276/276. Android CI-parity BUILD SUCCESSFUL (`lint test assembleDebug assembleRelease`; 2814 tests / 0 fail / 0 errors / 2 conditional skips; release APK built). Mutation campaign: all 26 mutants behaviorally killed (24 backend incl. the 16 B-SEC022 controls; C-SEC-008/010 Android lane; C-SEC-002 refined after a compile-only first fragment; every Android mutation restored with SHA verification and a green post-restore control). Repo/quality/security/contracts/release-control gates PASS with negative controls; npm audit 6/6; SBOMs 60/474/641 components; public-web + both web lints + demo-mode gates PASS; `git diff --check` clean.
STAGE_B = Seven-specialist gate on the frozen tree (ledgers included): all raised findings resolved pre-publication -- signed-region provenance blocker (raw-DER equality on every chain cert + regression test), multi-root order independence, PEM unbundled-BEGIN rejection, UNKNOWN-with-submission status-only guard, committed-root alias keep-set, non-terminal seed-capture guard, TEE-fallback cleanup; behavioral kill controls C-SEC-011..016; final pass result reported with the 6C report. Accepted residuals: no user-auth binding (A1); app-id parsing deferred; provider behavior backed by static scans + real-device gate; lost-update between seed capture and coordinator transitions accepted while no production ceremony callers exist (root-store serialization REQUIRED at activation wiring).
EXTERNAL_GATES = REAL_DEVICE_ATTESTATION_GATE = OPEN -- a genuine hardware-backed attestation on a PHYSICAL device has not been performed; UNIT/EMULATOR/CI evidence is recorded as exactly that and never as device evidence. PRODUCTION_ATTESTATION_GATE = OPEN -- operators must pin the real Android root CA bundle (`PCA_ANDROID_ATTESTATION_ROOTS_PEM`); without it the production verifier answers UNAVAILABLE (fail closed). TODO-15 remains IN_PROGRESS.
STOP = WAVE_6C_CODE_COMPLETE = YES; REAL_DEVICE_ATTESTATION_GATE = OPEN; WAVE_6C_100_PERCENT_CLOSED = NO (duty of honesty); stopped for owner review. Wave 6D (iOS), downstream Parent-policy / ordinary Trust-Set / device-active route activation, recovery, Platform, live DB and Azure remain NOT authorized.

## CODEX RESTART CHECKPOINT

RESTART_BRANCH = pca-dev
RESTART_SHA = 778805355ddefe0fefc83747035470076e86b404 (last certified exact-head; the 6C commit supersedes it and is reported to the owner with the 6C report)
LAST_CERTIFIED_CI = Quality Gates run 36961389056 SUCCESS 27/27 at `77880535`; the 6C commit's exact-head run is reported with the 6C report
READ_FIRST =
1. docs/PCA_PARENT_AUTHORITY_CONTINUOUS_GOAL.md
2. docs/pca_independent_senior_reviewer/PARENT_CODEX_MASTER_TODO.md
3. docs/pca_independent_senior_reviewer/PLATFORM_CODEX_MASTER_TODO.md
4. .agent-local-artifacts/local-uat-mission/PCA_LOCAL_UAT_HANDOFF.md (local only; contains credentials; never commit)
REESTABLISH_GOAL = PCA Parent Authentication + Authority — Continuous Completion
FIRST_CODEX_ACTIONS =
1. inspect worktree and preserve all legitimate changes (done for current re-entry);
2. verify local/tracking/server SHA using authenticated read-only GitHub state if Git transport credentials are unavailable (done: all a8c37162);
3. independently verify latest exact-head CI (last recorded: a8c37162 run 36634164993, 27/27; fresh Actions API lookup currently blocked by configured proxy);
4. reconcile current master TODO statuses against source (ongoing; Wave 5C implemented/validated locally);
5. obtain permitted `.git` metadata writes before stage/commit/push; current sandbox denied `.git/FETCH_HEAD` and `.git/index.lock`;
6. determine and continue the next authorized Parent dependency; do not wire Trust Set acceptance absent the required approved security/root-of-trust composition;
7. do NOT deploy;
8. preserve Platform HOLD_PARENT_DEPENDENCY;
9. continue only from the first genuinely incomplete dependency;
10. run exhaustive local browser UAT only after the current Parent engineering checkpoint is accepted.
OWNER_ACCEPTANCE_REQUIRED = YES
AZURE = HOLD
PLATFORM = HOLD_PARENT_DEPENDENCY

### 2026-09-29 22:44 UTC — Wave 5C composition review correction

The re-entry review found that child-request routes preferred a raw registry dependency even though Parent action authorization used the shared resolver. Removed that alternate dependency from the route and its `buildServer.ts` registration. The production-wiring test now checks the server-factory forwarding and verifies that the route has no raw-registry path. Backend build and the focused resolver/authorization/route/wiring suite pass locally (81/81, serialized); exact-head CI remains pending because the worktree is uncommitted. TODO-12 remains IN_PROGRESS and Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-29 22:58 UTC — TODO-14 Parent-session route audit integrated

The Parent-session child-request authorizer now uses the same registry-backed resolver as Parent action authorization and the direct child-request membership routes. The full seven-suite route-audit campaign passed 51/51 using a temporary UUID-owned local MySQL 8.4.11 database after the 58-migration environment/privacy gate; the database was removed. Its status-only collector proves 45/52 database-integrated declarations across 137 scenarios (50 allow, 75 expected denial, 1 protective-authority-not-applicable, 11 validation/protocol), with zero unexpected 401/403/other. Remaining seven: one schedule-policy Trust Set gate, three unconfigured Web Rules routes, two crypto-gated removal decisions, and one optional dashboard read. `GLOBAL_AGGREGATE_STATUS` remains `NOT_YET_PROVEN`. The standard wrapper hit Windows `spawn EPERM`; direct serial execution against the owned disposable topology succeeded. Exact-head CI remains pending and the Platform hold is unchanged.

### 2026-09-29 23:04 UTC — TODO-15 source gate reconfirmed

Read-only Android/iOS source inspection reconfirmed that production activation is not wired: Android production key generation remains fail-closed, and iOS lifecycle/epoch helpers have no production receipt-verification/application caller. Waves 5A/5B provide durable epoch storage and Trust Set signature-verification foundations, but the production acceptance writer remains unwired and PCA-DEC-037 families have no first-device DSK genesis anchor. No mobile source change or mobile test claim was made; owner/security bootstrap, crypto and attestation gates remain open.

### 2026-09-30 — iOS missing-floor gate hardened

TODO-15 source review found that `PolicyApplicationGate` accepted any epoch when its current trusted floor was absent. Changed this to `rejectMissingTrustedEpochFloor` and updated the XCTest expectation. A standalone Swift compile/probe passed missing-floor denial, equal/newer epoch acceptance, and independent stale Trust Set/key-epoch denial. `xcodebuild` is unavailable, so the XCTest/simulator suite was not run. This does not add a receipt caller or activate devices; the root ceremony, signature verification, replay-safe acceptance, application pipeline and attestation gates remain open. Current source is uncommitted and has no exact-head CI.

### 2026-09-30 — Android enrollment response status fail-closed

TODO-15 source review found that Android's bootstrap HTTP parser accepted any nonblank status, while its backend contract returns only `PAIRING_PENDING`. The Android HTTP parser now treats any other status in a success response as ambiguous; `EnrollmentCoordinator` preserves the raw token/pending attempt for explicit resolution, recovery also remains pending, and the local persistence boundary independently refuses any status other than `PAIRING_PENDING`. Focused Gradle `EnrollmentCoordinatorTest` and `HttpDeviceBootstrapApiClientTest` passed 50/50 (30 + 20, zero failures/errors/skips). The run used a task-local Gradle 8.7 cache because the default user-profile cache was denied; Kotlin daemon temp writes were denied and compilation fell back successfully. No device activation is enabled; exact-head CI and Xcode validation remain pending.

### 2026-09-30 — Re-entry transport and live DB refresh

The attached Codex re-entry handover was reconciled against the current source, migrations, tests, Git history and both master TODOs before resuming engineering. Current local HEAD, `origin/pca-dev`, and a fresh `git ls-remote` all equal `a8c37162ed6ec135b618a3942c4766bac3b8f508`; the Wave 5C source and test changes remain uncommitted. The latest recorded exact-head CI is run `36634164993`, 27/27 at `a8c37162`; a fresh Actions lookup could not connect because the configured proxy refused `api.github.com`, so no CI claim is made for current local changes. A fresh bounded TCP/3306 check to `pca-mysql.mysql.database.azure.com` returned `False`; live `pca_pro` remains last verified through migration 0059, repository/local are at 0060, and no live read or mutation was performed. Parent board status on re-entry: 14 PASS, five IN_PROGRESS (TODO-12/14/15/19/20), four TODO owner/release gates (TODO-18/21/22/23). Platform remains `HOLD_PARENT_DEPENDENCY`; owner localhost acceptance remains pending.

### 2026-09-30 — Codex handover source and audit-boundary review

Current re-entry confirms local HEAD and `origin/pca-dev` tracking ref at `a8c37162ed6ec135b618a3942c4766bac3b8f508`; a fresh server-ref check could not connect through the configured proxy, so server equality is unverified here. Latest recorded exact-head CI remains `36634164993` at `a8c37162` (27/27), before current uncommitted Parent/mobile changes. DeepSeek Wave 5A/5B source was reviewed at the committed baseline and remains accepted with the first-device Trust Set root/acceptance follow-up. The local Wave 5C membership resolver remains opaque, shared, and fail-closed; its recorded focused and disposable-MySQL tests do not substitute for exact-head CI.

TODO-12 FamilyAudit review reconfirmed overloaded `actorDeviceId` attribution (device, Parent account, target-device, and service values), unset production `actorMemberId`, and the rejecting opaque composer pending PCA-DEC-020 review. No approved typed actor schema or reviewed delivery path was found, so no actor-schema, plaintext, or crypto-composer shortcut was introduced. Continue independent Parent TODO-12/15 work where source and approved contracts provide a safe path. Keep TODO-14 global aggregate, TODO-18 owner acceptance, TODO-19 publication, TODO-20 live 0059/0060 reconciliation, Platform `HOLD_PARENT_DEPENDENCY`, and deployment gates explicit.
CURRENT_BUILD = Backend `npm run build` (`tsc`) passes on the current uncommitted Parent source tree. This is build-only evidence and does not replace focused tests, exact-head CI, owner acceptance, or release gates.

### 2026-09-30 — Current Parent source regression checkpoint

Backend build passes. The seven focused Parent resolver/authorization/child-request/runtime-grant files pass 145/145 serially under `NODE_ENV=test`; the suite-registration guard passes 6/6. A corrected database-backed route-audit command (duplicate test-file entry removed) passes 51/51 against disposable MySQL 8.4.11 after the 58-migration gate; the UUID-owned DB is removed. Its status-only report covers 45/52 declarations over 137 scenarios with zero unexpected 401/403/other and `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`. The initial direct test invocation omitted `NODE_ENV=test`; fail-closed production cookie naming made those fixture requests unauthenticated, and the correctly configured rerun passed.

Android's requested Gradle task succeeded but was UP-TO-DATE; existing current-input XML evidence shows the two target suites at 30/30 and 20/20 with no failures, errors, or skips. This is not a new test execution. Current exact-head CI remains the recorded run `36634164993` at `a8c37162`, 27/27; it does not cover these local edits. Parent TODO-14 remains globally unproven, TODO-12 FamilyAudit/root dependencies and TODO-15 activation remain gated, TODO-18 is owner-only, TODO-20 live state remains last verified at 0059, and Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Parent safety checkpoint `59bfc331`

Local commit `59bfc331` records the reviewed opaque Parent child-profile membership boundary, shared Parent-session child-request authorizer, corrected route-audit test command, iOS missing-floor rejection, Android exact-PAIRING_PENDING safeguards, affected tests, and updated crosswalk/ledgers. It contains 31 mission paths; `.vscode/` and root `0` remain untouched and excluded. Local validation: backend build PASS; focused Parent regression 145/145 under `NODE_ENV=test`; registration guard 6/6; corrected disposable MySQL 8.4.11 route campaign 51/51 after 58 migrations, UUID database cleanup PASS, report 45/52 integrated declarations across 137 scenarios with zero unexpected 401/403/other and global aggregate NOT_YET_PROVEN. Android Gradle completed with the target task UP-TO-DATE and current-input reports 30/30 + 20/20; this invocation reused XML reports rather than freshly executing tests. The previously recorded standalone Swift behavior probe passed; Xcode is unavailable.

`HEAD=59bfc331`; `origin/pca-dev` tracking ref remains `a8c37162`. `git ls-remote` could not reach GitHub through the configured proxy, so the current server ref is unverified; no push or exact-head CI is claimed. The last recorded exact-head run `36634164993` (27/27 at `a8c37162`) predates this commit. TODO-14 global aggregate remains NOT_YET_PROVEN; TODO-12 root and encrypted audit/policy gates, TODO-15 device activation gates, TODO-18 owner localhost acceptance, TODO-20 live 0059/0060 reconciliation, and Platform `HOLD_PARENT_DEPENDENCY` remain open.

### 2026-09-30 — Published checkpoint ref and CI status

The implementation checkpoint `59bfc331` and ledger sync `785323d2e471d1fa35a27d93935b0451f1a58210` are published on `origin/pca-dev` as a fast-forward from `a8c37162`. Post-push fetch and `git ls-remote` verify local/tracking/server equality at `785323d2e471d1fa35a27d93935b0451f1a58210`; required resolver, Parent-session authorizer, DB route-audit test and both master TODO files are remotely present. Exact-head Quality Gates run `36648259414` is IN_PROGRESS at that SHA. Parent TODO-12/14/15/20 and owner/release gates remain open; Platform stays `HOLD_PARENT_DEPENDENCY`.
TODO20_REFRESH = Fresh bounded TCP/3306 preflight to `pca-mysql.mysql.database.azure.com` timed out; no live DB read/mutation was performed. Repository/local schema remains 0060 and live `pca_pro` remains last verified at 0059.

### 2026-09-30 — Codex re-entry review and exact-head CI closure

REENTRY = After accepted DeepSeek checkpoint `91f7f6d4`, Git history contains only the Codex handover `a8c37162`, implementation `59bfc331`, and result-sync `785323d2`; there are zero new DeepSeek commits, source files, tests, or migrations to newly accept/revise. Waves 5A/5B remain previously certified at exact-head CI runs `36505757047` and `36519047489` (27/27 each).
CODEX_CHECKPOINT_REVIEW = The 31-path `59bfc331` implementation is published. Reviewed the registry-backed exact-id membership adapter, shared Parent-session authorizer and production composition, Android `PAIRING_PENDING` guards, iOS missing-trusted-floor rejection, test wiring, and security-preserving TODO-14 classifications. No security regression found in these reviewed deltas. Exact-head Quality Gates run `36648259414` is SUCCESS 27/27 at `785323d2e471d1fa35a27d93935b0451f1a58210`.
GIT = Fresh fetch and `git ls-remote origin refs/heads/pca-dev` both report `785323d2e471d1fa35a27d93935b0451f1a58210`; local, tracking, and server refs are equal. Only the current mission-ledger status sync remains local; `.vscode/` and root `0` are preserved and excluded.
TODO_BOARD = TODO-01…11/13/16/17 PASS (14); TODO-12/14/15/19/20 IN_PROGRESS (5); TODO-18/21/22/23 TODO/owner-release gates (4); no TODO is marked BLOCKED. Platform remains `HOLD_PARENT_DEPENDENCY`.
DATABASE = Repository migration head 0060; local owner-UAT documented head 0060 (MySQL port is open); live `pca_pro` last verified 0059 and current TCP preflight timed out. Parity remains NO; no live read or mutation in this review.
LOCAL_UAT = Database and backend ports 33061/4001 are open; Parent Web 4000 and Platform Web 4100 are not listening. Owner acceptance remains NOT GIVEN.
TRUE_NEXT_ENGINEERING_DEPENDENCY = TODO-15 independent device-security source/lifecycle review. TODO-12 first-device Trust Set root protocol, encrypted policy/audit writer paths, and production crypto remain gated; do not infer authority or activate devices/routes.

### 2026-09-30 — Platform real-backend E2E completed

The local real-backend Platform browser journey passed 1/1 on Chromium. The Playwright result started `2026-09-30T14:30:12.964Z` and completed in 113,754 ms with one expected test and zero unexpected tests. It exercised login/MFA, dashboard, entitlements, admin-user step-up/create, audit, settings, and billing against real Fastify and MySQL. The isolated MySQL 8.4.11 setup passed 58 migrations and the privacy/environment gate; only generated UUID test data was provisioned, and the runner removed the database. No owner-UAT data, live `pca_pro`, or production state was changed.

The previously observed pending admin-create request did not reproduce in this completed run. A separate earlier Vite webServer timeout was resolved by running the configured npm/Vite command under `cmd.exe`, where Vite served the expected loopback port; the complete Playwright run then passed. This does not close Parent TODO-12/14/15/19/20, exact-head CI, TODO-18 owner acceptance, Platform projection acceptance, or deployment gates. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Re-entry checkpoint CI findings and correction

CI = Quality Gates run `36732009370` completed FAILURE (25/27) at `e1f8b218c16c336c070409bb4b4f88c1d791ecd0`. The owner acceptance E2E passed; the cross-family test then reused a primary Parent daily-login grant revoked by the preceding sign-out-everywhere journey, so later E2E specs were skipped. The dependency-audit job reported HIGH Nodemailer plus moderate `fast-uri` advisories.
CORRECTION = The Parent isolation test now signs in once as the untouched second Parent and targets the disposable fixture's primary family ID, preserving the 403 checks. Nodemailer is pinned to 10.0.13; lockfile-only semver-compatible `fast-uri` updates are 3.1.8 and 4.2.1. Backend `npm audit fix --package-lock-only --ignore-scripts` reports 0 vulnerabilities. No local test suite was run; exact-head CI will validate the correction.
WORKTREE = Local HEAD and `origin/pca-dev` remain equal at `e1f8b218`; three code files and three mission ledgers contain scoped uncommitted corrections. `.vscode/` and root `0` remain excluded. `git diff --check` passes.
TODO_BOARD = TODO-01…11/13/16 PASS (13); TODO-12/14/15/17/19/20 IN_PROGRESS (6); TODO-18/21/22/23 TODO/owner-release gates (4); none marked BLOCKED.
LOCAL_UAT = MySQL ports 33061/33062 had TCP listeners; owner backend 4001 and Parent/Platform web 4000/4100 were stopped. Restore services and complete the technical browser precheck before offering the owner TODO-18. No owner acceptance, live DB mutation, Platform activation, Azure deployment, or production acceptance occurred.
NEXT_ACTION = Review and publish the scoped test/dependency/ledger checkpoint as an ordinary fast-forward; inspect exact-head CI; then continue the Parent work without opening owner/security, Platform, live DB, or release gates.

### 2026-09-30 — Codex re-entry and TODO-20 runtime diagnosis

REENTRY = Local/tracking/server refs were successfully verified equal at `fa428708efdbabcf36fdedae1c610ddca6bebf3a`; a later fetch/GitHub API attempt failed through the configured proxy. No DeepSeek-authored commit follows accepted checkpoint `91f7f6d4`; subsequent history is Codex-owned. Recorded exact-head Quality Gates run `36754475958` is green after iOS-only retry `110026310916`; a fresh Actions API query is unavailable through the current proxy.
TODO20 = Repository migrations remain at 0060 (58 files); owner-UAT was last verified at 0060 and live `pca_pro` at 0059. Current local probes found no MySQL listener, a stopped Docker service/missing engine pipe, and WSL `E_ACCESSDENIED`. Only MySQL 9.7 binaries are available; stopped MySQL80/MySQL97 services were not started. Fresh DNS resolved the live host to `4.161.89.178`, while TCP/3306 failed. No local/live DB read or mutation occurred in this re-entry.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23); TODO-14 remains 45/52 database-integrated and global aggregate NOT_YET_PROVEN. Platform remains `HOLD_PARENT_DEPENDENCY`; owner acceptance, first-device root protocol, live schema/grants, deployment and production gates remain open.
NEXT_ACTION = Retry TODO-20 only when a safe disposable MySQL 8.4 runtime can be restored; continue read-only TODO-12/15 review meanwhile. Do not use stopped host MySQL stores or weaken the Trust Set/device security boundary.

### 2026-09-30 — TODO-20 local repository/schema/grant revalidation

LOCAL_RUNTIME = Recovered the existing task-owned MySQL 8.4.11 archive and isolated datadir; started loopback-only at 127.0.0.1:33062 with GLOBAL/SESSION time_zone +00:00. Existing owner MySQL services were not started. Current instance contains only mysql, information_schema, performance_schema, and sys after cleanup.
LOCAL_SCHEMA = A fresh UUID-owned database passed repository `verify-mysql.mjs`: MySQL 8.4.11, utf8mb4/utf8mb4_bin, UTC, all 58 migrations. Schema snapshot regeneration produced 94 tables / 806 columns / 58 migration journal rows and `git diff --exit-code` confirmed `current_schema.sql` and `schema_manifest.json` exactly match repository-generated truth. Exact UUID database was dropped.
LOCAL_VALIDATION = Backend TypeScript build PASS; Parent route-audit MySQL campaign PASS 51/51, route report 45/52 integrated declarations / 137 scenarios / zero unexpected 401/403/other / GLOBAL_AGGREGATE_STATUS NOT_YET_PROVEN; Platform Admin runtime-grant acceptance PASS 6/6 including migration-0060 append-only epoch/floor constraints; Trust Set migration-safety/persistence/acceptance MySQL suites PASS 28/28. Each campaign used a fresh UUID database and confirmed cleanup; no owner-UAT or live DB was used.
LOCAL_GRANTS = Temporary least-privilege principal was cleaned by the 6/6 grant suite; postflight found zero `pa_priv_%` users and zero `pca_test_codex_%` schemas.
LIVE_PREFLIGHT = Fresh DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 is unreachable. Live `pca_pro` remains last verified at 0059; repository/local disposable schema is 0060. No live DB connection, read, or mutation occurred.
NEXT_ACTION = Retry fresh read-only `pca_pro` schema/grant inspection when TCP/3306 is reachable; apply 0060 only after immediate preflight and the locally validated mismatch is confirmed. Continue Parent TODO-12/15 only within owner-approved Trust Set/device/security boundaries; retain Platform hold.

### 2026-09-30 — Re-entry ledger publication CI closure

PUBLICATION = Ledger commit `e828546b53ef9c0e1f237d30398f251d506e4529` was pushed to `origin/pca-dev` by ordinary fast-forward. Post-push fetch, local HEAD, tracking ref, and `git ls-remote` all matched. The three mission ledgers exist in the remote tree; `.vscode/` and root `0` remain excluded.
EXACT_HEAD_CI = Quality Gates run `36766189779` completed SUCCESS 27/27 at exact SHA `e828546b53ef9c0e1f237d30398f251d506e4529`.
SCOPE_AND_GATES = Ledger-only change; no product source or schema change. Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO; TODO-14 aggregate remains NOT_YET_PROVEN. Live `pca_pro` remains last verified at 0059; no live query/mutation or owner acceptance occurred. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Published re-entry sync CI and live preflight refresh

PUBLICATION = Ledger sync `22a10c06ace0244cc3b0e6b2cb731501e51fd2ad` was pushed by ordinary fast-forward. Post-push fetch, local HEAD, tracking ref, and `git ls-remote` matched; all three mission ledgers exist remotely.
EXACT_HEAD_CI = Quality Gates run `36767517932` completed SUCCESS 27/27 at exact SHA `22a10c06ace0244cc3b0e6b2cb731501e51fd2ad`.
LIVE_PREFLIGHT = Fresh DNS resolves `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 returned false. No live MySQL session, SQL query, or mutation occurred; live remains last verified at 0059 and parity remains NO.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO; TODO-14 aggregate remains NOT_YET_PROVEN. Owner localhost acceptance is absent and Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Current ledger sync CI closure

PUBLICATION = Ledger sync `4eee477b0c77e2022596be16970bb86e3d010ad2` was pushed to `origin/pca-dev` by ordinary fast-forward. Post-push fetch and `git ls-remote` verified local/tracking/server equality and the three remote ledger paths.
EXACT_HEAD_CI = Quality Gates run `36768593806` completed SUCCESS 27/27 at exact SHA `4eee477b0c77e2022596be16970bb86e3d010ad2`.
LIVE_PREFLIGHT = DNS resolves to `4.161.89.178`; TCP/3306 returned false. Live `pca_pro` remains last verified at 0059; no live SQL session or mutation occurred.
GATES = TODO-12/14/15/20 remain IN_PROGRESS; TODO-18/21/22/23 remain owner/release gated. Platform stays `HOLD_PARENT_DEPENDENCY`.

### 2026-10-01 — a7e8a8a1 exact-head CI and local runtime-grant certification

EXACT_HEAD_CI = Quality Gates run `36775428822` completed SUCCESS 27/27 at exact SHA `a7e8a8a1064755950738a1b03b7e3e537a5e649d`, including full disposable-MySQL DB certification, real-backend E2E, Parent/Platform web, Android/iOS, security, and release-control jobs.
TODO20_LOCAL_GRANTS = On task-owned loopback MySQL 8.4.11 at `127.0.0.1:33062`, all 58 repository migrations and the runtime privilege suite passed; direct serial Node test mode passed 6/6. The suite verified audit insert/read, DB-denied audit UPDATE/DELETE, ordinary-table write control, Trust Set epoch append-only/floor-delete constraints, and the production writer/query-reader grant plan. UUID schema and temporary principal cleanup completed; zero `pca_test_codex_%` schemas and zero temporary platform-audit users remained.
WINDOWS_RUNNER_NOTE = The npm wrapper failed before test execution with Windows `spawn EPERM`; no product test ran in that attempt. The equivalent guarded serial test passed directly against the disposable instance.
LIVE_DB = Fresh live TCP/3306 preflight was unreachable; no live SQL read or mutation occurred. Repository/local schema remains 0060; live `pca_pro` last verified 0059, so parity remains NO.
GIT_AND_GATES = Checkpoint `a7e8a8a1` is on `pca-dev`; local and tracking refs matched before this ledger update, while `git ls-remote` is currently blocked by proxy connection refusal. `.vscode/` and root `0` remain excluded. Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-14 is 45/52 and globally NOT_YET_PROVEN; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-01 — ledger evidence publication

PUBLICATION = Three-ledger evidence commit `d7d67a3f05e0f05f3d918868ed107e66842de88a` was pushed to `origin/pca-dev` as an ordinary fast-forward. `git fetch origin` succeeded and matched local/tracking refs; GitHub's `pca-dev` commit page confirms d7d67a3f is the branch head. `git ls-remote` remains blocked by the configured proxy.
EXACT_HEAD_CI = Quality Gates run `36776746742` started for exact SHA `d7d67a3f05e0f05f3d918868ed107e66842de88a`; result is pending.
WORKTREE = Only unrelated untracked `.vscode/` and root `0` remain; neither was staged.

### 2026-10-01 — 83e4b875 exact-head CI and live-preflight refresh

PUBLICATION_CI = Higher-priority run `36776746742` for predecessor ledger commit `d7d67a3f` was cancelled by GitHub after the next same-branch push; this was workflow concurrency, not a test failure. Exact-head run `36777108468` for `83e4b8757341b8521e4f9df49c7eaa58b2741156` completed SUCCESS 27/27, including full disposable MySQL, real-backend E2E, Parent/Platform web, Android/iOS, security, and release-control jobs.
LIVE_PREFLIGHT = DNS resolves `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 is still unreachable. No live SQL read or mutation occurred. Repository/local schema is 0060; live `pca_pro` is last verified at 0059; current parity remains NO.
GIT = `83e4b875` is the local and fetched `origin/pca-dev` head after ordinary fast-forward push. Direct `git ls-remote` is blocked by the configured proxy. `.vscode/` and root `0` remain excluded.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-14 stays 45/52 with `NOT_YET_PROVEN`; Platform remains `HOLD_PARENT_DEPENDENCY`; owner localhost acceptance remains pending.

### 2026-09-30 — Published ledger CI closure

PUBLICATION = Ledger sync `7f4531fe207c5f09b60f6b87c994028c782cc5e3` was pushed to `origin/pca-dev` by ordinary fast-forward. Post-push fetch and `git ls-remote` verified local/tracking/server equality and the three remote ledger paths.
EXACT_HEAD_CI = Quality Gates run `36769567273` completed SUCCESS 27/27 at exact SHA `7f4531fe207c5f09b60f6b87c994028c782cc5e3`.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO; TODO-14 aggregate remains NOT_YET_PROVEN. Live `pca_pro` remains last verified at 0059; TCP/3306 remains unreachable and no live query/mutation occurred. Owner acceptance is absent; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — DeepSeek re-entry assessment and exact-head CI

REENTRY = The supplied DeepSeek handover reports head `3a4d0bb3`, an ancestor of accepted checkpoint `91f7f6d4`. No DeepSeek-authored commit follows that checkpoint. Coordinator-owned `59bfc331` was independently accepted with follow-up; current source still fails closed for child membership/device activation, and current commercial checkout authorization is Parent active-Administrator plus fresh TOTP. No DeepSeek handover finding justifies reactivating browser-owner or device cryptographic authority without its external review and root/key-custody prerequisites.
GIT_CI = Branch `pca-dev`; fresh local/tracking/server refs matched `e12711f3986eedaa43a82f250a6365c8e5222b0d`. Quality Gates run `36763771064` completed SUCCESS 27/27 at that exact SHA. `.vscode/` and root `0` remain excluded.
MISSION_STATUS = 15 PASS / 4 IN_PROGRESS (TODO-12/14/15/20) / 4 TODO (TODO-18/21/22/23) / 0 BLOCKED. TODO-14 remains 45/52 integrated with `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`; Platform remains `HOLD_PARENT_DEPENDENCY`.
DATABASE_AND_UAT = Repository and previously validated disposable MySQL schema are 0060; live `pca_pro` last verified 0059, parity NO. Authenticated live read-only preflight timed out before SQL; no live query/mutation occurred. MySQL 33061/33062 and app ports 4001/4000/4100 are stopped; owner acceptance remains absent.
NEXT_ACTION = Continue safe Parent TODO-12/14/15 evidence; retry read-only live TODO-20 preflight when reachable. Keep the same board and all Trust Set root, crypto, owner-UAT, Platform activation, deployment, and production gates open.

### 2026-09-30 — Latest ledger sync CI closure

PUBLICATION = Ledger sync `a41faf99ed0ecfda0587284a86bfb8b0b1ea6809` was pushed to `origin/pca-dev` by ordinary fast-forward. Post-push fetch and `git ls-remote` verified local/tracking/server equality and the three remote ledger paths.
EXACT_HEAD_CI = Quality Gates run `36771385817` completed SUCCESS 27/27 at exact SHA `a41faf99ed0ecfda0587284a86bfb8b0b1ea6809`.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO; TODO-14 aggregate remains NOT_YET_PROVEN. Live `pca_pro` remains last verified at 0059, with current TCP/3306 unreachable and no live query/mutation. Owner acceptance is absent; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — c0023645 exact-head CI and board reconciliation

EXACT_HEAD_CI = Quality Gates run `36772627678` completed SUCCESS 27/27 at exact SHA `c0023645b08dc4313cfe8dbf51df5e6604f5eec5`; GitHub's run page shows the full backend/MySQL, real-backend E2E, Parent/Platform browser, Android/iOS, security, and release-control gates completed successfully.
TODO_STATUS_RECONCILIATION = The canonical Parent master marks TODO-02…11, TODO-13, TODO-16/17/19 as PASS. This mission-history table contained stale READY_FOR_INTEGRATION labels for TODO-02…10 and IN_PROGRESS for TODO-13; those labels now match the canonical board. TODO-12/14/15/20 remain IN_PROGRESS; TODO-18/21/22/23 remain TODO.
GIT = c0023645 was pushed by ordinary fast-forward, then fetch and server-ref verification confirmed local/tracking/server equality and all three ledger files on origin/pca-dev. Unrelated `.vscode/` and root `0` remain excluded.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO; TODO-14 aggregate remains NOT_YET_PROVEN. Live `pca_pro` remains 0059 versus repository/local 0060; no live SQL comparison or mutation. Owner acceptance and Platform `HOLD_PARENT_DEPENDENCY` remain unchanged.

### 2026-09-30 — local route-audit recheck and 0541efe3 exact-head CI

LOCAL_MYSQL = Task-owned MySQL 8.4.11 at 127.0.0.1:33062 passed the repository environment gate and all 58 migrations. A fresh UUID-owned schema ran the Parent route-audit inner suite 51/51; the generated report records 45/52 integrated declarations across 137 scenarios, 50 allows, 75 expected denials, and zero unexpected 401/403/other. The seven remaining declarations are the documented Trust Set, encrypted Web Rules, signed/recovery crypto, and optional dashboard gates; aggregate remains `NOT_YET_PROVEN`. The UUID database was dropped; a direct postflight found zero `pca_test_codex_%` schemas.
WRAPPER_NOTE = `with-disposable-db.mjs` safely cleaned its UUID after Windows returned `spawn EPERM`; the equivalent repository verifier and serial inner route-audit suite then ran directly against the loopback-only disposable server. No owner-UAT/live DB or seed data was used.
CI = Quality Gates run `36774031399` completed SUCCESS 27/27 at exact SHA `0541efe35a0af955005c492f801ecc5c79fd5c46`; full backend DB, real-backend E2E, Parent/Platform browser, Android/iOS, security, and release-control jobs passed.
GATES = Parent TODO-12/14/15/20 remain open; Platform stays `HOLD_PARENT_DEPENDENCY`; live TCP/3306 is currently unreachable and no live query/mutation occurred.

### 2026-10-01 — fc100efa exact-head CI and browser technical precheck

EXACT_HEAD_CI = Quality Gates run `36778880069` completed SUCCESS 27/27 at exact SHA `fc100efadf2d3372fc25ed0fd6760235775aebf9`. The Chromium matrix passed Parent 101/101 and Platform 21/21; full disposable MySQL, real-backend E2E, Android/iOS, security, and release-control jobs passed.
LOCAL_PARENT_REAL_E2E = On task-owned loopback MySQL 8.4.11 port 33062, the fresh-schema migration/privacy/environment gate applied 58 migrations; a synthetic Parent was created/verified, its Family provisioned, and the cookie-session dashboard/settings journey passed 1/1. The sandbox spawn attempt failed before DB creation with `spawn EPERM`; the same guarded run passed under authorized elevated execution.
LOCAL_PLATFORM_REAL_E2E = The local runner generated a UUID-owned disposable schema and synthetic accounts, started real Fastify plus Chromium, and passed the Platform Admin login/MFA, dashboard, entitlements, step-up admin user, audit, settings, and billing journey 1/1. Its UUID schema was removed.
LOCAL_POSTFLIGHT = `pca_local_owner_uat` remains at migration 0060 with 94 tables / 806 columns and zero Parent, Platform-admin, or Family rows; zero `pca_test_codex_%` schemas remain. Owner-UAT ports 33061/4001/4000/4100 are stopped; literal `LOCALHOST ACCEPTED` was not given.
LIVE_PREFLIGHT = DNS resolves `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 remains unreachable. No live SQL read or mutation occurred; live schema remains last verified 0059 while repository/local are 0060.
NEXT_GATE = Automated browser and real-backend evidence passed for the exercised workflows; restore a full isolated local browser session and cover remaining Parent/Platform screens/actions before owner localhost acceptance. Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-14 remains 45/52 and `NOT_YET_PROVEN`.

### 2026-10-01 — Owner MFA recovery and password-lock policy, locally validated

OWNER_DECISION = OWNER_MFA_RECOVERY_POLICY=NO_24_HOUR_HOLD; OWNER_PASSWORD_FAILURE_POLICY=5 failed Parent password authentications in a rolling 15-minute window => one-hour password-login lock; FORGOT_PASSWORD_DURING_LOCK=ALLOWED; PASSWORD_RESET_CLEARS_PASSWORD_LOCK=YES; MFA_AND_PASSWORD_FAILURE_COUNTERS=SEPARATE.
IMPLEMENTATION = Policy source is commit e66b266dad9f503e2212754d3db020526ac0d8df. The exact test/harness checkpoint a8f08abcde68bc7ef11c0f6df910b8872cfde191 fixes mysql2 query-row assertions and isolates the password-lock browser journey on a separate enrolled Parent, without changing rate limits. The checkpoint was pushed and fetched; HEAD and origin/pca-dev matched.
SCHEMA = Existing account persistence lacked durable password failure state, so minimal additive migration 0061 adds account-level rolling-window start, failure count, and lock-until fields. Full disposable MySQL validation ran all 59 migrations from zero and replay/upgrade safety; owner-UAT last verified schema remains 0060; live pca_pro last verified 0059. No live or owner-UAT schema mutation occurred.
VALIDATION = Backend build/full non-DB regression 2751/2751; Parent Web 152 files/1076 tests and typecheck PASS; disposable MySQL 669 pass/0 fail/9 expected skips; populated production-path certification 275/275 with zero skips; real-browser Parent MFA + optional setup 4/4, zero skipped; all four contract validators/test catalogues PASS; deterministic security controls/negative controls PASS; repository checks and git diff --check PASS.
CI = Exact-head Quality Gates for source/test checkpoint a8f08abc was not directly verifiable at the time because the configured proxy refused access. Later run 36799538564 at ledger head fc368fc5771189ae404b6fc43ed09b81114ccd17 completed FAILURE in Parent real-backend MFA because the workflow omitted the isolated password-lock fixture variables.
GATES = TODO-17 and TODO-19 return to IN_PROGRESS pending exact-head CI and ledger synchronization. Parent board is 13 PASS / 6 IN_PROGRESS / 4 TODO / 0 BLOCKED. TODO-14 remains 45/52 and NOT_YET_PROVEN. TODO-18 is TODO; LOCALHOST ACCEPTED was not given. Platform remains HOLD_PARENT_DEPENDENCY. No Trust Set, device authority, Platform, live DB, Azure, deployment, or production change.

### 2026-10-01 — Exact-head CI Parent MFA fixture-handoff correction

CI = Quality Gates run 36799538564 at ledger head fc368fc5771189ae404b6fc43ed09b81114ccd17 failed in real-backend Parent MFA because the workflow manifest resolver did not export E2E_REAL_MFA_LOCK_PARENT_EMAIL, E2E_REAL_MFA_LOCK_PARENT_PASSWORD, or E2E_REAL_MFA_LOCK_PARENT_TOTP_SECRET.
FIX = Workflow now validates the isolated fixture, masks generated credentials/secrets, and exports all three required variables. The local disposable wrapper passed Parent MFA 3/3 and optional setup 1/1 with zero skips; its owned random schema was removed. The correction and ledger evidence await publication and a new exact-head CI run.
SCOPE = No live/owner-UAT database, Platform, Trust Set/device authority, Azure, deployment, or production mutation occurred.

### 2026-10-01 — FormData forgot-password source correction

CI = Run 36804016655 at 766d1c4199470d9cdcd5355037bdbc681d49c969 failed only in Parent real-backend E2E: the form showed the lock fixture while the POST body contained an empty email and returned `invalid_request`. All other jobs passed.
FIX = ForgotPassword reads the submitted input from FormData. Parent Web typecheck passed; disposable browser passed Parent MFA 3/3 plus optional setup 1/1, zero skips, and removed its run-owned schema.
NEXT = Publish the fix and updated ledgers, then inspect a new exact-head Quality Gates run. No live/owner-UAT DB, Platform, Trust Set, Azure, deployment, or production mutation occurred.

### 2026-10-01 — Direct-input-ref submission correction

CI = Run 36805623573 at 836ff1ed0a396cef2ab584bf47522a8d9e7d23ac repeated the empty reset-email result on the FormData version; all other jobs passed.
FIX = ForgotPassword now reads the exact current email input via ref. Parent Web typecheck and disposable browser MFA 3/3 plus optional setup 1/1 passed with zero skips; the owned schema was removed.
NEXT = Publish this correction and updated ledgers, then require exact-head Quality Gates before owner review. No live/owner-UAT DB, Platform, Trust Set, Azure, deployment, or production mutation occurred.

### 2026-10-01 — Pre-submit form association diagnostic

CI = Exact-head run 36806878236 failed only in Parent real-backend E2E: POST email was empty on the direct-ref version; every other job passed.
PROBE = Current source queries the named field from the submitted form. Browser test now records non-identifying input length/name/form association and pre-submit FormData length. Parent Web typecheck and disposable browser MFA 3/3 plus optional setup 1/1 pass, zero skips; owned schema removed.
NEXT = Publish the probe and determine the CI form/request mismatch from its exact-head evidence. No live database, Platform, Trust Set, Azure, deployment, or production change occurred.

### 2026-10-01 — Uncontrolled forgot-password input follow-up

CI = Exact-head Quality Gates run 36808069045 at 6de7e93d1a95fca8d7ee8a527da8cdba613fffa9 failed only in real-backend Parent browser E2E. The reset input was already empty before submit (`inputValueLength=0`), although it remained associated with the form; FormData also had length 0. All other jobs passed.
FIX = The email control is now uncontrolled, and E2E asserts the input and FormData retain the fixture length immediately before submission. Local Parent Web typecheck and disposable browser suite pass (Parent MFA 3/3 plus optional setup 1/1, zero skips); the run-owned schema was removed.
NEXT = Publish this scoped correction and ledger update, then inspect exact-head Quality Gates. TODO-17/19 remain IN_PROGRESS. No live/owner-UAT DB, Platform, Trust Set/device authority, Azure, deployment, production change, or owner acceptance occurred.

### 2026-10-01 — Parent reset browser route timing correction

CI = Quality Gates run 36809221770 at da9d6c8dcee6090c97fc038e4e3c4665d8ee3287 completed FAILURE only in real-backend browser E2E. The reset page's own input had length 0 before submit; the prior generic email locator had reported the fixture immediately after the URL changed. Every other job passed.
DIAGNOSIS = The generic locator can act on the still-mounted login email field between URL update and React's forgot-password form render. The browser test now waits for the reset page's unique input and fills that specific control. ForgotPassword source is restored to its original controlled input and state-based submit; earlier form-query and uncontrolled-input workarounds were unnecessary for this navigation race.
LOCAL = Parent Web typecheck PASS. Run-owned disposable MySQL browser suite passed Parent MFA 3/3 and optional setup 1/1, zero skips, then removed its schema. The route-specific correction awaits publication and CI confirmation.
GATES = TODO-17/19 remain IN_PROGRESS until the new pushed head passes Quality Gates. No live/owner-UAT DB, Platform product source, Trust Set/device authority, Azure, deployment, production mutation, or owner acceptance occurred.

### 2026-10-01 — Parent recovery policy exact-head Quality Gates success

SOURCE_HEAD = 7f669b05bd444854cb6f745d27838708a55c832c, pushed to origin/pca-dev and fetch-confirmed equal with local HEAD.
CI = Quality Gates run 36810048862 completed SUCCESS, 27/27 jobs. Its real-backend browser job passed the Parent MFA/password-lock/reset path, optional MFA setup, and Platform E2E; full disposable-MySQL certification, Parent/Platform web, Android/iOS, security, and release-control jobs also passed. The preceding run 36809221770 at da9d6c8d failed only because the test filled the login field before the reset form rendered.
LOCAL = Parent Web typecheck PASS; the guarded local browser wrapper passed Parent MFA 3/3 plus optional setup 1/1, zero skipped, and removed its run-owned schema. ForgotPassword is restored to its original controlled input; the browser test waits for the unique reset input before filling.
STATUS = TODO-17/19 PASS for this tested source checkpoint; Parent board 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23). Parent TODO-14 remains 45/52 and NOT_YET_PROVEN. Platform remains HOLD_PARENT_DEPENDENCY; literal LOCALHOST ACCEPTED remains pending. Repository migration head 0061, owner-UAT last verified 0060, live pca_pro last verified 0059. This ledger-only evidence checkpoint awaits publication and its own CI result.
SCOPE = No live/owner-UAT DB mutation, Platform product source or Enrollment activation, Trust Set/device authority change, Azure deployment, production change, or owner acceptance occurred.

### 2026-10-01 — Parent authority, iOS pairing guard, and schema snapshot integration

SOURCE = Removal-decision list/detail and Administration PIN status reads require an active same-family Administrator or Viewer before data access; membership errors and revocation fail closed with 403. iOS bootstrap/recovery rejects non-PAIRING_PENDING response status before device identity persistence, with app-model no-save tests. The TODO-14 crosswalk now describes immediate MFA replacement instead of the retired recovery hold. Official schema-snapshot generation brought current_schema.sql and schema_manifest.json through migration 0061.
LOCAL_VALIDATION = Backend build and focused authority wiring 18/18 PASS; guarded disposable-MySQL Parent route audit 52/52 PASS after all 59 migrations, zero skips, owned schema removed. Official fresh MySQL 8.4.11 schema verification passed 59 migrations, 94 tables, 809 columns, zero Parent rows; generated artifact diff contains only three password-lock fields and their CHECK. Independent static review confirmed table/column consistency. Swift parsing and git diff --check PASS; iOS XCTest awaits macOS CI. TODO-14 collector remains at 45/52 with seven gated/optional declarations and NOT_YET_PROVEN aggregate; the new revocation scenarios have not been counted into a fresh collector report.
LIVE_PREFLIGHT = Azure read-only inventory confirms the Ready pca-mysql Flexible Server in pca-group and the expected FQDN. Direct TCP/3306 remained false; no authenticated pca_pro schema/grant/data preflight, firewall mutation, or live SQL mutation occurred. Owner-UAT remains last verified at 0060, live pca_pro at 0059, repository/local disposable at 0061.
GATES = TODO-12/14/15/20 remain IN_PROGRESS; TODO-18/21/22/23 remain owner/external gated. Platform remains HOLD_PARENT_DEPENDENCY. This integrated source checkpoint is pending commit, push, and exact-head Quality Gates; prior published head 826ef5b3 passed 27/27.

### 2026-10-01 05:32 UTC — a2045c2b Quality Gates success and next Parent safety wave

PUBLISHED_SOURCE = `a2045c2bb5111e9602ee0d593ea2fd7e08ae135e` is fetch-confirmed equal with origin/pca-dev; exact-head Quality Gates run `36815327871` passed 27/27. Full disposable MySQL, real-backend browser E2E, iOS, Android, security and release-control jobs passed.
CURRENT_LOCAL_SOURCE = Signed and authorized-recovery removal-decision POSTs require current active Parent membership before decision parsing. Four focused revoked/lookup-failure cases fail closed; valid active cases still encounter the intentionally unavailable signing/recovery gate. The lost-response MySQL test now proves the attempt-scoped recovery response stays `PAIRING_PENDING` after pairing or revocation, while Parent-scoped status shows the current device lifecycle and device session remains inactive.
LOCAL_VALIDATION = Backend build PASS; focused removal-decision wiring 22/22 PASS; guarded disposable MySQL authority diagnostics applied 59 migrations and passed 62/62, zero skips, then removed its run-owned schema. Current edits remain unpublished and lack exact-head CI.
GATES = TODO-12/14/15/20 remain IN_PROGRESS; TODO-14 is 45/52 and NOT_YET_PROVEN. Child-readable live pre-activation status needs a separately approved proof protocol; historical recovery token must not become standing device authority. Repository/local disposable is 0061, owner-UAT last verified 0060, and live pca_pro last verified 0059 with TCP/3306 unavailable. Platform remains HOLD_PARENT_DEPENDENCY; literal `LOCALHOST ACCEPTED`, owner/security and deployment gates remain open. No live DB/owner-UAT mutation or production change occurred.

### 2026-10-01 05:42 UTC — Parent authority and enrollment contract exact-head certification

SOURCE = `f1b0a7d29c6c402875de0cb71551ca2931cc9d28` is pushed and fetch-confirmed equal to origin/pca-dev. Quality Gates run `36820461082` completed SUCCESS 27/27, including full disposable MySQL, real-backend browser E2E, backend unit, iOS, Android, security, web, and release-control jobs.
STATUS = TODO-17/19 PASS at this source checkpoint; board remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 owner or release gated (18,21,22,23). TODO-14 remains 45/52 and NOT_YET_PROVEN, signed/recovery crypto remains gated, and TODO-15 first-device root/key custody remains open. Repository/disposable schema is 0061; owner-UAT last verified 0060 and live pca_pro 0059. TCP/3306 remains unreachable on a read-only probe; no live database or owner-UAT mutation, Platform activation, Azure deployment, production acceptance or literal `LOCALHOST ACCEPTED` occurred.

### 2026-10-01 06:02 UTC — Local owner-UAT migration 0061 and technical service readiness

PREFLIGHT = Retained local-only `pca_local_owner_uat` at `127.0.0.1:33061` was MySQL 8.4.11 with all 58 migration entries matching the repository prefix through 0060, 94 tables, four Parent rows, and no 0061 password-state fields/CHECK. Pre-existing Parent field and exact application-table row-count fingerprints were recorded without printing row contents.
MIGRATION = Official `backend/scripts/migrate.mjs` applied only 0061 with an exact local host/port/database guard. Postflight journal matches all 59 repository migrations; 94 table manifests match the tracked snapshot, with 809 columns, enforced CHECK and clear initial password-failure state. The four Parent rows and pre-existing Parent-data/application row-count fingerprints are unchanged; no seed or production data was added.
SERVICES = API `/health` and `/health/db` return 200 JSON. Parent/Platform login pages currently return 200 HTML on `localhost:4000`/`:4100`; their 127.0.0.1 web addresses did not answer on this probe. Parent API session returns JSON 401 without a session with the expected local CORS origin; Platform same-origin whoami returns JSON 401. This proves service/routing availability only, not authenticated owner acceptance. Source f1b0a7d2 and preceding ledger head 4a858054 each passed exact-head Quality Gates 27/27.
GATES = TODO-20 remains IN_PROGRESS because live pca_pro was last verified at 0059 and TCP/3306 remains unreachable. TODO-12/14/15, owner TODO-18 literal `LOCALHOST ACCEPTED`, Platform projection, and deployment/production gates remain open. No live database/grant mutation or Platform Enrollment activation occurred. This local-UAT evidence update awaits publication.

### 2026-10-01 06:15 UTC — Exact-head 0061 ledger CI and authenticated localhost evidence

PUBLISHED_CI = Ledger head `83e13dbc2a1bdafc4406ec76725635f4b9dece09` was pushed and fetch-confirmed equal to origin/pca-dev. Quality Gates run `36823080788` completed SUCCESS 27/27, including full disposable MySQL, real-backend browser E2E, iOS, Android, security and release-control jobs.
LOCAL_BROWSER = Fresh Chromium sessions used only documented local synthetic accounts. Parent password plus unknown-browser email OTP reached `/dashboard`, and its session API returned 200. Platform Owner password plus fresh TOTP reached `/dashboard`, with App Owner visible in the account menu. The local handoff records this technical result without adding secrets to tracked files. No owner acceptance was inferred.
GATES = Repository/disposable/local owner-UAT schema is at 0061; live pca_pro remains last verified at 0059 and TCP/3306 unreachable. TODO-12/14/15/20 remain IN_PROGRESS; TODO-14 integrated 45/52 and NOT_YET_PROVEN. TODO-18 literal `LOCALHOST ACCEPTED`, Platform projection, first-device root/crypto, deployment, and production gates remain open. No live SQL/grant mutation or Platform Enrollment activation occurred. This browser-evidence update awaits publication.

### 2026-10-01 06:45 UTC — Retained Parent projection and Platform lookup agree

LOCAL_PARENT_PROJECTION = Production MySQL Parent identity repository selected the explicit verified Parent for the retained local 0061 family. Current-key email decryption and exact DTO mapping yielded only first name, last name, email, and nullable phone; the synthetic email matched and phone was NULL. This was a read-only repository/mapper check with no identity values or keys printed.
PLATFORM_LOOKUP = Production Parent Email resolver linked one family and classified the synthetic account `ACCOUNT_FOUND_BUT_NOT_ELIGIBLE / ALREADY_ENTITLED`. A fresh authenticated Platform Chromium session displayed the matching already-entitled status in Enrollment Management > Entitlements. This strengthens existing TODO-16 and PLATFORM-02 PASS evidence, but does not activate the held Enrollment Name/Email/Phone directory package.
CI_AND_GATES = Ledger head fa4f2092dfc455d1505d098ee39c72a2ecd376cc passed exact-head Quality Gates run 36824039318 27/27. Parent TODO-12/14/15/20, owner TODO-18 literal `LOCALHOST ACCEPTED`, live pca_pro reconciliation, first-device root/crypto, and deployment/production gates remain open. Platform remains HOLD_PARENT_DEPENDENCY; no live DB mutation or Enrollment activation occurred. This projection-evidence update awaits publication.

### 2026-10-01 07:07 UTC — DEC-037 immediate-recovery summary aligned

POLICY = The accepted DEC-037 decision had a current security-tradeoff bullet that still credited the retired 24-hour recovery hold, despite its explicit 2026-10-01 owner amendment and historical-section label. The bullet now states the immediate reset's actual consequence: password plus mailbox proof clears the old authenticator and sessions, issues an enrollment-only ticket, and has no delay. No auth source or runtime policy changed; the historical hold narrative remains marked superseded.
CI_AND_GATES = Published ledger head 50b4287ff5f84a09034ad145cbf748ec9298bd68 passed exact-head Quality Gates run 36827409031 27/27. Parent TODO-12/14/15/20, owner TODO-18 literal `LOCALHOST ACCEPTED`, live pca_pro, first-device security and Platform activation gates remain open. This documentation correction awaits publication.

### 2026-10-04 — Wave 6D: iOS first-device trust-root activation (iOS-only; real-device + production App Attest gates open; stopped for owner review)

AUTHORIZATION = Owner directive "PCA PARENT AUTHORITY — WAVE 6D. iOS FIRST-DEVICE TRUST-ROOT ACTIVATION", MODE = controlled iOS-only implementation + mandatory architecture qualification + adversarial security certification, AUTHORIZED_START_SHA = `cf1b920fe047ba663bb2419c61e920b55b476b34` (Wave-6C closure head; exact-head Quality Gates run 37093164430 SUCCESS 27/27). Stage A ran the exact seven specialists with 9-field reports -- 7/7 USABLE -- before any mutation, and the owner froze the architecture with clarifications (transcript Option A without `expiresAt`; enrollment-stable attestation clientDataHash derived from the M1-bound DSK; no durable App Attest counter this wave; no schema change).
ARCHITECTURE = The family trust root is the SECURE ENCLAVE P-256 DSK (Secure Enclave key, non-exportable by platform construction, `kSecAttrTokenIDSecureEnclave` + `.privateKeyUsage` access control; generate-time, SIGN-TIME and LOAD-TIME hardware-binding assertions; no software fallback anywhere; create-once attempt-scoped aliases `pca.dsk.<attemptId>`/`pca.dek.<attemptId>`). Apple App Attest is the platform-authenticity attestor and is STRUCTURALLY not the DSK: the App Attest key signs only Apple-app-scoped statements, so it can never become a signing oracle for the trust root. The ATTESTATION's `clientDataHash` is enrollment-stable -- `sha256("PCA_IOS_APPATTEST_ATTESTATION_V1|<dskKeyId>|<dskPublicKey>")`, both values from the durable ceremony row (M1-bound) and recomputable by the server BEFORE any request, so the client can never choose the attested content. The ASSERTION (counter >= 1) signs, via its own clientDataHash, the canonical 10-field `PCA_IOS_DSK_ATTESTATION_V1` netstring transcript (domain, version 1, familyId, deviceId, ceremonyId, challengeId, nonce, `ECDSA_P256_SHA256`, dskKeyId, dskPublicKey; frozen Option A: NO expiresAt -- freshness is carried by the DSK-signed bootstrap proof over the server challenge). The server rebuilds the transcript from the durable ceremony inputs plus the M1-expected DSK and requires byte equality. Evidence digest = sha256 of the exact raw UTF-8 evidence string, bound in both directions (envelope <-> verifier <-> DSK-signed proof <-> committed row). Acyclic: assertion covers transcript -> evidence -> sha256(evidence) into the DSK proof -> proof signed by the DSK. APP_ATTEST_KEY != DSK holds by construction; application identity (TeamID.BundleID) is enforced in BOTH authData values (rpIdHash = sha256(appId)) and by the pinned-root chain to Apple's App Attest root; aaguid must match the configured Apple environment (production `appattest`+7x00; development `appattestdevelop`). Counter policy: NO durable counter this wave (attestation counter == 0, assertion counter >= 1 only); one-time root + payload-digest idempotency carry replay protection at the commit layer. SCHEMA_DECISION = MIGRATION_REQUIRED = NO; repository head remains 0063; no 0064 exists.
IMPLEMENTATION = Backend (NEW files only behind the certified 6B/R1 boundary; the service, proof format, COMMIT_V1 domain, epoch rules, approval policy and commit path are untouched): `IosAttestationTranscript.ts` (frozen 10-field canonical encoder/decoder with strict re-encode identity), `AppleAppAttestCbor.ts` (strict bounded CBOR: definite+minimal lengths, text-string map keys, duplicate-key/tag/float rejection), `AppleAppAttestDer.ts` (credCert extension OID 1.2.840.113635.100.8.2 nonce extraction), `AppleAppAttestVerifier.ts` (17-step verification, never throws, bounded non-oracle reasons, VERIFIED values derived from the validated evidence -- never a blind echo; raw-DER byte-identity per chain link; order-independent pinned-root anchor loop), router extension in `PlatformAttestationVerifier.ts` (IOS lane active only with all three env values `PCA_IOS_APPATTEST_ROOT_PEM`/`PCA_IOS_APPATTEST_APP_ID`/`PCA_IOS_APPATTEST_ENVIRONMENT`; malformed config = UNAVAILABLE), `main.ts` UNCHANGED. iOS (Swift): `FirstDeviceCanonical.swift` (byte-equal encoders incl. the 383-byte transcript and the enrollment-stable clientData), `P256DerSignature.swift` (strict DER -> 64-byte IEEE-P1363 low-S; half-order pinned by an identity test), `SecureEnclaveDskProvider.swift`, `FirstDeviceDskDeviceProofProvider.swift` (ONE shared reference-typed provider identity behind BOTH the enrollment path and the runtime-sync session client; empty-string/typed fail-closed before preparation; persisted-attempt seam resolving the enrolled DSK across restarts), `IosAppAttestAdapter.swift` (DCAppAttestService; fail-closed `isSupported`; sorted-keys evidence envelope; 16 KiB budget), `FirstDeviceRootStore.swift` (durable seed + byte-stable submission payload; synchronous flush barrier), `FirstDeviceBootstrapApiClient.swift` (collapsed-vocabulary error mapping), `FirstDeviceTrustRootCoordinator.swift` (explicit FIFO single-flight gate; no optimistic commit; never re-challenge after submission begins; byte-stable replay that never re-signs; EXPIRED trims the persisted submission; terminal ROOT_COMMITTED; never mints keys), enrollment integration in `PCAApplication.swift` (attemptId BEFORE keygen; prepare BEFORE the public-key read; durable seed capture from the bootstrap/recover response; attempt-scoped orphan sweep keep-set), bootstrap response now carries the server-minted signing/encryption key ids (columns existed since 0003 -- no migration), and all 14 new Swift files registered in `PCA.xcodeproj`.
VALIDATION = Backend unit suite PASS 2855/2855 (0 fail, 0 skipped; +19 new Wave-6D tests over the 6C baseline 2836). Disposable MySQL full certification: inner lane 698 tests / 688 pass / 0 fail / 10 privileged-mode skips; 61 migrations from zero; certified production paths 276/276 -- PRODUCTION PATH CERTIFICATION PASSED. Shared golden vectors regenerated additively (proof 547 / epoch-1 393 / iOS transcript 383 bytes; existing keys byte-unchanged) and pinned by backend + iOS suites. Real-byte Apple kill matrix: 6/6 suites green with 35 single-aspect rejection cases in the matrix (plus 7 non-evidence rejections and the strict-CBOR unit matrix), all against fully real DER chains, real COSE keys and real ECDSA signatures. D-SEC CRITICAL-MUTANT CAMPAIGN (local, scripted, restore-verified; FINAL set): 14/14 mutants BEHAVIORALLY KILLED with zero survivors and all restores proven green -- T1 transcript equality, T2 attestation-nonce equality, T3 assertion signature, T4 raw-DER byte identity, T5 aaguid environment gate, T6 pinned-root anchor, T7 attestation counter, T8 router environment gate, T9 router app-id gate, T10 rpIdHash application-identity gate (backend, src-mutate + rebuild + focused-suite kill), and I1 attemptId-keygen binding, I2 pending-writer reintroduction ban, I3 sign-time SE-binding guard, I4 duplicated-provider-instance divergence (iOS source guards). Mapping to the frozen set: D-SEC-015=T2, 016=T1, 017=I4(+I2), 019=T10(+matrix rpId cases); D-SEC-018 (actor reentrancy duplicate flow) is CI-enforced by the FIFO behavioral XCTest (no local Swift toolchain exists -- stated honestly); the 001..014 classes are covered locally by T/I mutants plus CI-enforced Swift-runtime variants. Evidence file: `.agent-local-artifacts/wave6d/dsec-mutants-result.txt` (with the T8 refined cycle: BUILD=0/KILL_EXIT=1/GREEN). Android full regression: Debug + Release `testDebugUnitTest`/`testReleaseUnitTest` BUILD SUCCESSFUL, 2826 tests / 0 failures / 0 errors / 2 conditional skips (1413 + 1413, matching the 6C baseline exactly); ANDROID PRODUCT DIFF = ZERO. Contracts catalogue validation PASS; `git diff --check` clean.
STAGE_B = The seven-specialist gate reviewed the frozen final tree INCLUDING these ledger updates at 12-field granularity and raised findings that were RESOLVED in this same checkpoint before publication: (a) the assertion-verification equation -- a probe proved Node EC `verify(null, data)` hashes the data, so the earlier form would have rejected GENUINE device assertions; the verifier now uses `verify('sha256', authenticatorData||clientDataHash)` (WebAuthn/App-Attest semantics) with a matrix case pinning that the double-hashed variant is REJECTED; (b) the enrollment orphan-sweep keep-set now unions {new attempt, durable root record's attempt} (the Wave-6C Stage-B parity fix); (c) crash-recovery preparation re-activates an attempt ONLY when BOTH Secure Enclave public keys are readable, and the seed capture refuses to persist anything unless BOTH public keys are non-empty (blank-guard parity); (d) QA coverage gaps closed: a behavioral FIFO-gate test (second operation provably held until the first completes), lifecycle paths (awaitingApproval status-only, terminal rootCommitted, non-ACCEPTED body, evidence failure fail-closed + gate release), nine additional verifier rejection cases (attestation rpIdHash, credIdLen, COSE middle, 0xFFFFFFFF counter, 31-byte keyId, >2048-byte transcript, chain >3, 36-byte assertion authData, different expected DSK), and CI-executed source guards for refuse-overwrite / persist-before-send / capture-before-clear. The D-SEC campaign was re-run on the FIXED tree (14/14 behaviorally killed again; evidence file `.agent-local-artifacts/wave6d/dsec-mutants-result.txt`). Prior Stage-B verdicts on this fixed tree: Security APPROVE (0B/0M; one accepted minor: keychain save/flush errors are best-effort with server-authoritative recovery), Architect APPROVE (0/0/0), Dev APPROVE (fix verification, 0/0/0), QA APPROVE (0/0/2 minors: the defensive `invalid_expected_dsk` branch is unfalsifiable for typed inputs; the guard pins the overwrite condition but not its refusal `return`), DevOps/CI APPROVE (0/0/1 minor: pbxproj registration guards cannot detect a missing Sources-phase entry -- `xcodebuild` remains authoritative), Responsible AI APPROVE (0B/0M; one accepted minor duplicating the keychain best-effort note). Known accepted residuals (stated pre-review): App Attest receipt validation is out of scope by frozen design (an Apple-server concern); attestation/assertion `flags` bits are not constrained this wave; provider-level Secure Enclave behaviors rely on simulator fail-closed proofs, source guards and the OPEN real-device gate rather than on-device unit proof; XCTest compilation itself is arbitrated by the macOS CI job.
EXTERNAL_GATES = REAL_IOS_DEVICE_GATE = OPEN (Secure Enclave and App Attest cannot exist on the simulator; a genuine physical-device ceremony has NOT been performed). PRODUCTION_APP_ATTEST_GATE = OPEN: operators must pin the Apple App Attest root certificate (`PCA_IOS_APPATTEST_ROOT_PEM`), the TeamID.BundleID application identity (`PCA_IOS_APPATTEST_APP_ID`) and the Apple environment (`PCA_IOS_APPATTEST_ENVIRONMENT`); until then the iOS lane answers UNAVAILABLE (fail closed) and no iOS ceremony can commit. ANDROID_6C_RD_GATE remains a separate open physical-device proof. No live DB, Platform, Trust Set activation, Azure, deployment or production change occurred.
STOP = WAVE_6D_STOPPED_FOR_OWNER_REVIEW = YES. TODO-15 remains IN_PROGRESS (iOS activation now repository-side complete end-to-end; real-device gates open); the Parent board remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 owner-or-release gated (18,21,22,23); Platform remains HOLD_PARENT_DEPENDENCY. No downstream route activation, ordinary Trust-Set ingestion, recovery, Platform, live DB or Azure action was taken.

### 2026-10-04 — Wave 6D supervisor acceptance and ledger reconciliation (`WAVE_6D_LR`, records only)

ACCEPTANCE = The owner independently refreshed GitHub (`pca-dev` = `a8c98fbcc74b1f2e3c6878cdb8f5e97c0e1b366f`) and, having inspected the full 27-job list of the exact-head Quality Gates run, accepted the repository-side Wave 6D implementation and CI: WAVE_6D_CODE_COMPLETE = YES; WAVE_6D_CI_CERTIFIED = YES; REAL_IOS_DEVICE_PROVEN = NO; PRODUCTION_APP_ATTEST_PROVEN = NO; REAL_IOS_DEVICE_GATE = OPEN; PRODUCTION_APP_ATTEST_GATE = OPEN; WAVE_6D_100_PERCENT_CLOSED = NO. Quality Gates run 37171171191 at that exact SHA completed SUCCESS 27/27. Acceptance confirmed the intended architecture: Secure Enclave P-256 DSK as the family trust root (non-exportable by platform construction); App Attest as separate platform-authenticity evidence bound to the server-rebuilt 10-field ceremony transcript; enrollment-stable attestation clientDataHash derived from the server-minted `signingKeyId` plus the M1-enrolled DSK public key; no 0064 migration; Android product behavior unchanged (2826 tests, 0 failures, 2 documented skips).
STAGE_B_DISPOSITION = STAGE_B_SECURITY_RESULT = ACCEPTED; BLOCKERS = 0; MAJORS = 0; DOUBLECHECK_TOOLING_EXCEPTION = ACCEPTED_WITH_FOLLOWUP -- its REJECT was an artifact-access limitation, not a falsified claim, code defect, surviving security finding or architecture failure, and the file-capable claims review supplied the missing independent verification function. This disclosure is preserved verbatim and must never later be simplified into a perfect seven-seat execution without exception.
MUTATIONS = ACTUAL_BEHAVIORAL_MUTANTS = 14/14 KILLED; D_SEC_018 = CI BEHAVIORAL CONCURRENCY COVERAGE (Swift runtime, enforced by the FIFO XCTest in the macOS CI job); SURVIVORS = 0. This must never be restated as "19/19 mutants killed", which would overstate what was actually mutated.
LR = This reconciliation (`WAVE_6D_LR` = LEDGER RECONCILIATION ONLY) changed ONLY the three canonical ledgers -- no application source, migration, workflow, dependency, Android, iOS, backend or Platform code. It creates a new branch head; its exact-head Quality Gates result is reported with the LR checkpoint, after which the no-gratuitous-documentation-churn rule resumes.
NEXT = Production-readiness work is the immediate owner-directed priority; the physical-device and production-attestation gates remain open and queued.

### 2026-10-05 — Public-domain reuse and Child App production-readiness checkpoint

OWNER_AMENDMENT = Reuse the existing Public Web host for Child App enrollment and distribution routes; do not create a new domain. The existing domain inventory maps Public Web to `https://www.pcasafe.com`, Parent Web to `https://parent.pcasafe.com`, Platform Web to `https://platform.pcasafe.com`, and API to `https://api.pcasafe.com`. Proposed App Link host is `www.pcasafe.com`; `REUSES_EXISTING_DOMAIN=YES`; `NEW_DOMAIN_REQUIRED=NO`.
SOURCE_AND_POLICY = Public Web source has `/child-app/`, canonical `/enroll/<token>`, and exact `/.well-known/assetlinks.json` handling. Parent uses `VITE_PCA_CHILD_APP_PUBLIC_ORIGIN` as the enrollment origin and model-neutral `VITE_PCA_CHILD_APP_DISTRIBUTION_URL` for a direct signed APK, approved store URL, or landing page. Add Device fails closed before child/invitation creation when required production configuration is absent. Parent remains the invitation creator; API remains authoritative; Platform remains admin-only. `ANDROID_PACKAGE=org.pca.app`.
LOCAL_VALIDATION = The Child App Download E2E passed 6/6 in Chromium on an isolated fixture build/port; it covers the header action, unavailable-state copy, absence of fake links and 320px LTR/RTL layout. The initial run against the pre-existing port-4000 real-mode preview showed the expected sign-in page and failed; it was not counted as product evidence. Parent production build/typecheck/lint and earlier focused Parent tests passed. Public Web tests passed 24/24 with successful build/content parity; Platform refund recovery/proxy tests passed 21/21 plus typecheck/build/lint; Android debug unit tests passed.
RELEASE_READINESS = `ASSETLINKS_ROUTE_AVAILABLE=SOURCE YES`; the real signed-release fingerprint/file is absent and the live endpoint last returned 403. `ENROLLMENT_ROUTE_AVAILABLE=SOURCE YES`; live enrollment last returned 404 before the local route change, which is not deployed. `ANDROID_RELEASE_SIGNING_READY=NO`; `ANDROID_RELEASE_HOSTING_READY=NO`; `CHILD_APP_DISTRIBUTION_MODEL=OWNER_DECISION_REQUIRED`; `NEW_DOMAIN_REQUIRED=NO`. Android release signing is unset and release APK output is unsigned. Docker Desktop's Linux engine pipe rejected access, so container/nginx route headers and bearer-free logs are not runtime-certified. Direct current live-site browsing was inaccessible to the web checker.
DATABASE_AND_GIT = Live `pca_pro` last verified at schema 0059 versus repository/local 0063. Current TCP/3306 preflight timed out; no live SQL query or mutation occurred and parity is NOT VERIFIED. Local HEAD and origin/pca-dev remain `86b2fac0bde15b22570b636acc865713f108c369`. The extensive Parent/Platform/backend/Android/Public Web worktree changes, including this E2E correction, are local-only; no commit, push, CI result for current changes, deployment or production action occurred. `.vscode/`, root `0`, and the independent review artifact were preserved.
NEXT = Continue the production-route/action audit across Parent, Public Web, Platform and API; prove runtime route and proxy behavior, obtain the owner distribution choice and Android signing fingerprint, recheck live public routes, diagnose live DB access read-only, and close build/test gaps before the separate Azure deployment gate. Resume the queued Trust Set/epoch work after this readiness pass; Parent board remains 15 PASS / 4 IN_PROGRESS / 4 TODO or owner/release gated / 0 BLOCKED, TODO-14 remains 45/52, and Platform remains HOLD_PARENT_DEPENDENCY.

### 2026-10-05 — Download App browser harness now isolated

PLAYWRIGHT = The regular Parent E2E config uses fixture mode, a dedicated port 4002 and ignored `dist-e2e`, with server reuse disabled. This addresses the observed false failure from reusing the existing real-mode port-4000 preview and avoids overwriting that preview's build. `npx playwright test e2e/download-app.spec.ts --workers=1` then passed 6/6; port 4000 was preserved, the dedicated server stopped, and the generated E2E directory was removed.
SOURCE_CHECK = `git diff --check` passed after the harness and ledger edits; Git emitted only the existing CRLF normalization warnings for the Android enrollment config and Platform API proxy test.

### 2026-10-05 — Child App distribution semantics and live route checkpoint

The owner clarification to reuse the existing Public Web domain is reflected in source: `www.pcasafe.com` remains the proposed enrollment/App Link host. Parent's `childAppDistributionUrl` is model-neutral for an approved signed package, store listing, or public landing; Public EN/AR copy and the deployment verifier use the same general destination contract. Add Device remains fail-closed before child/invitation creation if its production origin or destination is absent.

Validation: Parent focused tests 46/46, typecheck, full source lint, and production build passed; Download App Chromium E2E passed 6/6; Public Web tests passed 24/24 and production build passed (20 pages, EN/AR 217/217 keys). The Parent production build used the PCA API/Public origins with distribution deliberately empty; scans found no localhost enrollment/API URL or APK/AAB/keystore artifact. The only `127.0.0.1` string is in an existing billing URL-validation allowlist. The container-verifier syntax check and `git diff --check` passed.

Direct read-only production probes returned Public `/child-app/` 404, `/enroll/` 404 and assetlinks 403; Parent/Platform roots 200 HTML; Platform `whoami` 401 JSON; API `/health` and `/health/db` 200, with DB connected. The new Child App routes are not deployed. DB health does not prove schema/grant parity: `pca_pro` remains last verified at 0059 versus repository/local 0063, the last direct TCP/3306 preflight timed out, and no direct SQL query/mutation occurred. Azure CLI has no authenticated account in this session, so Azure DB connection settings could not be inspected. Signer, distribution choice/hosting, live DB parity, nginx runtime, owner acceptance, exact-head CI, Azure and production gates remain open. No commit, push or deployment occurred.

### 2026-10-05 — Azure host ownership and live DB reachability refresh

AZURE_HOST_BINDINGS = Read-only Azure ARM confirms Public `www.pcasafe.com`→`pcaSafe`, Parent `parent.pcasafe.com`→`pcaParent`, and Platform `platform.pcasafe.com`→`pcaPlatform`; all three are Running and HTTPS-only. Their current container references are Public `pca-public:latest`, Parent `pca-parent-web:d3759d896aa3ff4804147ef80864dff1beb54ad6`, and Platform `pca-platform-admin:9496fb19dc29217b4e515305fe68ab70a48981e1`. The Child App reuses the existing Public host. No release or deployment occurred.
API_RESOURCE = DNS maps `api.pcasafe.com` to `pca-bngqeqahgdfvf8ak.uaenorth-01.azurewebsites.net`, but that App Service is absent from the sole accessible Azure subscription/tenant. The repository backend Dockerfile describes the API as a separate `pca` App Service placeholder. API resource ownership and current route behavior are NOT VERIFIED. Current HTTP probes fail at the configured proxy (`127.0.0.1:9`); no new HTTP status is claimed.
LIVE_DB = Azure ARM confirms `pca-mysql` Ready on MySQL 8.4 with public access enabled and `pca_pro` present. The visible web apps have no VNet integration, the DB has no delegated subnet/private DNS zone, and two exact-IP firewall rules are present. A 6-second direct TCP/3306 preflight from this session timed out. No credentials or SQL were used; schema/grant parity is unverified and no DB/firewall mutation occurred. Existing local disposable-MySQL certification is unchanged.
LOCAL_TOPOLOGY = Docker Linux engine access and WSL distro enumeration are denied; nginx is not installed on the host. Public container/nginx response-header and request-log verification remains pending. The Parent/Platform/Public code changes remain local-only; no commit, push, exact-head CI, deployment, owner acceptance, or production mutation occurred.

### 2026-10-05 — Safe Zone validation and iOS first-device persistence hardening

SAFE_ZONE = Parent Safe Zone POST/PATCH now use the repository's canonical base64url, decoded-byte length, and `1..0xffffffff` key-epoch checks before policy authorization; unexpected fields are rejected, and repository `INVALID_INPUT` maps to HTTP 400. Backend TypeScript build passed; focused Parent routes passed 9/9 and repository validation 2/2. Invalid requests produce no policy-authorizer call or write.
IOS_DURABILITY = `FirstDeviceRootStoring.save` reports whether encoding/writing succeeded. Coordinator state publication requires a matching readback; first submit additionally requires exact `.submitting` record and payload. Enrollment and recovery capture the root seed before persisting device identity, leaving the attempt available and showing a recoverable error if a configured root store write fails. Added XCTest regressions for a failed overwrite with an older APPROVED record and failed seed capture. `swiftc -frontend -parse` passed on all changed Swift files/tests. XCTest/typecheck did not run: `xcodebuild` is unavailable, and the local Windows Swift typecheck cannot find the required C standard headers. No production coordinator call site, trust-root approval, or device activation is implied.
TODO_STATE = Parent remains 15 PASS / 4 IN_PROGRESS / 4 owner/release-gated / 0 BLOCKED; TODO-12 and TODO-15 remain IN_PROGRESS. The iOS assertions await a compatible macOS/Xcode run. Platform remains HOLD_PARENT_DEPENDENCY. No commit, push, deployment, live SQL, or production mutation occurred.

### 2026-10-05 — Child App focused production-readiness recheck

The owner clarification is reflected: `www.pcasafe.com` is the existing proposed public enrollment/App Link host, and no new hostname is required. Distribution configuration remains model-neutral for a signed package, store listing, or public landing page; selecting the live destination and supplying the release signing fingerprint remain owner/release gates. Android application id is `org.pca.app`.

Fresh local evidence: Public Web suite 24/24 and static build passed (20 pages, EN/AR 217/217); Parent focused env/download/Add Device tests 40/40 and isolated Chromium Download App E2E 6/6 passed. The local build contains the `/child-app/` landing and bilingual enrollment fallback; no assetlinks file is emitted without the production signer fingerprint. The generated E2E directory was removed.

No live route probe, Azure mutation, live SQL, commit, push, or deployment occurred. Current local and cached remote refs remain `86b2fac0bde15b22570b636acc865713f108c369`; no fetch was performed. Runtime Public routing, signer/distribution, API route ownership, live schema/grants, exact-head CI, owner acceptance and release gates remain open.

### 2026-10-05 — Cross-surface epoch-bound Android follow-up

SCOPE = Continued the existing `INT32_MAX` family epoch-bound wave without creating a TODO or changing canonical TODO counts. Added the common Android bound to Family Envelope wire serialization/parsing, Safe Zone policy envelope and payload handling, and the local persisted family-state store. Persisted negative local epochs now fail closed without modifying the raw stored value. JSON numeric handling accepts integral forms such as `3`, `3.0`, and `3e0`, and rejects strings, fractions, negatives and values above `INT32_MAX`; zero remains available only for the existing sentinel contracts.
BACKEND_EVIDENCE = The previously completed backend slice remains at build PASS and 349/349 focused unit tests across 20 files. The separate loopback-only disposable MySQL harness applied all 61 migrations and the affected Trust Set persistence suite passed 21/21; its owned schema was dropped. The certified wrapper could not spawn `npm` (`spawn EPERM`) before suite execution; it cleaned up its owned database. The selected pre-existing nonempty local DB was left unchanged. No repository migration/schema file was added.
ANDROID_EVIDENCE = Focused Gradle run completed `BUILD SUCCESSFUL`; XML reports show 65/65 tests passed across EpochBoundsTest (3), EnvelopeWireCodecTest (10), SafeZonePolicyReceiverTest (10), PersistentFamilyStateStoreTest (7), SchedulePolicyEnvelopePayloadTest (16), PolicySnapshotRepositoryTest (10), and SyncOutboxAndReceiptTest (9). Kotlin daemon marker creation returned `AccessDeniedException` under the existing user profile; Gradle's fallback Kotlin compiler completed successfully. No physical-device test was run.
IOS_EVIDENCE = `xcodebuild` is unavailable on this Windows host, so XCTest was not run in this checkpoint. The existing iOS source/test changes remain subject to CI and device evidence.
LIVE_DB_AND_RELEASE = No live `pca_pro` read or mutation, HTTP probe, Azure operation or deployment occurred. Live DB remains last verified at migration 0059 versus repository/local 0063, and direct TCP/3306 remains unavailable from the prior preflight. The owner selected `https://www.pcasafe.com/child-app/` as the Parent information page; its deployed route remains unverified. The downstream signed installer/store destination, Child App signing fingerprint, assetlinks publication, nginx runtime/log proof, owner acceptance, Platform dependency, Azure deployment and production release remain open.
GIT = Local HEAD and cached `origin/pca-dev` remain `86b2fac0bde15b22570b636acc865713f108c369`; no fetch, commit, push or deployment occurred. Existing dirty/untracked paths were preserved. `git diff --check` passes, with only CRLF conversion warnings.
NEXT = Finish confirmation of remaining Android protocol boundaries, then perform the authorized read-only local/live persisted-row preflight when those environments are available. Keep production release gates and Parent-to-Platform dependency holds intact; update TODO state only when source/evidence proves a change.

### 2026-10-05 — Durable recovery and receipt-floor follow-up

ANDROID_DURABLE_PATHS = `InMemoryRecoveryEnvelopeStore.save` now rejects zero/negative Trust Set and key epochs, matching the backend recovery transaction's minimum epoch of 1. `SyncReceiptRepository.apply` now scans for any out-of-range epoch row in the same family before reading the sequence floor or inserting a receipt, so an unrelated corrupt row cannot distort ordering. This query fails closed and does not alter the corrupt row. The `DeviceEntity` DAO has no production upsert callsite; current readers use its device/member identity for scope, not the stored epoch fields. No entity constructor guard was added that could prevent deletion/export diagnosis of legacy rows.
ANDROID_VALIDATION = The focused offline Gradle run completed `BUILD SUCCESSFUL`; eight XML reports show 71/71 passed: EpochBoundsTest 3, EnvelopeWireCodecTest 10, SafeZonePolicyReceiverTest 10, PersistentFamilyStateStoreTest 7, InMemoryRecoveryEnvelopeStoreTest 5, SchedulePolicyEnvelopePayloadTest 16, PolicySnapshotRepositoryTest 10, SyncOutboxAndReceiptTest 10. The Kotlin compiler ran in-process after the first attempt exposed a Windows command-line property quoting issue; this successful run avoided the earlier Kotlin daemon marker access failure.
BOUNDARY = Existing zero sentinels remain accepted in local family state, while recovery envelopes require positive epochs. Invalid persisted receipt rows remain untouched and cause generic `INVALID_EPOCH_REJECTED` before sequence-floor use or writes. Device table epoch columns remain part of the later read-only local-store inspection; no production authority decision consumes them at present.
GIT_AND_RELEASE = No live DB access, HTTP probe, Azure operation, commit, push or deployment. Local HEAD and cached origin remain `86b2fac0bde15b22570b636acc865713f108c369`; all unrelated dirty files remain preserved. Parent TODO counts, Platform dependency hold, and Child App signing/distribution/release gates are unchanged.
NEXT = Finish the source-to-boundary scan, then perform the authorized read-only local/live persisted-row preflight when those environments are available; continue the earliest open mission work while retaining all owner and production gates.

### 2026-10-05 — Child App and first-device production-readiness continuation

OWNER_CLARIFICATION = Reuse the existing Public Web host `https://www.pcasafe.com` for Child App enrollment/App Links; Parent remains the invitation UI, API remains authoritative, and Platform remains admin-only. No new domain is required. The Android distribution URL remains model-neutral, and its package/store/landing choice is still an owner decision.
SOURCE = Parent and Android share one canonical public enrollment origin; distribution destination is a separate setting. Production rejects localhost and fails closed before child/invitation creation if required configuration is absent. Public Web source implements `/child-app/`, canonical `/enroll/<43-character-token>`, and optional validated assetlinks output. No signer fingerprint or distribution destination is configured; `org.pca.app` release output remains unsigned. Docker context excludes debug APKs.
LOCAL_EVIDENCE = Public Web route/security suite 24/24 and production build 20 pages, EN/AR 219/219. Parent production build, demo gate, typecheck and focused 46/46 Download App/Add Device/header/config tests passed. Android first-device focused tests passed 55/55. iOS explicit challenge recovery and root-record replacement policy are source-covered: only EXPIRED/REJECTED may be replaced; active, ambiguous and committed records are preserved. Swift syntax parse and diff check passed; XCTest is unavailable without Xcode. No emulator/physical-device evidence is claimed.
DATABASE_AND_EXTERNAL = Local `pca_test` matched a fresh isolated replay of all 61 repository migrations through 0063: 95 tables and normalized table definitions matched; the owned disposable schema was removed without seed data or existing-schema mutation. Grants were not certified. Live `pca_pro` remains last verified at 0059, TCP/3306 timed out, and no live SQL ran. Official live route checks are inaccessible from this session; route status is UNCONFIRMED. Nginx runtime/log behavior, signing, distribution, exact-head CI, owner acceptance, Azure and production release remain open.
GIT_AND_TODO = Local HEAD and cached `origin/pca-dev` remain `86b2fac0bde15b22570b636acc865713f108c369`; no fetch, commit, push or deployment occurred. Parent remains 15 PASS / 4 IN_PROGRESS / 4 owner-or-release gated / 0 BLOCKED; TODO-14 is 45/52, TODO-15 and TODO-20 remain IN_PROGRESS, and Platform remains `HOLD_PARENT_DEPENDENCY`. Continue the same goal from TODO-15 and the production route/action audit; do not infer release acceptance from local checks.

### 2026-10-05 — TODO-12 local authority-boundary hardening

REMOTE = Fresh fetch confirms local, tracking, and `FETCH_HEAD` all at `86b2fac0bde15b22570b636acc865713f108c369`; worktree source remains unpublished and the base-only CI result does not certify it.
SOURCE = Parent schedule-envelope validation now caps safe-integer `keyEpoch` at `INT32_MAX`. The dormant Web Rules Parent client always fails unavailable, including when generic family crypto says READY, so it cannot submit cleartext domains under PCA-SEC-023. Its missing remove-route configured-service scenario is now explicit in bounded evidence. FamilyAudit reports conflicts as failed delivery instead of success and isolates the affected recipient. No policy or actor semantics, database schema, encrypted protocol, or production wiring changed.
VALIDATION = Parent schedule-policy Vitest passed 10/10; Web Rules Parent Vitest 6/6 and typecheck passed; backend build passed; Web Rules route tests 18/18; FamilyAudit producer/store/route/wiring tests 20/20; child policy route tests 12/12; repository diff check clean.
STATUS = TODO-12 remains IN_PROGRESS; its Trust Set/root, encrypted policy/audit, and actor-model gates remain. TODO-14 remains 45/52 integrated, since the new Web Rules scenario is bounded-only. TODO-15 and TODO-20 remain IN_PROGRESS; Platform remains `HOLD_PARENT_DEPENDENCY`. No live SQL, commit, push, CI, deployment, or owner acceptance occurred.

### 2026-10-05 — Child App domain and distribution amendment recheck

OWNER_AMENDMENT = The owner clarification is consistent with the existing implementation: reuse `https://www.pcasafe.com` for Child App public enrollment/App Links; do not create a hostname. Parent creates/displays invitations, API remains authoritative, Platform remains admin-only. Distribution configuration is a model-neutral HTTPS destination; the owner has not selected direct signed APK, store listing, or landing-page distribution.
AZURE_DOMAIN_REFRESH = A fresh read-only `az webapp list` showed `www.pcasafe.com` bound to running HTTPS-only `pcaSafe`, `parent.pcasafe.com` to running HTTPS-only `pcaParent`, and `platform.pcasafe.com` to running HTTPS-only `pcaPlatform`. `api.pcasafe.com` currently resolves by CNAME to `pca-bngqeqahgdfvf8ak.uaenorth-01.azurewebsites.net`, but no matching API App Service or custom-host binding appeared in the accessible subscription; API resource ownership/routing remains unverified.
SOURCE_ROUTE_STATUS = Current local Public Web source builds `/child-app/`, canonical `/enroll/<43-character-token>`, and exact `/.well-known/assetlinks.json` handling. The nginx config serves enrollment fallback without echoing/logging the token and keeps assetlinks at 404 until a validated owner-supplied signing statement is present. The route source is local-only and Docker/nginx runtime behavior has not been verified.
LIVE_AND_RELEASE = Current direct web checks could not access `/child-app/`, `/enroll/`, or `/.well-known/assetlinks.json`; no live status is inferred. Android package is `org.pca.app`; release signing/fingerprint and hosting destination are absent. `CHILD_APP_DISTRIBUTION_MODEL=OWNER_DECISION_REQUIRED`; `REUSES_EXISTING_DOMAIN=YES`; `NEW_DOMAIN_REQUIRED=NO`.
SOURCE_NOTE = Corrected the local-only `docker-compose.yml` topology comment to match the verified Public/Parent/Platform App Service bindings and to keep the unresolved API ownership explicit. No service behavior changed.
GIT_AND_GATES = Local HEAD and cached `origin/pca-dev` remain `86b2fac0bde15b22570b636acc865713f108c369`; this review did not fetch, test, commit, push, deploy, or change Azure configuration. A read-only Azure binding query and live DB DNS/TCP preflight ran; TCP/3306 returned `False`, and no MySQL session or SQL query ran. Existing dirty work was preserved. Exact-head CI, downstream signed installer destination, signer, assetlinks publication, runtime routes/logging, Azure API ownership, live DB parity/grants, owner acceptance, and release remain open.

### 2026-10-05 — Owner selected Child App public landing page

OWNER_DECISION = `PUBLIC_LANDING_PAGE_SELECTED`. Parent's planned public destination is `https://www.pcasafe.com/child-app/`; it reuses the verified Public Web host. Parent remains the invitation UI, API the enrollment authority, and Platform admin-only.
RELEASE_READINESS = The owner selected `https://www.pcasafe.com/child-app/` as Parent's installation-information destination. Public Web source builds that landing page, but the deployed route is not yet verified (the prior browser check showed not found). Configure Parent Download App to link there after the Public route is deployed and verified; the landing page may honestly report that no installer is available yet. Keep production Add Device and backend enrollment readiness closed until a signed Android installer, signer fingerprint, live enrollment route and matching assetlinks statement are verified. Public Web's installer/store target remains unconfigured.
GIT_AND_GATES = Existing dirty work remains preserved. No production build configuration was changed, and no commit, push, deployment or live SQL action occurred. Exact-head CI and owner/production acceptance remain open.

### 2026-10-05 — Child App production gate and audit-feed completeness

OWNER_DECISION = `PUBLIC_LANDING_PAGE_SELECTED`; Parent's selected public installation-information URL is `https://www.pcasafe.com/child-app/`.
SOURCE = Parent Download App has neutral “View installation options” copy and bilingual EN/AR text; it renders the external link only when a valid distribution URL is configured. The production Parent URL stays unset until the selected Public route is deployed and verified. Parent production Add Device separately requires the enrollment route and explicit `VITE_PCA_CHILD_APP_ENROLLMENT_READY=true`, default false. Backend independently requires `PCA_CHILD_APP_ENROLLMENT_READY=true` in production; its 503 denial runs before step-up consumption, slot reservation and invitation persistence. The Parent client surfaces this status as a bilingual release-unavailable message.
TODO12 = An empty FamilyAudit envelope response no longer renders as a complete empty history. It remains pending until feed completeness can be proven; the displayed English/Arabic message now reflects uncertain delivery. Web Rules remain fail-closed and FamilyAudit conflicts remain isolated as failed delivery.
VALIDATION = Parent focused tests 83/83 across seven files; typecheck and full ESLint passed. Backend build passed; invitation role/readiness tests 11/11, iOS unavailability tests 5/5, readiness resolver tests 3/3. `git diff --check` clean apart from existing CRLF notices.
EXTERNAL_GATES = Live `/child-app/`, `/enroll/` and assetlinks behavior remains unconfirmed; no signed Android installer or fingerprint exists. Keep Parent and backend production readiness false. Live `pca_pro` remains last verified at 0059 against repository/local 0063; TCP/3306 is unreachable, no SQL ran. API App Service ownership/routing remains unverified.
GIT_AND_RELEASE = Local HEAD and cached origin remain `86b2fac0bde15b22570b636acc865713f108c369`. All changes are local-only and not covered by exact-head CI. No live SQL, commit, push, deployment, or owner acceptance occurred. Parent remains 15 PASS / 4 IN_PROGRESS / 4 TODO or gated / 0 BLOCKED, with TODO-14 at 45/52; Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT = Continue bounded TODO-12/TODO-14 work and remaining TODO-15 mobile security/real-device evidence; preserve Trust Set, root, live DB, owner-UAT, Platform, deployment and production gates.

### 2026-10-05 — TODO-15 Android persisted-family corruption handling

SOURCE = Android now distinguishes a genuinely absent family record from present-but-corrupt persisted data. The store raises a typed corruption exception for malformed record shape, enum values, negative epochs, and unparseable/out-of-domain epochs; it preserves the original raw value. Enrollment uses a dedicated `LocalStateCorrupt` state, blocks invite/bootstrap/retry/recovery/commit actions, and renders bilingual recovery guidance without action buttons, advising the user not to clear app data. Device identity reports `Unavailable`; Web Protection disables trusted family context; Safe Search falls back to STRICT, Screen Time to its safe baseline, retention omits family scope, and Admin Security hides family-scoped controls.
VALIDATION = Offline Android focused tests passed: store 7/7, identity provider 5/5, enrollment coordinator 31/31, Web Protection identity 5/5, PcaAppGraph 11 passed and 1 skipped; Arabic parity, resource completeness, and no-hardcoded-string checks passed 4/4. Main/test Kotlin compilation passed and `git diff --check` is clean. The skipped graph test remains skipped; no emulator or physical device was used.
GATES = TODO-15 remains IN_PROGRESS for root/attestation, approved crypto and key custody, production activation, and real-device acceptance. Current local work is uncommitted on base `86b2fac0` with no exact-head CI. No commit, push, deployment, live SQL, or owner acceptance occurred. TODO-12/14, TODO-20, owner acceptance, and Platform `HOLD_PARENT_DEPENDENCY` remain open.

### 2026-10-05 — Child App landing choice confirmed and Parent route ordering hardening

OWNER_DECISION = Owner confirmed a public landing page for Child App distribution. Parent's selected URL is `https://www.pcasafe.com/child-app/`; this does not supply a signed installer/store listing or signing fingerprint.
LIVE_ROUTE = Edge showed a not-found page at the selected public route. Local Public Web source includes the bilingual route, but it is not live yet. Keep the production download destination unconfigured until deployment and live verification; keep Parent/backend enrollment readiness false until signed installation, enrollment routing and asset association are verified.
BACKEND = Schedule-policy route validation now rejects malformed child IDs and opaque envelopes after session/CSRF but before role/device lookups. Build passed; focused route tests passed 12/12 using `--experimental-test-isolation=none --test-concurrency=1`. Default Node test isolation failed before loading the file with Windows `spawn EPERM`.
PLATFORM_AND_DATABASE = The read-only Platform `whoami` URL was blocked by Edge `ERR_BLOCKED_BY_CLIENT`; no HTTP response was classified. The live MySQL TCP/3306 preflight returned false and no SQL ran.
GIT_AND_RELEASE = Worktree remains broadly dirty and uncommitted on the last recorded base `86b2fac0`; no fresh fetch, exact-head CI, push, deployment, production mutation or owner acceptance occurred. TODO counts remain 15 PASS / 4 IN_PROGRESS / 4 owner-or-release gated / 0 BLOCKED. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — TODO-14 persisted schedule snapshot corruption handling

SOURCE = Android snapshot decoding requires `candidatePolicy`, `lastKnownGoodPolicy`, and `lastPolicySyncAtUtc` keys with strict null/object/string shapes. Corrupt nested policies, unsupported versions, malformed field shapes, and invalid epochs are reported as corrupt while retaining original stored bytes. Runtime reports `CORRUPT_LOCAL_STATE` and `ENFORCEMENT_UNAVAILABLE`; the production port does not call the enforcement consumer. Genuine absence keeps its prior never-accepted behavior. Fractional JSON epochs consistently raise `JSONException`.
VALIDATION = Final focused corruption and reboot/offline tests passed 7/7 (`BUILD SUCCESSFUL`), including malformed last-known-good objects and no raw-byte rewrite. The broader schedule package passed 55/55 across 9 suites before those final test-input-only additions; production source was unchanged afterward. Android `git diff --check` passed.
GATES = TODO-14 remains 45/52 with no publication/aggregate promotion; TODO-15 remains IN_PROGRESS for security root, attestation, signing and real-device evidence. No emulator, physical device, exact-head CI, live DB action, commit, push, deployment, or owner acceptance occurred. Existing dirty work remains preserved; live remote ref refresh is blocked by the workstation proxy.

### 2026-10-05 — Parent private-response caching, iOS recapture readback, and Platform paging

PARENT_PRIVACY = Authenticated Parent session, free-access-status, preferences GET/PATCH, Safe Zone GET, and FamilyAudit envelope responses now set `Cache-Control: private, no-store` before route processing. Backend build and the combined route suite passed 43/43 under `NODE_ENV=test` with response-header assertions.
IOS_DURABILITY = Same-attempt Keychain seed recapture now requires an exact durable readback; `swiftc -frontend -parse` passed for the changed store and regression file. XCTest remains unavailable on this Windows host.
PLATFORM_VALIDATION = The Accounts directory pagination regression passed 5/5 and Platform typecheck passed. No Enrollment Name/Email/Phone UI or identity-selection logic changed.
TODO20 = Fresh DNS resolved live MySQL to `4.161.89.178`; TCP/3306 was unreachable. Local MySQL test ports had no listener. The old temporary 8.4 data directories were preserved, and the missing 8.4 server binary was not substituted with the installed 9.7 server. No live or local SQL session/query ran in this check.
GIT_AND_GATES = Local/cached remote base remains `86b2fac0`; 235 dirty paths remain preserved, none staged. Live Git ref refresh failed through the workstation proxy. No commit, push, exact-head CI, deployment or owner acceptance occurred. TODO-14 remains 45/52; TODO-15 root/attestation/device/release gates, TODO-20 live reconciliation, TODO-18 localhost acceptance and Platform `HOLD_PARENT_DEPENDENCY` remain open.

### 2026-10-05 — Child App public landing-page choice confirmed

OWNER_DISTRIBUTION = Owner confirmed `PUBLIC_LANDING_PAGE` for Parent Download App, targeting `https://www.pcasafe.com/child-app/`. Local Public Web source contains the route, but live availability is unverified. Keep the production download link and enrollment readiness gated on live route verification, signed installer/store destination, signing fingerprint, and matching App Links association.
CURRENT_GIT = Local HEAD and cached `origin/pca-dev` remain `86b2fac0bde15b22570b636acc865713f108c369`; fresh `git ls-remote` failed through the workstation proxy. There are 238 dirty paths (212 tracked modifications, 27 untracked), zero staged. No commit, push, exact-head CI, or deployment occurred.
CURRENT_GATES = Backend cache-header campaign passed 43/43; iOS Swift parsing passed but XCTest is unavailable; Platform pagination passed 5/5 and typecheck passed. Live MySQL TCP/3306 remains unreachable with no SQL session. Parent TODO-14 remains 45/52, TODO-12/14/15/20 remain in progress, owner/release gates remain open, and Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — Schedule-policy fallback floor conformance

SOURCE = For an epoch-stale schedule candidate, Android retains a last-known-good policy only when that fallback is not behind the current device trust-set/key-epoch floors; otherwise it keeps the newer persisted candidate. Updated the shared policy contract, JSON vector, and JavaScript reference model in lockstep.
VALIDATION = Backend shared policy-acceptance vectors passed 17/17; backend build passed; child-policy route regression passed 12/12 using single-process mode after default Node isolation hit `spawn EPERM` before loading. Android Gradle conformance passed 2/2 methods, 0 failures/errors/skips; a fresh temp cache and non-daemon fallback Kotlin compilation worked despite access denial to the shared daemon marker. `git diff --check` reported only pre-existing CRLF notices.
GATES = TODO-14 remains 45/52 pending accepted Trust Set/root and receiving-device enforcement. Child App public landing was owner-confirmed; `/child-app/` currently returns not found and signed distribution/assetlinks are absent. Platform API routing could not be classified because Edge blocked the read-only request; live MySQL TCP/3306 failed before SQL.
FOLLOWUP = `PersistentSchedulePolicyStore.load()` currently treats a decode error as absent state, leading to `NO_ACCEPTED_POLICY` and an ALLOWED evaluator result. The shared contract has no corrupt-snapshot state or recovery behavior; keep it open until the safety semantics are defined rather than choosing a new restriction policy silently.
GIT_AND_RELEASE = Existing dirty work remains preserved. No fetch, stage, commit, push, exact-head CI, live SQL, deployment, or Azure mutation occurred. Parent TODO-12/14/15/20 remain IN_PROGRESS as recorded; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — Safe Zone route audit and certified disposable MySQL checkpoint

SAFE_ZONE_TEST = Updated the Parent Safe Zone MySQL HTTP regression to match the production fail-closed dependency contract: without a verified device-session bearer and shared Trust Set authorizer, owner mutations return `503 AUTHORITY_UNAVAILABLE`; create writes no row, and patch/delete leave a disposable existing fixture unchanged. The focused Parent route audit passed 52/52.
TODO14_ROUTE_COVERAGE = The 135-scenario report collected 45/52 declarations: 47 allow-proven, 73 expected denials, 3 `AUTHORITY_UNAVAILABLE`, 11 validation/protocol outcomes, and zero unexpected 401/403/other results. Global aggregate remains `NOT_YET_PROVEN`; seven declarations remain uncollected.
TODO20_LOCAL = Fresh loopback MySQL 8.4.11 passed the UTC/charset/collation environment gate and applied all 61 migrations through 0063. `test:db:full-certified` inner lane passed 696/706 (0 failed, 10 explicit privilege-only skips); populated production-path certification passed 276/276 (0 skipped/failed); focused grant and append-only checks passed 7/7. The first temporary migration account lacked `GRANT OPTION`; a separate fresh test datadir was configured with test-only grant authority, then the complete campaign passed. Disposable schemas and generated grant users were removed; both temporary MySQL servers were stopped with datadirs retained.
LIVE_AND_RELEASE_GATES = Live `pca_pro` DNS/TCP preflight still fails at TCP/3306 (`4.161.89.178`); no live SQL ran. Live schema remains last verified at 0059 versus repository 0063. No commit, push, exact-head CI, deployment, localhost owner acceptance or production acceptance occurred. Parent board remains 15 PASS / 4 IN_PROGRESS / 4 owner/release gated / 0 BLOCKED; TODO-14 remains 45/52; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — Parent TODO-14 dashboard, schedule-policy and decision-gate integrated evidence

TODO14 = The disposable-MySQL route audit passed 55/55 after all 61 migrations were applied in a fresh run-owned database. The authenticated dashboard scenario verifies same-family session access and honest `UNAVAILABLE`/`LIMITED` card states when backing evidence is incomplete. The schedule-policy case uses a real MySQL-backed Parent session and accepted-epoch resolver, with a test-only device-session collaborator; it proves 403 and zero relay/write when no signed Trust Set epoch exists, not device signatures or successful delivery. Signed and authorized-recovery decision requests against real pending rows return 403 when authorities are unavailable and preserve `PARENT_APPROVAL_REQUIRED`; this proves fail-closed behavior only, not signature validity, recovery authorization, or successful decisions. The generated 139-scenario report covers 49/52 declarations (48 allowed, 73 expected denials, 3 authority-unavailable, 3 crypto/device-gated, 11 validation/protocol, zero unexpected 401/403/other). Three Web Rules declarations remain without integrated evidence. The aggregate remains `NOT_YET_PROVEN`.
TODO20 = The route campaign used a fresh disposable MySQL 8.4.11 instance and run-owned UUID schema; all 61 migrations applied and the wrapper removed the schema. This is local disposable evidence only. Live `pca_pro` TCP/3306 remains unreachable, with no live SQL or mutation.
LIVE_PUBLIC_ROUTE_CHECK = Read-only browser and direct HTTP probes to `/child-app/`, `/enroll/`, and `/.well-known/assetlinks.json` returned no HTTP response in this environment. The last recorded Edge response for `/child-app/` was Not Found; no current status is inferred, and Parent's production URL remains gated on deployment and live verification.
WORKTREE_AND_GATES = Local HEAD and cached `origin/pca-dev` equal `86b2fac0bde15b22570b636acc865713f108c369`; 243 dirty status entries remain preserved and zero staged. No commit, push, exact-head CI, deployment, or owner acceptance occurred. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — Owner-selected Child App landing page local build

OWNER_DECISION = The owner selected `PUBLIC_LANDING_PAGE` for Parent's Download App destination: `https://www.pcasafe.com/child-app/`.
VALIDATION = Focused Child App landing, enrollment fallback, asset-links validator and nginx route tests passed 8/8. Public Web production build passed with 20 bilingual routes, exact 219/219 EN/AR content-key parity, all contrast checks passing and no build findings. The local artifact contains `/child-app/`.
PARENT_VALIDATION = Parent Download App page/header component tests passed 21/21. The first sandbox run stopped before test loading with `spawn EPERM`; the same tests passed under the elevated local process runner.
GATES = The build requests review of 63 new copy keys, and Arabic native review remains pending OD-12. The last direct HTTP observation was Not Found; this turn's read-only web-tool open could not access the URL, so no current HTTP status is inferred. No deployment occurred. Parent production link remains unset pending deploy+verify of the page. Signed installer/store location, signer fingerprint, App Links statement, backend enrollment readiness, exact-head CI, owner acceptance, and Azure release remain open. No commit or push occurred.

### 2026-10-05 — TODO-20 local persisted epoch-row preflight

LOCAL_READ_ONLY_SCAN = On loopback MySQL 8.4.11 `pca_test`, a read-only transaction inspected metadata for every numeric column whose name contains `epoch`, then ran aggregate-only checks over 13 columns / 6,680 column cells. No value was negative or above INT32_MAX. `device_session_epoch` rows and existing Trust Set/floor rows were at 1; other epoch columns were empty or nullable. No row contents were returned, no data was seeded, and no write occurred.
LOCAL_GRANT_CONTEXT = The connection principal was `root@%` with global administrative grants; this scan does not certify application runtime privileges. The separately recorded disposable runtime-grant/append-only suite remains the local grant evidence.
LIVE_PREFLIGHT = A fresh 4-second TCP/3306 probe to `4.161.89.178` timed out. No live SQL connection/query/mutation occurred; `pca_pro` remains last verified at migration 0059 versus repository 0063, and live parity remains NO.
MISSION_STATE = TODO-20 remains IN_PROGRESS; Parent TODO-14 remains 49/52 with aggregate NOT_YET_PROVEN; Platform remains `HOLD_PARENT_DEPENDENCY`. Continue the source-to-boundary review and retry read-only live schema/grant inspection when reachable. No production gate was promoted.

### 2026-10-05 — Parent route audit retest and Platform epoch boundary

TODO14_ROUTE_AUDIT = After wiring the shared test clock into `RemovalDecisionAuthority`, a fresh disposable MySQL 8.4.11 campaign applied all 61 migrations and passed 55/55. The generated schema-v3 report records 139 scenarios and 49/52 integrated declarations (48 allow-proven, 73 expected denials, 3 authority-unavailable, 3 crypto/device-gated, 11 validation/protocol, zero unexpected 401/403/other). Three Web Rules declarations remain uncollected; global aggregate remains `NOT_YET_PROVEN`. The disposable schema was removed.
PLATFORM_EPOCH_BOUNDARY = MySQL `families.device_session_epoch` is `INT UNSIGNED`; Platform status actions now validate and saturate the epoch safely. Suspending at `UINT32_MAX` succeeds without wrapping, and reactivation fails closed with 409 while keeping the family suspended. A real-MySQL HTTP test checks persisted status, epoch, and audit events. No migration/data mutation was needed.
VALIDATION = Backend build, focused Parent route audit (55/55), and `git diff --check` passed. The all-certified disposable Parent/Platform DB run applied all 61 migrations and completed with 710 inner tests (700 passed, 10 explicit privilege-only skips, 0 failed) plus 276/276 populated production-path tests (0 skipped/failed). The zero-skip production lane included and passed least-privilege runtime grant/append-only assertions through migration 0063; its temporary probe principal and owned schema were removed. The previous one-test signed/recovery clock-fixture failure is corrected and passed in the focused and broad reruns. TODO status counts are unchanged. Local grants are certified only for the disposable schema; live `pca_pro` TCP/3306 remains unreachable, with no live query/mutation, commit, push, exact-head CI, deployment, or owner acceptance. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-05 — TODO-14 Web Rules service-gate evidence

ROUTE_COVERAGE = Added MySQL HTTP status evidence for Web Rules GET/add/remove with the production service absent. All return exact `503 not_configured`; add/remove do not echo the submitted domain. Valid test Parent session and CSRF headers are sent, but the missing-service guard returns before the route checks them. These cases prove the gate only, not Web Rules functionality.
VALIDATION = Fresh disposable MySQL 8.4.11 applied all 61 migrations; Parent route campaign passed 56/56 and emitted 142 scenarios across 52/52 declaration keys. Classifications include 3 `SERVICE_NOT_CONFIGURED`, 3 `CRYPTO_DEVICE_GATED`, 3 `AUTHORITY_UNAVAILABLE`, and zero unexpected status outcomes. Report: `.agent-local-artifacts/qa_route_collector_20261005_web_rules_gates_86b2fac0.json`. The wrapper removed the disposable schema.
MISSION_STATE = TODO-14 remains IN_PROGRESS and `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`; encrypted Web Rules delivery, ordinary Trust Set acceptance, recipient enforcement, signed/recovery authority success, and optional dashboard disposition remain open. TODO counts are unchanged; Platform remains `HOLD_PARENT_DEPENDENCY`. No live DB query/mutation, commit, push, CI, deployment, or owner acceptance occurred.

### 2026-10-05 — TODO-12 Trust Set production-caller gate review

SOURCE_REVIEW = `TrustSetEpochAcceptanceService` performs canonical-byte/family checks, reads durable accepted epoch/key/floors and genesis anchor, verifies the authorized signer and signature, and appends only after validation. Production composes the MySQL trust-set store as a read-side resolver; there is no ordinary acceptance caller or ordinary Android/iOS signed-epoch request/retry path.
BLOCKER = PCA-DEC-020 is still `OPEN -- PROPOSED` and is recorded as gating device sessions, policy delivery and family sync. The acceptance service's test-verifier coverage does not provide an approved production crypto construction, signer/root configuration or cross-platform wire contract. Keep no-accepted-Trust-Set denial and receiving-device activation fail-closed.
NEXT = Continue only preparatory review until the required crypto construction and canonical request/retry/trust-root contract are approved; then wire the API/mobile path atomically with production verifier and recipient enforcement. TODO-12/14/15 and TODO-20 live checks remain open; Platform stays `HOLD_PARENT_DEPENDENCY`.
