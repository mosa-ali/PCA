# PCA Platform Web — Codex Master TODO

## Mission

PURSUING_GOAL = Complete the Parent-dependent Platform Enrollment integration and combined PCA release without duplicating Parent identity authority  
BRANCH = pca-dev  
MISSION_STATUS = IN_PROGRESS (Platform Enrollment work package is held)  
LAST_UPDATED_UTC = 2026-09-27 23:27 UTC
LOCAL_HEAD = 578dc0bbfcb050b8289adf7f10cbf1002c3082a2
REMOTE_HEAD = 578dc0bbfcb050b8289adf7f10cbf1002c3082a2 (fresh fetch and GitHub ref match)
CURRENT_CHECKPOINT_SHA = fbba783d5e5c3b2fe8c0f98ef02d3f8abc1eab29 (Parent source; verified ledger publication `578dc0bb`)
COORDINATOR = Current Codex agent  
PLATFORM_ACTIVATION_GATE = HOLD_PARENT_DEPENDENCY until Parent TODO-01…17 PASS, Parent projection PASS, TODO-18 PASS, and literal `LOCALHOST ACCEPTED=YES`  
CURRENT_ACTIVE_PLATFORM_TODO = PLATFORM-03…PLATFORM-05 remain blocked at the dependent Enrollment UI gate  
NEXT_ACTION = Keep dependent Platform activation held through Parent TODO-18, TODO-20 final exact-head CI and live 0059 schema/grant verification, and literal localhost acceptance. Parent Quality Gates run `36358762949` is PENDING at `578dc0bb`; require a pass on the final ledger-sync head before live work.

This base follows the pushed Parent/Platform source checkpoint `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`, canonical-ledger sync `114b784ea33112cb3bebd64b454866481d8b3ba3`, master TODO publication `27757ca77e0edec417516784dc3e59da6855896e`, publication-state sync `8f3f45b47d24cc7debd581230eda23c088d74f4e`, corrective checkpoint `0ba4c0d8c5631283267c0af2a8dc6046bd4c0552`, ledger sync `47d564c4af1fd6535dd1c9211cbf9c06a46970fb`, corrective CI-fixture checkpoint `1949ead054ae93b30fbd7c69dd4e41649b50bdbc`, ledger sync `0daf66008a801e5006c16130ae9f1adb052bd1f4`, daily browser-grant correction `a76aacae1710a7ff2fdc37788b0a291b3220decd`, prior ledger sync `9c50e8efd7f18c18d7e16ec0ef6697fb88026064`, and local MFA step-up correction `f51fe3dff3da62c045d1f8fd9d9a81be02efb2a7`. Exact-head run `36351171969` failed only real-backend browser E2E; 26 jobs passed. The MFA step-up follow-up is committed locally and awaits exact-head CI.

### 2026-09-27 20:58 UTC — Parent corrective checkpoint pushed

PARENT_CHECKPOINT = `1949ead054ae93b30fbd7c69dd4e41649b50bdbc` pushed fast-forward and verified by fetch plus remote branch SHA. Both ledgers were updated with the current checkpoint and queued exact-head Quality Gates run `36349986015`.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Monitor Parent CI and maintain the dependency hold until Parent activation gates, projection, TODO-18, and literal localhost acceptance pass.

## Parent Dependency

PARENT_PROJECTION_REQUIRED = YES  
PARENT_PROJECTION_SCOPE = FAMILY  
PARENT_PROJECTION_FIELDS = Name; Email; Phone (nullable)  
PARENT_IDENTITY_LOGIC_DUPLICATED_IN_PLATFORM = 0 in the current projection consumer  

Approved legacy-family policy:

1. Explicit provisioned Parent → authoritative.
2. Otherwise exactly one ACTIVE Administrator → authoritative legacy Parent.
3. Otherwise ambiguous/unavailable → fail closed.

AGENT-6_STATUS = HOLD_PARENT_DEPENDENCY (no inspection/write in this checkpoint)  
AGENT-7_STATUS = HOLD_PARENT_DEPENDENCY (no inspection/test/Git/Azure activity in this checkpoint)

## Platform Canonical Work Package

### PLATFORM-01 — Reconcile latest pca-dev baseline

STATUS = PASS  
OWNER = Coordinator  
FILES = `docs/PCA_PARENT_AUTHORITY_CONTINUOUS_GOAL.md`, checkpoint Git inventory  
EVIDENCE = Fresh fetch proves branch `pca-dev`, local=remote at `114b784e`; eight logical commits and their source/peer paths are on origin.  
BLOCKER = None for this checkpoint baseline.  
DONE_WHEN = latest Parent-complete remote state safely reconciled

### PLATFORM-02 — Consume Parent family identity projection

