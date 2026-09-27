# PCA Parent Authentication + Authority — Codex Master TODO

## Mission

PURSUING_GOAL = PCA Parent Authentication + Authority — Continuous Completion  
BRANCH = pca-dev  
MISSION_STATUS = IN_PROGRESS  
LAST_UPDATED_UTC = 2026-09-27 20:23 UTC
LOCAL_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e  
REMOTE_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e  
CURRENT_CHECKPOINT_SHA = 8f3f45b47d24cc7debd581230eda23c088d74f4e  
COORDINATOR = Current Codex agent  
CURRENT_ACTIVE_TODO = TODO-12 through TODO-17, TODO-19, and TODO-20 local reconciliation (integrated Parent authority/device, regression evidence, exact-head CI recovery, and local DB schema phase)  
NEXT_ACTION = Commit and push the reviewed corrective checkpoint to `origin/pca-dev`, verify the exact-head Quality Gates result, and continue the still-open TODO-12/14/17 evidence. GitHub CLI reads work after removing the dead proxy from that process; do not infer browser PASS without a current browser run. Keep schedule-policy/Web Rules fail-closed and do not mutate live `pca_pro` before its verified read-only preflight.

The implementation checkpoint payload is at `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`; canonical-ledger sync is `114b784ea33112cb3bebd64b454866481d8b3ba3`; master TODO publication is `27757ca77e0edec417516784dc3e59da6855896e`; publication-state sync is `8f3f45b47d24cc7debd581230eda23c088d74f4e`. Quality Gates run `36338197362` at `8f3f45b4` failed. No checkpoint CI result is PASS.

## Final Architecture

PARENT IDENTITY = verified email  
PARENT PRIMARY AUTHENTICATION = email + password  
FIRST-LOGIN ACTIVATION = safe family provisioning  
PARENT MFA = TOTP enrolled within 3 days (server-side 72-hour deadline)  
KNOWN-BROWSER LOGIN = email + password  
NEW-BROWSER LOGIN = email + password + email OTP + TOTP if already enrolled  
BROWSER TRUST = automatic account-bound login-assurance record; NOT Parent authorization  
PARENT AUTHORIZATION = family membership + ACTIVE role  
SENSITIVE ACTION = fresh TOTP step-up  
CHILD DEVICE SECURITY = separate device cryptography  
PLATFORM FAMILY IDENTITY PROJECTION = family-scoped Name + Email + nullable Phone

## Authentication Behavioral Reference

D3759D89_REFERENCE = `d3759d896aa3ff4804147ef80864dff1beb54ad6`  
D3759D89_PASSWORD_LOGIN = email + password; TOTP is not a substitute for the primary password  
D3759D89_EMAIL_VERIFICATION = verified-email activation is required; verification itself issues no session  
D3759D89_LOGIN_BEHAVIOR = known browser uses email + password; unknown browser requires emailed OTP and TOTP when already enrolled  
D3759D89_LOGIN_NOTIFICATION = first successful login emits `FIRST_LOGIN`; subsequent success emits `LOGIN_SUCCESSFUL`; delivery is best-effort  
D3759D89_SESSION_CREATION = successful login creates a fresh session; verification and password reset do not silently authenticate  
NEWER_VALID_FIXES_PRESERVED = OTP hash/attempt validation precedes consuming TOTP; family suspension revokes sessions, daily grants, pending login codes and family-bound step-up grants; account/family concurrency protections remain enabled.

## Canonical Parent TODO Board

Statuses are coordinator-assigned from repository evidence. Earlier real-MySQL, browser and suite results cited below are recorded historical evidence; this checkpoint could not rerun MySQL or browser E2E.

### TODO-01 — Preserve and reconcile current multi-session worktree

STATUS = PASS  
OWNER = Coordinator  
FILES = Entire checkpoint inventory; `docs/PCA_CHECKPOINT_PATH_CLASSIFICATION_2026-09-27.md`  
EVIDENCE = 330 initial dirty file paths were classified path by path. Eight logical commits were pushed; local and remote are equal at `114b784e`. All 61 peer assessment files were preserved in a separate snapshot commit. Five explicitly excluded paths remain: two stale schema snapshots, two machine-local `.vscode` files, and unrelated root `0`. No stash/reset/clean or force push.  
BLOCKER = None for lossless synchronization; excluded dirty paths have recorded reasons.  
DONE_WHEN = no legitimate PCA/peer work is lost

### TODO-02 — Reconcile d3759d89 Parent authentication baseline

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = `backend/src/parentaccount/**`, `backend/src/http/routes/parentAccountRoutes.ts`, `parent-web/src/pages/auth/**`  
EVIDENCE = Reference source compared; backend build passed; prior auth/email/route campaign 80/80, OTP/TOTP regression 3/3 and disposable MySQL campaign 43/43. Current focused auth/authority campaign passed 188/188.  
BLOCKER = Consolidated TODO-17 regression remains open; exact-head CI run `36338197362` failed.  
DONE_WHEN = approved login/email/session behavior is preserved or restored

### TODO-03 — Verified-email activation

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent account service/repository/routes and Parent auth UI/tests  
EVIDENCE = Prior in-memory and disposable MySQL checks cover activation-only verification, pending-account denial, invalid/replayed/expired codes, attempt limits, and no session at verification. Current build passed.  
BLOCKER = Consolidated TODO-17 regression remains open; exact-head CI run `36338197362` failed.  
DONE_WHEN = unverified Parents restricted and verified Parents proceed safely

### TODO-04 — Atomic Parent family provisioning

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent provisioning service/repository, `backend/src/db/schema.ts`, migrations 0049/0051+, MySQL tests  
EVIDENCE = Historical disposable MySQL first-login run proved one family/administrator/scope, 16-way concurrent provision calls, uniqueness, retry safety and cross-account refusal. Current migration 0057 test remains unrun.  
BLOCKER = Repeat integrated disposable MySQL suite when local MySQL is available.  
DONE_WHEN = exactly one family + one initial ACTIVE Administrator; retry and concurrency safe

