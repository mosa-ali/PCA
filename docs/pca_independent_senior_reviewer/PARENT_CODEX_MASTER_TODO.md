# PCA Parent Authentication + Authority — Codex Master TODO

## Mission

PURSUING_GOAL = PCA Parent Authentication + Authority — Continuous Completion  
BRANCH = pca-dev  
MISSION_STATUS = IN_PROGRESS  
LAST_UPDATED_UTC = 2026-09-27 23:27 UTC
LOCAL_HEAD = 578dc0bbfcb050b8289adf7f10cbf1002c3082a2
REMOTE_HEAD = 578dc0bbfcb050b8289adf7f10cbf1002c3082a2 (fresh fetch and GitHub ref match)
CURRENT_CHECKPOINT_SHA = fbba783d5e5c3b2fe8c0f98ef02d3f8abc1eab29 (source migration checkpoint; verified ledger publication `578dc0bb`)
COORDINATOR = Current Codex agent  
CURRENT_ACTIVE_TODO = TODO-12 through TODO-17, TODO-19, and TODO-20 (0059 exact-head CI plus final live schema/grant reconciliation)
NEXT_ACTION = Inspect exact-head Quality Gates run `36358762949` for published SHA `578dc0bb`; because this ledger records that publication, require a passing run at the eventual final ledger-sync head before live 0059. Then repeat live preflight immediately before applying 0059 to `pca_pro`, compare exact schema, data row counts, and grants, then continue the same TODO board. Keep schedule-policy/Web Rules fail-closed.

The implementation checkpoint payload is at `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`; canonical-ledger sync is `114b784ea33112cb3bebd64b454866481d8b3ba3`; master TODO publication is `27757ca77e0edec417516784dc3e59da6855896e`; publication-state sync is `8f3f45b47d24cc7debd581230eda23c088d74f4e`; corrective checkpoint is `0ba4c0d8c5631283267c0af2a8dc6046bd4c0552`; ledger sync is `47d564c4af1fd6535dd1c9211cbf9c06a46970fb`; corrective CI-fixture checkpoint is `1949ead054ae93b30fbd7c69dd4e41649b50bdbc`; ledger sync is `0daf66008a801e5006c16130ae9f1adb052bd1f4`; daily browser-grant fixture correction is `a76aacae1710a7ff2fdc37788b0a291b3220decd`; latest prior ledger sync is `9c50e8efd7f18c18d7e16ec0ef6697fb88026064`; MFA step-up correction is `f51fe3dff3da62c045d1f8fd9d9a81be02efb2a7`. Exact-head run `36351171969` at `9c50e8ef` failed only the real-backend browser E2E job, with 26 jobs passing; its grant-based cross-family API check passed; the MFA-gated invitation correction is committed locally and awaits exact-head CI.

### 2026-09-27 20:58 UTC — Parent corrective checkpoint pushed and verified

