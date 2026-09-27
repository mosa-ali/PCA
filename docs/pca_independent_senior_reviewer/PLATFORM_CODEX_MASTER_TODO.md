# PCA Platform Web — Codex Master TODO

## Mission

PURSUING_GOAL = Complete the Parent-dependent Platform Enrollment integration and combined PCA release without duplicating Parent identity authority  
BRANCH = pca-dev  
MISSION_STATUS = IN_PROGRESS (Platform Enrollment work package is held)  
LAST_UPDATED_UTC = 2026-09-27 17:42 UTC
LOCAL_HEAD = 27757ca77e0edec417516784dc3e59da6855896e  
REMOTE_HEAD = 27757ca77e0edec417516784dc3e59da6855896e  
CURRENT_CHECKPOINT_SHA = 27757ca77e0edec417516784dc3e59da6855896e  
COORDINATOR = Current Codex agent  
PLATFORM_ACTIVATION_GATE = HOLD_PARENT_DEPENDENCY until Parent TODO-01…17 PASS, Parent projection PASS, TODO-18 PASS, and literal `LOCALHOST ACCEPTED=YES`  
CURRENT_ACTIVE_PLATFORM_TODO = PLATFORM-03…PLATFORM-05 remain blocked at the dependent Enrollment UI gate  
NEXT_ACTION = Keep Agents 6/7 held; after Parent localhost acceptance, activate Platform specialists and implement/test Enrollment Name/Email/Phone integration.

This base follows the pushed Parent/Platform source checkpoint `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`, canonical-ledger sync `114b784ea33112cb3bebd64b454866481d8b3ba3`, and master TODO publication `27757ca77e0edec417516784dc3e59da6855896e`. Quality Gates run `36337926059` is queued for the current SHA; superseded runs `36337455750` and `36337595300` were cancelled. No CI PASS is inferred.

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
EVIDENCE = Local=remote at `114b784e`; exact Quality Gates run `36337595300` is pending at that SHA; prior payload run `36337455750` is in progress at `3d31cb5b`.  
BLOCKER = Current exact-head CI has not passed; Platform Enrollment changes are still held.  
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

LOCAL_HEAD = 27757ca77e0edec417516784dc3e59da6855896e  
REMOTE_HEAD = 27757ca77e0edec417516784dc3e59da6855896e  
LOCAL_REMOTE_EQUAL = YES (fresh fetch)  
PLATFORM_FILES_CHANGED = 0 uncommitted Platform paths; the two current Platform commits are pushed  
PLATFORM_LOCAL_ONLY_FILES_REMAINING = 0 for existing scope  
PLATFORM_UNPUSHED_COMMITS_REMAINING = 0  
PLATFORM_COMMIT = `24603231`, `2fde86de` in checkpoint; additional backend projection is included in the integrated Parent backend commit  
EXACT_HEAD_CI = QUEUED (`36337926059` at `27757ca7`)

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
CURRENT_P2 = Enrollment Name/Email/Phone remains unimplemented; exact-head CI pending; MySQL unavailable; dependent Platform work remains held.  
BLOCKERS = Parent TODO-17 integration; TODO-18 literal owner localhost acceptance; current exact-head CI; Docker/MySQL availability; schema/grant reconciliation; existing device crypto/trust gates.  
NEXT_ACTION = Monitor run 36337926059 for SHA 27757ca7. Do not activate Agents 6/7 until the Parent gate is satisfied. Once activated, implement Enrollment projection consumption and columns, then focused/full tests, lint/build, clean snapshot and exact-head CI.

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

### 2026-09-27 17:42 UTC — master TODO publication verified

LOCAL_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
REMOTE_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
TODO_CHANGES = 23/23 Parent TODOs and 16/16 Platform TODOs populated; no TODO was promoted without evidence.  
FILES_CHANGED = Both requested master TODO files were committed as `27757ca7` and verified on origin/pca-dev.  
TESTS = Structural ledger checks passed; no product source changed.  
BLOCKERS = Exact-head CI run 36337926059 is queued; MySQL unavailable; Parent localhost acceptance not received.  
DECISIONS = Keep Platform Enrollment held on the Parent projection/acceptance gates and distinguish historical evidence from current runs.  
NEXT_ACTION = Monitor exact-head CI and resume the earliest unfinished Parent TODO-12.