STATUS = PASS  
OWNER = Coordinator; Platform specialist integration remains held  
FILES = `backend/src/platformadmin/readmodels/ParentIdentityReadModel.ts`, `backend/src/http/routes/platformadmin/accountsRoutes.ts`, `platform-admin-web/src/pages/accounts/AccountDetail.tsx`  
EVIDENCE = Existing Platform Account Detail calls the Parent-owned family-scoped projection; exact whitelist is First Name, Last Name, Email, nullable Phone. Prior backend projection/route 11/11 and MySQL 61/61 evidence is recorded in the Parent ledger; exact source is verified at the current remote head.  
BLOCKER = Enrollment-specific integration is separately held by the Parent gate.  
DONE_WHEN = Platform consumes Parent-owned family projection without duplicating identity logic

### PLATFORM-03 — Add Enrollment Name column

STATUS = BLOCKED  
OWNER = Agent 6 + coordinator after activation  
FILES = Platform Enrollment directory/UI to be scoped after gate  
EVIDENCE = Not implemented or validated in the dependent Enrollment UI work package. Existing Account Detail projection is not evidence that Enrollment displays Name.  
BLOCKER = HOLD_PARENT_DEPENDENCY: Parent TODO-18 and literal `LOCALHOST ACCEPTED=YES` are not complete.  
DONE_WHEN = authorized canonical Parent Name displays correctly

### PLATFORM-04 — Add Enrollment Email column

STATUS = BLOCKED  
OWNER = Agent 6 + coordinator after activation  
FILES = Platform Enrollment directory/UI to be scoped after gate  
EVIDENCE = Not implemented or validated in the dependent Enrollment UI work package.  
BLOCKER = HOLD_PARENT_DEPENDENCY.  
DONE_WHEN = authorized canonical Parent Email displays correctly

### PLATFORM-05 — Add Enrollment Phone column

STATUS = BLOCKED  
OWNER = Agent 6 + coordinator after activation  
FILES = Platform Enrollment directory/UI to be scoped after gate  
EVIDENCE = Parent projection supports nullable phone; the dependent Enrollment column and NULL UI state are not implemented/validated.  
BLOCKER = HOLD_PARENT_DEPENDENCY.  
DONE_WHEN = authorized Phone displays correctly and NULL is handled safely

### PLATFORM-06 — Preserve RBAC and privacy

STATUS = PASS (current projection scope)  
OWNER = Coordinator  
FILES = Platform route RBAC/read model, Parent projection DTO, Platform role policy and tests  
EVIDENCE = VIEW_PARENT_IDENTITY precedes lookup; route is no-store and exact-field whitelist; prior role/route/two-family tests passed. Current source is committed and remote-verified.  
BLOCKER = Repeat full Enrollment acceptance suite after activation.  
DONE_WHEN = no cross-family disclosure; unauthorized identity denied; no extra PII or commercial fields  
CROSS_FAMILY_DISCLOSURE = 0 in current source/previous two-family test  
UNAUTHORIZED_IDENTITY_ACCESS = 0 in current projection route test evidence  
EXTRA_PII_OR_COMMERCIAL_FIELDS = 0

### PLATFORM-07 — Do not duplicate Parent identity logic

STATUS = PASS  
OWNER = Coordinator  
FILES = Parent projection read model and Platform Account Detail consumer  
EVIDENCE = Current Platform consumer calls family-scoped Parent projection; no separate canonical Parent selector was added in Platform.  
BLOCKER = Recheck during Enrollment integration review.  
DONE_WHEN = Platform contains no forked canonical Parent-selection logic

### PLATFORM-08 — Focused Enrollment tests

STATUS = BLOCKED  
OWNER = Agent 5 + Agent 6 after activation  
FILES = Future Platform Enrollment component/client tests and backend projection tests  
EVIDENCE = Parent projection tests exist; Enrollment Name/Email/Phone UI cases are not yet supplied.  
BLOCKER = HOLD_PARENT_DEPENDENCY.  
DONE_WHEN = Name, Email, nullable Phone, legacy single-admin, zero-admin, multi-admin ambiguity, cross-family rejection and unauthorized rejection all PASS

### PLATFORM-09 — Full Platform suite

STATUS = BLOCKED  
OWNER = Agent 7 + coordinator after activation  
FILES = `platform-admin-web` full automated suite and backend Platform integration suite  
EVIDENCE = No full Platform suite run in this checkpoint.  
BLOCKER = HOLD_PARENT_DEPENDENCY.  
DONE_WHEN = required Platform automated suite PASS

### PLATFORM-10 — Typecheck / lint / build