### TODO-05 — First-login trusted-browser creation

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent login/MFA repositories and service; `parent-web/e2e-real/parentMfa.spec.ts`  
EVIDENCE = Historical MySQL and in-memory flows prove automatic account-bound hashed browser assurance; cookie assertions check HttpOnly session and daily-login cookies.  
BLOCKER = Consolidated current browser regression is pending; local disposable runner is blocked by stopped Docker/MySQL.  
DONE_WHEN = successful first login automatically establishes account-bound browser trust

### TODO-06 — Three-day TOTP enrollment policy

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent MFA service/repository/routes/UI and migrations  
EVIDENCE = Server-side grace is 72 hours; prior MySQL checks proved concurrent starts preserve one deadline and browser/logout/cookie operations cannot reset it.  
BLOCKER = Consolidated TODO-17 regression remains open; exact-head CI run `36338197362` failed.  
DONE_WHEN = one server-side 72-hour deadline starts once and cannot be reset by browser tricks

### TODO-07 — TOTP setup and activation

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = `backend/src/parentaccount/mfa/**`, Parent MFA routes/UI and tests  
EVIDENCE = Prior disposable MySQL checks cover encrypted sealed secret, single-use enrollment ticket, recovery hold/session revocation and migration replay; current backend build and MFA-focused campaign passed.  
BLOCKER = Full Parent browser regression and current MySQL rerun are pending.  
DONE_WHEN = secure secret + local QR + confirmation + encrypted ACTIVE state proven

### TODO-08 — Known-browser login

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent login service, MFA/trust repository, email templates and browser specs  
EVIDENCE = Historical real-MySQL checks show known browser does not need routine TOTP after activation; successful-login notices are covered.  
BLOCKER = Current integrated browser campaign remains open; exact-head CI run `36338197362` failed.  
DONE_WHEN = known browser uses email + password without unnecessary login TOTP

### TODO-09 — New/unknown-browser login

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent login/OTP/TOTP flows, browser assurance repository, `parent-web/e2e-real/parentMfa.spec.ts`  
EVIDENCE = Historical MySQL campaign covers email OTP + active TOTP, account-bound browser trust and concurrent single-winner completion. OTP-before-TOTP ordering regression passed 3/3.  
BLOCKER = Real browser flow was not rerun in this checkpoint; Docker/MySQL fixture backend unavailable.  
DONE_WHEN = email OTP + TOTP-if-enrolled flow works and successful browser becomes trusted

### TODO-10 — Remove Genesis from Parent authentication/authorization

STATUS = READY_FOR_INTEGRATION  
OWNER = Coordinator  
FILES = Parent auth, provisioning, authority, routes, UI and tests  
EVIDENCE = Prior source review found no ordinary Parent Genesis runtime dependency; provisioning creates no Genesis authority/device rows.  
BLOCKER = Complete route/action audit remains in TODO-14.  
DONE_WHEN = ordinary Parent runtime has zero Genesis dependency

### TODO-11 — Migrate Trusted Browser away from family authority

STATUS = PASS  
OWNER = Coordinator  
FILES = Parent trust/session providers, repositories, routes/UI; family suspension  
EVIDENCE = Historical MySQL test proves suspension revokes sessions, daily grants, pending login challenges and family-bound step-up grants; old browser grant requires fresh verification after reactivation. Browser trust is account-bound login assurance only.  
BLOCKER = Cross-browser listing/individual-device management is a non-blocking follow-up; logout and revoke-all are available.  
DONE_WHEN = browser trust affects login assurance only

### TODO-12 — Complete normal Parent authority migration

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Parent route/action authority, authz, child requests, family membership, device binding, removal decisions, Parent Web action clients  
EVIDENCE = Source/action matrix reviewed; current focused service/HTTP campaign passed 188/188; build passed. Removal mutations use active Administrator and scoped TOTP step-up; Parent decision actor IDs are persisted by repository code and migration 0057, and omitted from Parent DTOs. Resolver/unit route checks and enrollment SQL source are committed.  
BLOCKER = Schedule-policy remains tied to device bearer/unavailable Trust Set; web rules remain `503 not_configured`; some bonus-grant actor metadata is process-local; migration 0057 persistence awaits MySQL.  
DONE_WHEN = normal authority = session + same family + ACTIVE Administrator

### TODO-13 — Sensitive-action TOTP step-up

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Step-up schema/service/routes/UI and classified Parent actions  
EVIDENCE = Ten of twelve declared operations had consumers in the last audit; device invitation has operation-specific step-up. Removal create/PIN/local decisions require scoped fresh TOTP, and unused ownership-transfer/recovery-material issuance is rejected. Prior focused route/UI checks passed; current focused backend campaign passed.  
BLOCKER = Explicit future authority policy is needed before ownership-transfer/recovery-material operations can be enabled; full Parent Web suite rerun pending.  
DONE_WHEN = classified high-risk actions require fresh TOTP

### TODO-14 — Full Parent route/action audit

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Parent backend routes/pages/actions and authority matrix  
EVIDENCE = Agent-2 source-mapped route/action matrix reviewed; eye-protection membership and removal route changes have focused tests. Current 188-test backend focus passed.  
BLOCKER = Integrated route/action campaign, aggregate unexpected status counts and Trust Set/web-rule authority boundaries remain open.  
DONE_WHEN = every required route is audited with proven authority and no normal action blocked by Genesis or browser trust  
UNEXPECTED_401 = NOT_YET_PROVEN (aggregate)  
UNEXPECTED_403 = NOT_YET_PROVEN (aggregate)  
AUTHORITY_UNAVAILABLE = known schedule-policy/web-rule boundaries remain; aggregate count NOT_YET_PROVEN  
GENESIS_BLOCKED_NORMAL_ACTIONS = 0 in reviewed ordinary Parent source; integrated count NOT_YET_PROVEN  
TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS = 0 in reviewed ordinary Parent source; integrated count NOT_YET_PROVEN

