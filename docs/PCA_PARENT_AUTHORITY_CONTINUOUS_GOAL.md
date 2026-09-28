# PCA Parent Authentication + Authority — Continuous Pursuing Goal

This is the single live mission ledger. Continue the canonical TODO-01…TODO-23
sequence here; do not reset it or create a disconnected mission. This current
checkpoint was refreshed on 2026-09-28 02:34 UTC; older dated entries below remain
historical evidence and may describe superseded states.

## Current checkpoint

```text
PURSUING_GOAL = PCA PARENT AUTHENTICATION + AUTHORITY — CONTINUOUS COMPLETION
CURRENT_TODO = TODO-10, TODO-12, TODO-14, TODO-15, and owner-gated TODO-18; TODO-02…09/11/13/16/17/19/20 PASS at the current integrated checkpoint or prior verified live/source evidence
MISSION_STATUS = IN_PROGRESS

BRANCH = pca-dev
LOCAL_HEAD = dfefe27c277c0e225ee1f1a50e38f00871dc8082 (Parent implementation plus master-ledger synchronization)
REMOTE = origin
TARGET_DEV_BRANCH = pca-dev
FETCHED_REMOTE_HEAD = 739133e9fe7b8240f4f104b1ba8d4879efc3e234 (fresh fetch and git ls-remote agree)
LOCAL_REMOTE_EQUAL = YES
REMOTE_ADVANCED_DURING_WORK = NO after the verified fast-forward push
INITIAL_WORKTREE_ENTRY_COUNT = 256 (historical mission start: 166 tracked modified; 90 untracked; none staged)
CHECKPOINT_WORKTREE_ENTRY_COUNT = 330 before the new classification file; 227 modified tracked and 103 untracked; no staged/deleted entries
POST_CHECKPOINT_DIRTY_PATHS = The source checkpoint is pushed; Parent master, Platform master, canonical board, and this ledger are being updated with exact-head CI evidence. Unrelated .vscode and root fragment 0 remain excluded.
PEER_WORK_PRESERVED = YES (all 61 date-bound assessment files committed separately; unrelated/mobile source remained untouched)

PARENT_IMPLEMENTATION_PATHS = coordinator owns authorized Parent + dependent Platform family-identity implementation; existing dirty changes retained
SHARED_PATHS = backend, database bootstrap, and cross-surface tests; one active writer per file, shared edits serialized
OUT_OF_SCOPE_DIRTY_PATHS = 39 API/mobile assessment files and 2 .vscode files; preserved
MISSION_LEDGER = docs/PCA_PARENT_AUTHORITY_CONTINUOUS_GOAL.md (new)
CODE_CHANGES_BY_THIS_CHECKPOINT = backend/src/parentaccount/ParentAccountService.ts; backend/src/platformadmin/accounts/FamilyAccountStatusService.ts; backend/src/http/routes/platformadmin/accountsRoutes.ts; backend/test/parentaccount/optionalMfaLogin.test.mjs; backend/test/db/parentAccount.mysql.test.mjs; backend/src/familyrbac/RemovalDecisionAuthority.ts; backend/src/familyrbac/MySqlRemovalDecisionRepository.ts; backend/src/http/routes/removalDecisionRoutes.ts; backend/migrations/0057_parent_actor_provenance_for_removal_decisions.sql; backend/src/db/schema.ts; parent-web/src/rbac/useFamilyAction.ts; parent-web/tests/route/familyActions.test.tsx; this ledger
FOCUSED_TESTS = Prior mission campaigns remain as recorded; Parent session-revocation real-client/Settings/RTL run passed 42/42; Parent Web typecheck, touched-file ESLint, strict E2E TypeScript compile, Playwright collection, backend build, and git diff --check passed.
BROWSER_EVIDENCE = Quality Gates run 36370514236 passed all 27 jobs at exact pushed HEAD 739133e9, including Parent/Platform real-browser E2E and real-backend disposable-MySQL acceptance. The local owner-acceptance campaign at 6b7bf8e passed 2/2 with no unexpected 401/403 in that journey, revoke-all 204/redirect, and cross-family isolation; its random disposable DB was removed. Global route/action aggregates remain NOT_YET_PROVEN.
BROADER_REGRESSION = TODO-17 PASS at 739133e9; full MySQL certification, Parent/Platform real-backend browser, Android, iOS, security, builds and unit jobs passed. TODO-13 focused sensitive-action HTTP campaign passed 64/64. External device-crypto and literal owner localhost gates remain separately open.
UNRELATED_FILES_TOUCHED = 0

REMOTE_ALIGNMENT_AUTHORIZED = YES (checkpoint synchronization amendment; origin / pca-dev)
REMOTE_ALIGNMENT_COMPLETED = YES at 739133e9fe7b8240f4f104b1ba8d4879efc3e234; four reviewed commits fast-forwarded, fetched, and independently matched by git ls-remote
PARENT_LOCAL_ONLY_FILES_REMAINING = Exact-head CI ledger synchronization is being prepared; unrelated .vscode and root fragment 0 remain excluded
PARENT_UNPUSHED_COMMITS_REMAINING = 0 source commits; current documentation synchronization is uncommitted; unrelated .vscode and root fragment 0 remain untracked and excluded

REPO_SCHEMA_HEAD = canonical source/migrations through 0059; 57 migrations applied from zero on local MySQL 8.4.11
REPO_MIGRATION_HEAD = 0059 (57 migrations; 0009 and 0010 absent from repository history)
LOCAL_SCHEMA_HEAD = 0059; 92 tables, 792 columns, 104 FKs, 92 PKs, 38 unique and 141 non-unique indexes, 282 checks
LIVE_PCA_PRO_SCHEMA_HEAD = 0059 on verified pca-mysql.mysql.database.azure.com / pca_pro (MySQL 8.4.9-azure)
SOURCE_SCHEMA_MATCH = EXACT_MATCH by full local/live introspection after 0059; excluded dirty current_schema.sql and schema_manifest.json were not used to manufacture agreement
LOCAL_DB_SCHEMA_MATCH = PASS; two fresh disposable local MySQL 8.4.11 migration databases (57 migrations / 92 tables) compare EXACT_MATCH; generated schema artifacts come from migrated database
LIVE_PCA_PRO_SCHEMA_MATCH = PASS; full structural snapshot EXACT_MATCH and 90 readable application-table counts unchanged
LIVE_GRANTS_MATCH = PASS; 92/92 exact plan; parent_account_security_events remains INSERT-only
MIGRATION_REQUIRED = NO remaining proven source/live mismatch after 0059
MIGRATION_FILE = 0059_parent_mfa_ascii_check_literal_charset.sql (locally validated, applied through official migration runner)
LOCAL_MIGRATION_TEST = PASS; focused migration safety 3/3 and Parent persistence test 22/22 on disposable DB
LIVE_MIGRATION_APPLIED = YES (0059 only after fresh immediate preflight)
LIVE_MIGRATION_RESULT = PASS; journal 56→57, no seed/reference/business DML, row-count preservation verified
NO_SEED_DATA = YES
DATA_LOSS = 0

CURRENT_P0 = pending re-review; prior assessment reported none
CURRENT_P1 = no current local backend npm test failure; full serial run passes 2648/2648 with zero skips
BLOCKERS = ordinary schedule-policy actions still depend on device bearer and unavailable Trust Set resolution; Web Rules remain 503 not_configured; real protection-status attestation and PAIRED-to-ACTIVE crypto/trust wiring remain open; successful Parent bonus-grant revocation actor attribution is process-local; ownership-transfer/recovery-material step-up operations have no consumers; TODO-14 aggregate route/action counts and TODO-15 security gates remain open; TODO-18 literal LOCALHOST ACCEPTED has not been received; release/deployment gates remain open
CURRENT_AUTHORITY_REVIEW = Schedule-policy writes require Parent Administrator session, CSRF, device bearer and Trust Set authorization; production resolver returns NO_TRUST_SET. Web Rules return 503 while production omits the service pending reviewed encrypted storage/delivery. Bonus-grant revocation actor attribution has no safe durable audit path. No plaintext shortcut or session-only bypass is authorized by the existing security contracts.
PARENT_ROUTE_MATRIX = Current-source `parent_api_contract_matrix.json` maps 35/35 Parent Web call paths and inventories 52 route declarations across 43 unique paths; 6 server routes have no matching Parent Web path. Parent Settings exposes backend-tested revoke-all with explicit confirmation and EN/AR copy; local owner-acceptance E2E and exact-head CI pass. This does not close TODO-14 aggregate runtime status counts.
NEXT_ACTION = continue TODO-12/14/15 evidence within the documented security boundaries; keep the Platform hold intact; offer localhost acceptance only when Parent gates are ready
```

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