STATUS = IN_PROGRESS  
OWNER = Agent 7 + coordinator after activation  
FILES = `platform-admin-web/**`  
EVIDENCE = Platform Web typecheck PASS in this checkpoint. Lint and production build are NOT RUN for the new/combined Enrollment package.  
BLOCKER = Complete remaining checks after activation and integration.  
DONE_WHEN = typecheck, lint and build all PASS  
TYPECHECK = PASS  
LINT = NOT RUN  
BUILD = NOT RUN

### PLATFORM-11 — Clean-snapshot validation

STATUS = BLOCKED  
OWNER = Agent 7 + coordinator after activation  
FILES = Platform/Parent clean checkout and test/build inputs  
EVIDENCE = No clean-snapshot validation in this checkpoint.  
BLOCKER = HOLD_PARENT_DEPENDENCY and exact-head CI pending.  
DONE_WHEN = Platform/Parent integration reproduces from approved repository state

### PLATFORM-12 — Commit Platform-owned changes

STATUS = PASS (existing checkpoint-owned work)  
OWNER = Coordinator  
FILES = `platform-admin-web/**`; `backend/src/platformadmin/**`; projection routes/tests  
EVIDENCE = Existing Platform Web/backend paths were staged by exact-path groups and committed (`24603231`, `2fde86de`) with unrelated files excluded; pushed to `pca-dev`. Future Enrollment changes still require their own commit.  
BLOCKER = None for the already implemented projection/directory changes.  
DONE_WHEN = intended Platform files committed with unrelated files = 0

### PLATFORM-13 — Push / exact-head CI

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Current Parent + Platform checkpoint source and CI  
EVIDENCE = Ledger-sync checkpoint `47d564c4` is pushed and local/remote aligned; exact-head Quality Gates run `36348596733` failed. Parent corrections are underway. Previous run `36338197362` failed; Platform Enrollment changes are still held.  
BLOCKER = Fresh exact-head CI and Parent owner gates remain pending; Platform Enrollment changes are still held.  
DONE_WHEN = local=remote and exact-head CI PASS

### PLATFORM-14 — Refresh rollback baseline

STATUS = TODO  
OWNER = Coordinator + owner  
FILES = API, Parent Web, Platform Web running revisions  
EVIDENCE = Not captured for a combined deployment; no deployment attempted.  
BLOCKER = TODO-19/20 and release authorization.  
DONE_WHEN = pre-deployment API/Parent/Platform revisions captured and current

### PLATFORM-15 — Azure deploy + production smoke

STATUS = TODO  
OWNER = Coordinator + owner  
FILES = Approved API/backend, Parent Web and Platform Web artifacts  
EVIDENCE = No Azure deployment or production smoke was run or authorized by this checkpoint.  
BLOCKER = Exact CI, schema/grants, rollback baseline, Parent acceptance and deployment gate.  
DONE_WHEN = API, Parent Web and Platform Web deployed; running revisions verified; production smoke PASS

### PLATFORM-16 — Owner UAT / Platform closure

STATUS = TODO  
OWNER = OWNER + COORDINATOR  
FILES = N/A until owner UAT offer  
EVIDENCE = Not offered; no owner acceptance received.  
BLOCKER = PLATFORM-03…15 and Parent owner/release gates.  
DONE_WHEN = Enrollment Name/Email/Phone, RBAC/privacy, no duplicated identity logic and owner Platform UAT are accepted; Platform package CLOSED

## Integration Evidence

PARENT_PROJECTION_READY = PASS (source review; prior backend routes 11/11 and MySQL 61/61)  
PARENT_PROJECTION_FIELDS = Name, Email, nullable Phone  
PARENT_IDENTITY_LOGIC_DUPLICATED_IN_PLATFORM = 0  
ENROLLMENT_NAME = NOT IMPLEMENTED / BLOCKED  
ENROLLMENT_EMAIL = NOT IMPLEMENTED / BLOCKED  
ENROLLMENT_PHONE = NOT IMPLEMENTED / BLOCKED  
CROSS_FAMILY_DISCLOSURE = 0 in current projection source/test evidence  
UNAUTHORIZED_IDENTITY_ACCESS = 0 in current projection source/test evidence  
EXTRA_PII_OR_COMMERCIAL_FIELDS = 0  
ENROLLMENT_FOCUSED_TESTS = BLOCKED (not implemented)  
PLATFORM_SUITE = NOT RUN  
PLATFORM_TYPECHECK = PASS  
PLATFORM_LINT = NOT RUN  
PLATFORM_BUILD = NOT RUN  
CLEAN_SNAPSHOT = NOT RUN

## Git