### TODO-15 — Preserve child-device cryptographic security

STATUS = IN_PROGRESS  
OWNER = Coordinator; mobile specialist review complete  
FILES = Device/session repositories and routes, enrollment binding, Parent device UI/API, Android/iOS contract surfaces  
EVIDENCE = Session/current-family/revocation gates and family epoch are implemented; prior focused MySQL/device-session tests passed. Mobile review found AddDeviceWizard called invitation `REDEEMED` “Connected” although backend device state is `PAIRING_PENDING`; local correction now says “Enrollment submitted”, explains fingerprint confirmation is still required, and links to Advanced Security pairing. Focused component regression passed 1/1 and Parent Web typecheck passed. Source audit still finds no safe PAIRED-to-ACTIVE first-policy path with current rejecting verifier and unavailable durable Trust Set/key-epoch resolver.  
BLOCKER = Production crypto/trust/policy bootstrap and independent attestation are not wired; protection status is a device self-report.  
DONE_WHEN = identity/pairing/signatures/replay/revocation/wrong-device protections remain green

### TODO-16 — Identity/profile integration + Platform family projection

STATUS = PASS  
OWNER = Coordinator  
FILES = Parent identity API/UI/migrations; Platform family read model, route/UI, tests  
EVIDENCE = Unicode-friendly nullable legacy names and optional phone; family-scoped four-field projection (first/last/email/nullable phone); prior Parent identity UI 15/15, backend identity/projection route tests 11/11 and disposable MySQL projection 61/61 (two-family isolation, zero-admin fail-closed, nullable phone, provisioning precedence). Projection and UI source are verified at the checkpoint remote.  
BLOCKER = Current MySQL rerun awaits Docker; dependent Platform Enrollment-specific work is separately held in the Platform ledger.  
DONE_WHEN = Parent identity persistence and minimal family-scoped Platform projection are implemented and evidence gates recorded  
First Name required = PASS  
Last Name required = PASS  
Email required = PASS  
Phone optional = PASS  
family-scoped Platform projection PASS = PASS (source and historical route/MySQL evidence)  
extra PII/commercial fields = 0

### TODO-17 — Full MySQL / security / browser regression

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Backend, Parent Web, Platform Web, disposable MySQL and real-browser suites  
EVIDENCE = Exact-head CI `36338197362` failed on `8f3f45b4`: Parent Web unit shard 6 timed out in `DeviceEnrollmentPanel.test.tsx`; full DB certification replayed migration 0050 against the widened event constraint; backend non-DB rejected migration 0057 as unguarded; real-backend E2E used fixed `pca_test` and lacked its private manifest; Parent Web browser E2E had five failures. Current local corrections cover those DB/resumability/E2E-fixture failures. The browser failures map to invitation/export TOTP dialogs not handled by specs and the retired trusted-browser route still expecting its old flow; specs were updated, but browser execution is not yet verified. Historical Parent Web Vitest 1065/1065, backend 2648/2648 and real Parent MFA browser flows 1/1 each remain historical.  
BLOCKER = Fresh disposable MySQL 9.7 is active on loopback; migrations 0050/0058 pass locally 2/2 and structural reconciliation passes 13/13, but this is not a full MySQL 8.4 suite. Parent Web lint, typecheck, and Playwright test collection pass; no current browser bodies were executed because the prior CI-mode local Chromium attempt was rejected by automatic approval review. Mobile/device external crypto gates remain.  
DONE_WHEN = integrated local regression is green and remaining external device/owner gates are accurately separated

### TODO-18 — Owner localhost acceptance

STATUS = TODO  
OWNER = OWNER + coordinator  
FILES = N/A  
EVIDENCE = Not offered; literal response not received.  
BLOCKER = TODO-17 integrated readiness.  
DONE_WHEN = literal `LOCALHOST ACCEPTED` received

### TODO-19 — Git reconciliation + remote alignment + exact-head CI

STATUS = IN_PROGRESS  
OWNER = COORDINATOR  
FILES = Parent/Platform source, tests, migrations, assessments and ledgers  
EVIDENCE = Prior checkpoint `8f3f45b4` was pushed and matched `origin/pca-dev`. Current `git ls-remote` also confirms remote head is still `8f3f45b4`. Quality Gates `36338197362` was retrieved through `gh` with proxy variables removed for that process and is FAILED at the exact head. Current corrective source/test changes are local and uncommitted.  
BLOCKER = Corrected exact-head CI must run after publishing the reviewed corrective checkpoint. Git fetch cannot refresh `.git/FETCH_HEAD` because of a local permission error; direct `git ls-remote` and process-scoped `gh` API access work. Overall TODO-19 release/acceptance sequence remains gated by TODO-18 and dependent Platform validation.  
DONE_WHEN = local/remote align, complete approved state is remote, exact-head CI PASS, and all files are classified  
LOCAL_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e (current committed head)  
REMOTE_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e (direct ls-remote)  
PARENT_LOCAL_ONLY_FILES_REMAINING = 21 current mission source/test/workflow/bootstrap/ledger paths pending checkpoint publication; 2 stale snapshots, 2 machine-local .vscode paths, and root fragment `0` remain excluded  
PARENT_UNPUSHED_COMMITS_REMAINING = 0  
EXACT_HEAD_CI = FAILED (`36338197362` at `8f3f45b4`)

### TODO-20 — Live schema / DB grants reconciliation