CHECKPOINT = `1949ead054ae93b30fbd7c69dd4e41649b50bdbc` pushed fast-forward to `origin/pca-dev`; fresh fetch, local HEAD, origin tracking ref, and `git ls-remote` all agree. Commit contains exactly the workflow, backend package/runner, Viewer component test, and both mission ledgers.
CI = Exact-head Quality Gates run `36349986015` is queued at this SHA. Local evidence remains syntax PASS, 14/14 structural/resumability tests PASS, Parent Web typecheck PASS, and lint PASS; CI/browser component execution has not yet been proven.
TODO20 = Full owner authorization remains recorded. No live `pca_pro`/grant inspection or mutation occurred; exact MySQL 8.4 schema equivalence and verified live target/preflight remain open.
NEXT_ACTION = Inspect run `36349986015` to completion and continue the same Parent mission from the earliest unfinished TODO. Preserve the Platform dependency hold.

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
EVIDENCE = Exact-head run `36348596733` at `47d564c4` completed with 24 jobs passing and three failing. Parent Web demo-mode Chromium E2E passed. The backend full MySQL suite passed on MySQL 8.4, but the following populated-path campaign ran against an empty `pca_test` after `test:db` had already dropped its owned random database. Real-backend E2E database setup issued a `CREATE DATABASE` statement with an empty identifier because shell quoting removed the dynamically joined name. Parent unit shard 6 failed only the Viewer pairing case: remounting the demo page lost its in-memory fixture, so lookup returned Not found instead of the pairing data. Corrective local changes make the E2E SQL shell-safe, run both DB campaigns inside one disposable DB lifetime, and change Viewer authority in place without remounting.  
BLOCKER = The fixes above are not yet pushed or rerun. Parent Web lint/typecheck pass; the 14-test DB-free migration/production-path structural suite passes. Local Vitest cannot start esbuild in this Windows sandbox (`spawn EPERM`); GitHub CI must verify the changed component. MySQL 9.7 local migration 0050/0058 and schema evidence remain distinct from the CI MySQL 8.4 full DB suite. Mobile/device external crypto gates remain.  
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
EVIDENCE = Checkpoint `399304c080e82c36719e4d5bf34953444181ecb8` (Platform real-backend E2E correction plus both master TODO ledgers) is fast-forward pushed to `origin/pca-dev`; post-push fetch, tracking ref and `git ls-remote` agree. Exact-head Quality Gates run `36356186069` completed SUCCESS at this SHA with all jobs passing. Source correction `102192b3` and ledgers are published; unrelated dirty paths remain excluded.
BLOCKER = Exact-head CI gate is PASS. Remaining TODO-19 release/acceptance sequence remains gated by TODO-18 and dependent Platform validation; this does not block the separately authorized TODO-20 schema reconciliation.
DONE_WHEN = local/remote align, complete approved state is remote, exact-head CI PASS, and all files are classified  
LOCAL_HEAD = 47d564c4af1fd6535dd1c9211cbf9c06a46970fb (current committed baseline; corrective changes are local)  
REMOTE_HEAD = 47d564c4af1fd6535dd1c9211cbf9c06a46970fb (fetch + GitHub ref verified)  
PARENT_LOCAL_ONLY_FILES_REMAINING = 6 current mission correction/ledger paths; 2 stale snapshots, 2 machine-local .vscode paths, and root fragment `0` remain excluded  
PARENT_UNPUSHED_COMMITS_REMAINING = 0  
EXACT_HEAD_CI = FAILED (`36348596733` at `47d564c4`); previous run `36338197362` FAILED at `8f3f45b4`; its replacement run `36348261937` was cancelled by superseding push

### TODO-20 — Live schema / DB grants reconciliation

STATUS = IN_PROGRESS (0051–0058 live migration PASS; corrective 0059 local validation PASS; exact-head CI and 0059 live preflight pending)
OWNER = Coordinator  
FILES = Repository schema/migrations, local PCA DB, live `pca_pro`, runtime grants  
AUTHORIZATION = Owner reminder received 2026-09-27: full repository/local/live pca_pro/runtime-grant reconciliation is approved; ordinary additive/corrective migrations may proceed only after local test and fresh live preflight.  
EVIDENCE = Canonical schema + migrations through 0059 declare 92 tables, 792 columns, 104 foreign keys, 92 primary keys, 38 unique non-primary indexes, 141 non-unique indexes, and 282 checks. Isolated MySQL 8.4.11 from-zero verification passed with 57 migrations; Parent target passed 61 tests with 3 expected privileged-mode skips; Platform Admin target passed 11/11. Focused migration-upgrade safety tests passed 3/3, including 0059 conversion of the two historical cp850 checks to the actual canonical clauses (`purpose` `_ascii`, hash `_utf8mb4`), enforced state, row-count preservation, and replay. Generated canonical schema and bootstrap artifacts were rebuilt from repository migrations plus local SHOW CREATE introspection. Live official runner applied 0051–0058; postflight reports journal=56, 92 tables, 792 columns, 104 FKs, 92 PKs, 38 unique indexes, 141 non-unique indexes, and 282 checks. Exact object-by-object row-count comparison passed for 90 application tables; the journal increased by the expected eight rows and `parent_account_security_events` remains unreadable through the runtime identity. The 7 Parent identity columns were null across 3 existing Parent rows; Family epoch=1 for the existing family; actor fields null with zero approval requests. One index, two Parent actor FKs, and six enforced Parent checks were verified. Live runtime grants remained exact at 92/92 after 0051–0058. A historical literal-charset difference remained in the two 0049 checks; corrective 0059 is locally tested and committed, awaiting exact-head CI and fresh live preflight/application. No live changes from 0059 have occurred.
LOCAL_SERVICE_REPAIR = Downloaded official MySQL 8.4.11 Windows archive and verified its published MD5; extracted and initialized a loopback-only instance on 127.0.0.1:33361 under a fresh OS-temp datadir. No installed MySQL service or existing datadir was started or touched. Local DB harness uses only disposable databases and test-only credentials; no live credentials/data were used locally.  
PCA_PRO_TARGET = VERIFIED read-only at Azure MySQL Flexible Server `pca-mysql.mysql.database.azure.com` / database `pca_pro`, version `8.4.9-azure`; TLS cipher `TLS_AES_256_GCM_SHA384`. The API CNAME points to a hostname absent from the listed App Services; API owner remains unidentified.  
BLOCKER = Exact-head CI for local checkpoint `fbba783d` is pending. On pass, perform fresh live read-only preflight immediately before 0059; live application through 0058 is complete and verified.
DONE_WHEN = repository schema matches local DB and pca_pro; required migration locally tested and live-applied if required; grants match; no seed data  
NO_SEED_DATA = YES (no test fixtures or application rows; only migration-required reference data)  
DATA_LOSS = 0  
NO_BLIND_DB_PUSH = YES  
LOCAL_TEST_FIRST = PASS on disposable MySQL 8.4.11: from-zero 57-migration verify; focused migration-upgrade 3/3; Parent 61/0/3skip; Platform 11/11; prior dedicated Parent grant 3/3 and Platform grant 5/5
LIVE_PREFLIGHT_BEFORE_MUTATION = YES  
REPOSITORY_SCHEMA_MATCH_AFTER = PARTIAL; the two corrected local expressions match MySQL 8.4.11 SHOW CREATE, and generated bootstrap artifacts pass `--check`; full structural local/live comparison awaits live 0059.
LOCAL_DB_SCHEMA_MATCH_AFTER = PASS; fresh Parent/Platform databases applied all 57 migrations; post-0059 local snapshot has canonical totals and normalized checks.
LIVE_PCA_PRO_SCHEMA_MATCH_AFTER = PARTIAL; migration/count/data effects through 0058 pass, with only the two proven 0049 literal-check expressions pending 0059.
LIVE_GRANTS_MATCH_AFTER = PASS after live 0051–0058; 92 expected/92 present, exact, no broad grants. Reverify after 0059. `parent_account_security_events` is intentionally INSERT-only per plan; do not treat its denied SELECT as a mismatch.
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

