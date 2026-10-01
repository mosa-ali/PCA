# PCA Parent Authentication + Authority — Continuous Pursuing Goal

This is the live mission history. The canonical TODO-01…TODO-23 status board is
maintained in `docs/pca_independent_senior_reviewer/PARENT_CODEX_MASTER_TODO.md`;
continue the same mission there and do not reset it or create a disconnected goal. This current
checkpoint was refreshed after exact-head run 36806878236 at 8ab308c6dfa2753255acb4a950e1de9a18ffe770. The run failed only in Parent real-backend E2E with an empty reset email on the direct-ref version; all other jobs passed. Current named-form query and privacy-safe pre-submit diagnostics pass local typecheck and disposable browser, pending publication/CI.

## Current checkpoint

```text
PURSUING_GOAL = PCA PARENT AUTHENTICATION + AUTHORITY — CONTINUOUS COMPLETION
OWNER = Codex coordinates and implements the continuing Parent mission after the DeepSeek handover
CURRENT_TODO = TODO-12, TODO-14, TODO-15, TODO-17, TODO-19, TODO-20 and owner-gated TODO-18; TODO-21/22/23 pending; TODO-01…11/13/16 PASS
MISSION_STATUS = IN_PROGRESS (DeepSeek implementation stopped by owner; Codex handover checkpoint)

BRANCH = pca-dev
REMOTE = origin (TARGET_DEV_BRANCH = pca-dev)
LAST_VERIFIED_REMOTE_SHA = Direct-ref checkpoint 8ab308c6dfa2753255acb4a950e1de9a18ffe770 is on origin/pca-dev; local and origin were equal after fetch. Run 36806878236 completed FAILURE only in Parent real-backend E2E with empty email; all other jobs passed. Current form-query diagnostic awaits publication.
CURRENT_LOCAL_CHECKPOINT_SHA = 8ab308c6dfa2753255acb4a950e1de9a18ffe770 plus uncommitted form-query implementation, pre-submit diagnostic, and ledger update.
LAST_EXACT_HEAD_CI = Quality Gates run 36806878236 at 8ab308c6dfa2753255acb4a950e1de9a18ffe770 completed FAILURE only in Parent real-backend E2E: POST email remained empty (length 0), safe error invalid_request, on the direct-ref version. All other jobs passed. Current form-query implementation and pre-submit diagnostics pass local typecheck/browser 4/4 and await publication/exact-head CI.
CURRENT_REPOSITORY_MIGRATION_HEAD = 0061 (59 migration files; additive Parent password-failure window/count/lock-until fields)
LIVE_PCA_PRO_MIGRATION_HEAD = 0059 on verified pca-mysql.mysql.database.azure.com / pca_pro (MySQL 8.4.9-azure)
CURRENT_REPO_LIVE_PARITY = NO (repository head 0061; owner-UAT was last verified at 0060; live pca_pro was last verified at 0059. This policy checkpoint made no live SQL query or mutation.)
PARENT_FORMAL_STATUS = IN_PROGRESS (13 PASS / 6 IN_PROGRESS: TODO-12/14/15/17/19/20 / 4 TODO: TODO-18/21/22/23)
PLATFORM_STATUS = HOLD_PARENT_DEPENDENCY
LOCALHOST_UAT_STATUS = Literal owner LOCALHOST ACCEPTED remains NOT GIVEN. The official real-browser/DB harness created and removed random disposable schemas through the configured local MySQL endpoint; the owner-UAT schema was not mutated. Local technical test evidence is not human acceptance.
AZURE_STATUS = HOLD
CURRENT_ACTIVE_TODOS = TODO-12 first-device Trust Set root protocol and encrypted audit/policy dependencies; TODO-14 has 45/52 database-integrated declarations across 137 scenarios with seven gated/optional; TODO-15 device lifecycle/security; TODO-17 and TODO-19 exact-head CI and publication evidence; TODO-20 live repo/schema/grant reconciliation; owner-gated TODO-18; TODO-21/22/23 pending.
CURRENT_ENGINEERING_CRITICAL_PATH = The registry-backed child-profile membership dependency is implemented in `59bfc331` and covered by exact-head Quality Gates run 36763771064. TODO-15 source/device-security review found no safe activation change. The next Trust Set/device step depends on an owner/security-approved first-device root and crypto/key-custody protocol: epoch-1 acceptance needs a durable genesis anchor, while PCA-DEC-037 provisioning intentionally creates no device/genesis-anchor/authority-chain rows (`backend/test/db/parentAccount.mysql.test.mjs:337-339`). Do not infer a signer/root from Parent account or TOTP. TODO-14 has 45/52 database-integrated routes; the seven remaining dispositions are schedule-policy Trust Set, Web Rules service/storage, signed/recovery decision crypto, and optional dashboard. No gate may be activated to inflate coverage.
CURRENT_OWNER_GATES = Owner/security protocol for first-device Trust Set root in newly TOTP-provisioned families (required before ingestion/device activation); TODO-18 literal `LOCALHOST ACCEPTED` after local MySQL/UAT health is restored; TODO-21/22 deployment + production acceptance; release authorization
CURRENT_EXTERNAL_GATES = E2EE/crypto human security review; device attestation review; Azure deployment authorization; Platform activation gate
CURRENT_SECURITY_GATES = Trust Set acceptance writer unwired (no production ingestion; no bootstrap anchor path for new TOTP-provisioned families; store-backed resolver answers NO_TRUST_SET only); one shared async registry-backed child-profile membership resolver serves Parent action authorization, Parent-session child-request decisions/grants and child-request routes and is covered by Quality Gates run 36763771064; webRuleService absent (503); RejectingDeviceSignatureVerifier; PAIRED-to-ACTIVE has no writer; no security downgrade permitted
CURRENT_LOCAL_UAT_ENVIRONMENT = Owner-UAT pca_local_owner_uat was last verified at schema 0060. The official test harness used configured local MySQL 8.4.11 only for random pca_test_codex schemas, applied 59 migrations, ran DB/browser suites, and removed each schema. No owner-UAT schema data was modified. Literal owner acceptance is pending; live pca_pro was not queried or changed.
NEXT_CODEX_ACTION = Publish the named-form query and privacy-safe pre-submit diagnostics with the ledgers, then use exact-head CI to inspect the request/form mismatch. Continue Parent work within approved boundaries; Platform stays HOLD_PARENT_DEPENDENCY. No live DB, Azure/deployment, or owner acceptance is authorized by this recovery-policy task.
APPROVED_PARENT_ARCHITECTURE = PARENT IDENTITY = verified email; PARENT PRIMARY AUTHENTICATION = email + password; FIRST-LOGIN ACTIVATION = safe family provisioning; PARENT MFA = TOTP enrolled within 3 days; KNOWN-BROWSER LOGIN = email + password; NEW-BROWSER LOGIN = email + password + email OTP + TOTP if already enrolled; BROWSER TRUST = account-bound login assurance only; PARENT AUTHORIZATION = family membership + ACTIVE Administrator role; SENSITIVE ACTION = fresh operation-scoped TOTP step-up; CHILD DEVICE SECURITY = separate device cryptography
PROHIBITIONS = NO Genesis Parent authority; NO browser-trust family authority; NO fake device ACTIVE state; NO unsigned Trust Set acceptance; NO plaintext E2EE-required policy storage; NO security downgrade to make UAT pass
LOCAL_REMOTE_EQUAL = YES; local HEAD, tracking ref, and server all equal `c3c8c5874679e0286d8872e04c23941b7e330c5a`; exact-head CI is run 36761102745 SUCCESS 27/27
PEER_WORK_PRESERVED = YES (historical; all date-bound assessment files committed separately; unrelated/mobile source untouched)

PARENT_IMPLEMENTATION_PATHS = Codex owns the authorized Parent + dependent Platform implementation after the handover; no DeepSeek implementation remains uncommitted
SHARED_PATHS = backend, database bootstrap, and cross-surface tests; one active writer per file, shared edits serialized
OUT_OF_SCOPE_DIRTY_PATHS = `.vscode/` and root fragment `0` only; preserved and excluded
MISSION_LEDGER = docs/PCA_PARENT_AUTHORITY_CONTINUOUS_GOAL.md
CODE_CHANGES_BY_LATEST_WAVES = Wave 5A `6cefdf1e` (migration 0060 + durable trust-set stores; 13 modified + 9 new files); Wave 5B `91f7f6d4` (verified trust-set acceptance + fail-closed store-backed role-resolver activation; 23 files). Both certified: runs 36505757047 and 36519047489 SUCCESS 27/27.
BROWSER_EVIDENCE = Exact-head run `36648259414` at `785323d2` passed all 27 jobs, including Android and real-backend browser E2E. Global route/action aggregates remain NOT_YET_PROVEN.
BROADER_REGRESSION = Wave-5B historical evidence: backend unit suite 2734/2734; disposable MySQL full lane inner 666 pass / 0 fail / 8 pre-existing skips; certified production paths 273/273; both PCA-SEC020 mutation negative controls KILLED. Current local Wave-5C focused suites passed as recorded below. Exact-head run `36753042327` passed 27/27, including full disposable MySQL, Parent MFA browser, mobile, backend, security, and web gates. TODO-17 is PASS at the certified checkpoint.
UNRELATED_FILES_TOUCHED = 0

REMOTE_ALIGNMENT_AUTHORIZED = YES (continuation of the existing synchronization amendment; origin / pca-dev)
REMOTE_ALIGNMENT_COMPLETED = YES at `e1f8b218`; fetch and `git ls-remote` agree with local and tracking refs.
PARENT_LOCAL_ONLY_FILES_REMAINING = Three mission ledgers now record the iOS retry result for run 36754475958 and the local TODO-20 migration/schema/grant validation. No source files changed; `.vscode/`, root fragment `0`, and downloaded ignored CI diagnostics remain excluded.
PARENT_UNPUSHED_COMMITS_REMAINING = 0 at tested checkpoint. Only unrelated `.vscode/` and root `0` are untracked.

REPO_SCHEMA_HEAD = canonical source/migrations through 0060 (94 tables; 58 migration files; 0009 and 0010 absent from repository history)
REPO_MIGRATION_HEAD = 0060 (58 SQL migration files)
LOCAL_SCHEMA_HEAD = 0060 on the local owner-UAT database `pca_local_owner_uat` (all 58 migrations applied from empty; 94 tables / 806 columns)
LIVE_PCA_PRO_SCHEMA_HEAD = 0059 on verified pca-mysql.mysql.database.azure.com / pca_pro (MySQL 8.4.9-azure; 92 tables / 792 columns)
SOURCE_SCHEMA_MATCH = EXACT_MATCH on all 92 shared tables by full introspection comparison (local 0060 vs live 0059); the only difference is the two additive 0060 tables, intentionally local-only
LOCAL_DB_SCHEMA_MATCH = PASS; local UAT database verified by `verify-mysql.mjs` (environment + 94-table schema + collations)
LIVE_PCA_PRO_SCHEMA_MATCH = PASS through 0059; zero column differences on shared tables (type/nullability/default/extra/charset/collation)
LIVE_GRANTS_MATCH = Last verified PASS through 0059 (92/92 at that schema level); 0060 runtime grants are not yet reconciled
MIGRATION_REQUIRED = YES for live when authorized: repository head 0060 vs live 0059; 0060 is additive and touches no existing table
MIGRATION_FILE = 0060_family_trust_set_epoch_persistence.sql (repository/local only; NOT applied to any live database)
LOCAL_MIGRATION_TEST = PASS; all 58 migrations applied from zero on guarded local disposable MySQL 8.4.11; child-profile registry DB suite 10/10 passed; UUID-owned database removed
LIVE_MIGRATION_APPLIED = 0059 is the last verified live application (journal 56→57); current endpoint preflight to TCP/3306 is unreachable; 0060 has not been applied
LIVE_MIGRATION_RESULT = Previous 0059 application passed and remains historical evidence; TODO-20 owner authorization to reconcile/apply ordinary locally tested additive corrections persists; no live mutation until fresh reachable preflight
NO_SEED_DATA = YES
DATA_LOSS = 0

CURRENT_P0 = pending re-review; prior assessment reported none
CURRENT_P1 = No production-code regression is proven. Exact-head run 36754475958 is recorded green after the iOS-only retry; local 0060 schema, route-audit, runtime-grant, and Trust Set DB validations now pass. Authority/device/owner gates remain open, including PCA-DEC-035 policy enablement requirements.
BLOCKERS = First-device/root-of-trust ceremony remains undefined; do not wire Trust Set ingestion or device activation without the owner/security protocol. Web Rules remain 503 pending reviewed encrypted storage/delivery; device attestation and PAIRED-to-ACTIVE crypto/trust wiring remain open; FamilyAudit actor kinds remain conflated pending explicit actor model and reviewed encrypted delivery; four Administrator-configurable policy operations remain `ALLOW_WITH_STEP_UP` pending signed E2EE DEC-034/035; ownership-transfer/recovery-material operations have no consumers; TODO-14 has seven gated/optional declarations and aggregate remains NOT_YET_PROVEN; live `pca_pro` remains last verified at 0059 because TCP/3306 is unreachable; TODO-18 literal LOCALHOST ACCEPTED and deployment/production owner gates remain pending.
CURRENT_AUTHORITY_REVIEW = Trust-set lane: durable signed-epoch store + cryptographic acceptance foundation DONE and locally revalidated on MySQL 8.4.11; accepted population remains EMPTY. The acceptance service requires a genesis anchor; PCA-DEC-037 first-login provisioning deliberately creates none. Membership lane: one async registry-backed resolver is published and exact-head CI-covered. Production has no Trust Set acceptance caller, Web Rules service remains absent, FamilyAudit actor provenance/encrypted delivery and DEC-034/035 policy writer remain unimplemented; PCA-DEC-028 keeps policy/request content E2EE-only and BonusGrantLedger process-local.
PARENT_ROUTE_MATRIX = Current-source matrix maps 35/35 Parent Web call paths; 52 method/path declarations across 43 unique paths; 45/52 declarations carry database-backed integrated evidence across 137 scenarios, with zero unexpected 401/403/other. Seven remain gated/optional; `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`.
NEXT_ACTION = Retry TODO-20 read-only live preflight when 3306 becomes reachable; apply migration 0060 and reconcile grants only after fresh local/live comparison. Continue TODO-12/15 only within owner-approved security boundaries; preserve Platform `HOLD_PARENT_DEPENDENCY`, do not deploy, and keep localhost acceptance as the owner's decision.
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
| TODO-20 — Live schema / DB grants reconciliation | IN_PROGRESS | Coordinator | Repository schema/migrations, local disposable MySQL, live `pca_pro`, runtime grants | Prior exact live reconciliation through 0059 remains valid historical evidence. Repository/local now reach 0060; all 58 migrations and child-profile registry MySQL 10/10 pass locally with run-owned DB cleanup. Fresh live endpoint DNS resolved, but TCP/3306 preflight failed; Azure CLI session inspection was blocked by managed `.azure` write permissions. No live mutation occurred; current parity is NO and grant parity for 0060 is unproven. | Reachable authorized live connection context for fresh read-only preflight; then apply only locally tested additive/corrective DDL and reconcile grants per the existing owner authorization | Repository/local/live schema and grants match, required migrations tested locally and live-applied only after fresh preflight, no seed data, DATA_LOSS=0 |
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

## CODEX RESTART CHECKPOINT

RESTART_BRANCH = pca-dev
RESTART_SHA = a8c37162ed6ec135b618a3942c4766bac3b8f508 (local, tracking ref and fresh `git ls-remote` server ref agree; local Wave 5C diff is uncommitted)
LAST_CERTIFIED_CI = 36634164993 SUCCESS 27/27 at `a8c37162`; current Wave 5C diff is not covered
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