STATUS = IN_PROGRESS (local reconciliation; live phase gated)  
OWNER = Coordinator  
FILES = Repository schema/migrations, local PCA DB, live `pca_pro`, runtime grants  
AUTHORIZATION = Owner reminder received 2026-09-27: full repository/local/live pca_pro/runtime-grant reconciliation is approved; ordinary additive/corrective migrations may proceed only after local test and fresh live preflight.  
EVIDENCE = Canonical `schema.ts` + migrations through 0058 declare 92 tables, 792 columns, 104 foreign keys, 92 primary keys, 38 unique non-primary indexes, 141 non-unique indexes, and 282 checks. A fresh disposable MySQL 9.7 instance applied all 56 migrations with no test-fixture/application seed rows. Schema comparison found one real index drift: canonical source declared `family_authority_request_challenges_service_fk`, but migration 0044 omitted it. Additive migration 0058 and source provenance now reconcile it; migration 0050/0058 replay tests pass 2/2 and migration rerun is a no-op. Migrated and canonical-bootstrap DBs now have matching index structure and aggregate tables/columns/FKs/checks. Local least-privilege grants were provisioned for a disposable local principal and matched all 92 table-level grants exactly, with zero broad/elevated grants; no live grant mutation occurred. Eight table CHECK-clause renderings still differ by `_ascii` versus `_utf8mb4` introducers on MySQL 9.7; confirm full schema equality using required MySQL 8.4. Disposable-bootstrap artifacts were regenerated by their source generator and `--check` passes. Pre-existing stale snapshots remain untouched; no live DB was inspected or mutated.  
LOCAL_SERVICE_REPAIR = Docker Desktop engine remains unavailable and starting `com.docker.service` was denied. A fresh disposable MySQL 9.7 server is running loopback-only on 127.0.0.1:33061 from a newly initialized OS-temp datadir; no installed MySQL service or existing data directory was started or touched. MySQL 9.7 does not certify the required MySQL 8.4 environment.  
PCA_PRO_TARGET = Not configured in checked process/test environment; no unambiguous live connection target found; read-only inspection not yet performed.  
BLOCKER = TODO-19 exact-head Quality Gates failed (`36338197362` at `8f3f45b4`); required MySQL 8.4 confirmation and verified read-only live `pca_pro` target/preflight remain unavailable. Owner has authorized full reconciliation; continue automatically as soon as TODO-19 is executable and the live target/preflight is verified.  
DONE_WHEN = repository schema matches local DB and pca_pro; required migration locally tested and live-applied if required; grants match; no seed data  
NO_SEED_DATA = YES (no test fixtures or application rows; only migration-required reference data)  
DATA_LOSS = 0  
NO_BLIND_DB_PUSH = YES  
LOCAL_TEST_FIRST = PASS for migrations 0050/0058 on fresh disposable MySQL 9.7; MySQL 8.4 rerun pending  
LIVE_PREFLIGHT_BEFORE_MUTATION = YES  
REPOSITORY_SCHEMA_MATCH_AFTER = NOT_YET_PROVEN (8 CHECK renderings remain version-sensitive under local MySQL 9.7)  
LOCAL_DB_SCHEMA_MATCH_AFTER = PARTIAL (counts and indexes match; confirm all constraints on MySQL 8.4)  
LIVE_PCA_PRO_SCHEMA_MATCH_AFTER = NOT_YET_PROVEN  
LIVE_GRANTS_MATCH_AFTER = NOT_YET_PROVEN  
LOCAL_RUNTIME_GRANTS = PASS (92/92 exact table grants; zero broad/elevated grants on disposable local principal)

### TODO-21 — Azure deployment

STATUS = TODO  
OWNER = Coordinator + owner  
FILES = Approved API/backend, Parent Web, Platform Web release artifacts  
EVIDENCE = No Azure deployment attempted or authorized by this checkpoint.  
BLOCKER = TODO-19 exact-head CI; TODO-20 reconciliation; refreshed rollback baseline and release gate.  
DONE_WHEN = approved API/backend deployed; Parent Web deployed; Platform Web deployed where combined release requires it; running SHA/digest verified

### TODO-22 — Owner production acceptance

STATUS = TODO  
OWNER = OWNER  
FILES = N/A  
EVIDENCE = Not offered.  
BLOCKER = TODO-21.  
DONE_WHEN = owner production UAT PASS

### TODO-23 — Final closure

STATUS = TODO  
OWNER = COORDINATOR  
FILES = Canonical Parent TODO board, Platform package, all required evidence  
EVIDENCE = Mission remains active; no owner acceptance/deployment/closure claimed.  
BLOCKER = TODO-01…TODO-22 and dependent Platform work package.  
DONE_WHEN = TODO-01…TODO-22 PASS; CURRENT_P0=0; CURRENT_P1=0; all required release evidence complete

## Current Evidence

### Family Provisioning

FIRST_LOGIN_FAMILY_PROVISIONED = PASS (historical disposable MySQL + service evidence)  
EXACTLY_ONE_FAMILY = PASS (historical uniqueness/concurrency campaign)  
EXACTLY_ONE_INITIAL_ADMIN = PASS (historical)  
RETRY_SAFE = PASS (historical)  
CONCURRENCY_SAFE = PASS (16-way family provisioning; historical)  
CROSS_ACCOUNT_ATTACHMENT = PASS (historical refusal test)  
REAL_MYSQL_EVIDENCE = PASS historically; NOT RERUN in current checkpoint

### TOTP

TOTP_DEADLINE_STARTS_ONCE = PASS historically  
TOTP_DEADLINE_72H_SERVER_SIDE = PASS  
COOKIE_RESET_BYPASS = PASS historically  
TOTP_SETUP = PASS historically; current full browser run pending  
TOTP_SECRET_ENCRYPTED = PASS historically  
TOTP_CONFIRMATION = PASS historically  
TOTP_RECOVERY = PASS historically

### Browser Assurance