BLOCKERS = Exact-head CI for the new 0059 checkpoint and final live 0059 schema/grant comparison remain open; integrated browser/mobile/owner tests remain open; schedule-policy and web-rule production authority remain fail-closed; device crypto/trust/policy bootstrap remains unavailable; TODO-18 literal owner acceptance has not been offered; Platform work package remains on HOLD_PARENT_DEPENDENCY; no Azure deployment or production acceptance is authorized by the checkpoint.

## Next Action

NEXT_ACTION = Publish and obtain exact-head CI for 0059; after CI PASS, repeat live preflight, apply 0059, and verify exact schema/data/grants. Then resume the earliest unfinished Parent TODO and keep Platform Enrollment held until Parent TODO-01…17, TODO-16 projection and TODO-18 literal acceptance pass.

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

### 2026-09-27 20:30 UTC — corrective checkpoint published; TODO-20 reminder reaffirmed

CHECKPOINT = `0ba4c0d8c5631283267c0af2a8dc6046bd4c0552` fast-forward pushed to `origin/pca-dev`; post-push fetch succeeded and local HEAD = origin/pca-dev = GitHub branch ref. GitHub contents API confirms both Parent and Platform master TODO files exist remotely at this checkpoint.
FILES = 21 reviewed mission paths committed; stale schema snapshots, `.vscode/`, and unrelated root fragment `0` remain excluded. Specialist QA source review mapped the five prior Parent browser failures to the corrected specs; no local browser body run is claimed.
CI = Corrected exact-head Quality Gates run `36348261937` is in progress at `0ba4c0d8`; prior failed run remains historical evidence only.
TODO20 = Owner's reminder reconfirmed existing full TODO-20 authorization: repository/local/live `pca_pro`/runtime grant reconciliation and ordinary proven additive/corrective migration are approved with NO_SEED_DATA=YES, DATA_LOSS=0, LOCAL_TEST_FIRST=YES, and fresh live preflight before mutation. Local disposable MySQL 9.7 is responding at 127.0.0.1:33061 but its CHECK rendering equivalence remains version-sensitive; required MySQL 8.4 equivalence and verified live `pca_pro` target are unavailable. No live DB/grants inspected or mutated.
NEXT_ACTION = Update and publish both ledgers for checkpoint `0ba4c0d8`; monitor exact-head run `36348261937`; continue TODO-20 local environment/version diagnosis and verified live-target discovery when gates are executable. Do not seed data, mutate unverified live resources, or promote partial schema equality.

### 2026-09-27 20:57 UTC — corrective CI harness local verification; TODO-20 authorization reaffirmed