LOCAL_HEAD = 47d564c4af1fd6535dd1c9211cbf9c06a46970fb  
REMOTE_HEAD = 47d564c4af1fd6535dd1c9211cbf9c06a46970fb  
LOCAL_REMOTE_EQUAL = YES (fresh fetch)  
PLATFORM_FILES_CHANGED = 0 uncommitted Platform paths; the two current Platform commits are pushed  
PLATFORM_LOCAL_ONLY_FILES_REMAINING = 0 for existing scope  
PLATFORM_UNPUSHED_COMMITS_REMAINING = 0  
PLATFORM_COMMIT = `24603231`, `2fde86de` in checkpoint; additional backend projection is included in the integrated Parent backend commit  
EXACT_HEAD_CI = FAILED (`36348596733` at `47d564c4`); previous run `36338197362` FAILED at `8f3f45b4`; run `36348261937` was cancelled by superseding push

## Rollback Baseline

PRE_DEPLOY_PRODUCTION_SHA = NOT CAPTURED  
PRE_DEPLOY_API_REVISION = NOT CAPTURED  
PRE_DEPLOY_PARENT_WEB_REVISION = NOT CAPTURED  
PRE_DEPLOY_PLATFORM_WEB_REVISION = NOT CAPTURED  
ROLLBACK_BASELINE_CAPTURED = NO

## Azure

API_DEPLOYMENT = NOT STARTED  
PARENT_WEB_DEPLOYMENT = NOT STARTED  
PLATFORM_WEB_DEPLOYMENT = NOT STARTED  
API_RUNNING_REVISION_VERIFIED = NO  
PARENT_WEB_RUNNING_REVISION_VERIFIED = NO  
PLATFORM_WEB_RUNNING_REVISION_VERIFIED = NO  
PRODUCTION_SMOKE = NOT RUN

## Owner Gate

OWNER_PLATFORM_UAT = NOT OFFERED  
PLATFORM_WORK_PACKAGE_STATUS = HOLD_PARENT_DEPENDENCY

## Risks and Next Action

CURRENT_P0 = NOT_YET_PROVEN (fresh severity re-review not complete)  
CURRENT_P1 = NOT_YET_PROVEN (revalidate pre-production reports before release)  
CURRENT_P2 = Enrollment Name/Email/Phone remains unimplemented; exact-head CI pending; MySQL 8.4 validation unavailable (local MySQL 9.7 only); dependent Platform work remains held.  
BLOCKERS = Parent TODO-17 integration; TODO-18 literal owner localhost acceptance; current exact-head CI; MySQL 8.4 and live database target; schema/grant reconciliation; existing device crypto/trust gates.  
NEXT_ACTION = Monitor run 36348261937 for SHA 0ba4c0d8. Do not activate Agents 6/7 until the Parent gate is satisfied. Once activated, implement Enrollment projection consumption and columns, then focused/full tests, lint/build, clean snapshot and exact-head CI.

## Checkpoint History

### 2026-09-27 17:37 UTC — Parent/Platform remote checkpoint

LOCAL_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3  
REMOTE_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3  
PLATFORM_TODO_CHANGES = PLATFORM-01 PASS; existing projection tasks 02/06/07 and commit task 12 PASS; dependent Enrollment tasks remain held; CI task 13 in progress.  
FILES_CHANGED = Eight logical commits include existing Platform projection/UI and assessment snapshots; no Agent-6/7 writes.  
TESTS = Platform typecheck PASS; prior projection route/UI/DB evidence retained as historical; current full Platform suite not run.  
BLOCKERS = HOLD_PARENT_DEPENDENCY; exact-head CI pending; no Enrollment columns, Azure deployment or owner UAT.  
DECISIONS = Parent owns identity projection; Platform reads it; no duplicate identity selector; no deployment.  
NEXT_ACTION = Maintain the hold until the literal Parent localhost acceptance gate.

### 2026-09-27 19:49 UTC — Parent CI and fixture checkpoint

LOCAL_HEAD = `8f3f45b47d24cc7debd581230eda23c088d74f4e`; Parent/Platform changes remain local and uncommitted  
PARENT_CI = Quality Gates `36338197362` FAILED at `8f3f45b4`; a new exact-head run is required. GitHub is unreachable through the current configured proxy.  
FILES_CHANGED = Parent corrected the real-backend E2E job to create a random run-owned disposable database and private temporary manifest. Platform Enrollment remains held; no Platform product source changed.  
TESTS = Workflow YAML parse PASS; Parent migration recovery tests 8/8 PASS.  
DECISIONS = Do not start dependent Enrollment or misstate Parent release readiness based on static workflow parsing.  
NEXT_ACTION = Maintain HOLD_PARENT_DEPENDENCY until Parent CI, TODO-17, and literal localhost acceptance gates are complete.

### 2026-09-27 20:01 UTC — Parent TODO-20 local schema checkpoint