FIRST_BROWSER_AUTO_TRUST = PASS historically  
MANUAL_BROWSER_SETUP_DEPENDENCY = 0  
KNOWN_BROWSER_PASSWORD_ONLY = PASS historically  
KNOWN_BROWSER_TOTP_ACTIVE_PASSWORD_ONLY = PASS historically  
UNKNOWN_BROWSER_EMAIL_OTP = PASS historically  
UNKNOWN_BROWSER_TOTP_IF_ACTIVE = PASS historically  
TRUST_ACCOUNT_BOUND = PASS historically  
TRUST_RAW_TOKEN_SERVER_STORAGE = NO (hashed-at-rest)  
TRUST_EXPIRY = PASS historically  
TRUST_REVOCATION = PASS historically; family suspension revocation covered

### Authority

GENESIS_NORMAL_RUNTIME_DEPENDENCY = 0 in reviewed source  
TRUSTED_BROWSER_NORMAL_AUTHORITY_DEPENDENCY = 0 in reviewed source  
NORMAL_AUTHORITY = IN_PROGRESS; session + same-family membership/active role implemented on covered routes  
FRESH_TOTP_STEP_UP = IN_PROGRESS; implemented on classified sensitive routes; full matrix open  
ACTIONS_CLASSIFIED = PARTIAL; ownership-transfer/recovery-material operations are currently unavailable

### Full Action Matrix

PARENT_PAGES_TOTAL = NOT_YET_PROVEN  
PARENT_PAGES_TESTED = NOT_YET_PROVEN (integrated current campaign incomplete)  
PARENT_ACTIONS_TOTAL = NOT_YET_PROVEN  
PARENT_ACTIONS_TESTED = PARTIAL  
UNEXPECTED_401 = NOT_YET_PROVEN (aggregate)  
UNEXPECTED_403 = NOT_YET_PROVEN (aggregate)  
AUTHORITY_UNAVAILABLE = Known for schedule-policy Trust Set and web-rule production wiring  
GENESIS_BLOCKED_NORMAL_ACTIONS = 0 in reviewed source; integrated aggregate NOT_YET_PROVEN  
TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS = 0 in reviewed source; integrated aggregate NOT_YET_PROVEN

### Platform Projection

TODO_16_PLATFORM_PROJECTION = PASS  
PROJECTION_SCOPE = Family-scoped, fail-closed on no/ambiguous eligible Parent  
PROJECTION_FIELDS = First name, last name, email, nullable phone  
EXTRA_PII_OR_COMMERCIAL_FIELDS = 0  
LEGACY_FAMILY_POLICY = Explicit provisioned Parent; else exactly one ACTIVE Administrator; otherwise ambiguous/unavailable  
CROSS_FAMILY_PROJECTION_TEST = PASS historically  
UNAUTHORIZED_PROJECTION_TEST = PASS historically  
MULTIPLE_ADMIN_AMBIGUITY_TEST = PASS historically  
ZERO_ADMIN_TEST = PASS historically  
PHONE_NULLABLE_TEST = PASS historically

### Child Device Security

DEVICE_IDENTITY = IN_PROGRESS; independent device identities retained  
PAIRING = IN_PROGRESS; current ceremony still depends on device proof/authority availability  
SIGNATURE = BLOCKED by rejecting production verifier and human crypto review  
REPLAY_PROTECTION = Implemented in device/session layers; integrated cryptographic acceptance NOT_YET_PROVEN  
REVOCATION = Session/family epoch gates implemented; full real device lifecycle NOT_YET_PROVEN  
WRONG_DEVICE_REJECTION = Partial focused coverage; end-to-end cryptographic proof NOT_YET_PROVEN

## Test Evidence

BACKEND_BUILD = PASS (current checkpoint)  
PARENT_WEB_TYPECHECK = PASS (current checkpoint)  
PLATFORM_WEB_TYPECHECK = PASS (current checkpoint)  
MYSQL = Local disposable MySQL 9.7: migrations 0001…0058, focused migration replays and local runtime grants PASS; required MySQL 8.4 lane and live DB remain unverified  
FAMILY_CONCURRENCY = PASS historically; not rerun now  
PARENT_WEB = PASS historically (151 files / 1065 tests); not rerun now  
AUTHORITY_MATRIX = IN_PROGRESS; current focused backend 188/188  
IDENTITY_PROFILE = PASS historically (Parent UI 15/15; backend routes 11/11; DB 61/61)  
LOGIN_NOTIFICATION = PASS historically  
TOTP = PASS historically in focused/DB/browser lanes  
BROWSER_TRUST = PASS historically; current real browser not run  
CHILD_DEVICE_SECURITY = PARTIAL; crypto activation remains blocked  
REAL_BACKEND_E2E = NOT RUN in this checkpoint  
REAL_BROWSER_E2E = NOT RUN in this checkpoint; historical Parent MFA flows 1/1 each

## Git Status

LOCAL_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e  
REMOTE_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e  
LOCAL_REMOTE_EQUAL = YES (fresh fetch)  
FILES_LEFT_DIRTY = 5 explicitly excluded: generated stale schema snapshots (2), `.vscode` local files (2), unrelated root `0` (1)  
PARENT_LOCAL_ONLY_FILES_REMAINING = 0  
PARENT_UNPUSHED_COMMITS_REMAINING = 0  
EXACT_HEAD_CI = FAILED for `8f3f45b4` run `36338197362`; no replacement run has been queued

## Database