LOCAL_VALIDATION = `node --check scripts/with-disposable-db.mjs` PASS; `productionPathCertification.test.mjs` + `migrationResumability.test.mjs` PASS 14/14 after the `all-certified` runner change. Parent Web `pnpm run typecheck` PASS and `pnpm run lint` PASS after the Viewer test edit. No browser/component execution or fresh exact-head CI PASS is claimed.
PUBLISH_SET = Four reviewed implementation paths plus both existing mission ledgers are intended for the next checkpoint. Dirty generated schema snapshots `backend/schema/current_schema.sql` and `schema_manifest.json`, `.vscode/`, and root fragment `0` remain excluded; their state was not used to manufacture TODO-20 schema agreement.
TODO20 = Owner reaffirms the existing TODO-20 authorization and all required zero-seed, zero-data-loss, local-first, live-preflight, and post-reconciliation checks. Local-only validation does not close the MySQL 8.4 or verified-live-target gates. `pca_pro` and live grants remain uninspected and unmutated.
NEXT_ACTION = Publish the exact six mission paths, inspect new exact-head CI results, then continue the earliest unfinished Parent TODO and TODO-20 when its version/target gates are executable. Platform remains on HOLD_PARENT_DEPENDENCY.

### 2026-09-27 21:11 UTC — exact-head E2E auth fixture diagnosis and correction

CI = Run `36350073129` completed FAILED at `0daf66008a801e5006c16130ae9f1adb052bd1f4`: 26 jobs passed, one failed. Real-backend browser E2E ran two acceptance-flow cases but login did not establish a session (`sessionEstablished=false`; browser remained `/login`). The flow had omitted the run-owned daily browser-grant cookies already provided by its disposable fixture and used by the companion MFA E2E. No backend/schema failure is inferred from this test result.
LOCAL_VALIDATION = Backend build PASS; bounded TODO-14 route/action campaign PASS 154/154 with `NODE_ENV=test`; Parent Web typecheck PASS, lint PASS, and Playwright collection lists both acceptance-flow tests. No real-browser body execution is claimed locally.
PARENT_FIX = Acceptance-flow UI login and both API logins now attach the fixture's primary/secondary daily browser-grant cookie before authenticating; required grant variables fail closed with the other fixture prerequisites. The correction is local and pending review/publication and a new exact-head run.
TODO20 = Owner authorization remains active. No live DB/grants inspected or mutated; full schema equivalence and verified `pca_pro` target/preflight remain open.
NEXT_ACTION = Review, publish, and validate the E2E grant fix; retain all TODO-20 fail-closed gates and continue the same goal after CI.

### 2026-09-27 21:16 UTC — daily browser-grant E2E correction published

CHECKPOINT = `a76aacae1710a7ff2fdc37788b0a291b3220decd` fast-forward pushed to `origin/pca-dev`; post-push fetch, tracking ref, and remote branch SHA agree. Commit contains the acceptance-flow real-backend spec and both updated master TODO files.
CI = Exact-head Quality Gates run `36351084552` is queued at this SHA. The prior `36350073129` run completed with 26 jobs passed and one real-backend E2E job failed because the acceptance-flow login omitted its disposable daily browser grants.
LOCAL_VALIDATION = Parent Web typecheck/lint PASS and acceptance-flow Playwright collection PASS (two tests listed); backend build and TODO-14 route/action suite PASS 154/154 under `NODE_ENV=test`. Real-browser assertions await CI.
TODO20 = Authorization remains active. No live database/grants inspected or mutated; exact MySQL 8.4 schema equivalence and verified live target remain open.
NEXT_ACTION = Inspect `36351084552` to completion and continue the same mission from the next executable Parent TODO; Platform remains on HOLD_PARENT_DEPENDENCY.

### 2026-09-27 21:26 UTC — real E2E grant fixed; MFA step-up uncovered

CI = Exact-head run `36351171969` completed FAILED at `9c50e8efd7f18c18d7e16ec0ef6697fb88026064`: 26 jobs passed, one real-backend E2E job failed. The grant-based cross-family API test passed. The owner flow authenticated and reached device invitation creation, where the test timed out waiting for the invitation POST because `CREATE_DEVICE_INVITATION` requires fresh TOTP step-up.
PARENT_FIX = Owner-flow E2E now uses the disposable enrolled-MFA Parent, completes unknown-browser email OTP + TOTP login, then enters a fresh TOTP in the sensitive-action dialog after waiting for a new counter. Cross-family isolation retains the primary/secondary grace accounts and their daily grants. Local typecheck, lint, and two-test collection PASS; browser execution is pending.
TODO20 = Existing authorization remains active; no live database/grants inspection or mutation. MySQL 8.4 schema equivalence and verified live target/preflight remain open.
NEXT_ACTION = Complete independent test review, publish the MFA step-up correction and ledger updates, then validate exact-head CI and continue the same Pursuing Goal.