### 2026-09-27 — authorized checkpoint inventory and pre-commit evidence

```text
CHECKPOINT_MISSION = PCA CURRENT WORKTREE -> LOGICAL COMMITS -> pca-dev REMOTE ALIGNMENT
OWNER_CHECKPOINT_PUSH_AUTHORIZATION = YES (checkpoint sync only)
MISSION_STATUS = IN_PROGRESS
CURRENT_TODO = TODO-12 through TODO-17 (integrated Parent evidence)
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
CURRENT_TODO = TODO-12 through TODO-17 (integrated Parent implementation/evidence)
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

## Canonical TODO board

Every item retains the required status, owner, files, evidence, blocker, and
completion condition. Statuses are not PASS based solely on pre-existing edits.

| TODO | Status | Owner | Files | Evidence | Blocker | Done when |
|---|---|---|---|---|---|---|
| TODO-01 — Preserve and reconcile current multi-session worktree | PASS | Coordinator | All 256 initial dirty paths; exact inventory above | Local and freshly fetched remote both `e9c93a78`; 166 modified, 90 untracked, none staged; authorized Parent/Platform/shared paths retained; API/mobile assessment and `.vscode` paths preserved outside scope | None identified | Legitimate work classified and preserved; no peer work lost |
| TODO-02 — Reconcile `d3759d89` Parent authentication baseline | READY_FOR_INTEGRATION | Coordinator | `backend/src/parentaccount/**`, Parent auth routes, email/outbox, `parent-web/src/pages/auth/**` | Reference source compared; backend build PASS; in-memory auth/email/route campaign 80/80; OTP/TOTP regression 3/3; disposable MySQL campaign 43/43; login notification and session creation covered | Consolidated TODO-17 regression remains | Approved login, verification, notification, session behavior preserved/restored; newer fixes preserved |
| TODO-03 — Verified-email activation | READY_FOR_INTEGRATION | Coordinator | Parent account service/repository/routes and auth UI | In-memory and real-MySQL checks cover activation-only verification, pending-account denial, invalid/replayed/expired code, attempt limit, and no session at verify | Consolidated TODO-17 regression remains | Unverified Parents remain restricted; verified Parents proceed safely; negative cases pass |
| TODO-04 — Atomic Parent family provisioning | READY_FOR_INTEGRATION | Coordinator | Provisioning service/repository, family schema/migrations, MySQL tests | Disposable MySQL first-login asserts exactly one family/admin/scope; 16 concurrent calls observe one family; database uniqueness and cross-account service-identity refusal pass | Consolidated TODO-17 regression remains | Real MySQL proves exactly one family/admin across retry/concurrency, with no cross-account or partial state |
| TODO-05 — First-login trusted-browser creation | READY_FOR_INTEGRATION | Coordinator | Parent login service, MFA/trust persistence, auth client/UI | First successful login issues a hashed-at-rest account-bound grant; real-MySQL first login and unknown-browser completion pass; in-memory end-to-end pass | Consolidated TODO-17/browser regression remains | Required successful login automatically creates account-bound browser trust without a setup ceremony |
| TODO-06 — Three-day TOTP enrollment policy | READY_FOR_INTEGRATION | Coordinator | Parent MFA schema/service/repository/routes and login UI | Server-side grace constant is 72 hours; real-MySQL 12-way start preserves one deadline; expired grace requires setup; local boundary checks pass | Consolidated TODO-17 regression remains | One server-side 72-hour deadline survives logout, other browsers, and cookie clearing |
| TODO-07 — TOTP setup and activation | READY_FOR_INTEGRATION | Coordinator | Parent MFA service/routes/UI, encryption/config, tests | Disposable MySQL verifies sealed secret, recovery hold/session revocation, enrollment ticket single-use, and migration replay; focused setup tests pass | Full Parent browser regression remains | Encrypted pending secret, local QR, rate-limited valid confirmation, secure ACTIVE state |
| TODO-08 — Known-browser login | READY_FOR_INTEGRATION | Coordinator | Parent login service, MFA/trust repository, security email | Real-MySQL and focused tests prove known browser does not require routine TOTP after activation; subsequent login notice is queued | Consolidated TODO-17/browser regression remains | Known browser uses email/password and receives the successful-login notification, including with active TOTP |
| TODO-09 — New/unknown-browser login | READY_FOR_INTEGRATION | Coordinator | Parent login/OTP/TOTP flows and browser trust | Real-MySQL tests prove email OTP + active TOTP, account-bound trust, and one winner under 8 concurrent completions; fixed ordering regression passes 3/3 | Consolidated TODO-17/browser regression remains | Email OTP and enrolled TOTP are enforced as specified before trust and console access |
| TODO-10 — Remove Genesis from Parent authentication/authorization | READY_FOR_INTEGRATION | Coordinator | Parent auth, family authority, routes, UI and tests | Source search found only explanatory comments in Parent backend; no Parent Web Genesis reference; MySQL provisioning creates no family-authority/device rows | Full route/action audit at TODO-14 | No ordinary Parent runtime path needs Genesis, Genesis challenge, or Parent-owner crypto chain |
| TODO-11 — Migrate Trusted Browser away from family authority | PASS | Coordinator | Parent trust/session providers, repositories, routes and UI; Platform family suspension | MySQL-backed test proves family suspension atomically revokes linked Parent sessions, daily-login grants, pending email login challenges, and family-bound sensitive step-up grants; `completeLoginStepUp` rejects suspended families; reactivation requires fresh email verification for the old browser grant; `/security/trusted-browser` redirects away from pairing UI | Cross-browser listing/individual-device management is a nonblocking follow-up; current logout and revoke-all endpoints provide revocation | Trust is automatic, account-bound, revocable/expirable, and login assurance only |
| TODO-12 — Complete normal Parent authority migration | IN_PROGRESS | Coordinator | Parent route/action authority and role checks across backend and web | Source/action matrix reviewed; ordinary family routes use session/family/membership roles; Parent child-request decisions/direct grants/revokes now have a distinct session-only path with 60/60 focused service/HTTP checks; successful bonus-grant revokes retain process-local Parent actor/time metadata (BonusGrantLedger 9/9 and childRequestRoutes 17/17 run separately; build PASS); eye-protection reads and writes use durable async child-profile membership, with route tests 8/8 and current route authority covered by disposable SQL 61/62 before a subsequently corrected Viewer fixture; removal create/PIN/local-decision mutations require active Administrator and operation-scoped single-use TOTP step-up; removal request/session decision actor fields now persist through repository code and migration 0057, omitted from Parent DTOs; unit/route/schema campaign 56/56 and backend build PASS; migration 0057 MySQL persistence test is added but awaiting service; integrated resolver/route tests 26/26 and enrollment binding SQL cases 22/22 pass; schedule-policy still depends on device bearer and unavailable Trust Set authority; web rules are `503 not_configured`; signing/recovery authorities reject | TODO-11; schedule-policy cryptographic/device-authority boundary; web-rule production wiring; DB validation of durable actor attribution; process-local revocation metadata | Normal same-family actions use session + membership + ACTIVE Administrator; browser trust is irrelevant; intended routes have proven production authority wiring |
| TODO-13 — Sensitive-action TOTP step-up | IN_PROGRESS | Coordinator | Step-up schema/service/routes/UI and classified sensitive actions | Ten of twelve declared operations have consumers; device-invitation creation now requires its own `family.device.enrollment.create` grant in the API and Parent wizard, with a check-constraint migration; focused route tests 10/10, enrollment UI/client tests 75/75, full disposable DB suite passes all 54 migrations; `ADD_ADMINISTRATOR` default mapping corrected to `family.member.add` and focused Family Actions test passes 4/4; public step-up issuance rejects reserved ownership-transfer/recovery-material operations (Parent MFA route tests 7/7); removal request, local-PIN decision, and PIN configuration now consume fresh session-bound TOTP grants scoped to the stored/requested operation; Parent removal UI obtains and sends matching tokens and explicitly rejects a missing token for local-PIN decisions; backend build PASS, removal route suite 16/16; last recorded Parent protection-action client test 3/3 and typecheck PASS, but a current typecheck retry could not start due Node process OOM under 143 MB free memory | TODO-12; explicit Owner-authority model and action policy for any future transfer/recovery consumer; current full Parent Web validation remains outstanding | Fresh TOTP gates each classified high-risk mutation; unused operations are removed from runtime issuance or have a real consumer; negative cases pass |
| TODO-14 — Full Parent route/action audit | IN_PROGRESS | Coordinator | Parent routes/pages/actions and authority matrix evidence | Agent-2 source-mapped route/action matrix completed; commercial mutations follow PCA-DEC-030 with active family Administrator plus fresh operation-specific TOTP (the old owner-attestation chain is retired); eye-protection membership gap closed and focused route suite passes 8/8; removal create/PIN/local-decision routes now have active Administrator and TOTP checks; resolver and route tests pass 26/26; enrollment binding SQL passes within 22/22 disposable tests; integrated route/action evidence and aggregate unexpected 401/403 counts still need integrated rerun; unavailable Trust Set/web-rule authority and durable Parent actor provenance remain explicit | TODO-12, TODO-13; schedule-policy cryptographic authority, web-rule production wiring, durable actor attribution | All required surfaces audited; zero unexpected 401/403 or authority/trust/Genesis blocks |
| TODO-15 — Preserve child-device cryptographic security | IN_PROGRESS | Coordinator | Shared backend device routes/services, Parent enrollment clients, focused tests | Pair confirmation correctly requires TOTP; MySQL/current-session identity checks reject revoked devices and suspended families; family suspension/reactivation now advances a durable device-session epoch so old in-memory sessions stay invalid; paired-session seed now supplies `familySessionEpoch: 1` and the 13-test device-session suite passes with a structurally valid record; Parent-auth disposable DB campaign after migration 0056 passed 61/61; full DB suite validates the integrated 54-migration baseline; no safe PAIRED-to-first-policy-to-ACTIVE path exists with current rejecting device verifier and unavailable durable FTS/key-epoch resolver | TODO-12; production crypto/trust/policy bootstrap architecture | Device identity, signatures, replay protection, revocation, first-policy activation, and wrong-device rejection are proven end to end |
| TODO-16 — Identity/profile integration + Platform family identity projection | PASS | Coordinator | Parent identity APIs/UI, migrations, Platform read model/routes/UI and tests | Family-scoped projection source and exact four-field DTO are reviewed; Parent identity/UI tests 15/15 and backend identity/projection routes 11/11 pass; disposable MySQL 61/61 includes provisioning precedence, zero-admin fail-closed, nullable phone, and two-family isolation | TODO-04, TODO-12; broader authority audit remains open in TODO-12…15 | Required names + email and nullable phone work; Platform projection is minimal, family-scoped, authorized and fail-closed on zero/multiple candidates |
| TODO-17 — Full MySQL/security/browser regression | IN_PROGRESS | Coordinator | Backend, Parent Web, Platform tests and E2E | Parent Web serial Vitest 151/151 files and 1065/1065 tests PASS; Parent-auth MySQL 61/61; historical full disposable backend DB 612/612 on 54 migrations; latest full disposable DB rerun FAILED overall with `Deriving bits failed`/Platform authentication failures under resource pressure; focused enrollment binding DB 22/22 PASS; eye-protection route unit suite 8/8 PASS and disposable authority diagnostics 61/62 before the corrected Viewer fixture, whose MySQL rerun is blocked by stopped Docker/MySQL; focused migration/artifact/iOS/Safe Zone/audit checks 33/33; full backend `npm test` 2648/2648 historical PASS and later registered-file run 272/272 PASS; production-path certification analyzer 8/8; browser Parent MFA and optional setup each 1/1; broader mobile/browser/owner evidence remains distinct and pending | TODO-02…TODO-16; repeat full disposable DB after service/resource recovery; browser/mobile/owner integration | Required local build/typecheck/MySQL/security/browser evidence is green without skips; outstanding device/authority boundaries are resolved or explicitly fail-safe for owner acceptance |
| TODO-18 — Owner localhost acceptance | TODO | Owner + coordinator | Local Parent/API journey and acceptance evidence | Not offered; implementation is not yet ready | TODO-17 | Owner manually validates the full required journey and replies literal `LOCALHOST ACCEPTED` |
| TODO-19 — Git reconciliation + exact-head CI | IN_PROGRESS | Coordinator | Approved Parent + Platform source/tests/migrations/docs | Checkpoint-sync exception pushed eight logical commits to `origin/pca-dev` at `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`; local=remote and representative source verified; exact-head Quality Gates run 36337455750 is queued | Monitor exact-head CI; final TODO-19 release/acceptance sequencing remains gated by TODO-18 literal owner acceptance and Platform validation | Local = remote = exact CI head; complete approved Parent and Platform state is remote; unrelated paths excluded |
| TODO-20 — Live schema / DB grants reconciliation | TODO | Coordinator | Repository schema/migrations, local PCA DB, live `pca_pro` | Read-only source audit found and locally corrected 0055 step-up CHECK snapshot, stale schema.ts header, and altered-migration metadata; canonicalSchemaDrift suite passes 5/5; local/live DB schema and grants remain uninspected | TODO-19 exact-head CI; credentials/access and live preflight | Repository/local/live schema and grants match, with local-first tested migration if required, no seed data |
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