LOCAL_HEAD = `8f3f45b47d24cc7debd581230eda23c088d74f4e`; worktree changes remain uncommitted  
PARENT_DB = Disposable MySQL 9.7 applied migrations through 0058; local index/schema count reconciliation is partial pending MySQL 8.4 validation. No Platform database or source was touched.  
PARENT_CI = Exact-head Quality Gates `36338197362` FAILED at `8f3f45b4`; GitHub is unreachable through current proxy.  
PLATFORM = HOLD_PARENT_DEPENDENCY remains unchanged; no Enrollment columns, Azure deploy or owner UAT.  
NEXT_ACTION = Maintain the hold until Parent exact-head CI, TODO-17, and literal localhost acceptance gates are complete.

### 2026-09-27 20:05 UTC — Parent local grant validation

PARENT_DB = Local disposable MySQL 9.7 runtime grant plan matched all 92 table grants; zero broad/elevated grants. Live grants and `pca_pro` remain uninspected.  
PARENT_CI = Exact-head Quality Gates `36338197362` FAILED at `8f3f45b4`; GitHub is unreachable through the configured proxy.  
PLATFORM = HOLD_PARENT_DEPENDENCY remains unchanged; no Platform source, database, Azure or owner UAT changed.  
NEXT_ACTION = Maintain the hold until Parent exact-head CI, TODO-17, MySQL 8.4/live DB gates, and literal localhost acceptance are complete.

### 2026-09-27 17:43 UTC — master TODO publication verified

LOCAL_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
REMOTE_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
TODO_CHANGES = 23/23 Parent TODOs and 16/16 Platform TODOs populated; no TODO was promoted without evidence.  
FILES_CHANGED = Both requested master TODO files were committed as `27757ca7` and verified on origin/pca-dev.  
TESTS = Structural ledger checks passed; no product source changed.  
BLOCKERS = Exact-head CI run 36338197362 is queued at 8f3f45b4; Docker/MySQL unavailable; Parent TODO-15/17 remain open; Parent localhost acceptance not received.  
DECISIONS = Keep Platform Enrollment held on the Parent projection/acceptance gates and distinguish historical evidence from current runs.  
NEXT_ACTION = Monitor exact-head CI and keep Agents 6/7 held until Parent TODO-01…17, TODO-16 projection, and TODO-18 literal acceptance pass.

### 2026-09-27 17:59 UTC — Parent TODO-15 and TODO-20 checkpoint

LOCAL_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e; origin/pca-dev matched after fetch  
PLATFORM_TODO_CHANGES = No Platform implementation started. Parent's redeemed-invitation copy is corrected locally; the Platform Enrollment activation hold remains.  
FILES_CHANGED = Parent Web EN/AR enrollment state, dev fixture, and regression only; generated DB snapshots remain outside this ledger update.  
TESTS = Parent Web redeemed-but-not-paired component regression 1/1 PASS; Parent Web typecheck PASS.  
BLOCKERS = Exact-head CI is queued; local Docker engine unavailable; TODO-20 awaits TODO-19 and a verified live read-only target; Parent owner acceptance not received.  
DECISIONS = Parent owns its identity projection and activation gates; Platform does not duplicate authority or begin Enrollment work before Parent acceptance.  
NEXT_ACTION = Maintain Platform hold and resume only after the Parent gates are satisfied.

### 2026-09-27 20:12 UTC — Parent TODO-20 regression checkpoint

PARENT_DB = Focused disposable MySQL 9.7 migration replay and malformed-index recovery passed 2/2; zero app/test entities seeded and canonical index restored. This is not MySQL 8.4 evidence.
PARENT_SCHEMA = Structural reconciliation tests passed 13/13; bootstrap artifact check passed. Remaining eight CHECK text differences need MySQL 8.4 verification.
PARENT_LIVE = `pca_pro` and live grants remain uninspected and unmutated; TODO-19 exact-head CI is still failed and verified live-target preflight is unavailable.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work started.
NEXT_ACTION = Continue Parent TODO-19 recovery and preserve Platform hold until Parent gates and literal owner acceptance pass.

### 2026-09-27 20:23 UTC — Parent CI/browser checkpoint

PARENT_CI = Exact-head run 36338197362 remains FAILED at 8f3f45b4; `gh` read access works with process-local proxy variables removed. No corrected run exists because local corrections have not been pushed.
PARENT_BROWSER = Enrollment/export specs now complete their operation-bound demo TOTP prompts; retired trusted-browser route spec expects its dashboard redirect. Playwright collection lists 17 tests across the edited three files; browser bodies have not been rerun.
PARENT_DB = Disposable MySQL 9.7 remains local-only. Platform stays on HOLD_PARENT_DEPENDENCY; no Platform files beyond its ledger and no Platform database/deployment work changed.
NEXT_ACTION = Keep Platform hold. Review/publish the Parent corrective checkpoint, then validate exact-head CI before asking for literal localhost acceptance.