### 2026-09-27 21:34 UTC — TODO-20 authorization reconfirmed; local validation refreshed

OWNER_AUTHORIZATION = Owner reconfirmed that existing TODO-20 already authorizes full repository/local/live `pca_pro`/runtime-grant reconciliation and ordinary proven corrective migrations. Preserve NO_SEED_DATA=YES, DATA_LOSS=0, LOCAL_TEST_FIRST=YES, fresh live preflight, and every post-migration equality check. No new TODO or mission was created.
LOCAL_VALIDATION = Parent Web typecheck PASS; lint PASS; `playwright.real.config.ts --list` PASS with 12 real-backend tests collected (including both acceptance-flow cases). The first collection invocation used a nonexistent config path and is disregarded. Browser execution has not run locally.
TODO20_ENVIRONMENT = Docker service is stopped and Docker Engine reports access denied. Loopback port 33061 accepts TCP, but `backend/test.env` contains no `PCA_DATABASE_URL`, so the disposable server identity/version and schema cannot be safely established from this session. No database connection, live read, or mutation occurred. Continue local-environment diagnosis; do not infer MySQL 8.4 equality or treat port reachability as DB evidence.
REMOTE = `git ls-remote origin refs/heads/pca-dev` failed because GitHub HTTPS egress through the configured proxy was unavailable. No push or exact-head CI was attempted after that failure.
NEXT_ACTION = Commit only the reviewed acceptance-flow spec and these two ledgers, retry fetch/push/remote verification when network is available, then monitor exact-head CI. Continue TODO-20 local MySQL repair/version confirmation and verified live-target discovery under existing authorization; keep Platform on HOLD_PARENT_DEPENDENCY.

### 2026-09-27 21:37 UTC — MFA step-up correction committed locally

CHECKPOINT = `f51fe3dff3da62c045d1f8fd9d9a81be02efb2a7` commits exactly `parent-web/e2e-real/acceptance-flow.spec.ts` and the two existing master TODO ledgers. Parent Web typecheck/lint and real-config test collection (12 total, including two acceptance-flow cases) pass. Browser execution and exact-head CI remain unverified.
GIT = Local `pca-dev` is one implementation checkpoint ahead of recorded remote `9c50e8ef`; earlier `git ls-remote` failed on GitHub HTTPS egress. No force update, remote change, or unrelated file staging occurred.
TODO20 = Reaffirmed owner authorization remains in effect. No local database connection was made because `backend/test.env` only sets `NODE_ENV`; Docker Engine is inaccessible. Live target/grants remain uninspected and unmutated.
NEXT_ACTION = Publish the ledger correction describing verified remote publication, resolve GitHub Actions API access, then inspect exact-head CI and resume earliest executable Parent TODOs.

### 2026-09-27 21:40 UTC — checkpoint publication verified; TODO-20 engine diagnosis

PUSH = Fast-forward push succeeded. Fresh `git fetch origin pca-dev`, local HEAD, `origin/pca-dev`, and `git ls-remote origin refs/heads/pca-dev` all returned `effb3837990cb4dadbd99f5143dd25ba8459f143`. Implementation commit `f51fe3df` is a descendant of prior remote `9c50e8ef`; its tree contains exactly the acceptance-flow spec and two master TODO ledgers, followed by ledger sync `effb3837`.
CI = `gh run list --commit effb3837` could not reach GitHub API because configured proxy `127.0.0.1:9` refused connections. No CI result is inferred.
TODO20_ENVIRONMENT = Correction: `backend/test.db.env` does define loopback root URL for `pca_test`, but read-only connection was rejected `ER_ACCESS_DENIED_ERROR`; no SQL read or write succeeded. Docker service start was denied by Windows (`Cannot open 'com.docker.service'`). Read-only service inspection found MySQL80 stopped (8.0 config) and MySQL97 stopped with config `D:\MySQL\my.ini`, port 3306, and configured `D:\MySQL\Data` directory absent; neither service was started. The loopback 33061 listener did not authenticate the test-only credentials, so its server identity/version remains unproven. Live `pca_pro` and grants remain uninspected/unmutated.
NEXT_ACTION = Restore access to the disposable MySQL 8.4.11 environment without opening an unidentified data directory; establish server identity/version and schema locally, inspect live `pca_pro` read-only only after target proof, and inspect CI when GitHub API connectivity returns.