REPO_SCHEMA_HEAD = source/schema.ts + migration 0058  
REPO_MIGRATION_HEAD = 0058 (56 SQL migration files through 0058; no duplicate numbers)  
LOCAL_SCHEMA_HEAD = 0058 on fresh disposable MySQL 9.7, loopback-only port 33061  
LIVE_PCA_PRO_SCHEMA_HEAD = NOT_INSPECTED; no live DB access/mutation in checkpoint  
LOCAL_DB_SCHEMA_MATCH = PARTIAL; 92 tables, 792 columns, 104 FKs and 282 checks; physical indexes match canonical bootstrap; CHECK text has 8 version-sensitive charset-introducer differences  
LIVE_PCA_PRO_SCHEMA_MATCH = NOT_YET_PROVEN  
LIVE_GRANTS_MATCH = NOT_YET_PROVEN  
MIGRATION_REQUIRED = YES for migration 0057 actor provenance and migration 0058 service-account index reconciliation; live state not inspected  
MIGRATION_APPLIED = 0058 applied and replay-verified on disposable MySQL 9.7 only; no live apply  
LOCAL_RUNTIME_GRANTS = 92/92 exact table grants for disposable principal; production grants NOT_INSPECTED  
NO_SEED_DATA = YES

## Release

LOCALHOST_READY = NOT_YET_PROVEN for owner acceptance  
LOCALHOST_ACCEPTED = NO  
PUSH_AUTHORIZED = YES, checkpoint synchronization only; current checkpoint is pushed  
DEPLOY_AUTHORIZED = NO  
API_DEPLOYMENT = NOT STARTED  
PARENT_WEB_DEPLOYMENT = NOT STARTED  
PLATFORM_WEB_DEPLOYMENT = NOT STARTED  
OWNER_PRODUCTION_ACCEPTANCE = NOT OFFERED

## Open Risks

CURRENT_P0 = NOT_YET_PROVEN (checkpoint-wide fresh severity review incomplete; historical assessment is date-bound)  
CURRENT_P1 = NOT_YET_PROVEN (refresh release severity review before TODO-18/21)  
CURRENT_P2 = Schedule-policy Trust Set authority; web-rule `503 not_configured`; process-local bonus revoke actor metadata; no safe production device-policy activation path.

## Blockers

BLOCKERS = Docker unavailable; local MySQL 9.7 passes migration checks but is not MySQL 8.4; live `pca_pro` schema/grants remain uninspected because no verified target is configured; exact-head CI run `36338197362` failed and GitHub is unreachable through current proxy; integrated browser/mobile/owner tests remain open; schedule-policy and web-rule production authority remain fail-closed; device crypto/trust/policy bootstrap remains unavailable; TODO-18 literal owner acceptance has not been offered; Platform work package remains on HOLD_PARENT_DEPENDENCY; no Azure deployment or production acceptance is authorized by the checkpoint.

## Next Action

NEXT_ACTION = Resolve failed Quality Gates and obtain corrected exact-head results; reproduce browser failures under CI env; run schema/migration equivalence on MySQL 8.4; verify the read-only `pca_pro` target before any live action. Continue TODO-12/15 and keep Platform Enrollment held until Parent TODO-01…17, TODO-16 projection and TODO-18 literal acceptance pass.

## Checkpoint History

### 2026-09-27 17:37 UTC — synchronized Parent/Platform implementation checkpoint

LOCAL_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3  
REMOTE_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3  
TODO_CHANGES = TODO-01 preservation/synchronization PASS; TODO-19 checkpoint sync complete but exact-head CI pending; TODO-12…17 remain active; TODO-18 acceptance remains NO.  
FILES_CHANGED = Eight logical checkpoint commits; 326 classified paths committed; five explicit exclusions preserved.  
TESTS = Backend focused 188/188; backend build and Parent/Platform typechecks PASS; migration recovery 3/3; registration + production-path checks 14/14; MySQL/browser unavailable.  
BLOCKERS = MySQL/Docker unavailable; exact-head CI pending; device crypto/trust and owner acceptance gates remain.  
DECISIONS = No Azure or live DB mutation; no force push; separate dated peer assessment snapshots preserved; schema snapshots excluded due drift.  
NEXT_ACTION = Continue same Pursuing Goal from TODO-12/15 and integrated TODO-17.

### 2026-09-27 17:40 UTC — master TODO ledgers initialized

LOCAL_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3 before the control-file commit  
REMOTE_HEAD = 114b784ea33112cb3bebd64b454866481d8b3ba3 before the control-file commit  
TODO_CHANGES = All 23 canonical Parent TODOs populated; no status promoted without evidence.  
FILES_CHANGED = Parent and Platform Git-visible master TODO files created under `docs/pca_independent_senior_reviewer/`.  
TESTS = No source changes; existing checkpoint evidence summarized with historical/current labels.  
BLOCKERS = Exact-head CI pending; MySQL unavailable; owner acceptance not received.  
DECISIONS = Base both ledgers on exact synchronized source tree 114b784e.  
NEXT_ACTION = Commit/push the two ledgers, verify remote contents/equal heads, then continue TODO-12/15.

### 2026-09-27 17:43 UTC — master TODO publication verified

LOCAL_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
REMOTE_HEAD = 27757ca77e0edec417516784dc3e59da6855896e before this ledger update  
TODO_CHANGES = 23/23 Parent TODOs and 16/16 Platform TODOs populated; no TODO was promoted without evidence.  
FILES_CHANGED = Both requested master TODO files were committed as `27757ca7` and verified on origin/pca-dev.  
TESTS = Structural ledger checks passed; no product source changed.  
BLOCKERS = Exact-head CI run 36338197362 is queued at 8f3f45b4; MySQL unavailable; Parent localhost acceptance not received.  
DECISIONS = Base both ledgers on pushed publication 8f3f45b4 and keep historical test evidence distinct from current runs.  
NEXT_ACTION = Finish and locally validate the CI fixture correction; investigate failed Parent Web browser cases under the exact CI demo-mode environment; obtain a corrected exact-head CI run. Then resume TODO-12/15 and, once TODO-19 plus live-target preflight permit, execute TODO-20 under the owner's authorization.

### 2026-09-27 17:59 UTC — TODO-15 state correction and TODO-20 authorization