### 2026-09-27 20:30 UTC — Parent corrective checkpoint publication

PARENT_CHECKPOINT = `0ba4c0d8c5631283267c0af2a8dc6046bd4c0552` fast-forward pushed and verified with fetch; local HEAD = origin/pca-dev = GitHub ref. Both master TODO files are present remotely.
PARENT_CI = Exact-head run `36348596733` failed. Its demo-mode Parent Web Chromium E2E job passed; the disposable E2E DB setup, populated-path harness, and Viewer component fixture failed. Parent corrections are local and pending a fresh run. TODO-20 MySQL 8.4 schema-equivalence and live `pca_pro` target gates remain open.
PLATFORM = HOLD_PARENT_DEPENDENCY remains unchanged. No Platform product source, database, deployment or owner UAT changed.
NEXT_ACTION = Maintain Platform hold until Parent CI, TODO-17, TODO-20 and literal localhost acceptance gates are satisfied.

### 2026-09-27 20:54 UTC — Parent exact-head CI failure and correction in progress

PARENT_CI = Quality Gates run `36348596733` completed FAILED at `47d564c4`; 24 jobs passed and 3 failed. Parent Web demo-mode Chromium E2E passed. Real-backend E2E generated an empty DB identifier, the backend populated-path certification targeted an empty `pca_test` after the disposable wrapper cleaned up, and Parent unit shard 6's Viewer pairing case lost its fixture on remount.
PARENT_FIX = Workflow SQL now joins a regex-validated database name without shell-sensitive backticks; backend full-suite and populated-path certification now share one disposable DB lifetime; Viewer authority changes in place while retaining the seeded pairing request. Changes and ledger update are local; tests are pending exact-head CI.
PLATFORM = HOLD_PARENT_DEPENDENCY remains unchanged; no Platform product source, database, deployment or owner UAT changed. One Platform ledger update is pending publication.
NEXT_ACTION = Publish the Parent corrections and both ledger updates, run exact-head Quality Gates, and maintain the Parent dependency hold.

### 2026-09-27 20:57 UTC — Parent corrective checkpoint verification

PARENT_LOCAL_VALIDATION = Disposable runner syntax PASS; production-path certification + migration-resumability checks PASS 14/14; Parent Web typecheck and lint PASS after the Viewer test edit. These are local checks only; no browser-body execution or new exact-head CI PASS is claimed.
PARENT_PUBLISH_SET = Parent workflow/backend disposable-runner/Viewer-test corrections and both mission ledgers are queued for exact-path publication. Platform implementation/deployment remains held on Parent dependency and owner acceptance.
PARENT_TODO20 = Existing owner authorization reaffirmed for repository/local/live schema and runtime-grant reconciliation with zero seed data, zero data loss, local test first, fresh live preflight, and post-mutation verification. MySQL 8.4 equivalence and verified live `pca_pro` target remain open; no live inspection or mutation occurred.
NEXT_ACTION = Publish and inspect exact-head CI; retain Platform HOLD_PARENT_DEPENDENCY until Parent gates and literal localhost acceptance pass.

### 2026-09-27 21:11 UTC — Parent real-backend E2E gate update

PARENT_CI = Exact-head run `36350073129` at `0daf6600` completed FAILED with 26 jobs passing and only real-backend browser E2E failing. Parent traced the two login failures to omitted disposable daily browser grants; a local fix is pending review and publication.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Keep Platform Enrollment held through the next exact-head Parent CI result and all other Parent acceptance gates.

### 2026-09-27 21:16 UTC — Parent daily browser-grant correction published

PARENT_CHECKPOINT = `a76aacae1710a7ff2fdc37788b0a291b3220decd` pushed and verified; exact-head Quality Gates run `36351084552` queued. Parent E2E correction now installs the fixture's primary and secondary browser grants before login. CI confirmation is pending.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Monitor Parent CI and keep Enrollment held until Parent activation gates, projection, TODO-18, and literal localhost acceptance pass.

### 2026-09-27 21:26 UTC — Parent TOTP step-up E2E follow-up

PARENT_CI = Exact-head run `36351171969` at `9c50e8ef` completed FAILED with 26 jobs passing; the real-backend E2E owner journey reached invitation creation but lacked the required fresh TOTP step-up. Its grant-based cross-family test passed. Parent is implementing an enrolled-MFA fixture path; validation is pending.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Keep Enrollment held through the next Parent exact-head CI and all activation/projection/localhost gates.