### 2026-09-27 21:52 UTC — exact-head CI exposed retired dashboard-copy assertion

CI = Exact-head Quality gates run `36352633376` at `85fd9bdee7f1d6acda70c411af22ddf1005423ec` completed FAILED: 26 jobs passed; only `Real-backend browser E2E` failed. Full backend MySQL certification, Web real-browser E2E, real-backend cross-family isolation, and all other jobs passed. The owner journey authenticated with MFA, created the child and invitation through fresh TOTP step-up, then failed on `/dashboard` because its final assertion expected removed copy `Family information is unavailable in this browser`. The rendered current state was the fail-closed `Not available yet` notice with “Your children's protected data cannot be opened on this browser yet.” No auth, invitation, or API isolation failure was reported.
PARENT_FIX = Updated the browser regression to assert the current fail-closed notice after navigation and reload while still asserting the retired “Set up this browser” action is absent. Local validation and a new exact-head run are pending.
TODO20 = Existing owner authorization remains. CI full DB suite passed on disposable MySQL; this does not close local MySQL 8.4 or live `pca_pro`/grant reconciliation. No live DB was inspected or mutated.
NEXT_ACTION = Run Parent Web typecheck/lint and Playwright collection, commit the assertion/ledger correction, push and verify, then inspect new exact-head CI.

### 2026-09-27 21:53 UTC — current dashboard copy assertion corrected locally

CHECKPOINT = `7a62fe603c7c09358321bdecace20fd544f5da44` commits the Parent E2E assertion correction and both mission ledgers. Parent Web typecheck/lint PASS; real config collection PASS (12 tests). This change is local-only pending publication.
EXPECTED_UI = After the MFA/invitation journey and reload, assert the current `Not available yet` heading and the truthful protected-data-unavailable sentence; continue asserting the retired `Set up this browser` action is absent.
NEXT_ACTION = Wire the existing Parent Email lookup into Entitlements so the real-backend contract in run `36353386170` is rendered; validate/publish with ledger updates, then inspect new exact-head CI. Continue locally gated live migration reconciliation.

### 2026-09-27 22:06 UTC — live pca_pro schema and grants read-only reconciliation

LIVE_TARGET = Verified `pca-mysql.mysql.database.azure.com/pca_pro`, Azure MySQL Flexible Server `8.4.9-azure`; TLS verification succeeded with `TLS_AES_256_GCM_SHA384`. Runtime URL was read from Key Vault in process memory and never printed. DNS for `api.pcasafe.com` points to a hostname absent from listed App Services; API owner remains unproven.
LIVE_SCHEMA = Read-only metadata: 92 tables, 782 columns, 102 FKs, 92 PKs, 38 unique non-primary indexes, 138 non-unique indexes, 278 checks. `schema_migrations` has 48 rows through `0050_parent_mfa_recovery_hold.sql`; repository has 56 files through 0058. Missing migrations are 0051–0058; their effects explain +10 columns, +2 FKs, +3 non-unique indexes, +4 checks (0051 replaces a check, net count 0). No row data was queried and no DDL ran.
LIVE_GRANTS = Compared live runtime principal `SHOW GRANTS` to `scripts/db/runtimeGrantPlan.mjs`: 92 expected and 92 present; no missing/extra table grants, privilege mismatches, or unexpected non-table grants beyond `USAGE`.
NO_MUTATION = `@@global.read_only=0`; only SELECT/SHOW ran. No live DDL or grant mutation. TODO-20 local MySQL 8.4 first-test gate, zero-seed, zero-data-loss and fresh-preflight conditions remain binding. CI disposable MySQL 8.4.11 full DB suite passed in run `36352633376`; it is not local validation.
CI = Run `36353386170` at `c76e2273` failed with 26 jobs passing. Parent MFA/child/invitation/reload and cross-family flows passed. Platform Admin E2E timed out on `.parent-email-lookup` in Enrollment > Entitlements. The resolver component exists but was not rendered anywhere; UI wiring is in progress.
NEXT_ACTION = Complete and validate the resolver integration, publish exact source/ledger files, then establish fresh disposable local MySQL 8.4 validation for 0051–0058 before any live mutation.

### 2026-09-27 22:10 UTC — Parent Email resolver locally validated