LOCAL_HEAD = 8f3f45b47d24cc7debd581230eda23c088d74f4e; origin/pca-dev matched after fetch  
TODO_CHANGES = TODO-15 now records the local, tested `REDEEMED` enrollment copy correction. TODO-20 retains its existing TODO and records owner authorization and required fail-closed migration gates.  
FILES_CHANGED = AddDeviceWizard, EN/AR locale, dev fixture, component regression; master ledgers updated locally. Generated snapshots remain untouched by coordinator.  
TESTS = Redeemed-but-not-paired Parent Web regression 1/1 PASS; Parent Web typecheck PASS. First sandboxed Vitest launch failed with spawn EPERM; scoped retry passed.  
BLOCKERS = Quality Gates 36338197362 is queued at 8f3f45b4; Docker engine unavailable despite authorized start attempt; no verified `pca_pro` target; live DB not inspected.  
DECISIONS = Keep `REDEEMED` distinct from paired/active; do not fabricate a device sender or metadata transport. Do not bypass TODO-19, seed data, hand-edit snapshots, or connect local tests to production.  
NEXT_ACTION = Resolve current exact-head CI and local engine access; resume TODO-12/15 code and validation; execute TODO-20 automatically after its gate and target preflight are available.

### 2026-09-27 19:49 UTC — TODO-19 CI failure diagnosis and E2E fixture wiring

LOCAL_HEAD = `8f3f45b47d24cc7debd581230eda23c088d74f4e`; current changes remain uncommitted  
EXACT_HEAD_CI = `36338197362` FAILED at `8f3f45b4`; no newer run yet  
FILES_CHANGED = `.github/workflows/quality-gates.yml` now creates a random `pca_test_codex_<32 hex>` DB on ephemeral MySQL, sets the required owner marker, places the private fixture manifest in `os.tmpdir()`, reads from that path, and removes it with an `always()` cleanup step. Parent EN/AR REDEEMED copy and migration-0050/0057 recovery-test changes remain local. Generated snapshots and machine-local files remain excluded.  
TESTS = Migration resumability/recovery 8/8 PASS; workflow YAML parse PASS; workflow `git diff --check` PASS.  
CI_FAILURES = Migration 0050 replay hit an incompatible event-check rewrite; migration 0057's named atomic recovery was rejected by generic resumability classification; E2E fixture lacked random disposable DB ownership and private manifest wiring; Parent Web shard 6 timed out; browser E2E failures remain under investigation.  
ENVIRONMENT = `gh` cannot reach GitHub through configured proxy `127.0.0.1:9`. Browser runner was tried without CI demo-mode env, so its route failures are invalid for CI attribution. Retry with CI environment was blocked because automatic approval review reported workspace approval credits exhausted; no bypass attempted. Docker/MySQL remains unavailable.  
DECISIONS = Keep live DB untouched until TODO-19 is executable and a verified read-only `pca_pro` target/preflight exists. YAML parsing is not a CI pass.  
NEXT_ACTION = Review the E2E workflow fix, obtain a new exact-head CI result when GitHub access is restored, then continue earliest unfinished TODOs and start TODO-20 as soon as its gates are executable.

### 2026-09-27 20:01 UTC — TODO-20 disposable MySQL reconciliation

LOCAL_HEAD = `8f3f45b47d24cc7debd581230eda23c088d74f4e`; worktree changes remain uncommitted  
LOCAL_DATABASE = Fresh disposable MySQL 9.7 datadir under OS temp; loopback-only port 33061; `pca_test_codex_e8d429f2bcdd42109f67bc4258445600`; no test-fixture/application rows, only migration-required reference data.  
SCHEMA = All 56 migrations through 0058 applied; 92 tables, 792 columns, 104 FKs, 271 physical indexes including PKs, and 282 checks. Canonical-bootstrap comparison has identical index structure and aggregate table/column/FK/check counts. Eight CHECK-clause text renderings differ only by `_ascii`/`_utf8mb4` introducers under MySQL 9.7 and need MySQL 8.4 confirmation.  
MISMATCH = Migration 0044 omitted canonical `family_authority_request_challenges_service_fk`. Additive idempotent migration 0058 now adds it and schema metadata records the migration. Existing MySQL-generated `parent_genesis_step_up_service_account_fk` is now represented in canonical schema metadata.  
FILES_CHANGED = Migration 0058, `backend/src/db/schema.ts`, Parent MFA DB replay regression, regenerated disposable-bootstrap artifacts, migration 0050 idempotency-test title, CI fixture workflow, Parent enrollment copy/test and both master TODOs. Generated stale DB snapshots remain untouched.  
TESTS = MySQL migration 0050/0058 replay 2/2 PASS; schema/migration structural tests 13/13 PASS; runtime-grant policy tests 16/16 PASS; local runtime grant readback matches 92/92 statements and has zero broad/elevated grants; 56 migrations applied and second runner invocation is a no-op; disposable bootstrap `--check` PASS; workflow YAML parse PASS; owned-source `git diff --check` PASS. MySQL 9.7 is not an 8.4 certification.  
LIVE = No `pca_pro` target/credentials found; no live read or mutation. TODO-20 remains gated on failed TODO-19 exact-head CI and verified live preflight.  
NEXT_ACTION = Resolve TODO-19 CI access/failures; obtain MySQL 8.4 disposable validation and verified read-only `pca_pro` target; then continue authorized local-first/live-preflight work without test-data seeding or data loss.

### 2026-09-27 20:05 UTC — TODO-20 local runtime grant reconciliation