### 2026-09-27 21:34 UTC — Parent TODO-20 authorization reconfirmed

PARENT = Owner reconfirmed the existing Parent TODO-20 repository/local/live-schema/runtime-grant reconciliation authorization, including local-first additive/corrective migration work under its no-seed/no-data-loss gates. No new mission/TODO was created; Parent ledger now records the current environment and validation evidence.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product, DB, release, deployment, or owner-acceptance work occurred.
REMOTE = GitHub HTTPS egress was unavailable during read-only `git ls-remote`; no new exact-head run or remote publication is claimed.
NEXT_ACTION = Maintain the Platform hold until Parent activation/projection, TODO-18/19, TODO-20, and literal localhost acceptance gates close.

### 2026-09-27 21:37 UTC — Parent MFA step-up correction committed locally

PARENT_CHECKPOINT = `f51fe3dff3da62c045d1f8fd9d9a81be02efb2a7` contains the Parent acceptance-flow correction plus both mission ledgers. Typecheck/lint and real-config collection pass; browser execution and exact-head CI remain unverified. GitHub egress is unavailable and the checkpoint has not been pushed.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Continue the hold through Parent exact-head CI, TODO-20 reconciliation, activation/projection gates, and literal localhost acceptance.

### 2026-09-27 21:40 UTC — Parent checkpoint published; external evidence unavailable

PARENT_CHECKPOINT = `f51fe3df` implementation and `effb3837` ledger sync are fast-forward published. Fresh fetch, local HEAD, tracking ref, and remote branch all agree at `effb3837990cb4dadbd99f5143dd25ba8459f143`.
PARENT_CI = GitHub Actions API query was blocked by the configured local proxy refusing connections; no exact-head CI result is claimed.
PARENT_TODO20 = Owner authorization is reconfirmed. Disposable MySQL 8.4 is not available from the current host state; Docker start was denied and the test URL did not authenticate. No live DB inspection or mutation occurred.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Maintain the Platform hold; resume Parent CI and TODO-20 as soon as the required external and local database access is available.

### 2026-09-27 21:52 UTC — Parent exact-head CI remains blocked by stale UI assertion

PARENT_CI = Run `36352633376` at `85fd9bde` completed FAILED with 26 passing jobs. Only Parent real-backend browser E2E failed, after the MFA invitation flow passed, because an assertion expected retired dashboard copy; Parent updated the assertion to current fail-closed dashboard wording. Full backend MySQL certification and real-browser Web E2E passed.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Keep Enrollment held until the corrected Parent exact-head CI, TODO-20, activation/projection gates, and literal localhost acceptance pass.

### 2026-09-27 21:53 UTC — Parent assertion correction committed locally

PARENT_CHECKPOINT = `7a62fe60` fixes the stale final dashboard assertion to match current fail-closed UI copy. Typecheck/lint and real-config collection pass; publication and new exact-head CI are pending.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no Platform product/database/deployment work or owner acceptance occurred.
NEXT_ACTION = Keep Enrollment held through publication and Parent exact-head CI, TODO-20, activation/projection gates, and literal localhost acceptance.

### 2026-09-27 22:06 UTC — Parent Email lookup rendering gap in Platform E2E

PARENT_CI = Run `36353386170` at `c76e2273` completed FAILED with 26 jobs passing. Parent MFA invitation journey and cross-family isolation passed; only combined real-backend E2E failed.
PLATFORM_SOURCE = The existing `ParentEmailFamilyLookup` component and server-side `resolve-parent-email` call existed but were not rendered. Coordinator began wiring it into Enrollment Management > Entitlements and connecting the resolved family ID to its existing entitlement read path; validation was pending at this checkpoint.
PARENT_TODO20 = Live `pca_pro` is verified read-only on MySQL 8.4.9. Migration journal stops at 0050 while source goes through 0058; counts reflect 10 columns, 2 FKs, 3 indexes and 4 checks missing. Runtime grants match repository policy 92/92. No DB writes occurred; local MySQL 8.4 test-first gate remains open.
PLATFORM = HOLD_PARENT_DEPENDENCY remains; no production activation, database mutation or owner acceptance occurred.
NEXT_ACTION = Validate/publish the Parent Email resolver integration and keep Enrollment held through Parent exact-head CI, TODO-20, activation/projection and localhost acceptance gates.

### 2026-09-27 22:10 UTC — Parent Email resolver integration validated locally