PLATFORM_FIX = Rendered existing `ParentEmailFamilyLookup` in Platform Enrollment > Entitlements, bound its server-resolved family ID to the existing entitlement read path. No frontend bulk family lookup was introduced; multiple-family selection remains provided by the component.
LOCAL_VALIDATION = Platform Admin typecheck PASS, lint PASS, production build PASS, and focused ParentEmailFamilyLookup/Entitlements/EnrollmentManagement suites PASS 14/14. Initial Vitest/build attempts hit Windows `spawn EPERM`; elevated reruns passed. Combined real-backend browser E2E remains pending.
NEXT_ACTION = Commit/publish only the Platform Entitlements integration and both master ledgers, verify exact remote SHA, then rerun Quality gates. TODO-20 live migration remains held until fresh local MySQL 8.4 migration validation.

### 2026-09-27 22:11 UTC — Parent Email resolver integration committed locally

CHECKPOINT = `643cb866feee65887623f71a536d9a8a34bb8643` commits only `platform-admin-web/src/pages/entitlements/Entitlements.tsx`; the component connects server-side Parent Email resolution to the existing entitlement detail. Platform typecheck, lint, production build and focused tests 14/14 pass. Earlier exact-head CI run `36353386170` exposed the absent component; new browser E2E awaits publication.
GIT = Local `pca-dev` is one source checkpoint ahead of verified remote `c76e2273`. Only the resolver integration and both mission ledgers are in the intended publication set; schema snapshots, `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Sync both ledgers to `643cb866`, publish source and ledger sync fast-forward, then verify and inspect new exact-head Quality gates.

### 2026-09-27 22:37 UTC — TODO-20 MySQL 8.4 restored and exact-head Platform E2E corrected

SOURCE_CHECKPOINT = `102192b31c1e883198ec68343064427697fbbfaa` corrects the real-backend Parent Email lookup journey. At failing exact-head run `36354470524` (`d32fc1b7`), the lookup correctly reported an eligible family before the first entitlement read lazily created its `FREE_STARTER` row. The test now asserts initial eligibility, the loaded entitlement, and `ALREADY_ENTITLED` on the second live lookup. Full local Platform real-browser E2E against disposable MySQL + Fastify PASS 1/1 (2.3m).
TODO20_LOCAL = Official MySQL 8.4.11 Windows archive checksum PASS; isolated loopback instance on `127.0.0.1:33361`, OS-temp datadir. `npm run db:verify` PASS from zero: MySQL 8.4.11, UTC, utf8mb4/utf8mb4_bin, all 56 migrations, 92 expected tables. Separate schema with 48 migrations through 0050 upgraded through official `db:migrate`: migrations 0051–0058 applied, journal 56, tables 92, Family and Parent row counts 0. Parent DB suite 61 PASS / 0 FAIL / 3 expected privileged-gate skips; Platform DB suite 11/11; dedicated Parent grant acceptance 3/3; Platform audit-grant acceptance 5/5.
TODO20_LIVE_READ_ONLY = Fresh identity remains `pca-mysql.mysql.database.azure.com/pca_pro`, MySQL `8.4.9-azure`, migration journal 48 through 0050, 92 tables, 782 columns, 102 FKs, 92 PKs, 38 unique indexes, 138 non-unique indexes, 278 checks. Live runtime grants match plan exactly (92/92). The 0050 event/operation CHECK expressions are strict subsets of the new migration allowlists; no live row data, DDL, or grants were changed. The runtime principal intentionally has INSERT-only access to `parent_account_security_events`, so its row count is not exposed by that identity. Local tests used disposable data only; no live credentials/data were used locally.
LIVE_GATE = No pca_pro mutation until TODO-19 exact-head CI passes. Run `36354470524` is FAILED solely at Platform Admin real-backend E2E; all other jobs passed. The correction is local in `102192b3`, and exact-head CI for that correction is pending publication. Repeat live preflight immediately before any eventual live mutation; preserve no-seed/data-loss requirements.
GIT = Current local source `102192b3`; last remote `origin/pca-dev` verified at `d32fc1b7` before this commit. Only the two mission ledgers remain to sync; generated schema snapshots, `.vscode/`, and root fragment `0` remain excluded.
NEXT_ACTION = Publish this source checkpoint and ledger sync, inspect the new exact-head CI result, then resume TODO-20 live migration/grant reconciliation only after the TODO-19 gate permits it.

### 2026-09-27 22:50 UTC — exact-head CI passed; TODO-20 live mutation gate open

CI = Quality Gates run `36356186069` completed SUCCESS at `399304c080e82c36719e4d5bf34953444181ecb8`; no failed jobs. The run includes the Platform real-backend browser correction and the current published master TODO ledgers. `git fetch origin pca-dev`, local HEAD, `origin/pca-dev`, and `git ls-remote origin refs/heads/pca-dev` all matched at this SHA.
TODO20 = Local MySQL 8.4.11 full-from-zero and 0050→0058 upgrade tests, Parent/Platform DB regressions, and both dedicated runtime-grant suites are PASS as recorded above. Live remains read-only at this point. Since TODO-19 exact-head CI now passes and the target is verified, proceed with a fresh immediate pca_pro preflight before any live migration; do not use local test credentials/data for live access.
NEXT_ACTION = Run and inspect the fresh live preflight; if target, schema journal, check compatibility, row-count baseline, and runtime grant-plan checks remain as proven, apply the official migration runner for 0051–0058 and verify schema, row preservation, and grants. Stop before any destructive or unexpected state.

### 2026-09-27 23:21 UTC — TODO-20 corrective migration locally validated

SOURCE = Local commit `fbba783d5e5c3b2fe8c0f98ef02d3f8abc1eab29` adds additive/corrective migration 0059 for the two proven literal-charset drifts, updates canonical schema from local MySQL 8.4.11 SHOW CREATE output, and regenerates schema/bootstrap artifacts. No business-row DML or seeds are in 0059.
LOCAL = MySQL 8.4.11 from-zero gate passed at 57 migrations. Focused upgrade-safety suite passed 3/3 after simulating historical cp850 check clauses; both checks remain enforced, the ticket row count is unchanged, and migration replay is stable. Parent DB target passed 61/0/3 expected skip; Platform Admin DB target passed 11/11. Initial broad-suite attempts caught and corrected a test expectation about MySQL’s stored purpose literal (`_ascii`) versus the hash literal (`_utf8mb4`); the focused final regression passes.
LIVE = `pca_pro` already applied 0051–0058 after fresh preflight. Postflight journal=56 and schema totals match repository (92 tables, 792 columns, 104 FKs, 92 PKs, 38 unique indexes, 141 non-unique indexes, 282 checks); exact application row-count comparison passed for 90 readable tables; runtime grants are exact 92/92. The 0059 two-check reconciliation has not been applied live.
GATE = Source `fbba783d` and ledger syncs are published. Fresh fetch/local/remote heads match at `578dc0bb`; the five required remote paths are present. Exact-head Quality Gates run `36358762949` is PENDING at `578dc0bb`; live 0059 remains held until the final ledger-sync SHA passes CI and a fresh immediate preflight succeeds.
NEXT_ACTION = Record run `36358762949` outcome and any final ledger sync; apply/verify 0059 live only after exact-head CI PASS and fresh preflight, then continue the same TODO board.

### 2026-09-27 23:43 UTC — TODO-20 exact-head CI findings and corrective harness work

CI = Exact-head Quality Gates run `36358827739` at `c71546343db8ef982b28d432711058db6c5d7a80` completed FAILED. Backend FULL DB certification (disposable MySQL) passed, including migration 0059. Backend build/unit tests had one failure: migration 0059 was missing `alteredByMigrations` provenance for `parent_mfa_enrollment_tickets`. Real-backend browser E2E failed because the cross-family CREATE assertion received 429 after the preceding owner journey exhausted its shared source-IP authenticated-request budget. Android and iOS jobs passed. No live DB mutation is authorized by this failed run.
FIX = Canonical schema now traces migration 0059. Cross-family E2E uses a distinct forwarded test address; only the disposable real-backend E2E workflow trusts the loopback Vite proxy (`PCA_TRUSTED_PROXY_CIDRS=127.0.0.1`), with production defaults unchanged.
LOCAL_VALIDATION = Backend TypeScript build PASS. Serial Windows canonical schema drift suite PASS 5/5 (default worker launch first returned `spawn EPERM`, then the documented serial mode passed). Bootstrap generators report 92 tables, 792 columns, 104 FKs, 282 checks, 57 migrations; disposable bootstrap artifact check PASS. Local real-backend browser E2E and the corrective exact-head CI have not yet run.
TODO20_GATE = 0059 remains unapplied to live `pca_pro`. Require a fresh exact-head CI PASS and immediate live read-only preflight before any migration; retain no-seed, zero-data-loss, local-first, post-schema/grant equality checks.
NEXT_ACTION = Review the narrow source/workflow/artifact changes, sync both ledgers, publish the exact checkpoint fast-forward, then inspect exact-head CI. Continue the same TODO-20 and dependent Platform hold.