LOCAL_DATABASE = Same disposable loopback-only MySQL 9.7 DB; temporary local-only runtime principal  
GRANTS = `runtimeGrantPolicy.test.mjs` passed 16/16. `provision-runtime-db-grants.mjs` provisioned 92 table grants; `SHOW GRANTS` matched all 92 table-level plan entries exactly after MySQL user-quote normalization; zero broad/elevated grants. No live grant mutation occurred.  
PARENT_WEB = Focused Vitest startup blocked by Windows `spawn EPERM` from the esbuild child process; previous focused EN/AR and enrollment regression results remain historical. Playwright retry with CI env remains blocked by approval-review credits; the attempt without CI env is not valid CI reproduction.  
LIVE = `pca_pro` remains uninspected and unmutated; owner authorization remains active after TODO-19 and live-target/preflight gates.  
NEXT_ACTION = Resolve exact-head CI and browser QA access, verify MySQL 8.4, and discover a verified read-only `pca_pro` target before any live action.

### 2026-09-27 20:09 UTC — TODO-20 disposable data and QA checkpoint

DATA_CHECK = Disposable DB has 0 Parent accounts, 0 families, 0 devices, and 0 Platform Admin accounts; only migration-required reference rows exist.  
GRANTS = Local disposable principal remains at 92/92 exact table-level grants with zero broad/elevated grants; production grants NOT_INSPECTED.  
VALIDATION = Focused Vitest retry hit esbuild `spawn EPERM`; no pass inferred. GitHub remains unreachable through the configured proxy and no new exact-head CI run exists.  
LIVE = No pca_pro target/credentials available in the checked process; no live inspection or mutation.  
NEXT_ACTION = Continue TODO-19 CI recovery and the MySQL 8.4/live-target discovery gates; retain TODO-20 authorization and execute live preflight before any mutation.

### 2026-09-27 20:12 UTC — TODO-20 migration shape regression verified

LOCAL_DATABASE = Fresh disposable loopback-only MySQL 9.7 at 127.0.0.1:33061; no application/test entities were seeded. The migration-0058 regression cleaned up its deliberately malformed index and left the canonical service-account index restored.
MIGRATION = 0058 now passes replay against the valid index and fails closed when a same-named index targets the wrong column; test assertion uses explicit result aliases for MySQL driver compatibility.
TESTS = Focused MySQL migrations 0050/0058 2/2 PASS; canonical schema drift, migration resumability, and actor recovery structural suite 13/13 PASS; disposable bootstrap `--check` PASS; owned source/migration/workflow/bootstrap diff check PASS.
SCHEMA_LIMIT = Full MySQL 8.4 validation is still required; local 9.7 CHECK-clause text has eight charset-introducer-only differences. This is not a declared full-version certification.
LIVE = `pca_pro` and production grants remain uninspected and untouched. TODO-19 exact-head CI remains failed; no verified live database target is available.
NEXT_ACTION = Continue exact-head CI recovery and MySQL 8.4/live-target discovery. Execute the already-authorized live preflight/migration/grant sequence only after both gates are executable; preserve zero-seed and zero-data-loss requirements.

### 2026-09-27 20:23 UTC — TODO-17 CI failure source mapping and Parent browser corrections

GIT = `git ls-remote origin refs/heads/pca-dev` confirms remote remains `8f3f45b47d24cc7debd581230eda23c088d74f4e`; no new commit is published yet. `gh run view 36338197362` succeeds after removing proxy environment variables in that process only; exact-head run conclusion is FAILED. `git fetch` still cannot write `.git/FETCH_HEAD` (permission denied); no lock or metadata was removed.
CI_FAILURE_MAP = Unit shard failure was a 5-second timeout in the Viewer pairing-request component case; its local timeout is now 15 seconds. Migration 0050 replay failed after 0051 widened the event check; migration 0050 no longer rewrites that 0051-owned check. Migration 0057 is a single atomic recovery DDL; its narrow exception is named and tested in resumability classification. Real-backend fixture failure used fixed `pca_test` and missing manifest; workflow now creates a random owned DB and temporary manifest path. Parent Playwright failures were: invitation-token/overflow scenarios omitted operation-bound TOTP, trusted-browser test expected a retired state machine instead of redirect, and export test expected an obsolete generic re-auth prompt rather than current TOTP step-up. Specs now follow those current contracts.
TODO12_14_AUDIT = Read-only specialist audit confirms schedule-policy and Web Rules still fail closed behind device/Trust Set and unavailable durable storage; no safe route-only removal preserves real sender-device/envelope integrity. Parent audit actor model has sentinel/device-shape ambiguity and needs explicit model work before re-labeling. Reserved ownership-transfer/recovery-material operations remain non-issuable without an owner-approved policy. Aggregate unexpected 401/403 counts remain NOT_YET_PROVEN.
FILES_CHANGED = 21 mission paths: corrective workflow, migrations 0050/0058, schema source, DB/resumability/production-path tests, disposable bootstrap artifacts, Parent EN/AR enrollment state and component coverage, Parent Playwright E2E specs, disposable runner guard, and both existing master TODO ledgers. Stale `backend/schema/current_schema.sql` and `schema_manifest.json`, `.vscode/`, and root fragment `0` are excluded from the checkpoint.
LOCAL_VALIDATION = Disposable MySQL 9.7: migration 0050/0058 replay 2/2 PASS; migration/schema structural suite 13/13 PASS; disposable bootstrap `--check` PASS. Parent Web lint PASS; typecheck PASS; Playwright collection 17 tests/3 files PASS (no browser bodies executed); focused disposable-runner guard regression 1/1 PASS; workflow YAML parse PASS; owned-source diff check PASS. Browser execution remains unverified because the prior CI-mode local Chromium request was rejected by automatic approval review.
TODO17_STATUS = IN_PROGRESS; do not infer full DB/browser PASS from the narrow local evidence or failed baseline CI.
TODO19_STATUS = IN_PROGRESS; current mission changes remain local until reviewed checkpoint commit/push and fresh exact-head CI.
NEXT_ACTION = Complete integration review, publish only the 23 current mission paths, obtain corrected exact-head CI, and continue TODO-12/14/17; preserve the Parent policy/actor blockers and Platform HOLD_PARENT_DEPENDENCY.