PLATFORM_FIX = `ParentEmailFamilyLookup` is now rendered on Enrollment Management > Entitlements; it resolves Parent Email server-side and binds one selected internal Family ID to the entitlement detail read. Multiple-family selection remains intact.
LOCAL_VALIDATION = Platform Admin typecheck PASS, lint PASS, production build PASS, and three focused suites PASS 14/14. The unprivileged Vitest/Vite starts hit `spawn EPERM`; elevated reruns completed successfully.
GATES = Exact-head browser E2E pending. `HOLD_PARENT_DEPENDENCY` for production activation remains; no production or database mutation and no owner acceptance occurred.
NEXT_ACTION = Publish and rerun exact-head Quality gates; retain Parent/TODO-20 and localhost activation gates.

### 2026-09-27 22:11 UTC — Platform Parent Email lookup committed locally

PARENT_CHECKPOINT = `643cb866feee65887623f71a536d9a8a34bb8643` adds the server-side Parent Email resolver to Enrollment > Entitlements and was validated locally: typecheck, lint, build and focused tests 14/14 PASS.
PLATFORM = Production activation remains `HOLD_PARENT_DEPENDENCY`; no deployment, live database mutation or owner acceptance occurred.
NEXT_ACTION = Publish the source checkpoint and ledger sync, then inspect combined real-backend E2E at the exact pushed head.

### 2026-09-27 22:37 UTC — real-backend Parent Email lookup assertion corrected

CI = Exact-head run `36354470524` at `d32fc1b729aee263f9aaf1d9d501ad0622950314` failed only Platform Admin real-backend E2E. The server correctly reported an eligible family before its first entitlement read created the `FREE_STARTER` record; the test expected the later already-entitled state too early. Other CI jobs, including disposable MySQL certification, passed.
FIX = Source checkpoint `102192b31c1e883198ec68343064427697fbbfaa` now validates the real sequence: unknown email, eligible lookup, loaded FREE_STARTER entitlement, then second lookup reporting already entitled.
LOCAL_VALIDATION = Full Platform Admin real-browser E2E with real local Fastify and disposable MySQL 8.4.11 PASS 1/1 (2.3m). Temporary DB and private fixture manifest were removed.
GATES = New exact-head CI awaits publication. Platform activation remains `HOLD_PARENT_DEPENDENCY`; TODO-20 live reconciliation and literal localhost acceptance remain open. No deployment, live DB mutation, or owner acceptance occurred.
NEXT_ACTION = Publish source and ledger sync; inspect exact-head CI before continuing the dependent Platform work package.

### 2026-09-27 23:21 UTC — Parent TODO-20 corrective migration checkpoint

PARENT_SOURCE = `fbba783d5e5c3b2fe8c0f98ef02d3f8abc1eab29` adds locally tested migration 0059, updates the canonical schema from MySQL 8.4.11 SHOW CREATE evidence, adds replay/data-preservation coverage, and regenerates database bootstrap artifacts. Parent DB target passed 61 tests with 3 expected privileged skips; Platform Admin DB target passed 11/11; focused migration-upgrade suite passed 3/3.
PARENT_LIVE = Migrations 0051–0058 are applied and reconciled on `pca_pro`; 0059 remains pending exact-head CI and fresh immediate preflight. Existing runtime grants were exact at 92/92 after 0058 and must be checked again after 0059.
PLATFORM_GATE = `HOLD_PARENT_DEPENDENCY`; no Platform source, database, deployment, activation, or owner acceptance changed in this checkpoint.
NEXT_ACTION = Source `fbba783d` and ledger sync `578dc0bb` are published; fresh fetch/local/GitHub heads match and required files are present remotely. Quality Gates run `36358762949` is PENDING at `578dc0bb`; wait for the final ledger-sync head’s result before Parent TODO-20 final live verification, keeping dependent Platform activation held.
PRIOR_CI = Exact-head Quality Gates run `36356186069` completed SUCCESS at `399304c080e82c36719e4d5bf34953444181ecb8`; local, fetched tracking and live GitHub refs matched at this SHA. This prior CI pass does not cover the new 0059 checkpoint.

### 2026-09-27 23:43 UTC — Parent TODO-20 CI gate remains closed

PARENT_CI = Exact-head run `36358827739` at `c71546343db8ef982b28d432711058db6c5d7a80` FAILED: disposable MySQL full DB certification passed, while canonical migration provenance had one backend unit failure and the Parent real-backend cross-family CREATE check hit 429 after a shared per-IP budget was consumed. Android and iOS passed. Parent corrections add migration trace metadata and isolate only the disposable E2E clients behind the explicitly trusted loopback test proxy; corrective CI is pending.
PLATFORM_GATE = `HOLD_PARENT_DEPENDENCY`; no Platform source, live data, activation, deployment, or owner acceptance changed.
NEXT_ACTION = Require the corrective Parent exact-head Quality Gates run to pass, then continue Parent TODO-20 immediate-preflight/schema/grant reconciliation and preserve the dependent Platform hold.
