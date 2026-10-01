# PCA Parent Authentication + Authority — Codex Master TODO

## Mission

PURSUING_GOAL = PCA Parent Authentication + Authority — Continuous Completion  
BRANCH = pca-dev  
MISSION_STATUS = IN_PROGRESS  
LAST_UPDATED_UTC = 2026-10-01 (Parent recovery-policy regression at pushed source/test head a8f08abc; three-ledger sync pending)
WAVE_BASE_SHA = `59bfc331` Parent membership/authorizer implementation checkpoint, derived from the accepted `a8c37162` handover; published and validated by exact-head run `36648259414` at `785323d2`.
LAST_GREEN_REMOTE_SHA = `9f6bd581c203dd8d08fcf6f9abc811b93b7c98c3` (Quality Gates run `36784297610` SUCCESS, 27/27 on attempt 2)
CURRENT_WAVE_STATUS = Owner recovery/password-lock implementation is source commit e66b266dad9f503e2212754d3db020526ac0d8df; validation-harness fixes are commit a8f08abcde68bc7ef11c0f6df910b8872cfde191, pushed and fetched. Local backend 2751/2751, Parent Web 1076/1076, MySQL 669 passed/0 failed/9 expected skips plus populated production-path 275/275/0 skipped, real-browser Parent MFA 4/4, all four contract catalogues, security controls, Parent Web typecheck, repository checks, and diff check passed. Exact-head CI for a8f08abc is unverified because configured GitHub API proxy 127.0.0.1:9 refuses connections. Repository migration head 0061; owner-UAT last verified 0060; live pca_pro last verified 0059. No live SQL, Platform, Trust Set, Azure, deployment, or owner acceptance occurred.
WAVE_CONTENT_SHA = `59bfc331` Parent source checkpoint, published and included in exact-head run `36648259414` at `785323d2`.
EXACT_HEAD_CI_SHA = a8f08abcde68bc7ef11c0f6df910b8872cfde191 is pushed; exact-head Quality Gates not yet verified because configured GitHub API proxy 127.0.0.1:9 refuses connections. Last verified green remains run 36784297610 at 9f6bd581c203dd8d08fcf6f9abc811b93b7c98c3.
LOCAL_STATE = Source/test checkpoint a8f08abcde68bc7ef11c0f6df910b8872cfde191 is pushed and fetch-confirmed; this ledger sync is committed and published by ordinary fast-forward, with post-push local/origin equality verified. .vscode/ and root 0 remain untracked, unrelated, and excluded.
COORDINATOR = Current Codex agent  
CURRENT_ACTIVE_TODO = TODO-12 first-device Trust Set root/bootstrap gated; TODO-14 remains 45/52 integrated with seven gated/optional; TODO-15 device security; TODO-17 current exact-head regression CI; TODO-19 exact-head CI/Git closure; TODO-20 live schema/grants; owner-gated TODO-18 remain open. Board totals 13 PASS / 6 IN_PROGRESS (12,14,15,17,19,20) / 4 TODO (18,21,22,23); Platform remains HOLD_PARENT_DEPENDENCY.
NEXT_ACTION = Publish the three-ledger result sync for tested head a8f08abc, fetch and verify refs plus remote ledger paths, then verify exact-head Quality Gates when GitHub API access is restored. Do not claim LOCALHOST ACCEPTED. Keep TODO-12/14/15 open pending approved Trust Set root/crypto protocol and route dispositions. Retry only fresh read-only TODO-20 preflight when reachable; live pca_pro remains last verified at 0059 and this policy task authorizes no live mutation.

### 2026-10-01 — a7e8a8a1 exact-head CI and TODO-20 local runtime grants

EXACT_HEAD_CI = Quality Gates run `36775428822` completed SUCCESS 27/27 at exact SHA `a7e8a8a1064755950738a1b03b7e3e537a5e649d`.
LOCAL_GRANT_CERTIFICATION = On task-owned loopback MySQL 8.4.11, all 58 repository migrations and the platform runtime privilege suite passed. Direct serial Node test mode passed 6/6: audit insert/read; audit UPDATE/DELETE denied by the DB; ordinary-table write control; migration-0060 Trust Set append-only/floor delete-grant constraints; and production writer/query-reader behavior under the declared grant plan. The UUID test schema and temporary principal were removed; no UUID test schemas or temporary platform-audit users remained.
WRAPPER_NOTE = The npm wrapper failed before test execution with Windows `spawn EPERM`; the guarded serial Node invocation passed. This was a runner/process-launch issue, not a product test failure.
LIVE_DB = TCP/3306 to live `pca_pro` remains unreachable; no live query or mutation occurred. Repo/local schema is 0060; live is last verified 0059.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 with aggregate NOT_YET_PROVEN; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-01 — ledger evidence publication

PUBLICATION = Three-ledger checkpoint `d7d67a3f05e0f05f3d918868ed107e66842de88a` was pushed by ordinary fast-forward and fetched from `origin`; GitHub's pca-dev branch page confirms the server head. Direct `git ls-remote` is blocked by the configured proxy.
LEDGER_CI = Quality Gates run `36776746742` for exact SHA `d7d67a3f05e0f05f3d918868ed107e66842de88a` was cancelled by a higher-priority same-branch workflow after commit `83e4b875` was pushed. The replacement run `36777108468` passed at `83e4b875`.

### 2026-10-01 — 83e4b875 exact-head CI and TODO-20 refresh

EXACT_HEAD_CI = Quality Gates run `36777108468` completed SUCCESS 27/27 at exact SHA `83e4b8757341b8521e4f9df49c7eaa58b2741156`. Its full disposable-MySQL and real-backend E2E jobs passed, as did web, Android/iOS, security, and release-control checks.
SUPERSEDED_RUN = The prior ledger commit's run `36776746742` was cancelled when a higher-priority same-branch push arrived; this is not a product test failure.
LIVE_PREFLIGHT = Fresh DNS resolved the live MySQL host to `4.161.89.178`; TCP/3306 returned false. No live SQL read/mutation occurred. Live remains last verified at 0059 versus repo/local 0060.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 with aggregate `NOT_YET_PROVEN`; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — DeepSeek re-entry review and exact-head CI completion

REENTRY = No DeepSeek-attributed commit follows accepted checkpoint `91f7f6d4`; the reviewed Parent membership/mobile-safety checkpoint after it is coordinator-owned commit `59bfc331`. Source/test review classified that checkpoint `ACCEPT_WITH_FOLLOWUP`: registry-backed child-profile membership and Parent session authorization fail closed on negative/failed lookup and require the active Administrator; Android accepts only `PAIRING_PENDING`; iOS rejects a missing trusted epoch floor. No Trust Set writer/root inference, signature bypass, fake ACTIVE state, plaintext policy path, or route-success shortcut was found. No migration follows 0060.
GIT_CI = Local, tracking, and server refs equal `c3c8c5874679e0286d8872e04c23941b7e330c5a`; Quality Gates run `36761102745` passed 27/27 at that exact SHA. `.vscode/` and root `0` remain excluded.
DATABASE_UAT = Disposable local migration/snapshot/grant and Trust Set suites passed as recorded in this ledger. Live `pca_pro` remains last verified 0059; fresh TCP accepted, but the authenticated read-only MySQL client timed out before SQL and the Kudu-sidecar shell was not usable. No live schema/grant query or mutation occurred. Owner-UAT port 33061 and app ports 4001/4000/4100 are stopped; task-owned disposable MySQL 33062 is running. Literal `LOCALHOST ACCEPTED` remains pending.
NEXT_DEPENDENCY = The first-device Trust Set root and crypto/key-custody ceremony requires owner/security approval; do not infer it from a Parent account or TOTP. Web Rules encrypted persistence/delivery, FamilyAudit actor/provenance and encrypted delivery, and DEC-034/035 policy writer dependencies remain open. TODO-14 stays 45/52 with seven gated/optional declarations and aggregate NOT_YET_PROVEN. Keep Platform `HOLD_PARENT_DEPENDENCY`, live mutation, deployment, and production gates closed.

### 2026-09-30 — Codex re-entry assessment after DeepSeek handover


CURRENT_GIT = Branch `pca-dev`; local HEAD, `origin/pca-dev`, and `git ls-remote origin refs/heads/pca-dev` all equal `551d423f8cd01a079574e54fccf441f73f2a1878`. Worktree has four intended tracked changes (the MFA diagnostic refinement and three mission ledgers), plus unrelated untracked `.vscode/` and root `0`; those untracked paths remain excluded.
DEEPSEEK_REVIEW = No DeepSeek-attributed commit follows accepted checkpoint `91f7f6d4`. The post-checkpoint source commit `59bfc331` is coordinator-owned; reviewed its 28 changed backend/Android/iOS source and test files, along with migration history (no migration after 0060), related tests, both master TODOs, the continuous-goal ledger, the local-UAT handoff without copying credentials, and the DeepSeek handover. Disposition: `ACCEPT_WITH_FOLLOWUP` for registry-backed child-profile membership and fail-closed mobile hardening. The resolver uses the actor-derived family and exact opaque profile ID, collapses negative outcomes, and fails closed on registry errors; Parent session authorization reuses it and requires an active Administrator. Android accepts only `PAIRING_PENDING`; iOS rejects a missing trusted epoch floor. No Trust Set writer, genesis/root inference, signature bypass, fake ACTIVE state, plaintext policy path, or route-success shortcut was introduced. No security regression found in reviewed source deltas.
EXACT_HEAD_CI = GitHub Quality Gates run `36740111414` is confirmed at exact SHA `551d423f`, FAILURE with 26/27 jobs successful. The sole failed job is real-backend browser E2E: enrolled-MFA `/api/parent/login/step-up` returned 401 `invalid_code` after the email-only request returned `mfaRequired`. The endpoint intentionally uses the same error for invalid email code and invalid TOTP, so the rejected factor remains unproven. The safe diagnostic refinement is uncommitted and awaits exact-head CI.
TODO_STATUS = 15 PASS (01-11, 13, 16, 17, 19) / 4 IN_PROGRESS (12, 14, 15, 20) / 4 TODO (18, 21, 22, 23) / 0 BLOCKED. TODO-14 remains 45/52 database-integrated with seven gated/optional declarations and `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`.
DATABASE = Repository schema has 58 migration files through 0060; last verified local owner-UAT schema was 0060; live `pca_pro` was last verified at 0059. Local ports 33061/33062 and app ports 4001/4000/4100 are stopped in this re-entry. A fresh live-DNS lookup did not yield an address, so no live DB read or mutation occurred and parity remains NO.
PLATFORM_AND_UAT = Platform remains `HOLD_PARENT_DEPENDENCY`. Owner-UAT services are currently not ready; literal owner `LOCALHOST ACCEPTED` remains pending. Azure deployment and production acceptance remain on hold.
TRUE_NEXT_ENGINEERING_DEPENDENCY = Publish the narrowly scoped MFA diagnostic refinement and rerun exact-head CI to determine whether the failed second factor is TOTP or OTP validity. Resolve any proven product defect without changing authentication security. Then resume TODO-12/14/15 only within approved boundaries; the first-device Trust Set root/key-custody protocol is still an owner/security gate and no safe implementation is selected absent it.
FILES_EXPECTED = Immediate checkpoint: `parent-web/e2e-real/parentMfa.spec.ts` and the three current-state ledgers. No migration is expected. Local full real-backend rerun is unavailable while MySQL/backend/web services are stopped.
SUPERVISOR_RECOMMENDATION = PROCEED with the narrow diagnostic checkpoint and exact-head CI; HOLD broad Trust Set/device activation, live DB mutation, Platform Enrollment activation, localhost acceptance, Azure deployment, and production changes.

### 2026-09-30 — MFA diagnostic checkpoint committed

COMMIT = `57cc83e5c41ad2553471a56d20724035a1143e68` contains the canonical backend TOTP helper, the non-secret OTP-validity probe, and synchronized Parent/Platform re-entry ledgers. `git diff --cached --check` passed before commit.
GIT = Local HEAD is one commit ahead of tracking/server `551d423f8cd01a079574e54fccf441f73f2a1878`; ordinary fast-forward publication and exact-head CI remain pending. `.vscode/` and root `0` were not staged.
NEXT_ACTION = Push this exact commit to `origin/pca-dev`, fetch again, verify local/tracking/server equality, and monitor its exact-head Quality Gates run.

### 2026-09-30 — diagnostic checkpoint publication verified

PUBLICATION = Commits `57cc83e5c41ad2553471a56d20724035a1143e68` and ledger sync `3aff4047ca48c91a25dfd331f231e6b66e4c00fa` were pushed by ordinary fast-forward. Fresh `git fetch`, `git rev-parse`, and `git ls-remote` verify local/tracking/server equality at `3aff4047ca48c91a25dfd331f231e6b66e4c00fa`; worktree has no tracked modifications.
CI = Quality Gates run `36742259731` is queued on exact SHA `3aff4047ca48c91a25dfd331f231e6b66e4c00fa`; no result is claimed yet.
GATES = Parent TODO-12/14/15/17/19/20 remain IN_PROGRESS; TODO-18/21/22/23 remain TODO. Platform remains `HOLD_PARENT_DEPENDENCY`; no live DB mutation, owner acceptance, deployment, or production change occurred.

### 2026-09-30 — MFA TOTP replay diagnosis and correction

CI = Run `36742456952` completed FAILURE 1/27 at `b8b6908e`; all jobs passed except real-backend E2E. The enrolled-MFA step-up returned 401 `invalid_code`, while reusing the same email OTP alone returned 200 `mfaRequired`.
ROOT_CAUSE = The workflow executes `acceptance-flow.spec.ts` before `parentMfa.spec.ts` against the same disposable DB and same enrolled Parent. The first flow logs in and uses later fresh TOTP counters; the second spec waited only beyond the fixture's enrollment counter. That can replay a previously accepted counter, which the production forward-only watermark correctly rejects.
CORRECTION = `parentE2eSupport.mjs mfa-state` now exposes only the numeric persisted `lastAcceptedTotpCounter` from the guarded disposable DB. `parentMfa.spec.ts` reads it before the first login and waits for a strictly newer counter. `node --check` and Playwright test discovery passed. No production auth behavior changed; exact-head CI is pending.
TODO_STATUS = 13 PASS / 6 IN_PROGRESS (12, 14, 15, 17, 19, 20) / 4 TODO (18, 21, 22, 23) / 0 BLOCKED. Platform stays `HOLD_PARENT_DEPENDENCY`; live DB, owner acceptance, Azure, and production gates remain closed.

### 2026-09-30 — run 36740111414 enrolled-MFA result

CI = Quality Gates run `36740111414` at `551d423f8cd01a079574e54fccf441f73f2a1878` completed FAILURE with 26/27 jobs passing. Backend build/unit, full disposable-MySQL, Android, iOS, dependency audit, web tests, and all non-E2E gates passed. The only failing job was the real-backend browser E2E.
E2E_DIAGNOSIS = Parent acceptance/cross-family and MFA-setup flows passed. `parentMfa.spec.ts` reached the OTP+TOTP step; `/api/parent/login/step-up` returned 401 `{error: invalid_code}` after the prior email-only step had returned `mfaRequired`. Route semantics intentionally collapse invalid email code and invalid TOTP to the same response. Therefore the rejected factor is not proven by this run.
FOLLOWUP = The E2E now imports `base32Decode`/`computeTotp` from the backend build rather than maintaining a duplicate algorithm. On a failed OTP+TOTP request, it makes one disposable-fixture OTP-only probe and records only HTTP status plus whether the route returns `mfaRequired`; no code, secret, account, or token is logged. Playwright test discovery passes. Full rerun is pending.
GATES = TODO-17/19 remain IN_PROGRESS; Parent TODO-12/14/15/20 and owner-gated TODO-18 remain open. Platform remains `HOLD_PARENT_DEPENDENCY`; no live DB, owner-UAT, deployment, or production mutation occurred.

### 2026-09-30 — run 36738374071 triage and follow-up

CI = Quality Gates run `36738374071` failed 2 of 27 jobs at exact SHA `3b0fea64af0a04c3d37a14b9dcc0cf82120bbc77`; backend build/unit passed. Parent acceptance and cross-family scenarios proceeded, including the second-Parent grant path. The enrolled-MFA real-browser test stayed on `/login` after submitting OTP+TOTP; its DOM showed the generic verification error. The browser screenshot/report does not distinguish invalid OTP from invalid TOTP.
DEPENDENCY_AUDIT = The remaining HIGH advisory was `brace-expansion` in `platform-admin-web/package-lock.json`. Ran `npm audit fix --package-lock-only --ignore-scripts`; the lockfile changed semver-compatible resolutions only. Platform Admin audit now exits 0 at HIGH threshold with two moderate Vitest findings; no breaking Vitest 5 upgrade was applied.
E2E_FOLLOWUP = Aligned all Parent real-E2E cookie lookups/context origins with `127.0.0.1:4002`. Added an assertion around the final `/api/parent/login/step-up` response that reports only status and machine error code, so a repeat failure will separate the rejected protocol stage without exposing credentials. Playwright discovers four tests across the three certified specs. The MFA login outcome has not yet been rerun against a real backend.
LOCAL_LIMIT = Disposable MySQL/real-backend local rerun is unavailable in this environment: Docker Desktop is stopped and loopback port 33061 is closed. Exact-head CI is the next real-backend validation.
GATES = TODO-17/19 remain IN_PROGRESS; Parent TODO-12/14/15/20 and owner-gated TODO-18 remain open. Platform remains `HOLD_PARENT_DEPENDENCY`; no live DB, owner-UAT, deployment, or production mutation occurred.

### 2026-09-30 — run 36735353255 triage and focused remediation

CI = Quality Gates run `36735353255` at exact SHA `bfe2005f1b717a452f1f1e09161e533e62cacc50` failed 3 of 27 jobs (24 passed). Backend build/unit failed only at the SDK-disclosure drift assertion: generated disclosure still described Nodemailer 10.0.0 after the manifest/lock update to 10.0.13. Regenerated `backend/src/sdkDisclosure/thirdPartySdks.generated.ts`; after `npm run build`, the focused test passes 3/3. Backend dependency audit passed with 0 vulnerabilities.
E2E = The owner acceptance journey passed. Cross-family login returned HTTP 200 with `sessionEstablished=false`; the helper installed its daily-login cookie for `localhost:4002` while the configured browser origin is `127.0.0.1:4002`. Updated the cookie origin to the configured loopback host; Playwright discovers both certified tests. Full real-backend rerun is pending.
DEPENDENCY_AUDIT = Parent Web audit failed on HIGH brace-expansion and moderate fast-uri/Vitest. The local semver-compatible lockfile refresh removes the high finding; `npm audit --audit-level=high` exits 0 with two moderate Vitest findings. No breaking Vitest major upgrade was applied.
LOCAL_VALIDATION = Backend build PASS; SDK disclosure focused test PASS 3/3; backend and Parent Web high-severity audits exit 0; Playwright real E2E test discovery PASS 2 tests; `git diff --check` PASS. Exact-head CI and remote publication remain pending.
GATES = TODO-17/19 remain IN_PROGRESS. Parent TODO-12/14/15/20 and owner-gated TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`; no live DB, owner-UAT, deployment, or production mutation occurred.

### 2026-09-30 — PCA Codex re-entry assessment (refreshed)

CURRENT_GIT = Branch `pca-dev`; local HEAD `8e83349343eae45586d6ffb1249caad3b17b2b4f`; tracking/server head `8e63d4738f3d4c0d06afd25b58adf383ca2352ad`; one fast-forward commit ahead. Fresh `git fetch`, `git rev-parse`, and `git ls-remote` succeeded. No tracked unstaged changes; `.vscode/` and root `0` are unrelated untracked exclusions.
DEEPSEEK_REVIEW = `git log 91f7f6d4..HEAD` contains no DeepSeek-attributed commit; the actual source checkpoint is `59bfc331` (`security: enforce parent family scope and enrollment state`), followed by coordinator documentation/evidence commits. Review disposition for the post-91f7 source is ACCEPT_WITH_FOLLOWUP. No migration follows accepted migration 0060; repository head remains 0060 (58 SQL migration files).
FILES_REVIEWED = Backend async child-profile resolver, MySQL opaque-registry adapter, Parent action authorization, Parent-session child-request authorizer, child-request routes, production composition, Android enrollment/bootstrap/recovery, iOS policy epoch gate, focused tests and migration history.
SECURITY_REVIEW = Membership lookup is bound to the actor-derived family; malformed, cross-family, absent and unavailable results deny without a public existence oracle. Active family Administrator remains required for Parent-session child-request actions. The same resolver is composed into Parent-action authorization, child-request decisions/grants and direct ledger routes. No Trust Set/genesis anchor, authority writer, signature bypass, fake ACTIVE state or route-success shortcut was introduced. Android accepts only `PAIRING_PENDING` and preserves ambiguous recovery attempts; iOS rejects a missing trusted epoch floor. No reviewed signature/replay/family/epoch downgrade regression found.
CI = Remote exact head `8e63d473` passed Quality Gates run `36658212487`, 27/27, including MySQL, backend, web, Android/iOS and real-browser jobs. Local checkpoint `8e833493` changes Playwright real-run configuration and documentation only; it is not yet pushed or covered by exact-head CI. Platform real-backend E2E independently passed 1/1 on local loopback Fastify + disposable MySQL with synthetic fixtures; this is technical evidence, not owner acceptance.
TODO_STATUS = 14 PASS / 5 IN_PROGRESS (TODO-12,14,15,19,20) / 4 TODO or owner/release gated (TODO-18,21,22,23) / 0 marked BLOCKED. TODO-14 has 45/52 database-integrated declarations and seven intentionally gated/optional declarations; global aggregate remains NOT_YET_PROVEN.
DATABASE = Repository schema 0060; last recorded owner-local schema 0060; live `pca_pro` last verified at 0059. The fresh live DB reachability check remains unavailable, so no live read or mutation is claimed. Local real-backend E2E used a task-owned disposable MySQL database and removed its schema; the earlier interrupted attempt left one orphan datadir directory that was not manually removed.
PLATFORM = `HOLD_PARENT_DEPENDENCY`; Parent-owned minimal family projection remains the contract. Enrollment activation, owner `LOCALHOST ACCEPTED`, Azure deployment and production acceptance remain unclaimed.
TRUE_NEXT_DEPENDENCY = Publish local checkpoint `8e833493` and run exact-head CI, then continue TODO-12/14 only within approved boundaries. The registry-backed child-profile membership second gate is implemented and CI-certified at remote head. The next authority/device dependency is an owner/security-approved first-device Trust Set root and key-custody protocol; do not invent it from Parent credentials/TOTP. TODO-14's remaining seven dispositions are genuine Trust Set, encrypted Web Rules, signed/recovery crypto and optional-dashboard gates, not test gaps to bypass.
FILES_EXPECTED = For the immediate publication: the five files in commit `8e833493`; for next engineering work, no product-source file is selected until the owner/security protocol or a separately proven safe TODO-12/14 correction is identified.
SCHEMA_CHANGE_EXPECTED = No migration required by the re-entry-reviewed resolver, Android, or iOS changes; no new migration beyond 0060 was found.
SUPERVISOR_RECOMMENDATION = PROCEED with the authorized fast-forward publication and exact-head verification; keep Platform, live DB, owner acceptance, crypto, deployment and production gates on HOLD.

### 2026-09-30 — Exact-head CI failure and focused remediation

CI = Run `36732009370` at `e1f8b218c16c336c070409bb4b4f88c1d791ecd0` completed FAILURE: 25/27 jobs passed; failed jobs were `Real-backend browser E2E (disposable MySQL + live Fastify)` and `Dependency vulnerability audit`.
E2E_ROOT_CAUSE = The acceptance-flow test signed out everywhere, revoking the primary fixture's daily login grant; a later cross-family test attempted to reuse that grant and got `sessionEstablished=false`. The owner journey itself passed. The test now authenticates the untouched second Parent once and targets `E2E_REAL_TEST_FAMILY_ID`, the primary Parent family, retaining the cross-family LIST/CREATE 403 assertions.
DEPENDENCY_REMEDIATION = Backend Nodemailer 10.0.0 triggered the HIGH advisory; lockfile-only update to 10.0.13 and semver-compatible `fast-uri` 3.1.8/4.2.1 resolved the backend audit. `npm audit fix --package-lock-only --ignore-scripts` reports 0 vulnerabilities. No force update or runtime source change was made.
CURRENT_LOCAL_CHANGE = `backend/package.json`, `backend/package-lock.json`, `parent-web/e2e-real/acceptance-flow.spec.ts`, and the mission ledgers. `git diff --check` passes; exact-head CI is pending publication.
TODO_STATUS = 13 PASS / 6 IN_PROGRESS (TODO-12,14,15,17,19,20) / 4 TODO or owner/release gated (TODO-18,21,22,23) / 0 BLOCKED. TODO-17 remains IN_PROGRESS until the corrected exact-head campaign passes.
OWNER_AND_PLATFORM_GATES = No owner acceptance, Platform activation, live DB read/mutation, Azure deployment or production acceptance occurred. Local owner API/web ports were stopped at the latest readiness check; do not offer TODO-18 before restoring services and completing technical browser precheck.
NEXT_ACTION = Review the three-file code diff plus ledgers, commit the scoped fix, publish by ordinary fast-forward, and inspect the resulting Quality Gates run.

### 2026-09-28 06:49 UTC — TODO-14 collector checkpoint published and CI passed

GIT = Commits `99de804e`, `97d49cfe` and the result-sync are published as a fast-forward. Fresh fetch, local HEAD, tracking ref and `git ls-remote` agree at `52fda09edff4db47e856185975688997952f69d3`; the collector helper, route test, crosswalk and both master TODOs are present remotely. `.vscode/` and root `0` remain excluded.
CI = Exact-head Quality Gates run `36387631829` completed SUCCESS 27/27 at `52fda09edff4db47e856185975688997952f69d3`, including full disposable-MySQL, real-backend browser, Android and iOS jobs.
TODO14 = The status-only collector covers 8/52 declarations with 12/12 matched rows in its bounded test-double slice. Global route/action aggregates remain NOT_YET_PROVEN.
NEXT_ACTION = Continue collector coverage across route families; preserve separate expected-denial, authority/service/crypto-gate classifications and keep Parent TODO-12/15 and owner/Platform gates open.

### 2026-09-28 06:54 UTC — TODO-14 collector expanded across child-request routes

IMPLEMENTATION = Instrumented the Parent child-request/bonus-time route test suite to collect list, decide, direct grant, active-grants read and revoke outcomes; known missing-membership-resolver responses are classified as AUTHORITY_UNAVAILABLE.
VALIDATION = Backend build PASS; combined removal-decision and child-request suites PASS 34/34 in one serial process. Combined report: 20/20 matched scenarios across 13/52 method/path declarations (10 allow, 4 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 crypto/device-gated, 1 validation); unexpected 401/403/other=0 for these test-double routes; full inventory coverage false, global aggregate NOT_YET_PROVEN.
GIT = The 13-route expansion is local/uncommitted. Last published HEAD is `c43eb6f20bb34f35a9ab96005a6cf786e32f1113`; exact-head run `36388515737` is IN_PROGRESS with 23/27 jobs successful and none failed at last poll. `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Let the current exact-head run finish, then publish the reviewed collector/crosswalk/master-ledger expansion and continue route-by-route.

### 2026-09-28 06:57 UTC — child-request route collector commit validated locally

COMMIT = Local commit `ca064871a4ab452e09c64a4d5929d95e2baa5357` instruments Parent child-request/bonus-time list, decide, direct grant, active-grants and revoke routes, including explicit membership-authority-unavailable outcomes.
VALIDATION = Backend build PASS; combined removal-decision and child-request suites PASS 34/34. The status-only report matched 20 scenarios across 13/52 declarations: 10 allow, 4 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 crypto/device-gated, 1 validation, zero unexpected 401/403/other. Full coverage remains false and global aggregate NOT_YET_PROVEN.
GIT = Commit `ca064871` and the both-ledger sync are local; published SHA remains `c43eb6f20bb34f35a9ab96005a6cf786e32f1113`. Exact-head run `36388515737` at c43 is in progress (24/27 successful, zero failed at last poll).

### 2026-09-28 06:59 UTC — current exact-head CI reconciled; attached report superseded

CI = Run `36388515737` completed SUCCESS with 27/27 jobs and zero failures at `c43eb6f20bb34f35a9ab96005a6cf786e32f1113`. It validates the published c43 checkpoint, not the later local `ca064871` collector addition; exact-head CI for that addition remains required.
REPORT = The supplied report's `0daf660`/`399304c` Git and CI snapshots and live migration-0050/0058 claims predate the current ledger evidence. The canonical mission ledger records live `pca_pro` through 0059, exact repository/local/live schema agreement, runtime grants 92/92, and preserved readable-table counts. Do not replay migrations from the report. Its `HOLD_PARENT_DEPENDENCY` recommendation remains aligned with open TODO-12/14/15 and literal localhost acceptance.
GIT = Fresh `git fetch` and `git ls-remote` confirm published `pca-dev` remains c43; local `ca064871` is a fast-forward descendant. Only the two master TODO files are modified for this sync; unrelated `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Publish `ca064871` with the two master ledgers, verify post-push local/tracking/server equality and remote path presence, then inspect CI for the resulting exact head.

### 2026-09-28 07:12 UTC — TODO-14 collector exact-head CI passed

GIT = Commit `7bea6996f421024b530ae7679704c78122f2642b` was pushed as a fast-forward. Fresh fetch and server comparison confirmed local HEAD, `origin/pca-dev`, and `git ls-remote` equality; the collector helper, child-request test, and both master ledgers exist remotely. `.vscode/` and root `0` remain untracked and excluded.
CI = Exact-head Quality Gates run `36389628059` completed SUCCESS 27/27 at `7bea6996f421024b530ae7679704c78122f2642b`, including disposable-MySQL certification, real-backend browser E2E, Android and iOS. This validates the published 20-scenario/13-declaration collector addition; global route/action aggregates remain NOT_YET_PROVEN.
NEXT_ACTION = Publish the CI result ledger sync, verify the resulting head and run, then extend TODO-14 coverage to Parent account identity/auth routes while preserving distinct outcome classifications.

### 2026-09-28 07:12 UTC — Parent account identity/auth collector slice validated locally

IMPLEMENTATION = Instrumented existing Parent account route assertions for registration, email verification, login, anonymous/authorized identity read, CSRF denial, contact mutation validation, and authorized identity edit. The collector records only method, templated route, scenario classification and expected/actual status.
VALIDATION = Combined account/removal-decision/child-request route suites passed 55/55 serially with `backend/test.env`. The bounded collector matched 28 scenarios across 18/52 declarations (15 allow, 6 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 crypto/device-gated, 2 validation); unexpected 401/403/other=0. Report explicitly remains `coverageComplete=false`, `globalAggregateStatus=NOT_YET_PROVEN`.
GIT = The account-route test and crosswalk were published in `dff134c40f4baa9cdb987fd8758fdb09de67d434`; fresh fetch confirmed local/tracking/server equality and remote file presence. Exact-head run `36391810357` is queued. Generated reports were removed; `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Record the post-push SHA and queued run in the master ledgers, then inspect exact-head CI.

### 2026-09-28 07:24 UTC — ledger-sync CI passed; account collector ready for publication

CI = Exact-head Quality Gates run `36390803278` completed SUCCESS 27/27 at `6f2a78fdd64a3eb04ca92728d6bd1c2ec49f74e5`, including full disposable MySQL, real-backend browser E2E, Android and iOS.
TODO14 = The locally validated account slice adds eight matched scenarios across five declarations. Combined account/removal-decision/child-request tests passed 55/55 serially; report covers 28 matched scenarios across 18/52 declarations with zero unexpected 401/403/other. This is bounded test-double evidence; aggregate remains NOT_YET_PROVEN.
NEXT_ACTION = Publish the account-route test, crosswalk and master-ledger sync; exact-head CI for those newly added files remains required.

### 2026-09-28 07:28 UTC — Parent account-route checkpoint published

GIT = Commit `dff134c40f4baa9cdb987fd8758fdb09de67d434` was pushed as a fast-forward. Fresh fetch confirmed local, tracking and server refs equal; account route test, crosswalk and both master ledgers are present remotely. Unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Exact-head run `36391810357` is queued at dff134c4. Local combined route validation is 55/55; exact-head CI remains pending.
NEXT_ACTION = Publish this post-push head/run sync, then inspect the run.

### 2026-09-28 07:38 UTC — account-route checkpoint exact-head CI passed

CI = Run `36392059784` completed SUCCESS 27/27 at `3428199aaee871c5debd8e2575c185e88284c8df`, including full disposable MySQL certification, real-backend browser E2E, Android and iOS. The account-route collector and crosswalk are in this tested history.
TODO14 = Exact-head validation now covers the published 28-scenario/18-declaration bounded collector code. Whole-inventory coverage and global outcome aggregates remain NOT_YET_PROVEN.
NEXT_ACTION = Publish this CI result sync, then continue route-family collection and retain TODO-12/15 plus owner and Platform gates.

### 2026-09-28 07:48 UTC — ledger-sync CI passed; MFA collector validated locally

CI = Exact-head Quality Gates run `36392902094` completed SUCCESS 27/27 at `1d99fda217e180dcc14f6e241a7166259d560ddf`.
TODO14 = MFA enrollment, recovery and step-up tests now add 14 bounded scenarios across six method/path declarations. The combined four-suite report matches 42 scenarios across 24/52 declarations (21 allow, 11 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 crypto/device-gated, 5 validation/protocol); zero unexpected 401/403/other; combined suites passed 62/62. Global aggregates remain NOT_YET_PROVEN.
GIT = MFA test and crosswalk edits are local; latest published SHA is `1d99fda217e180dcc14f6e241a7166259d560ddf` with exact-head run green. `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Publish the MFA collector/crosswalk and both master-ledger updates; require exact-head CI for those new files.

### 2026-09-28 07:59 UTC — MFA collector exact-head CI passed; family-membership slice validated locally

CI = Exact-head Quality Gates run `36393911487` completed SUCCESS 27/27 at `1d8490aeb5da8104302c4badcc8ab82271d4b06b`, including the MFA collector and crosswalk.
TODO14 = Family-membership tests now add 12 status-only outcomes across invitation create/list/revoke/role/accept and member remove declarations. Combined five-suite route campaign passed 79/79; report matches 54 scenarios across 30/52 declarations (27 allow, 17 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 crypto/device-gated, 5 validation/protocol), with zero unexpected 401/403/other. Coverage is incomplete and global aggregate remains NOT_YET_PROVEN.
GIT = Family-membership test and crosswalk edits are local; latest published SHA is `1d8490aeb5da8104302c4badcc8ab82271d4b06b`. Require exact-head CI after publication; `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Publish the family-membership collector and both master-ledger updates, then verify exact-head CI.

### 2026-09-28 08:10 UTC — membership collector exact-head CI passed; dashboard/audit slice validated locally

CI = Exact-head Quality Gates run `36394990145` completed SUCCESS 27/27 at `da21a66d0bae8e1b600b65e5e8c50339b8402cad`, including the family-membership collector and ledger sync.
TODO14 = Dashboard and audit-event route tests add 12 matched scenarios across two method/path declarations, including explicit optional-route absence. Combined seven-suite route campaign passed 92/92. Bounded report matches 66 scenarios across 32/52 declarations (30 allow, 24 expected denial, 2 authority unavailable, 1 protective-authority-not-applicable, 2 optional-route-absent, 2 crypto/device-gated, 5 validation/protocol); zero unexpected 401/403/other. Global aggregates remain NOT_YET_PROVEN.
GIT = Dashboard/audit test and crosswalk edits are local; latest published SHA `da21a66d0bae8e1b600b65e5e8c50339b8402cad` is green. Require exact-head CI after publication; `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Publish the dashboard/audit collector and both master TODO updates; then inspect exact-head CI.
### 2026-09-28 06:12 UTC — bounded TODO-14 runtime outcome collector slice

IMPLEMENTATION = Added an opt-in status-only collector for route test outcomes and instrumented the removal-decision detail GET scenarios. The JSON report classifies same-family allow, unknown-ID expected privacy denial and cross-family expected privacy denial; it stores no request bodies, headers, credentials or IDs. It declares its scope bounded, coverage incomplete (1/52 routes), and global aggregate `NOT_YET_PROVEN`.
VALIDATION = Backend build PASS. The focused removal-decision suite passed 17/17; generated report recorded 3/3 matched scenarios (1 allow, 2 expected denials) and zero unexpected 401/403/other in this bounded slice. The Actions API call for run `36384812687` failed through the configured localhost proxy; its last observed status remains QUEUED at `5f17326a`.
GIT = Collector implementation and crosswalk/ledger updates are local and uncommitted; last published HEAD remains `5f17326a9f590b320444ce8686b90d689dcb45d9`. `.vscode/` and root `0` remain untracked and excluded.
TODO14 = One of 52 route declarations now has three structured scenario rows. This does not prove global route aggregates or database-backed behavior; TODO-14 remains IN_PROGRESS.
NEXT_ACTION = Publish the bounded collector source commit with master-ledger updates; expand coverage route by route after exact-head CI. Preserve known authority/service/crypto gates and Platform hold.

### 2026-09-28 06:15 UTC — TODO-14 bounded collector committed locally

COMMIT = Local commit `4565e1b9378fe29b22485d6837e13c51a9e72ccb` adds an opt-in status-only collector and instruments three removal-detail GET scenarios. The report contains one route/three scenario rows, matched 200 allow plus two expected 404 privacy denials, zero unexpected 401/403/other for this slice, `coverageComplete=false`, and `globalAggregateStatus=NOT_YET_PROVEN`.
VALIDATION = Backend build PASS; focused removal-decision suite PASS 17/17 with collector output enabled; `node --check` and `git diff --check` PASS. No exact-head CI has run for this local commit.
GIT = Local source commit descends from verified remote `5f17326a`; both master ledger files remain the only intended tracked changes. The Actions API remains unreachable through the configured localhost proxy; run `36384812687` was last observed QUEUED at `5f17326a`.
TODO14 = One of 52 method/path declarations is dynamically collected in a bounded HTTP test. Database-backed all-route aggregate remains NOT_YET_PROVEN.
NEXT_ACTION = Keep the new collector checkpoint synchronized with exact-head CI; then expand coverage route by route.

### 2026-09-28 06:18 UTC — exact-head CI and collector publication refreshed

GIT = Collector commit `4565e1b9` and ledger sync `ad9f46da` were published as a fast-forward. Fresh fetch, local/tracking/server refs agree at `ad9f46da7988bea2774923e7c15fb3ee9bdc690f`; the collector, route test, crosswalk, and both master TODOs exist remotely. `.vscode/` and root `0` remain untracked and excluded.
CI = Run `36384812687` completed SUCCESS 27/27 at exact head `5f17326a9f590b320444ce8686b90d689dcb45d9`. The current Quality Gates run `36385746422` is QUEUED at exact head `ad9f46da`; no result is claimed for it.
TODO14 = The bounded collector remains one route/three scenarios with global aggregate NOT_YET_PROVEN. The preceding 5f CI result does not cover collector commit `4565e1b9`.
NEXT_ACTION = Refresh run `36385746422`, sync its outcome, and continue route-by-route collector coverage while preserving all known authority/service/crypto and owner gates.

### 2026-09-28 06:25 UTC — TODO-14 collector coverage expanded in working tree

IMPLEMENTATION = Extended the opt-in status-only collector within the removal-decision route suite: 12 scenarios now cover 8/52 method/path declarations. The report separates five allows, three expected denials, protective-authority-not-applicable, two crypto/device gates and one validation result; unexpected 401/403/other remain zero for this bounded test-double slice.
VALIDATION = Backend build PASS; focused removal-decision suite PASS 17/17; parsed collector JSON confirms 12/12 matched rows and `coverageComplete=false`, `globalAggregateStatus=NOT_YET_PROVEN`. This is not database-backed or global route proof.
GIT = The expansion is local/uncommitted. Published HEAD remains `ad9f46da7988bea2774923e7c15fb3ee9bdc690f`; run `36385746422` is still IN_PROGRESS (26/27 jobs succeeded, iOS remains active at last poll).
NEXT_ACTION = Complete the current exact-head CI and sync its final result before publishing the expanded collector slice with both master TODOs.

### 2026-09-28 06:33 UTC — exact-head iOS simulator failure and failed-job rerun

CI = Initial run `36385746422` completed with 26/27 jobs successful; only iOS failed. The app built and launched, but xcodebuild reported `Test runner never began executing tests after launching`; logs also reported connection failures to `com.apple.FamilyControlsAgent` and ManagedSettingsAgent. No Swift compile error or test assertion failure was reported. This is classified as an iOS simulator/test-runner failure, not a proven Parent source defect.
RERUN = Requested `gh run rerun 36385746422 --failed` at unchanged SHA `ad9f46da7988bea2774923e7c15fb3ee9bdc690f`; only the iOS job is rerunning. Last check: 26/27 jobs remain successful and the iOS job is IN_PROGRESS.
TODO14 = Local collector expansion remains commit `99de804e`; build and the focused 17/17 suite pass. It is not included in run `36385746422`.
NEXT_ACTION = Wait for the failed iOS job rerun, record its result, then publish the reviewed collector expansion and synced ledgers.

### 2026-09-28 06:38 UTC — exact-head iOS rerun passed

CI = The failed-job rerun of `36385746422` completed SUCCESS; all 27/27 jobs are green at exact head `ad9f46da7988bea2774923e7c15fb3ee9bdc690f`. The first iOS attempt failed before tests began because the simulator test runner did not start and FamilyControlsAgent/ManagedSettings services were unreachable; rerun completed successfully without source changes. Record this as a transient simulator-runner failure followed by PASS, not as a Parent code defect.
GIT = Local collector expansion commit `99de804ee27e7f000b9d0cba3e260a19bc690016` and ledger sync `97d49cfe3873d066d6757a7cae70ce1075c40d91` are fast-forward descendants of `ad9f46da` and remain unpublished. Unrelated `.vscode/` and root `0` remain excluded.
TODO14 = Current 8/52 route, 12-scenario collector expansion passed focused local build/tests but is not covered by run `36385746422`.
NEXT_ACTION = Publish the local collector and ledger commits as a narrow fast-forward, then verify its exact-head CI result.

### 2026-09-28 06:04 UTC — TODO-14 direct status-assertion checkpoint committed locally

SOURCE = Local commit `4efc4e44f662c922c7b44b759e1b923a2e59d4e7` adds an explicit MFA confirmation 200 assertion, same-family removal-detail 200 plus indistinguishable unknown/cross-family 404 assertions, and crosswalk anchors for all 52/52 method/path declarations. The stale blocker about a missing detail-route assertion is removed.
VALIDATION = Backend build PASS; focused MFA and removal-decision HTTP suites PASS 24/24 using in-process serial Node execution after the default Windows test isolation failed before execution with `spawn EPERM`; `git diff --check` PASS.
GIT = The source commit is a fast-forward descendant of fetched/server `pca-dev=ce296483507d8a92a61c2b6cdd1179e1d880e1be`; it is not yet published. Exact-head CI has not run for `4efc4e44`. Unrelated `.vscode/` and root `0` remain untracked and excluded.
TODO14 = Static status assertion anchors are 52/52. Global scenario-classified 401/403/authority-unavailable aggregates and the disposable collector remain NOT_YET_PROVEN.
NEXT_ACTION = Implement the disposable TODO-14 scenario collector after recording the published checkpoint and inspecting its exact-head CI.

### 2026-09-28 06:05 UTC — TODO-14 assertion checkpoint published; exact-head CI queued

GIT = Commits `4efc4e44` and `5f17326a` are published as a fast-forward. Fresh fetch, local HEAD, tracking ref and `git ls-remote` agree at `5f17326a9f590b320444ce8686b90d689dcb45d9`; the Parent and Platform master TODOs and route-action crosswalk exist in the remote tree. `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36384812687` is QUEUED on exact HEAD `5f17326a`; no result is claimed. GitHub Actions API polling later failed through the configured localhost proxy, so preserve the last observed queued status until connectivity returns.
TODO14 = Static direct status assertions now cover 52/52 declarations; global scenario-classified runtime aggregates and the disposable collector remain NOT_YET_PROVEN.
NEXT_ACTION = Continue TODO-14 collector design/implementation while retaining TODO-12/15 and owner/Platform gates, then refresh exact-head CI when the Actions API is reachable.

### 2026-09-28 05:52 UTC — TODO-14 assertion mapping extended locally

TODO14 = The crosswalk now gives exact test-line anchors for 51/52 route declarations. The only remaining row without a direct HTTP status assertion anchor is optional removal-decision detail GET. Static assertion mapping still does not prove runtime aggregates: the disposable scenario collector and global `UNEXPECTED_401`, `UNEXPECTED_403`, `AUTHORITY_UNAVAILABLE`, and Genesis/browser-trust counts remain open/NOT_YET_PROVEN.
VALIDATION = `git diff --check` passed; this documentation-only extension changed no source or tests, and no tests were run.
GIT = The last published/local/remote head is `ce296483507d8a92a61c2b6cdd1179e1d880e1be`; the crosswalk extension is uncommitted. `.vscode/` and root `0` remain untouched and excluded.
CI = Exact-head run `36383400891` at `ce296483` is IN_PROGRESS (22/27 jobs succeeded at last poll); it does not include this uncommitted expansion. Run `36383174064` for `6bddaf11` was cancelled after the newer ledger-sync checkpoint superseded that head.
NEXT_ACTION = Let the current exact-head run finish, publish the reviewed crosswalk and ledger update fast-forward, then verify new exact-head CI and continue integrated collector design.

### 2026-09-28 05:59 UTC — TODO-14 status assertions completed and locally certified

CORRECTION = Specialist review found the prior `51/52` figure counted the MFA enrollment-confirm response-body assertion as a direct HTTP status assertion. The true pre-fix count was 50/52. Added an explicit 200 status assertion to that confirmation request and a direct removal-decision detail GET test, bringing the crosswalk to 52/52 direct status anchors. The detail test proves same-family 200 and identical 404 responses for unknown and cross-family request IDs.
LOCAL_VALIDATION = Backend TypeScript build PASS; focused `removalDecisionRoutes.wiring.test.mjs` plus `parentMfaRoutes.test.mjs` PASS 24/24 with `--experimental-test-isolation=none --test-concurrency=1`; `git diff --check` PASS. Initial default serial invocation failed before executing suites with Windows `spawn EPERM`; bounded in-process retry completed successfully.
REMOTE_CI = Quality Gates run `36383400891` completed SUCCESS, 27/27, on published base `ce296483`. It does not include these local test/crosswalk changes. Run `36383174064` at `6bddaf11` was cancelled after the newer ledger-sync checkpoint superseded that head.
TODO14 = Static status assertions now cover all 52 method/path declarations. Scenario-classified all-route runtime aggregates and disposable collector remain NOT_YET_PROVEN. Schedule-policy `NO_TRUST_SET`, Web Rules `SERVICE_NOT_CONFIGURED`, crypto-gated signed/recovery decisions, protective-authority-not-applicable, and DEC-035 policy configuration remain separate categories; current Admin operations are still `ALLOW_WITH_STEP_UP`.
GIT = Local and verified remote HEAD remain equal at `ce296483507d8a92a61c2b6cdd1179e1d880e1be`; the two test edits, crosswalk extension and ledger updates are local/unpublished. `.vscode/` and root `0` remain untouched.
NEXT_ACTION = Publish the reviewed tests, crosswalk and ledgers in one narrow fast-forward, inspect its exact-head CI, then implement the bounded disposable scenario collector. TODO-14 stays IN_PROGRESS until global runtime aggregates and authority gates are resolved.

### 2026-09-28 05:46 UTC — assertion-anchor checkpoint published; exact-head CI running

GIT = Commits `df4302bb` and `6bddaf11` were pushed fast-forward to `pca-dev`. Post-push fetch, local HEAD, `origin/pca-dev`, and `git ls-remote` all agree at `6bddaf11252041bcb23c9e92d148390ba76ca61c`; the Parent master TODO, Platform master TODO and route/action crosswalk exist in the remote tree. `.vscode/` and root `0` remain untracked and excluded.
CI = Prior Quality Gates run `36382569294` completed SUCCESS at exact base `aa26c1ba`, 27/27. Current run `36383174064` is IN_PROGRESS at exact HEAD `6bddaf11`; no result is claimed yet.
TODO14 = Published 12 representative entries covering 14 method/path declarations with direct test line anchors and expected outcome classes. Remaining declarations, the integrated disposable collector, and global `UNEXPECTED_401`, `UNEXPECTED_403`, `AUTHORITY_UNAVAILABLE`, and Genesis/browser-trust aggregates remain open/NOT_YET_PROVEN.
VALIDATION = Documentation `git diff --check` passed; no source or test files changed and no tests were run in this docs-only checkpoint.
GATES = TODO-12/14/15, literal TODO-18 localhost acceptance and Platform `HOLD_PARENT_DEPENDENCY` remain open. TODO-20 remains PASS through live migration 0059.
NEXT_ACTION = Continue the per-route assertion map and collector design; then sync the outcome of exact-head run `36383174064`.

### 2026-09-28 05:41 UTC — TODO-14 representative assertion anchors added

GIT = Crosswalk commit `df4302bbf389cea232627961edea9d1b5e9ded13` is local and descends from remote `aa26c1bab9530d6b1e8532545c5c831f3c485d61`. Fresh fetch and `git ls-remote` agreed at `aa26c1ba`; the local documentation commit is not yet published. `.vscode/` and root `0` remain untracked and excluded.
CI = Exact-head Quality Gates run `36382569294` is IN_PROGRESS at base head `aa26c1ba`; it does not cover `df4302bb`. No CI result is claimed for the new crosswalk evidence.
TODO14 = `parent_route_action_test_crosswalk.md` now adds 12 representative entries covering 14 method/path declarations with test file line anchors and expected success, denial, optional-route and unavailable-authority outcomes. Remaining declarations retain suite-only associations. This does not prove an all-route runtime aggregate: `UNEXPECTED_401`, `UNEXPECTED_403`, aggregate `AUTHORITY_UNAVAILABLE`, and Genesis/browser-trust counts remain NOT_YET_PROVEN.
VALIDATION = `git diff --check` passed. No tests ran; source/security behavior is unchanged.
GATES = TODO-12/14/15, literal TODO-18 localhost acceptance, and Platform `HOLD_PARENT_DEPENDENCY` remain open; TODO-20 remains PASS through live migration 0059.
NEXT_ACTION = Publish this narrow docs checkpoint after the ledger sync, inspect its exact-head CI, then continue remaining TODO-14 route assertions and collector design.

### 2026-09-28 05:32 UTC — crosswalk CI result synchronization passed

GIT = Published checkpoint `cc9fceb59d7b07823c6c9833fd1ec898b5857445` synchronized the 27/27 result for crosswalk checkpoint `0e275bf1`; post-push fetch/ref verification passed. Unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36381752337` completed SUCCESS at exact HEAD `cc9fceb5`, 27/27 jobs.
TODO14 = The 52-declaration first-pass handler/test-family crosswalk is published. Exact per-method/path assertion anchors, expected-outcome classes and aggregate runtime counters remain open.
GATES = TODO-12/15 security protocols, literal TODO-18 localhost acceptance, and Platform `HOLD_PARENT_DEPENDENCY` remain open. TODO-20 remains PASS through live 0059.
NEXT_ACTION = Continue exact assertion mapping and collector design without weakening device, Trust Set, E2EE or Owner gates.

### 2026-09-28 05:19 UTC — TODO-14 crosswalk checkpoint passed exact-head CI

GIT = Commit `0e275bf14b95b843cd06dc8d3c92b090422096ea` published the first-pass 52-declaration crosswalk and matching ledgers; fresh fetch, local HEAD, tracking ref and `git ls-remote` agree. Route-family test associations are explicitly not exact assertion coverage.
CI = Quality Gates run `36380843449` completed SUCCESS at exact HEAD `0e275bf1`, all 27 jobs. Real-backend E2E, full disposable MySQL, Android/iOS, browser, security, build and unit jobs passed.
TODO14 = Remains IN_PROGRESS. The crosswalk separates 35 mapped Parent Web client paths, 43 unique backend paths, and six no-caller dispositions; exact method/path assertions and runtime scenario collector remain next.
GATES = TODO-12/15 protocol constraints, literal TODO-18 owner acceptance and Platform `HOLD_PARENT_DEPENDENCY` remain unchanged. TODO-20 is PASS through live migration 0059.
NEXT_ACTION = Continue exact assertion mapping and the disposable runtime collector design; do not infer all-route counts from suite association or journey evidence.

### 2026-09-28 05:07 UTC — TODO-14 static test crosswalk and exact-head CI

GIT = Last published checkpoint `80e3ff47c36cd7c1bbc28f540b15eeeb0291b3c9` is fresh-fetch/`git ls-remote` equal. Current local TODO-14 crosswalk and ledger updates are not yet published; unrelated `.vscode/` and root `0` remain excluded.
CI = Quality Gates run `36379988964` completed SUCCESS at exact HEAD `80e3ff47`, 27/27, including real-backend E2E, full disposable MySQL, Android/iOS, builds, security and browser jobs.
TODO14 = Added `parent_route_action_test_crosswalk.md`: all 52 method/path declarations link to source handlers, route-family test suites and current caller/disposition status. This static first pass explicitly leaves exact assertion-to-row anchors and scenario classification open. The bounded 154/154 campaign and one authenticated browser journey are not global status aggregates.
NEXT_ACTION = Publish this evidence sync, then continue exact assertion mapping and define a disposable collector that separates expected denials from unexpected authorization and authority-unavailable results.

### 2026-09-28 04:57 UTC — report reconciliation checkpoint passed exact-head CI

GIT = `9fc02b41e77fc7a0423033b74b7fcf6fc221aa42` containing the three ledger updates was pushed fast-forward. Fresh fetch, local HEAD, `origin/pca-dev`, and `git ls-remote` all agree; remote master TODO files are present. `.vscode/` and root `0` remain excluded.
CI = Quality Gates run `36379266945` completed SUCCESS at exact HEAD `9fc02b41`, 27/27. Real-backend E2E, full disposable-MySQL certification, Parent/Platform browser suites, Android, iOS, builds, security and unit jobs passed.
REPORT = Attachment snapshot `399304c`/run `36356186069` and its migration-0050 claim are historical. Live schema/grants were already reconciled through 0059; no migration replay is needed.
REMAINING = TODO-12/14/15 and literal TODO-18 `LOCALHOST ACCEPTED` remain open. DEC-035 still forbids plaintext policy and a temporary fail-closed flip without an Owner writer. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Resume TODO-14 runtime route/action evidence; do not expand the bounded journey's zero unauthorized-status result into global proof.

### 2026-09-28 04:44 UTC — historical status report reconciled against current mission state

REPORT = The attachment's `399304c`/run `36356186069` and live migration-0050 snapshot predate the verified `78ac5eac` checkpoint. Live `pca_pro` reconciliation through migration 0059 and the exact schema/grant postflight are already recorded; no migration replay is needed from this report.
CI = Quality Gates run `36378245540` completed SUCCESS at exact HEAD `78ac5eac`, 27/27. Runs `36376318648` and `36377167205` also passed 27/27. TODO-17 automated integration remains PASS; TODO-19 remains active for the current ledger publication and fresh remote verification.
REMAINING = TODO-12/14/15 and literal TODO-18 `LOCALHOST ACCEPTED` remain open. DEC-035 prohibits plaintext policy and a temporary fail-closed flip without an Owner writer. Platform remains `HOLD_PARENT_DEPENDENCY`; no activation, deployment, production smoke or owner UAT is claimed.
NEXT_ACTION = Resume TODO-14 runtime route/action evidence; keep historical report metrics separate from the later source, CI and live-database evidence.

### 2026-09-28 03:25 UTC — owner-flow correction passed exact-head integrated CI

CI = Quality Gates run `36373007968` completed SUCCESS at exact source/test HEAD `3ace68d92792e25de169d3dcb7cf6f1fd9b7075a`; all 27 jobs passed. Parent owner-acceptance real-backend E2E passed 2/2 with zero skipped/unexpected/flaky; full disposable-MySQL, Parent/Platform browser, Android, iOS, security, build and unit jobs passed.
LOCAL_CAMPAIGN = Backend build PASS; TODO-14 route/action suite PASS 154/154, zero skips; Parent Web typecheck, strict typecheck/lint on the changed E2E spec PASS.
REPORT_RECONCILIATION = Attachment refs `0daf660`/`399304c`, CI runs `36350073129`/`36356186069`, and live 0050 claim are historical; the latest verified source HEAD is `3ace68d9`, and live `pca_pro` reconciliation is recorded through 0059. TODO-13 and TODO-17 are PASS. TODO-12/14/15, owner TODO-18 and dependent Platform gates remain open.
ARCHITECTURE = PCA-DEC-028 intentionally keeps BonusGrantLedger process-local. Active-grants is optional/unconsumed; revoke browser exposure awaits reviewed encrypted FamilyAudit actor delivery. Plaintext grant persistence is not an acceptable fix.
NEXT_ACTION = Publish the route-matrix clarification and this ledger sync; continue TODO-12/14/15 without lifting `HOLD_PARENT_DEPENDENCY`.

### 2026-09-28 03:32 UTC — evidence sync pushed; exact-head CI queued

GIT = Documentation-only commit `baf3358f148bba17323c0ecbe4d79beb51a5c9f6` was pushed fast-forward to `origin/pca-dev`; fresh fetch, local HEAD, tracking ref, and `git ls-remote` match. No tracked mission files remain local-only; `.vscode/` and root `0` remain excluded.
CI = Quality Gates run `36374085095` is queued at exact current HEAD `baf3358f`; source/test parent `3ace68d9` passed run `36373007968` 27/27.
NEXT_ACTION = Inspect run `36374085095`; continue TODO-12/14/15 and keep TODO-19 active until current-head CI is complete.

### 2026-09-28 03:40 UTC — ledger-sync exact-head CI passed

CI = Quality Gates run `36374085095` completed SUCCESS at exact HEAD `baf3358f148bba17323c0ecbe4d79beb51a5c9f6`; 27/27 jobs passed.
TODO17 = PASS remains current: source/test SHA `3ace68d9` passed the owner flow 2/2 and 27/27 overall; the full run at `baf3358f` passed 27/27 again.
TODO19 = Current exact-head and remote equality are verified. This CI result is being added to the mission ledger for publication; keep TODO-19 active until that result-sync checkpoint is published and verified.
NEXT_ACTION = Publish the result sync and continue TODO-12/14/15 without lifting owner or Platform gates.

### 2026-09-28 04:00 UTC — exact-head owner-flow locator ambiguity

CI = Quality Gates run `36374962516` at `55c9067b` completed with 26/27 jobs successful. The real-backend owner flow had one pass and one failure because `getByRole('status')` matched both the identity-loading message and revoke-all confirmation.
FIX = The E2E assertion now targets the exact confirmation copy. Local Parent Web typecheck and touched-spec ESLint pass; the source behavior and backend were unchanged.
TODO17 = IN_PROGRESS until the corrected exact-head integrated campaign passes. TODO19 remains IN_PROGRESS through publish, remote verification and fresh CI.
NEXT_ACTION = Publish the narrow test correction and failure evidence; inspect its follow-on exact-head CI, then resume TODO-12/14/15.

### 2026-09-28 04:11 UTC — corrected exact-head integrated regression passed

GIT = Test-only locator correction and three synchronized mission ledgers were committed as `4a1b372dd959596938ce6477f6262c2d3afb2118`, pushed fast-forward, and verified equal to `origin/pca-dev` and `git ls-remote`. Only unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36376318648` completed SUCCESS at exact HEAD `4a1b372d`; all 27 jobs passed, including real-backend browser E2E and full disposable-MySQL certification. This resolves the prior ambiguous Settings status-locator test failure; no product authorization or database behavior changed.
TODO17 = PASS for the integrated automated campaign at exact HEAD `4a1b372d`. TODO19 remains IN_PROGRESS until this CI result is synchronized and its publication is verified. TODO-12/14/15 and literal TODO-18 owner localhost acceptance remain open; TODO-20 remains PASS through live migration 0059.
PLATFORM = `HOLD_PARENT_DEPENDENCY` remains; no localhost owner acceptance, Enrollment activation, deployment, production smoke, or owner UAT is implied.
NEXT_ACTION = Publish this result sync, then continue TODO-12/14/15 without relaxing the Trust Set, encrypted-storage, or owner-acceptance gates.


### 2026-09-28 04:23 UTC — Parent authority and device gates re-reviewed

AUTHORITY = Read-only specialist review reconfirmed no safe route-only TODO-12 fix: schedule-policy has Parent session/role/CSRF plus device bearer and unavailable Trust Set; Web Rules remain unconfigured until encrypted storage/delivery exists. Do not remove either gate or wire plaintext in-memory rules.
POLICY = `familyrbac/policy.ts` still discards FamilyRbacPolicyConfig, leaving four Administrator-configurable operations hard-coded `ALLOW_WITH_STEP_UP` despite safe-default-off requirements. PCA-DEC-034/035 require signed E2EE policy changes, audit, Owner writer, consuming reader, step-up, and certification as one implementation; no piecemeal flip/writer is safe.
AUDIT = `FamilyAuditRecord` offers only `actorDeviceId`, while Parent routes use target device IDs, Parent account IDs, or service sentinels in that field. Production audit uses an in-memory reference repository and a rejecting opaque composer. Correcting identity requires an explicit actor schema and reviewed encrypted delivery; no sentinel substitution or plaintext fallback.
DEVICE = Mobile specialist review found no additional safe TODO-15 source change. Enrollment remains `PAIRING_PENDING`, Parent confirmation reaches `PAIRED`, and ACTIVE requires signed policy delivery/receipt with production crypto verifiers, Trust Set/key-epoch resolution and attestation still gated. Existing epoch/revocation checks remain fail-closed.
NEXT_ACTION = Continue TODO-14 runtime matrix evidence; carry TODO-12/15 protocol gates forward without bypassing crypto/security decisions.

The implementation checkpoint payload is at `3d31cb5b00aea7a4c2ed2b2f66660c05e217bd4e`; canonical-ledger sync is `114b784ea33112cb3bebd64b454866481d8b3ba3`; master TODO publication is `27757ca77e0edec417516784dc3e59da6855896e`; publication-state sync is `8f3f45b47d24cc7debd581230eda23c088d74f4e`; corrective checkpoint is `0ba4c0d8c5631283267c0af2a8dc6046bd4c0552`; ledger sync is `47d564c4af1fd6535dd1c9211cbf9c06a46970fb`; corrective CI-fixture checkpoint is `1949ead054ae93b30fbd7c69dd4e41649b50bdbc`; ledger sync is `0daf66008a801e5006c16130ae9f1adb052bd1f4`; daily browser-grant fixture correction is `a76aacae1710a7ff2fdc37788b0a291b3220decd`; latest prior ledger sync is `9c50e8efd7f18c18d7e16ec0ef6697fb88026064`; MFA step-up correction is `f51fe3dff3da62c045d1f8fd9d9a81be02efb2a7`. Exact-head run `36351171969` at `9c50e8ef` failed only the real-backend browser E2E job, with 26 jobs passing; its grant-based cross-family API check passed; the MFA-gated invitation correction is committed locally and awaits exact-head CI.

### 2026-09-28 04:28 UTC — authority/device review and result-sync CI reconciled

GIT = Result-sync commit `678b1d33937c62e7b47da65ef88919f0209b523c` is remote; its exact-head Quality Gates run `36377167205` passed all 27 jobs. Three mission-ledger updates from the 04:23 specialist reviews are local for the next publication; unrelated `.vscode/` and root `0` remain excluded.
TODO17 = PASS: source/test checkpoint `4a1b372d` passed `36376318648` 27/27; the documentation-sync checkpoint `678b1d33` also passed `36377167205` 27/27.
TODO12_14 = Review confirmed no safe route-only removal of device/Trust Set checks, no production plaintext Web Rules path, and unresolved typed FamilyAudit actor attribution. Four configurable Administrator operations still have effective `ALLOW_WITH_STEP_UP` despite safe-default-off; DEC-034/035 require the signed E2EE writer/reader/audit/step-up/certification together. Global route/action aggregates remain NOT_YET_PROVEN.
TODO15 = Mobile review found no additional safe code change: production crypto verifiers, durable Trust Set/key epochs, attestation, and signed first-policy receipt/activation remain gates; existing epoch/revocation checks remain fail-closed.
NEXT_ACTION = Publish these specialist findings and continue TODO-14 route/action evidence; do not fabricate or bypass the required security protocols.

### 2026-09-28 04:41 UTC — exact-head authority-review sync passed

GIT = Ledger review sync `78ac5eacae15958ac5c575e90e9f76e058717732` is pushed fast-forward and matches fresh fetch/tracking/`git ls-remote`; exact-head Quality Gates run `36378245540` passed 27/27.
TODO17 = PASS: source/test HEAD `4a1b372d` passed `36376318648`, 27/27; two subsequent documentation checkpoints `678b1d33` and `78ac5eac` passed `36377167205` and `36378245540`, 27/27 each.
DEC035 = Owner ruling explicitly prohibits both plaintext policy configuration and a temporary fail-closed flip without an Owner writer. Safe-default-off remains unimplemented; only the full signed E2EE writer/reader/audit/step-up/certification path may close the decision.
TODO12_14_15 = No safe route-only TODO-12 or crypto-bootstrap TODO-15 source change was identified. Aggregate route/action counts remain NOT_YET_PROVEN; the documented authority and device protocol gates remain open.
NEXT_ACTION = Continue TODO-14 runtime route/action evidence, without bypassing the Owner ruling or device/E2EE gates.

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

STATUS = PASS
OWNER = Coordinator  
FILES = `backend/src/parentaccount/**`, `backend/src/http/routes/parentAccountRoutes.ts`, `parent-web/src/pages/auth/**`  
EVIDENCE = Approved login/email/session behavior reconciled; exact-head Quality Gates run `36370514236` passed 27/27 jobs at `739133e9`, including Parent auth/backend, Parent Web unit and real-browser coverage.
BLOCKER = None for the approved login baseline.
DONE_WHEN = approved login/email/session behavior is preserved or restored

### TODO-03 — Verified-email activation

STATUS = PASS
OWNER = Coordinator  
FILES = Parent account service/repository/routes and Parent auth UI/tests  
EVIDENCE = Activation-only verification and denial/expiry/replay boundaries passed auth/migration DB certification and full DB certification in exact-head run `36370514236` at `739133e9`; all 27 jobs passed.
BLOCKER = None for the verified-email lifecycle.
DONE_WHEN = unverified Parents restricted and verified Parents proceed safely

### TODO-04 — Atomic Parent family provisioning

STATUS = PASS
OWNER = Coordinator  
FILES = Parent provisioning service/repository, `backend/src/db/schema.ts`, migrations 0049/0051+, MySQL tests  
EVIDENCE = First-owner bootstrap certification and full disposable-MySQL DB certification passed in exact-head run `36370514236` at `739133e9`; repository migrations through 0059 applied and Parent persistence coverage passed.
BLOCKER = None for atomic first-family provisioning in the integrated checkpoint.
DONE_WHEN = exactly one family + one initial ACTIVE Administrator; retry and concurrency safe

### TODO-05 — First-login trusted-browser creation

STATUS = PASS
OWNER = Coordinator  
FILES = Parent login/MFA repositories and service; `parent-web/e2e-real/parentMfa.spec.ts`  
EVIDENCE = Exact-head real-browser and disposable-MySQL campaigns passed; first successful login establishes account-bound HttpOnly session and daily-login cookies, covered by Parent MFA browser and backend persistence suites.
BLOCKER = None for first-login automatic browser assurance.
DONE_WHEN = successful first login automatically establishes account-bound browser trust

### TODO-06 — Three-day TOTP enrollment policy

STATUS = PASS
OWNER = Coordinator  
FILES = Parent MFA service/repository/routes/UI and migrations  
EVIDENCE = Fixed server-side 72-hour deadline and non-reset behavior passed auth/migration DB certification and Parent backend/browser jobs in run `36370514236` at `739133e9`; 27/27 jobs passed.
BLOCKER = None for the server-side TOTP enrollment deadline.
DONE_WHEN = one server-side 72-hour deadline starts once and cannot be reset by browser tricks

### TODO-07 — TOTP setup and activation

STATUS = PASS
OWNER = Coordinator  
FILES = `backend/src/parentaccount/mfa/**`, Parent MFA routes/UI and tests  
EVIDENCE = Parent MFA browser, backend authentication/migration DB, and full disposable-MySQL certification passed in exact-head run `36370514236` at `739133e9`, covering setup, activation, secret handling and session gates.
BLOCKER = None for tested TOTP setup/activation behavior.
DONE_WHEN = secure secret + local QR + confirmation + encrypted ACTIVE state proven

### TODO-08 — Known-browser login

STATUS = PASS
OWNER = Coordinator  
FILES = Parent login service, MFA/trust repository, email templates and browser specs  
EVIDENCE = Backend known-browser login and account-bound grant tests passed; exact-head run `36370514236` passed Parent browser/authentication and DB jobs at `739133e9`.
BLOCKER = None for the tested known-browser password-only flow.
DONE_WHEN = known browser uses email + password without unnecessary login TOTP

### TODO-09 — New/unknown-browser login

STATUS = PASS
OWNER = Coordinator  
FILES = Parent login/OTP/TOTP flows, browser assurance repository, `parent-web/e2e-real/parentMfa.spec.ts`  
EVIDENCE = Exact-head run `36370514236` passed the real-browser unknown-browser email OTP + active TOTP journey, real-backend disposable MySQL, and authentication/migration DB certification at `739133e9`; 27/27 jobs passed.
BLOCKER = None for the tested unknown-browser login path.
DONE_WHEN = email OTP + TOTP-if-enrolled flow works and successful browser becomes trusted

### TODO-10 — Remove Genesis from Parent authentication/authorization

STATUS = PASS
OWNER = Coordinator
FILES = Parent auth, provisioning, authority, routes, UI and tests  
EVIDENCE = Complete Wave-2 source audit + integrated route evidence: zero ordinary-Parent Genesis dependencies. `parent_genesis_challenges`/`parent_genesis_step_up_authorizations` are referenced only by `schema.ts` (retained real objects awaiting a separately-authorized cleanup migration; PCA-DEC-037 retired them and "nothing writes them any more"), and no `/api/parent/genesis/*` route declaration exists (the HTTP suite asserts 404 for all four former paths). `attemptFamilyGenesis` survives only as a comment in `familymembers/*`; former Genesis/device-signature gates on billing/commercial authority are documented as replaced by operation-scoped TOTP step-up; remaining `genesis` identifiers belong to the family-owner attestation chain (`family_authority_genesis_anchors`, `FamilyTrustSetEngine` genesis-epoch semantics) and are CHILD_DEVICE_SECURITY_LEGITIMATE, not Parent authority. The integrated campaign observed `GENESIS_BLOCKED_NORMAL_ACTIONS = 0` with no scenario requiring Genesis; provisioning creates no Genesis authority/device rows.
BLOCKER = None for the audit itself. A future cleanup migration for the two retired schema objects remains separately authorized only.
RECOMMENDED_STATUS = PASS (coordinator recommendation: zero ordinary-Parent Genesis runtime dependency proven by complete source audit plus integrated route evidence)
OWNER_DECISION = PASS — owner-approved during the Wave-3 directive (2026-09-28); formally promoted in the Wave-3 checkpoint entry above.
DONE_WHEN = ordinary Parent runtime has zero Genesis dependency

### TODO-11 — Migrate Trusted Browser away from family authority

STATUS = PASS  
OWNER = Coordinator  
FILES = Parent trust/session providers, repositories, routes/UI; family suspension  
EVIDENCE = Historical MySQL test proves suspension revokes sessions, daily grants, pending login challenges and family-bound step-up grants; old browser grant requires fresh verification after reactivation. Browser trust is account-bound login assurance only. The backend `/api/parent/sessions/revoke-all` route has CSRF/session-invalidation tests. Parent Settings exposes explicit confirmation through `ServiceAuthClient.revokeAllSessions()` and redirects to sign-in after success. Focused real-client, Settings, and RTL validation passed 42/42; TypeScript and touched-file ESLint passed.
BLOCKER = Cross-browser listing and individual-device management remain follow-ups. Current all-session revocation ends with the caller redirected to sign-in; no device-level controls are implied.
DONE_WHEN = browser trust affects login assurance only

### TODO-12 — Complete normal Parent authority migration

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Parent route/action authority, authz, child requests, family membership, device binding, removal decisions, Parent Web action clients  
EVIDENCE = Source/action matrix reviewed; bounded route/action campaign passed 154/154 after a successful backend build. Removal mutations use active Administrator and scoped TOTP step-up; Parent decision actor IDs persist through migration 0057 and are omitted from Parent DTOs. Local disposable MySQL 8.4.11 persistence coverage for migration 0057 passed (22/22); migrations 0001–0059 applied and the disposable DB was removed. Fresh source review confirms the bonus revoke route checks active Parent role, CSRF and child-family membership before mutating `BonusGrantLedger`; its actor/time attribution is process-local. `FamilyAuditRecord` currently exposes only `actorDeviceId`; source also stores target device IDs, Parent account IDs, or service sentinels in device-shaped actor fields. Production FamilyAudit uses an in-memory reference repository and a rejecting opaque composer pending crypto review. `childPolicyRoutes.ts` requires Parent Administrator session, CSRF, bound device bearer and Trust Set authorization for schedule-policy writes; production's `StoreBackedTrustSetRoleResolver` returns `NO_TRUST_SET` while the verified acceptance writer has no production caller. Wave 5C now wires one async exact-membership adapter over the opaque child-profile registry into Parent action authorization, the Parent-session child-request authorizer and child-request routes; focused route/service/resolver tests pass 128/128 and backend build passes. The current disposable-MySQL route campaign passes 51/51 and integrated report proves 45/52 declarations across 137 scenarios. A guarded UUID-named local disposable MySQL database passed the MySQL 8.4.11 environment/privacy gate (58 migrations) and the child-profile registry suite (10/10), then was removed; the repository wrapper itself still hits Windows `spawn EPERM` when launching a child process. Web Rules return `503 not_configured` while production leaves `webRuleService` absent. Re-review of `familyrbac/policy.ts` confirms four configurable Administrator operations remain hard-coded `ALLOW_WITH_STEP_UP` while the documented safe default is off; the resolver discards config. PCA-DEC-034/035 require the signed E2EE policy-change envelope, audit event, Owner writer, actual reader, step-up, and populated-state certification together. PCA-DEC-028 makes process-local bonus grant bookkeeping intentional and does not authorize plaintext persistence.
BLOCKER = Schedule-policy remains closed pending production Trust Set acceptance/writer wiring; the async child-profile membership second gate is now covered by exact-head Quality Gates runs `36772627678` and `36774031399`. A further bootstrap dependency is source-proven: `TrustSetEpochAcceptanceService` requires a durable genesis anchor for epoch 1, while PCA-DEC-037 first-login provisioning intentionally writes no device, `family_authority_genesis_anchors`, attestations, or chain-head rows (`backend/test/db/parentAccount.mysql.test.mjs:337-339`). No first-device/root-of-trust ceremony is defined or wired for these TOTP-provisioned families; do not infer a DSK, signer, or device root from Parent account/TOTP. The owner/security protocol decision must precede any acceptance writer or route activation. Web Rules require reviewed encrypted policy storage/delivery (webRuleService absent from production composition; all three routes 503 at webRuleRoutes.ts:163/187/231). Correct Parent actor attribution requires an explicit actor model plus reviewed encrypted FamilyAudit delivery; actorDeviceId is the sole populated actor field and currently carries device ids, parent account ids, service sentinels and target device ids while actorMemberId is never set (familyrbac/FamilyAuditStore.ts:19-20; representative writers PairingService.ts:77, retentionRoutes.ts:279, InvitationService.ts:217, RemovalDecisionAuthority.ts:436). PCA-DEC-035 remains open: familyrbac/policy.ts:123 discards the config, the four configurable operations stay hard-coded ALLOW_WITH_STEP_UP, and family_rbac_policy_config has zero production writers — plaintext and a temporary fail-closed flip remain rejected. Every device-actor route is additionally blocked by un-mintable device sessions (RejectingDeviceSignatureVerifier at main.ts:364 plus the status='ACTIVE' requirement in MySqlDeviceRepository.getActiveDeviceSessionEpoch). Policy/request content is E2EE-only under PCA-SEC-023/PCA-DEC-028; do not add plaintext persistence or fabricate encrypted envelopes. TODO-15 device trust/attestation constraints remain authoritative.
WAVE4_VERIFIED_DECOMPOSITION = (read-only at 89570c6d; Agent 1 full review + Agent 7 adversarial confirmation C1-C7) A. Trust-set lane dead in production (UnavailableTrustSetRoleResolver returns NO_TRUST_SET at actor resolution, ParentActionAuthorizationService.ts:239-247); B. account lane (session + family scope + ACTIVE Administrator + CSRF + operation-scoped TOTP) is live for membership/removal/child-request parent routes; child-device lane unreachable; DEVICE/MEMBER targets hard-DENY; child-request/bonus stores in-memory per PCA-DEC-028; C. Web Rules service never wired; D. FamilyAudit actor overload confirmed with a call-site table; E. policy-config discard + zero writers confirmed. Dependency order: durable signed-epoch source + persisted epoch floors FIRST (never reuse family_authority_chain_heads for FTS floors), then the second (child-profile membership) resolver, then route activation, then encrypted policy/audit/Web-Rules storage, then mobile activation (TODO-15), then TODO-14 aggregate closure.
DONE_WHEN = normal authority = session + same family + ACTIVE Administrator

### TODO-13 — Sensitive-action TOTP step-up

STATUS = PASS
OWNER = Coordinator  
FILES = Step-up schema/service/routes/UI and classified Parent actions  
EVIDENCE = Source map confirms all ten currently issuable high-risk operations have Parent route consumers and fresh, operation-scoped step-up: family member add/remove/role-change/invitation-revoke; device enrollment create/revoke; retention update; history export/delete; and security-settings change. Removal create and decisions consume operation-specific grants; invitation, retention/history, device enrollment, pairing and security-setting routes consume their matching grants. `family.ownership.transfer` and `family.recovery.material.reveal` remain in the schema vocabulary but are absent from the issuable-operation set; the step-up route rejects them, and no action consumer exists. Exact-head Quality Gates run `36360087042` at `35f6c022` passed all jobs, including Parent Web and backend regression. Local backend build passed, and focused step-up/consumer HTTP suites passed 64/64 with zero skips on 2026-09-28.
BLOCKER = None for currently implemented sensitive actions. Ownership transfer and recovery-material workflows remain disabled until separately designed and authorized; this PASS does not enable them.
DONE_WHEN = classified high-risk actions require fresh TOTP

### TODO-14 — Full Parent route/action audit

STATUS = IN_PROGRESS  
OWNER = Coordinator  
FILES = Parent backend routes/pages/actions and authority matrix  
BOUNDED_ROUTE_DECLARATION_COVERAGE = 52/52 declarations (138 bounded scenarios; coverage proven by exact method+route inventory-key comparison, never row counts; zero unexpected 401/403/other in the bounded slice)
DATABASE_BACKED_INTEGRATED_EVIDENCE = 45/52 declarations via the run-owned disposable-MySQL campaign (`npm run test:db:parent-route-audit`; current report: 137 matched scenarios: 50 allow, 75 expected denial, 1 protective-authority-not-applicable, 11 validation/protocol; zero unexpected 401/403/other; collector report schemaVersion 3 with per-tier counts and `declarationsWithoutIntegratedEvidence`)
CURRENT_LOCAL_RECHECK = On 2026-09-30, repository verification applied all 58 migrations to a fresh UUID schema on task-owned MySQL 8.4.11; the serialized Parent route-audit inner suite passed 51/51. Its report reconfirmed 45/52 integrated declarations, 137 scenarios, 50 allows, 75 expected denials, 11 validation/protocol, and zero unexpected 401/403/other; seven Trust Set/Web Rules/crypto/optional dashboard dispositions remain outside integration. The UUID DB was dropped and postflight found zero `pca_test_codex_%` databases.
INTEGRATED_REQUIRED_AND_PROVEN = 45
INTEGRATED_REQUIRED_BUT_MISSING = 0 (all 17 previously missing or authority-misclassified required declarations now carry database-backed HTTP evidence; five child-request/bonus-time declarations were verified against real Parent session/role rows and registry-backed membership)
AUTHORITY_GATED = 1 (schedule-policy — production `StoreBackedTrustSetRoleResolver` returns `NO_TRUST_SET` because the verified Trust Set acceptance writer has no production caller)
SERVICE_GATED = 3 (web-rules GET/POST/remove — production leaves `webRuleService` absent, 503 `not_configured`)
CRYPTO_GATED = 2 (signed and authorized-recovery decisions)
OPTIONAL = 1 (dashboard; no Parent Web caller, optional unconsumed read)
UNREVIEWED = 0; ALL_DECLARATIONS_RECONCILE = YES (each declaration carries exactly one reviewed disposition in the crosswalk dispositions table, updated in Wave 3)
EVIDENCE = Refreshed matrix: 35/35 Parent Web client paths map to handlers; 52 declarations / 43 unique paths; the crosswalk anchors all 52 to direct HTTP status assertions and records bounded + integrated tiers. Prior bounded history retained in the checkpoint entries below (154/154 route campaign; 52/52 collector coverage). Wave-3 local validation: audit lane PASS 50/50 against a run-owned disposable `pca_test_codex_<uuid>` database (created, migrated, environment verified as MySQL 8.4.11 utf8mb4/utf8mb4_bin with UTC time_zone, dropped afterward); integrated report 40/52 with 130 scenarios and zero unexpected; bounded collector regression PASS 144/144 with 52/52 declarations and 138 scenarios; parent-auth disposable campaign PASS 61/0 with 3 expected privileged-mode skips; authority-diagnostics campaign PASS 62/62; full non-DB backend suite PASS 2674/2674. Wave-2 validation remains recorded in the checkpoint entries below (integrated 38/38; bounded 144/144; parent-auth 61/0/3; authority-diagnostics 62/62; full non-DB 2674/2674).
BLOCKER = `GLOBAL_AGGREGATE_STATUS` stays `NOT_YET_PROVEN` by design: seven declarations remain outside integrated success evidence — one TODO-12 schedule-policy Trust Set gate, three TODO-12 Web Rules encrypted-storage/delivery gates, two TODO-15 signed/recovery crypto gates, and one optional unconsumed dashboard read. Do not activate gated routes or fabricate signatures to raise the percentage; do not add plaintext policy persistence (PCA-DEC-028).
DONE_WHEN = every required route is audited with proven authority and no normal action blocked by Genesis or browser trust  
GLOBAL_AGGREGATE_STATUS = NOT_YET_PROVEN
UNEXPECTED_401 = 0 bounded / 0 integrated; aggregate NOT_YET_PROVEN
UNEXPECTED_403 = 0 bounded / 0 integrated; aggregate NOT_YET_PROVEN
AUTHORITY_UNAVAILABLE = bounded 5 (known schedule-policy and membership boundaries); integrated campaign 0 observed across 45 declarations; aggregate count NOT_YET_PROVEN
GENESIS_BLOCKED_NORMAL_ACTIONS = 0 bounded + integrated; source audit shows 0 normal-authority dependencies (see TODO-10)
TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS = 0 bounded + integrated; source audit shows 0 authority dependencies

### TODO-15 — Preserve child-device cryptographic security

STATUS = IN_PROGRESS  
OWNER = Coordinator; mobile specialist review complete  
FILES = Device/session repositories and routes, enrollment binding, Parent device UI/API, Android/iOS contract surfaces  
EVIDENCE = Session/current-family/revocation gates and the durable Trust Set/key-epoch persistence and signature-verification foundation (Waves 5A/5B) are implemented. Mobile review found AddDeviceWizard called invitation `REDEEMED` “Connected” although backend device state is `PAIRING_PENDING`; local correction now says “Enrollment submitted”, explains fingerprint confirmation is still required, and links to Advanced Security pairing. Focused component regression passed 1/1 and Parent Web typecheck passed. iOS `PolicyApplicationGate` now rejects a missing trusted epoch floor; standalone Swift compile and four behavior assertions pass; Xcode XCTest/simulator is unavailable. Android bootstrap/recovery accepts only `PAIRING_PENDING` at the HTTP parser, coordinator response boundary, and final persistence boundary; malformed higher lifecycle statuses are treated as ambiguous while retaining the durable recovery attempt. Focused Gradle tests passed 50/50 (30 coordinator and 20 HTTP client tests; 0 failed/errors/skipped). Current source still has no production Trust Set acceptance-writer caller, approved first-device/root ceremony, deployable device-signing verifier, signed first-policy receipt/application path, or independent attestation. Android enrollment remains fail-closed at `CryptoReviewRequired`; iOS lifecycle/receipt-verification/application helpers still have no production caller.
BLOCKER = Trust Set ingestion and PAIRED-to-ACTIVE remain unavailable because PCA-DEC-037 Parent provisioning creates no genesis device/DSK anchor, and no owner/security bootstrap protocol is approved. Production device signature verification and independent attestation are also absent; protection status remains a device self-report. Do not infer a device root from Parent/TOTP or label any device ACTIVE before a signed, replay-safe, epoch-bound policy is verified and applied.
WAVE4_VERIFIED_LIFECYCLE_FACTS = (read-only at 89570c6d; Agents 3/4 + Agent 7 C5/C6/C9) BACKEND: PAIRING_PENDING-to-PAIRED is a parent action (guarded UPDATE devices SET status='PAIRED' ... WHERE status='PAIRING_PENDING' with self-approval exclusion, MySqlDeviceRepository.ts:298-300); PAIRED-to-ACTIVE has NO writer at all (only REVOKED and PAIRED UPDATEs exist; the genesis INSERT creates ACTIVE but is crypto-gated) and no device-facing status channel returns it; device sessions are un-mintable behind the rejecting verifier. ANDROID: lifecycle-audit infrastructure exists (DeviceEnrollmentState enum, persistent audit sink, migration 4-to-5) but is not an activation engine — EnrollmentState deliberately has no PAIRED/ACTIVE arm, state is derived from the backend bootstrap status (PairingState.valueOf(result.status); trustSetEpoch/keyEpoch persisted as 0), no signature/epoch/replay verification exists, key generation is NotApprovedDeviceKeyPairGenerator (bootstrap stops at CryptoReviewRequired), and PairingApiClient has no implementation/callers. IOS: EnrollmentLifecycleMachine is constructed only in tests; PolicyApplicationGate, acknowledge and clearPolicy have zero callers; no CryptoKit verification exists; the receipt-verify-decrypt-apply pipeline is absent (applyVerifiedPolicy has zero production callers); FamilyControls authorization is a strictly-earlier permission, never activation. CRYPTO: envelope acceptance is fail-closed at two independent layers (rejecting verifiers + unattainable MAX_SAFE_INTEGER epoch floors); no durable Trust Set store or server key-epoch store exists; FDEK wrap targets ACTIVE entries only. The exact legitimate PAIRED-to-ACTIVE proof is: first accepted family envelope (device DSK signature over a server challenge, backend envelope acceptance with signature + Trust Set/key-epoch floors + replay/idempotency ledgers, on-device verification/decryption, successful applyVerifiedPolicy) — currently NOT BUILT on any layer.DONE_WHEN = identity/pairing/signatures/replay/revocation/wrong-device protections remain green

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
EVIDENCE = Local policy regression passed: backend 2751/2751; Parent Web 152 files/1076 tests; Parent Web typecheck; disposable MySQL 669 pass/0 fail/9 expected skips; populated production-path MySQL 275/275/0 skips; real-browser Parent MFA and optional setup 4/4/0 skipped; four contract catalogues; security controls; repository checks; diff check. Exact-head CI for pushed a8f08abc is UNVERIFIED because configured GitHub API proxy 127.0.0.1:9 refused connections.
BLOCKER = Exact-head Quality Gates for a8f08abc is unverified; TODO-17 remains IN_PROGRESS until the exact pushed head passes CI. TODO-12/14/15 and owner/release gates remain separate.
DONE_WHEN = integrated regression is green and remaining external device/owner gates are accurately separated

### TODO-18 — Owner localhost acceptance

STATUS = TODO  
OWNER = OWNER + coordinator  
FILES = N/A  
EVIDENCE = Not offered; literal response not received.  
BLOCKER = Parent TODO-12/14/15 authority/device gates remain open; owner localhost validation is not inferred from green CI.
DONE_WHEN = literal `LOCALHOST ACCEPTED` received

### TODO-19 — Git reconciliation + remote alignment + exact-head CI

STATUS = IN_PROGRESS
OWNER = COORDINATOR
FILES = Parent/Platform source, tests, migrations, assessments and ledgers  
EVIDENCE = Source/test checkpoint a8f08abcde68bc7ef11c0f6df910b8872cfde191 was pushed by ordinary fast-forward and fresh fetch confirmed HEAD=origin/pca-dev at that SHA. Exact-head CI and the result-ledger publication remain pending; configured GitHub API proxy refused run lookup.
BLOCKER = Exact-head Quality Gates for a8f08abc and the subsequent ledger-sync commit are unverified; source/test checkpoint is pushed and fetch-confirmed.
DONE_WHEN = local/remote align, complete approved state is remote, exact-head CI PASS, and all files are classified
LOCAL_HEAD = Post-sync local HEAD was verified equal to origin/pca-dev by a fresh fetch after the ledger commit.
REMOTE_HEAD = Post-sync origin/pca-dev matched local HEAD after fresh fetch; see Git history for the ledger-sync SHA.
PARENT_LOCAL_ONLY_FILES_REMAINING = 0 tracked mission files; .vscode/ and root 0 remain excluded.
PARENT_UNPUSHED_COMMITS_REMAINING = 0
EXACT_HEAD_CI = a8f08abc result UNVERIFIED; gh run list cannot reach GitHub because configured proxy 127.0.0.1:9 refused the connection.

CURRENT_REENTRY_CHECK = 2026-09-30: exact-head Quality Gates run `36657492055` passed 27/27 at SHA `965479051b547cb659946c0c4a6fb8f237a5883c`. Full disposable-MySQL certification, real-backend browser E2E, Android, iOS, backend, Parent/Platform, release-control and security jobs passed. Parent production-preview browser suite passed 101/101 with demo fixtures; Platform production-preview suite passed 21/21 with HTTP mocks. Backend and DB health returned 200; both web apps were restored to real-backend local development mode. Use `127.0.0.1` because `localhost` reaches an unrelated IPv6 listener. Fresh read-only TODO-20 preflight resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178` but TCP/3306 returned False; no live read or mutation occurred. TODO-20 and owner TODO-18 remain open.

### 2026-09-30 — Exact-head Quality Gates passed

CI = Run `36657492055` completed SUCCESS 27/27 at SHA `965479051b547cb659946c0c4a6fb8f237a5883c`. Backend build/unit tests, full disposable MySQL, real-backend browser E2E, Parent and Platform suites, Android, iOS, security, release controls, repository quality, and all required jobs passed.
TODO20 = Fresh read-only preflight resolved the live database host to `4.161.89.178` but TCP/3306 was unreachable. No live DB read/mutation occurred; continue only from a reachable authorized network/credential context, with local-first migration validation and immediate preflight still mandatory.
GATES = TODO-14 remains 45/52 with gated/optional declarations; TODO-15 awaits the owner-approved device-root/crypto protocol; TODO-20 remains repository/local 0060 versus live last verified 0059. Owner TODO-18 is pending and Platform remains `HOLD_PARENT_DEPENDENCY`.

### TODO-20 — Live schema / DB grants reconciliation

STATUS = IN_PROGRESS (repository migration 0061; owner-UAT last verified at 0060; live pca_pro last verified at 0059; current parity is NO)
OWNER = Coordinator  
FILES = Repository schema/migrations, local PCA DB, live `pca_pro`, runtime grants  
AUTHORIZATION = Owner reminder received 2026-09-27: full repository/local/live pca_pro/runtime-grant reconciliation is approved; ordinary additive/corrective migrations may proceed only after local test and fresh live preflight.  
EVIDENCE = Canonical schema + migrations through 0059 declare 92 tables, 792 columns, 104 foreign keys, 92 primary keys, 38 unique non-primary indexes, 141 non-unique indexes, and 282 checks. Isolated MySQL 8.4.11 from-zero verification passed with 57 migrations; Parent DB target passed 61 tests with 3 expected privileged-mode skips; Platform Admin DB target passed 11/11; focused migration-upgrade safety passed 3/3. Exact-head Quality Gates run `36360087042` completed SUCCESS at `35f6c022f017e04aecbf3573394bf20f90d12489`, including full disposable-MySQL certification and Parent/Platform real-backend browser E2E. After immediate preflight, the official runner applied only 0059 to verified `pca_pro` (`pca-mysql.mysql.database.azure.com`, MySQL 8.4.9-azure). TLS verified as `TLS_AES_256_GCM_SHA384`; live journal is 57 through 0059; live introspection compared to local MySQL 8.4.11 with `EXACT_MATCH`. All 92 tables, 792 columns, 104 FKs, 92 PKs, 38 unique indexes, 141 non-unique indexes, and 282 checks match. The two live CHECK clauses are now canonical (`purpose` `_ascii`, hash `_utf8mb4`) and remain enforced. Runtime grants match the explicit repository plan exactly (92/92; only expected global `USAGE` beyond table grants). Exact row counts for 90 readable application tables are unchanged; the migration journal increased exactly 56→57; `parent_account_security_events` remains intentionally unreadable through the runtime identity (INSERT-only). No application rows or reference data were seeded; migration 0059 contains only the two corrective CHECK DDL operations and its journal insert. The attached status report's `0daf660`/`399304c` checkpoints and claim that live was still at 0050 are historical; the current fetched head and fresh live preflight/postflight above supersede them.
LOCAL_SERVICE_REPAIR = Downloaded official MySQL 8.4.11 Windows archive and verified its published MD5; extracted and initialized a loopback-only instance on 127.0.0.1:33361 under a fresh OS-temp datadir. No installed MySQL service or existing datadir was started or touched. Local DB harness uses only disposable databases and test-only credentials; no live credentials/data were used locally.  
LOCAL_SNAPSHOT_REGENERATION = Reviewed dirty snapshot diffs and found `device_session_epoch` under `complimentary_entitlement_grants` despite migration 0056/schema.ts locating it on `families`. Preserved pre-refresh files in task temp storage. A fresh disposable MySQL 8.4.11 database applied migrations 0001–0059 through `npm run db:migrate`; `npm run db:schema:snapshot` regenerated both artifacts from that DB. An independent second database passed `verify-mysql.mjs` from zero (57 migrations, 92 tables); both databases' complete introspection snapshots compare `EXACT_MATCH`. Follow-up artifact check confirms 92 SQL table sections and 92 manifest tables; the epoch occurs on `families` only. No application rows or seeds were created.
PCA_PRO_TARGET = Previously verified Azure MySQL Flexible Server `pca-mysql.mysql.database.azure.com` / database `pca_pro`, version `8.4.9-azure`; TLS cipher `TLS_AES_256_GCM_SHA384`. Last proven migration 0059 applied and post-verified; current endpoint access failed the TCP/3306 reachability preflight. The API CNAME points to a hostname absent from the listed App Services; API owner remains unidentified.
CURRENT_RECHECK = Repository source contains additive migration 0061 for Parent password-failure window/count/lock-until fields. Full disposable MySQL applied all 59 migrations from zero and passed 669 tests/0 failures/9 expected skips; populated-database production-path certification passed 275/275 with zero skips. The official harness removed its random disposable schema. Owner-UAT remains last verified at 0060 and was not mutated; live pca_pro remains last verified at 0059 with TCP/3306 previously unreachable. No live query or mutation occurred in this policy task.
BLOCKER = Current live MySQL reachability was last measured unavailable (`Test-NetConnection ... -Port 3306 = False`); this policy task made no fresh live query. Resume from an authorized network/credential context, inspect live read-only, then apply only the locally validated migration(s) required by a fresh comparison and reconcile grants if that comparison confirms a mismatch.
DONE_WHEN = repository schema matches local DB and pca_pro; required migration locally tested and live-applied if required; grants match; no seed data  
NO_SEED_DATA = YES (no test fixtures or application rows; only migration-required reference data)  
DATA_LOSS = 0  
NO_BLIND_DB_PUSH = YES  
LOCAL_TEST_FIRST = PASS on disposable MySQL 8.4.11 through repository migration 0060: 58-migration verification; child-profile registry DB 10/10; migration-0060 runtime grant plan exact-privilege assertion 17/17; real temporary runtime-principal grant boundary 6/6 under the actual grant planner; historical migration-upgrade 3/3, Parent 61/0/3skip, Platform 11/11, dedicated Parent grant 3/3 and Platform grant 5/5
LIVE_PREFLIGHT_BEFORE_MUTATION = YES  
REPOSITORY_SCHEMA_MATCH_AFTER = PASS; full local-to-live introspection comparison is EXACT_MATCH after 0059.
LOCAL_DB_SCHEMA_MATCH_AFTER = PASS; local MySQL 8.4.11 applied all 57 migrations and matches canonical repository schema.
LIVE_PCA_PRO_SCHEMA_MATCH_AFTER = PASS; live journal=57 and local/live full structural snapshot is EXACT_MATCH; 0059 preserved all readable application-table row counts.
LIVE_GRANTS_MATCH_AFTER = PASS; exact 92/92 expected table grants, no missing/extra/mismatched grants. `parent_account_security_events` is intentionally INSERT-only per plan and its denied runtime SELECT is not a mismatch.
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
MYSQL = Disposable MySQL 8.4.11 lanes validated through migration 0060 repository-side, now including the Wave-5B acceptance-integration suite (real stores + real P-256 verifier + real genesis-anchor source): inner 666 pass / 0 fail; certified production paths 273/273 (0 skipped, 0 failed). Live `pca_pro` remains at 0059
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

LOCAL_HEAD = 6cefdf1ee7d999c390bfe2100db67fa61b36e32f
REMOTE_HEAD = 6cefdf1ee7d999c390bfe2100db67fa61b36e32f
LOCAL_REMOTE_EQUAL = YES (fresh fetch)
FILES_LEFT_DIRTY = 2 untracked exclusions preserved: `.vscode/` local files and the unrelated root `0`
PARENT_LOCAL_ONLY_FILES_REMAINING = 0
PARENT_UNPUSHED_COMMITS_REMAINING = 0
EXACT_HEAD_CI = SUCCESS for `6cefdf1e` run `36505757047` (27/27 jobs, zero failures); the Wave-5B commit's exact-head run is reported to the owner with the Wave-5B report

## Database

REPO_SCHEMA_HEAD = source/schema.ts + migrations through 0060 (94 tables)
REPO_MIGRATION_HEAD = 0060 (58 SQL migration files; 0009 and 0010 are absent from repository history)
LOCAL_SCHEMA_HEAD = 0060 on run-owned disposable MySQL 8.4.11 lanes (94 tables; Wave-5B acceptance suites exercise the 0060 tables end-to-end with real P-256 signatures)
LIVE_PCA_PRO_SCHEMA_HEAD = 0059 on verified `pca-mysql.mysql.database.azure.com/pca_pro` (MySQL 8.4.9-azure)
LOCAL_DB_SCHEMA_MATCH = PASS through 0060 in the disposable lane (94 tables / 806 columns / 94 primary keys / 142 indexes / 293 checks / 58 migrations)
LIVE_PCA_PRO_SCHEMA_MATCH = EXACT_MATCH with local MySQL 8.4.11 through 0059; live has not been advanced to 0060
LIVE_GRANTS_MATCH = PASS through 0059 (92/92 at that schema level); the repository plan declares 94 tables (0060 adds `family_trust_set_epochs` SELECT,INSERT and `family_epoch_floors` SELECT,INSERT,UPDATE); live regrant is an owner action once 0060 application is authorized
MIGRATION_REQUIRED = YES for live when authorized: repository/source head is 0060 while live remains 0059; 0060 is additive and touches no existing table
MIGRATION_APPLIED = 0059 is the last live application (journal 56→57); migration 0060 is repository-side only and was NOT applied to any live database
LIVE_APPLICATION_AUTHORIZED = NO (Waves 5A–5B made zero live database changes)
REPO_SCHEMA_AHEAD_OF_LIVE_FOR_WAVE5A = YES (0060 repository-side only)
CURRENT_REPO_LIVE_PARITY = NO (repo 0060 vs live 0059; authorized hold)
LOCAL_RUNTIME_GRANTS = plan declares 94 tables; disposable-DB lanes passed with the regenerated plan; live runtime grants remain the 0059-verified 92-table set
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

BLOCKERS = TODO-20 is PASS through migration 0059, exact-head CI run `36360087042`, live schema/grant equality, and row-count preservation. Wave 5B delivered the verified trust-set acceptance foundation and the approved fail-closed store-backed role-resolver activation (production can only answer NO_TRUST_SET: the acceptance writer is unwired and the envelope floors/verifiers remain rejecting; the atomic set is pinned by test/tooling/ftsProductionWiring.test.mjs). TODO-12 schedule-policy and Web Rules authority remain fail-closed (the child-profile membership resolver is the remaining gate — Wave 5C); TODO-15 device crypto/trust/policy bootstrap remains unavailable; TODO-18 literal owner acceptance has not been offered; Platform work package remains on HOLD_PARENT_DEPENDENCY; no Azure deployment or production acceptance is authorized by this checkpoint.

## Next Action

NEXT_ACTION = STOP for owner review of the Wave-5B verification foundation (repository-side; live remains 0059; LIVE_APPLICATION_AUTHORIZED = NO). Do not begin Wave 5C, do not wire the acceptance service into any route, do not activate envelope floors or non-rejecting verifiers, and do not begin further waves without explicit owner authorization; retain fail-closed Trust Set, E2EE/Web Rules and device-security boundaries; keep GLOBAL_AGGREGATE_STATUS NOT_YET_PROVEN and SCHEDULE_POLICY_ACTIVATED = NO; keep Platform Enrollment held at HOLD_PARENT_DEPENDENCY until its Parent dependencies and literal TODO-18 localhost acceptance pass.
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

### 2026-09-27 23:45 UTC — TODO-20 corrective source checkpoint published

PUBLISHED = Commit `6d368042a21d4e5fbc6b69f440c69c3858e7db8b` contains only the seven reviewed source/workflow/bootstrap/ledger paths. Fast-forward push to `origin/pca-dev` succeeded; after fetch, local HEAD, `origin/pca-dev`, and `git ls-remote` all equal `6d368042a21d4e5fbc6b69f440c69c3858e7db8b`. Unrelated dirty `backend/schema/current_schema.sql`, `backend/schema/schema_manifest.json`, `.vscode/`, and root `0` remain excluded.
CI = Exact-head Quality Gates run `36359758120` was queued for source checkpoint `6d368042`; ledger-only publication is being prepared and requires its own latest-head run before any live mutation.
NEXT_ACTION = Complete the ledger sync, verify remote equality and required path presence, then inspect the resulting exact-head run. TODO-20 live 0059 remains gated on exact-head PASS plus immediate preflight.

### 2026-09-27 23:50 UTC — TODO-20 corrective validation refresh

LOCAL_E2E = Retried `npm run test:e2e:parent:real` against disposable local MySQL 8.4.11 after the initial worker launch returned `spawn EPERM`. The elevated retry built the backend, passed the 57-migration DB gate, provisioned and then removed its run-owned disposable database, but Playwright's configured web server did not become ready within 60 seconds. This wrapper runs `realBackend.spec.ts`; it did not execute the changed `acceptance-flow.spec.ts`. Classify as local harness/environment failure, not a product or corrective-test PASS. No live DB was contacted.
REMOTE_CI = Exact-head Quality Gates run `36359820131` for ledger-sync head `a97de7545ca61b0ee662b0808f9b1f9c9773da63` remains IN_PROGRESS; no completed failures reported at this check. A ledger-only sync will require fresh exact-head CI on the resulting head.
TODO20_GATE = Live migration 0059 remains unapplied pending an exact-head CI PASS and immediate fresh live preflight.
NEXT_ACTION = Publish this validation update, inspect the resulting latest-head Quality Gates run, and proceed only when the exact head passes.

### 2026-09-28 00:20 UTC — TODO-20 live reconciliation complete

CURRENT_HEAD = `35f6c022f017e04aecbf3573394bf20f90d12489`; fresh fetch verified local HEAD, `origin/pca-dev`, and server `pca-dev` equal. Exact-head Quality Gates run `36360087042` completed SUCCESS with no failed jobs.
LIVE_PREFLIGHT = Runtime and migration identities independently verified `pca_pro` on `pca-mysql.mysql.database.azure.com`, MySQL `8.4.9-azure`, TLS `TLS_AES_256_GCM_SHA384`. Immediately before mutation, journal=56 through 0058; only the two proven `_cp850` Parent MFA CHECK literals differed from local/repository truth; 92 tables / 792 columns / 104 FKs / 92 PKs / 38 unique indexes / 141 non-unique indexes / 282 checks; runtime grants matched 92/92. A fresh exact-count baseline covered 90 readable application tables; runtime identity intentionally cannot SELECT `parent_account_security_events`.
MUTATION = Official `backend/scripts/migrate.mjs` applied only locally validated `0059_parent_mfa_ascii_check_literal_charset.sql`. No seed/reference/business data was inserted. The migration consists of corrective CHECK DDL plus its migration journal insert.
POSTFLIGHT = Live journal=57 through 0059; local MySQL 8.4.11/live full introspection comparison `EXACT_MATCH`; canonical purpose CHECK uses `_ascii`, hash CHECK uses `_utf8mb4`; both remain enforced. Runtime grants still exactly match plan 92/92. Exact row counts for all 90 readable application tables are unchanged; journal is the expected 56→57; event table remains intentionally unreadable with runtime INSERT-only grant. Structural totals remain 92/792/104/92/38/141/282. NO_SEED_DATA=YES; DATA_LOSS=0.
ATTACHMENT_RECONCILIATION = The supplied status report combined historical snapshots (`0daf660`, `399304c`) and an older claim that `pca_pro` ended at 0050. Current GitHub and live checks were refreshed; the current branch is `35f6c022`, its exact-head run is green, and live state was through 0058 immediately before this authorized migration.
NEXT_ACTION = Continue the same Parent board at earliest unfinished TODO-12; retain unresolved device/authority/localhost/deployment gates. Sync and publish both master ledgers, then inspect the exact-head run for that ledger publication.

### 2026-09-28 00:56 UTC — status report reconciled; TODO-17 promoted

REPORT = The attached report's `0daf660` owner-acceptance browser failure was corrected by the later source/fixture checkpoint; exact-head run `36360087042` at `35f6c022` is green. Its older live migration-0050/0058 claim is superseded by the completed migration-0059 postflight above.
TODO17 = PASS for integrated automated regression at `35f6c022` (Parent/Platform real-backend browser journeys, MySQL, security, Android/iOS and build/unit jobs passed). A later local wrapper timed out before browser specs and does not change that exact-head CI evidence. Device trust/crypto is tracked separately under TODO-15; owner localhost acceptance remains TODO-18.
TODO12 = Migration-0057 actor persistence is no longer awaiting MySQL: disposable MySQL 8.4.11 test passed 22/22 after migrations 0001–0059; disposable DB cleanup passed. Remaining blockers are Trust Set/device authority for schedule policy, unconfigured Web Rules, and non-durable bonus-revocation actor attribution. Do not bypass E2EE/device-trust constraints with plaintext persistence or self-reported authority.
GIT = Fresh fetch returned `origin/pca-dev=35f6c022`. Local HEAD `1056546e` is docs-only and ahead; subsequent ledger edits remain uncommitted. Direct server-ref/Actions API checks failed because the configured localhost proxy refused connections. A prior commit attempt was rejected by automatic approval review for exhausted credits; no bypass or publication is attempted here.
NEXT_ACTION = Continue TODO-12/14 source/action audit within the E2EE/device-trust constraints. Resume TODO-19 publication when approved commit review is available; keep Platform held.

### 2026-09-28 01:04 UTC — TODO-13 sensitive-action matrix validated

TODO13 = PASS for implemented sensitive actions. Source mapping confirms ten issuable operations have consuming Parent routes and matching fresh operation-scoped TOTP grants; focused local step-up/consumer HTTP campaign passed 64/64 and backend build passed. Ownership transfer and recovery-material reveal remain non-issuable and have no consumers; this closure does not enable them.
PLATFORM = `HOLD_PARENT_DEPENDENCY` remains because TODO-12/14/15/16, Parent projection gate and TODO-18 literal localhost acceptance are incomplete.
NEXT_ACTION = Continue TODO-12; retain TODO-14 aggregate audit and TODO-15 child-device trust/cryptographic security gates.

### 2026-09-28 01:21 UTC — generated schema snapshots reconciled

TODO20 = The previously dirty `backend/schema/current_schema.sql` and `schema_manifest.json` had an incorrect `device_session_epoch` placement. Their pre-refresh copies are preserved under task temp storage. On a fresh loopback-only MySQL 8.4.11 instance, the official migration runner applied 0001–0059 (57 migrations) to one disposable database; `verify-mysql.mjs` applied and certified all 57 from zero in a second. Full structural introspections of both databases were `EXACT_MATCH`. The official `npm run db:schema:snapshot` regenerated the two artifacts from the first migrated database. Artifact checks confirm 92 SQL tables and 92 manifest tables; the epoch appears on `families` only.
SAFETY = Only local disposable databases were used; no production credentials, live DB, seed data or application rows were used. MySQL was shut down and the task-owned data directory removed; original snapshots and both structural introspections remain in task temp storage.
NEXT_ACTION = Continue TODO-12/14; publish the five mission artifacts only when approved commit review is available, without touching excluded `.vscode` or root `0` paths.

### 2026-09-28 01:27 UTC — status report rechecked; canonical TODO-20 summary corrected

REPORT = The supplied report's detailed checkpoint is older than the already-recorded `35f6c022`/run `36360087042` result. The reported Parent owner-acceptance failure at `0daf660` was corrected and the later exact-head run passed. Its claim that live `pca_pro` remained through 0050 is superseded: fresh preflight, migration 0059, exact schema/grant postflight, and 90 readable-table row-count preservation are recorded above. Treat the supplied percentage table and 0050 live state as historical; do not reopen completed gates based on that snapshot.
LOCAL_SNAPSHOT_VALIDATION = The official schema-drift suite passed 5/5 in serial Windows mode after the default worker launch returned `spawn EPERM`; both generated snapshots were rebuilt from migrated MySQL 8.4.11, and the two independent disposable database introspections matched exactly.
CURRENT_GIT = Local HEAD is `1056546e6a43eaeb8886e79afe5d584af8154995`, parent `35f6c022f017e04aecbf3573394bf20f90d12489`; the available `origin/pca-dev` tracking ref remains `35f6c022`. No fresh remote update could be established through the configured proxy this turn. One local docs-only commit and current mission artifacts remain unpublished; `.vscode/` and root `0` remain untouched.
NEXT_ACTION = Continue TODO-12 and TODO-14 from current source evidence. Keep TODO-20 PASS and Platform on `HOLD_PARENT_DEPENDENCY`.

### 2026-09-28 01:31 UTC — TODO-12 policy-route boundary reconfirmed

SOURCE_REVIEW = `childPolicyRoutes.ts` checks Parent session/family role, CSRF, actor-device bearer and `ParentActionAuthorizationService`; the production resolver is `UnavailableTrustSetRoleResolver`, which returns `NO_TRUST_SET`. `webRuleRoutes.ts` checks for its optional service and returns `503 not_configured`; `main.ts` deliberately omits readable rule storage pending reviewed encrypted storage/delivery. These are real crypto/authority gates, not routes to unblock with a session-role shortcut.
NEXT_ACTION = Continue TODO-14 route/action evidence and TODO-15 device-security review while retaining the TODO-12 gates. No source or test files changed in this review.

### 2026-09-28 01:37 UTC — Parent route contract map refreshed

TODO14_SOURCE_MAP = Rebuilt backend handler locations from current `backend/src/http/routes/**/*.ts`; verified all 34 mapped Parent Web client source references point to live non-comment source and all handler line references to `app.<method>` declarations. The inventory contains 52 Parent handler declarations and 43 unique paths. Seven route paths lack a matching Parent Web call path; these include dormant/unavailable surfaces and remain explicitly listed in the JSON artifact.
LIMIT = The source map does not establish whether a given 401/403 is expected during integrated use. `UNEXPECTED_401`, `UNEXPECTED_403`, aggregate `AUTHORITY_UNAVAILABLE`, and Genesis/browser-trust aggregate counts remain NOT_YET_PROVEN. No test was run and no product source was changed.
NEXT_ACTION = Continue the runtime Parent route/action audit and keep TODO-14 IN_PROGRESS until those aggregate counts have direct integrated evidence.

### 2026-09-28 01:40 UTC — session revocation exposure clarified

TODO11 = Current-session logout and backend revoke-all are implemented; `routes.test.mjs` covers CSRF and post-revocation invalidation. Current Parent Web `ServiceAuthClient` and profile menu expose only current-session sign-out. Therefore cross-browser session revocation is not a Parent UI capability at this checkpoint; the `sessions/revoke-all` route stays in the unmapped route inventory. TODO-11's browser-trust/login-assurance criterion remains PASS.
NEXT_ACTION = Keep the client exposure gap visible in the route inventory; continue TODO-14 runtime authorization evidence.

### 2026-09-28 01:45 UTC — Parent all-session revocation exposed in Settings

IMPLEMENTATION = Added `ServiceAuthClient.revokeAllSessions()` to real/dev clients. The real client posts with HttpOnly session cookies and double-submit CSRF, maps 401/403/network failures honestly, and accepts the backend's 204 only as success. Parent Settings now explains scope, requires a second confirmation, reports failures, clears the local MFA reminder dismissal, and navigates to `/login` after success. English and Arabic copy were added.
VALIDATION = Added focused real-client request/error tests and Settings confirmation/success/failure tests. They are not yet run. `parent_api_contract_matrix.json` now maps 35 current Parent Web paths; the seven unmapped routes from the prior snapshot are reduced to six.
NEXT_ACTION = Run focused Parent Web tests, typecheck and lint; update evidence from the actual result before considering this follow-up complete.

### 2026-09-28 01:51 UTC — Status report reconciled; session revocation validation passed

REPORT = The attachment's `0daf660` owner-acceptance failure and live migration-0050 snapshot are superseded by the later exact-head CI PASS `36360087042` at `35f6c022` and verified `pca_pro` migration 0059 postflight already recorded above. Its later `399304c`/`36356186069` claims describe an earlier successful checkpoint; the current fetched remote ref is `35f6c022`. No localhost owner acceptance, Platform activation, deployment, or production UAT is claimed.
LOCAL_VALIDATION = Focused Parent Web tests for real session client, Settings confirmation/failure/success, and Settings RTL passed 42/42. Parent Web typecheck and touched-file ESLint passed. Initial sandbox Vitest startup returned Windows `spawn EPERM`; the bounded elevated retry completed successfully. `git diff --check` and route-matrix JSON parsing passed.
IMPLEMENTATION = Parent Settings now exposes the existing CSRF-protected revoke-all endpoint with a second confirmation, accurate error handling, and sign-in redirect. This working-tree change is not committed, has no exact-head CI evidence yet, and does not change TODO-12 authority boundaries or TODO-14 aggregate runtime counts.
GIT = Local HEAD remains `1056546e6a43eaeb8886e79afe5d584af8154995`; fetched `origin/pca-dev` remains `35f6c022f017e04aecbf3573394bf20f90d12489`. Mission source and ledger changes remain uncommitted; unrelated schema snapshots, `.vscode/`, and root `0` remain excluded from publication.
NEXT_ACTION = Continue TODO-12/14 from source/runtime evidence, keep TODO-15 crypto/trust and TODO-18 owner acceptance open, and preserve Platform `HOLD_PARENT_DEPENDENCY`.

### 2026-09-28 01:54 UTC — fresh remote and TODO board verification

GIT = `git fetch origin pca-dev` succeeded. `origin/pca-dev` and `git ls-remote origin refs/heads/pca-dev` both resolve to `35f6c022f017e04aecbf3573394bf20f90d12489`; local HEAD `1056546e6a43eaeb8886e79afe5d584af8154995` is a descendant with one docs-only commit. Local and remote heads do not match yet. Mission implementation/ledger changes remain uncommitted; unrelated dirty schema snapshots, `.vscode/`, and root `0` remain excluded.
ROUTE_MAP = Corrected the revoke-all source reference to the live fetch call at `realServiceAuthClient.ts:489`; route matrix JSON parses and reports 35 mapped Parent Web call paths. Aggregate TODO-14 runtime counts remain NOT_YET_PROVEN.
BOARD = Canonical TODO-01…TODO-23 statuses now match the current Parent master ledger for the reconciled rows. TODO-17 remains PASS only for the integrated `35f6c022` checkpoint; local Settings changes remain subject to their focused evidence and a future exact-head CI run.
NEXT_ACTION = Continue TODO-12/14 on the existing authority boundaries. Maintain `HOLD_PARENT_DEPENDENCY`; do not infer owner localhost acceptance or release readiness from the supplied report.

### 2026-09-28 01:57 UTC — remote verification retry limitation

REMOTE = `git fetch origin pca-dev` succeeded and updated the tracking ref to `35f6c022f017e04aecbf3573394bf20f90d12489`. A `git ls-remote` call also succeeded at 01:53 UTC with the same SHA; a later repeat failed through the configured localhost proxy. Treat the fetched ref and successful earlier server-ref result as the current verified remote evidence; no push was attempted.
WORKTREE = `git diff --check` passes; route matrix JSON parses and maps the revoke-all call to `realServiceAuthClient.ts:489`. Parent Web tests remain 42/42, typecheck/lint PASS. Exact-head CI remains only proven at the prior `35f6c022` checkpoint.
NEXT_ACTION = Continue TODO-12/14; retry remote verification when needed before publication and preserve the existing review boundary.

### 2026-09-28 02:00 UTC — revoke-all added to certified browser journey

E2E_CHANGE = Extended `parent-web/e2e-real/acceptance-flow.spec.ts` to visit Settings at the end of the real Parent journey, confirm sign-out-everywhere, require the real `POST /api/parent/sessions/revoke-all` response to be 204, and verify redirect to `/login`. This uses the disposable MFA Parent and validates the actual UI-to-API contract.
LOCAL_VALIDATION = Playwright test collection found both real-backend specs; touched-file ESLint passed. The certified real-backend test body was not run locally because its disposable MySQL/backend and provisioned account requirements are not available in this checkout. Exact-head CI for this uncommitted change is pending.
TODO17 = Prior exact-head run `36360087042` remains PASS for source head `35f6c022`; do not extend that result to this later uncommitted browser assertion.
NEXT_ACTION = Continue TODO-12/14 implementation/evidence while preserving the Platform hold; include this E2E assertion in the next authorized published checkpoint and inspect its exact-head CI result.

### 2026-09-28 02:01 UTC — authenticated journey status accounting added

TODO14_CHANGE = The real Parent owner-acceptance journey now records authenticated `/api/parent/*` and `/v1/families/*` 401/403 responses after sign-in and asserts zero before intentional session revocation. This measures only the named journey; it does not prove route-wide/global aggregate counts or authority-unavailable totals.
VALIDATION = Playwright collected both real-backend specs, ESLint passed, and standalone strict TypeScript compilation passed on `acceptance-flow.spec.ts`. The test body was not run locally. The new counter/assertion therefore remains unproven until real-backend execution on an integrated checkpoint.
NEXT_ACTION = Continue TODO-12 and the wider TODO-14 source/action work; keep the aggregate acceptance fields NOT_YET_PROVEN until an executed integrated campaign produces evidence.

### 2026-09-28 02:16 UTC — Parent acceptance and revoke-all passed on disposable MySQL

LOCAL_RUN = Added a guarded `parent-owner-acceptance-real-e2e` runner target using only a loopback MySQL URL, `NODE_ENV=test`, a random run-owned database, private fixture credentials, and a separate disposable backend. MySQL 8.4.11 applied all 57 migrations. Playwright certified result PASS: 2 expected tests, 0 skipped, 0 unexpected, 0 flaky. The owner flow's authenticated `/api/parent/*` and `/v1/families/*` 401/403 counter was zero; revoke-all returned 204 and redirected to `/login`; the separate cross-family isolation assertions also passed. Runner cleanup removed the random database; the separate loopback MySQL instance and task-owned OS-temp datadir were stopped and removed.
HARNESS_CORRECTION = First real attempt exposed the existing 60/minute per-IP budget at the additional revoke request and in the cross-family second flow. The E2E-only backend now trusts only the loopback Vite proxy and uses a separate TEST-NET client address for the revoke request. Production rate-limit settings and trust configuration are unchanged. The corrected real-backend campaign then passed.
VALIDATION = Backend build and campaign PASS; Parent Web typecheck, touched-file ESLint, strict standalone E2E TypeScript compilation, Playwright collection, route-matrix JSON and `git diff --check` PASS. Backend workspace has no ESLint binary; the disposable runner executed and `node --check` passed. TODO-14's zero 401/403 is proven for this campaign only; global all-routes counts and authority-unavailable totals remain NOT_YET_PROVEN.
GIT = Local HEAD remains `1056546e`; fresh `origin/pca-dev` remains `35f6c022`. These source/harness changes are uncommitted, so the earlier exact-head run `36360087042` does not cover them. No publication or production mutation occurred.
NEXT_ACTION = Continue TODO-12/14 and TODO-15 source/security gates; then publish the reviewed exact paths and require exact-head CI. Keep TODO-18 owner acceptance and Platform `HOLD_PARENT_DEPENDENCY` unchanged.

### 2026-09-28 02:21 UTC — Parent implementation checkpoint committed locally

COMMIT = `6b7bf8e12b67f349e38fa2271d564bf72dec975b` (`feat(parent): expose revoke-all sessions and certify flow`) contains the 17 exact reviewed mission files. It includes Parent Settings revoke-all UI/client/locales/tests, the certified acceptance journey and guarded disposable E2E runner, route matrix correction, mission ledger updates, and regenerated TODO-20 schema snapshots. `.vscode/` and root `0` were not staged.
VALIDATION = Local Parent Web focused campaign 42/42; Parent Web typecheck/ESLint; strict E2E TypeScript compile; certified disposable MySQL 8.4.11 real-backend acceptance 2/2 (0 skips/unexpected/flaky, including zero measured 401/403, revoke-all 204 and redirect, cross-family isolation); 57 migrations; backend build; `node --check`; `git diff --check` all pass. Disposable DB and task-owned server/data directory were removed.
GIT = Parent `pca-dev` local HEAD is `6b7bf8e`; prior local docs commit `1056546e` is also ahead of fetched `origin/pca-dev=35f6c022`. Fast-forward ancestry is preserved. Source publication and exact-head CI are pending; `.vscode/` and `0` remain untracked and excluded.
GATES = This local browser campaign does not replace exact-head CI. TODO-12/14/15 and TODO-18 remain open; TODO-20 remains PASS through live 0059. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Commit/publish this ledger synchronization, push the authorized three-commit fast-forward to `origin/pca-dev`, then verify refs/files and exact-head CI. Continue TODO-12/14/15 afterward.

### 2026-09-28 02:34 UTC — Parent checkpoint publication and integrated CI verified

GIT = The reviewed three-commit fast-forward (1056546e, 6b7bf8e, dfefe27c) is published. Fresh `git fetch`, `origin/pca-dev`, local HEAD, and `git ls-remote` all match `dfefe27c277c0e225ee1f1a50e38f00871dc8082`; both master TODO files are present in the remote tree. Unrelated `.vscode/` and root `0` remain untracked and excluded.
CI = Quality Gates run `36369764525` completed SUCCESS on exact HEAD `dfefe27c277c0e225ee1f1a50e38f00871dc8082`: 27 jobs succeeded, zero failed. Real-backend browser E2E, full disposable-MySQL DB certification, Parent/Platform browser suites, Android, iOS, security, builds, and unit jobs passed.
TODO17_19 = Integrated automated regression and exact-head publication gates are PASS for this checkpoint. TODO-12/14/15 authority/device gates and TODO-18 literal localhost owner acceptance remain open; TODO-20 stays PASS through live migration 0059 with exact schema/grant postflight and preserved readable-table counts.
REPORT = The attachment's `0daf660` failure snapshot, `399304c` checkpoint, and live migration-0050 claim are older than verified current state. Current remote is `dfefe27c`; live `pca_pro` is already reconciled through 0059. The report's hold recommendation remains appropriate because owner/device/authority gates are still open.
NEXT_ACTION = Continue the same mission at TODO-12/14/15; do not activate Platform Enrollment or deploy until the recorded Parent and owner gates close.

### 2026-09-28 02:47 UTC — earlier authentication TODOs re-evaluated against exact-head CI

TODO02_09 = Promoted to PASS after reviewing their completion criteria against auth/migration DB certification, first-owner bootstrap certification, full disposable-MySQL certification, Parent MFA browser flow, Parent Web unit shards, and real-browser jobs in exact-head Quality Gates run `36370514236` at `739133e9`; all 27 jobs passed.
REMAINING = TODO-10 still depends on TODO-14 route/action closure. TODO-12/14/15 remain open; TODO-18 still requires literal owner `LOCALHOST ACCEPTED`. TODO-20 remains PASS through live 0059. Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Continue TODO-12/14/15 and retain the TODO-10/TODO-14 dependency and owner localhost gate.

### 2026-09-28 02:54 UTC — unmapped Parent API paths classified

TODO14_SOURCE_REVIEW = Re-read each of the six server paths without a Parent Web call site and added explicit machine-readable dispositions to `parent_api_contract_matrix.json`: two bonus-grant endpoints stay unexposed pending durable lifecycle/audit; dashboard and removal-detail remain optional unconsumed reads; authorized-recovery and signed decision routes remain crypto/device gated. The matrix still maps 35/35 Parent Web calls to backend handlers and inventories 52 declarations/43 unique paths.
LIMIT = Classification closes the source-inventory ambiguity only. `UNEXPECTED_401`, `UNEXPECTED_403`, aggregate `AUTHORITY_UNAVAILABLE`, Genesis/browser aggregate counts remain NOT_YET_PROVEN; TODO-14 stays IN_PROGRESS and TODO-10 remains dependent on it.
NEXT_ACTION = Continue integrated runtime/action evidence without adding browser callers for the deferred or cryptographic paths.

### 2026-09-28 08:19 UTC — eye-protection route outcomes added to TODO-14 collector

TODO14_LOCAL = Existing eye-protection GET/POST assertions now emit eight status-only scenarios across both method/path declarations. The combined bounded collector inventory is 74 scenarios across 34/52 declarations: 32 allows, 29 expected denials, three authority-unavailable outcomes, one protective-authority-not-applicable outcome, two optional-route absences, two crypto/device gates, and five validation/protocol outcomes. The focused eye-protection suite passed 8/8; that run observed zero unexpected 401/403/other responses. Its report explicitly remains `coverageComplete=false` and `globalAggregateStatus=NOT_YET_PROVEN`.
CI = Exact-head Quality Gates run `36396015633` completed SUCCESS 27/27 at `c460144aab45a0a91ce2fe52ca05b80a81636ce5`; it does not include this new local test instrumentation.
PLATFORM_GATE = `HOLD_PARENT_DEPENDENCY`; no Platform activation, deployment, or owner acceptance occurred.
NEXT_ACTION = Publish the eye-protection collector/crosswalk and ledger update as the next exact-head checkpoint; continue TODO-14 and keep all-route aggregates unproven.

### 2026-09-28 19:45 UTC — TODO-14 collector reaches full 52/52 declaration coverage

IMPLEMENTATION = The status-only collector now covers every current Parent route declaration. The helper compares collected method+route keys against a canonical 52-declaration inventory (mechanically re-verified against `backend/src/http/routes` on 2026-09-28: 52 declarations / 43 unique paths) and reports `declarationsCollected`, `declarationsMissing`, `undeclaredCollectedKeys`, computed `coverageComplete`, and explicit `GENESIS_BLOCKED_NORMAL_ACTIONS` / `TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS` counters (report schema version 2). Eighteen previously uncollected declarations were instrumented across seven route suites: schedule-policy; account session/logout/revoke-all/password-reset; CSRF bootstrap; free-access-status; preferences and safe-zones (with new positive PATCH/DELETE assertions); protection-alerts; and web-rules. The eye-protection slice from the prior local checkpoint is included. Schedule-policy's production-default `NO_TRUST_SET` fail-closed 403 stays classified `AUTHORITY_UNAVAILABLE`; web-rules `not_configured` stays `SERVICE_NOT_CONFIGURED`; signed/recovery decisions stay `CRYPTO_DEVICE_GATED`; no gated route was activated and no plaintext policy persistence was introduced.
VALIDATION = Backend build PASS; the combined thirteen-suite collector campaign PASS 144/144 in one serial process with the collector enabled; full backend unit regression PASS 2674/2674. Combined report: 138 matched scenarios across 52/52 declarations (52 allow, 59 expected denial, 5 authority unavailable, 1 protective-authority-not-applicable, 3 optional-route absent, 4 service-not-configured, 2 crypto/device-gated, 12 validation/protocol); unexpected 401/403/other = 0; GENESIS_BLOCKED_NORMAL_ACTIONS = 0; TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS = 0; `coverageComplete = true` by inventory-key comparison; `globalAggregateStatus = NOT_YET_PROVEN`. `git diff --check` clean; no generated report residue committed.
TODO14 = Declaration coverage complete in the bounded test-double slice. TODO-14 remains IN_PROGRESS: database-backed integrated campaign evidence is not yet produced, and the known authority boundaries (schedule-policy Trust Set path, Web Rules encrypted policy storage/delivery, crypto-gated signed/recovery decisions) are classified honestly rather than resolved.
FILES = `backend/test/helpers/parentRouteOutcomeCollector.mjs`; `backend/test/http/{childPolicyRoutes,childRequestRoutes,dashboardRoutes,eyeProtectionRoutes,familyAuditEventRoutes,familyMemberRoutes,parentMfaRoutes,protectionAlertRoutes,webRuleRoutes}.test.mjs`; `backend/test/parentaccount/{routes,freeAccessStatusRoute,preferencesSafeZonesRoute}.test.mjs`; `backend/test/familyrbac/removalDecisionRoutes.wiring.test.mjs`; `docs/pre_production_assessment/pca_parent_platform/parent_route_action_test_crosswalk.md`; both master ledgers.
GIT = This slice is local for the checkpoint entry; last verified published head remains `c460144aab45a0a91ce2fe52ca05b80a81636ce5` (exact-head run `36396015633` SUCCESS 27/27). `.vscode/` and root `0` remain excluded.
CI = Exact-head CI for this new commit has not run yet; no result is claimed.
NEXT_ACTION = Publish this slice as a fast-forward, record its exact-head run, then stop for owner review before any next wave. Candidate next waves: extend the collector into the guarded disposable-DB integration campaign, or begin TODO-10 Genesis proof closure (its recorded blocker is this route/action audit); TODO-12/15 remain unstarted.

### 2026-09-28 19:45 UTC — 52/52 collector checkpoint published; exact-head CI passed

GIT = Commit `6b0ea0f446c45b7db9ce6b310b35641987c1620d` was pushed as a fast-forward (`c460144a..6b0ea0f4`). Fresh fetch, local HEAD, tracking ref and `git ls-remote` agree; the collector helper, eight route suites, crosswalk and both master ledgers are present remotely. `.vscode/` and root `0` remain excluded.
CI = Exact-head Quality Gates run `36472978551` completed SUCCESS 27/27 (zero failed jobs) at `6b0ea0f446c45b7db9ce6b310b35641987c1620d`, including the full disposable-MySQL certification, real-backend browser E2E, Android and iOS jobs.
TODO14 = The published head validates the 52/52 declaration coverage code and both ledger updates. Coverage is complete in the bounded test-double slice; `globalAggregateStatus` remains NOT_YET_PROVEN and no authority boundary (schedule-policy Trust Set path, Web Rules storage/delivery, crypto-gated signed/recovery decisions) was resolved or bypassed.
NEXT_ACTION = STOP for owner review. Candidate next waves: (a) run the collector under the guarded disposable-DB integration campaign; (b) TODO-10 Genesis proof closure. Do not begin TODO-12/15 without authorization.

### 2026-09-28 20:50 UTC — Wave 2: database-backed integrated Parent route evidence

IMPLEMENTATION = The status-only collector gained an orthogonal `evidenceTier` dimension (`BOUNDED_HTTP` default / `MYSQL_HTTP` / `REAL_BACKEND`; report schemaVersion 3 with per-tier counts, per-tier declaration sets, unexpected totals, and `declarationsWithoutIntegratedEvidence`), so bounded and integrated totals are never mixed. A new narrow disposable-DB mode `parent-route-audit` (`npm run test:db:parent-route-audit`; inner lane uses `--experimental-test-isolation=none`; refuses to run without the collector output path) reuses `with-disposable-db.mjs` and the `require-owned-disposable-db` ownership guard. New integrated HTTP suite `backend/test/db/parentRouteAuditHttp.mysql.test.mjs` covers the real register→verify→login lifecycle, identity/preferences with GET readback, session/logout/revoke-all, CSRF bootstrap, password reset, MFA enrollment/login-step-up/recovery/step-up, safe zones (role/CSRF/validation/recipient boundaries + durable create-patch-delete), family-audit reads, and protection-alert reads over real MySQL repositories; the existing eye-protection, free-access, and commercial-notification session suites were instrumented with `MYSQL_HTTP` rows. No production source changed; no migration; no plaintext policy persistence; no gated route activated. Platform ledger untouched except the hold entry below in its own file.
VALIDATION = Integrated campaign PASS 38/38 with a run-owned disposable `pca_test_codex_<uuid>` database (created, migrations applied, environment verified as MySQL 8.4.11 utf8mb4/utf8mb4_bin with UTC, dropped afterward): 28/52 declarations, 71 matched scenarios (32 allow, 32 expected denial, 7 validation/protocol), unexpected 401/403/other = 0, `GENESIS_BLOCKED_NORMAL_ACTIONS` = 0, `TRUSTED_BROWSER_BLOCKED_NORMAL_ACTIONS` = 0. Bounded regression PASS 144/144 (52/52 declarations, 138 scenarios, zero unexpected). Full non-DB backend suite PASS 2674/2674. Parent-auth disposable campaign PASS 61/0 (3 expected privileged-mode skips); authority-diagnostics campaign PASS 62/62. `git diff --check` clean. Temporary reports removed after SHA-256 capture (integrated report `4107A3D8…`, bounded report `AA65181E…`).
DISPOSITIONS = 28 `MYSQL_INTEGRATED_REQUIRED_AND_PROVEN`; 12 `MYSQL_INTEGRATED_REQUIRED_BUT_MISSING` (family-member ×6, removal-decision/administration-pin ×6); 6 `KNOWN_FAIL_CLOSED_AUTHORITY_GATE` (schedule-policy; child-request routes; bonus-time routes); 3 `KNOWN_FAIL_CLOSED_SERVICE_GATE` (web-rules); 2 `KNOWN_CRYPTO_DEVICE_GATE` (signed / authorized-recovery); 1 `OPTIONAL_ROUTE` (dashboard); UNREVIEWED = 0. Full 52-row table in the crosswalk.
TODO10 = Complete Genesis source audit: zero NORMAL_PARENT_AUTHORITY_DEPENDENCY. `parent_genesis_*` tables are schema-only (no writers; PCA-DEC-037), no genesis routes exist, and remaining identifiers are the family-owner attestation chain (child-device security) or historical comments. Trusted-Browser audit: daily-login grants are login assurance only with no authority consumer; `TRUSTED_BROWSER_NORMAL_AUTHORITY_DEPENDENCY` = 0. Coordinator recommendation recorded in the TODO-10 body: PASS (owner decides).
TODO14 = Coverage complete in the bounded tier (52/52 reviewed) and database-backed for 28; `GLOBAL_AGGREGATE_STATUS` remains `NOT_YET_PROVEN` pending the 12 required-but-missing routes and the intentionally gated boundaries.
GIT = Single Wave-2 checkpoint commit on `pca-dev` (base `722f6710`); the pushed SHA and its exact-head Quality Gates run are reported to the owner in the Wave-2 report and are deliberately not re-committed after CI.
NEXT_ACTION = STOP for owner review. Candidate next wave: extend integrated evidence to the 12 required-but-missing declarations (family-member invitation/role/remove/accept; removal-decision and administration-pin flows) without touching TODO-12/15 architecture.

### 2026-09-28 21:57 UTC — Wave 3 closed every required-but-missing Parent declaration

IMPLEMENTATION = Two new database-backed HTTP suites: `backend/test/db/parentRouteAuditMembershipHttp.mysql.test.mjs` (33 collector scenarios: invitation list/create/revoke/role, member remove, member-invitation accept) and `backend/test/db/parentRouteAuditRemovalHttp.mysql.test.mjs` (20 collector scenarios: removal-decision list/detail/create/local-pin decide and administration-PIN status/configure), both composed from the real MySQL repositories and the real `FamilyMemberInvitationService` / `MySqlFamilyMemberAccountBinder` / `RemovalDecisionAuthority` / `RemovalTargetResolver` / `AdministrationPinService`. Registered in `test:db:parent-route-audit:inner` and `test:db:inner`. The collector report `scope` string was corrected to "scenario evidence with explicit evidence tiers; not a global aggregate" (schemaVersion 3 unchanged).
VALIDATION = Audit lane PASS 50/50 with zero skipped; integrated collector report 40/52 declarations, 130 MYSQL_HTTP scenarios (45 ALLOW_PROVEN / 73 EXPECTED_DENIAL / 1 PROTECTIVE_AUTHORITY_NOT_APPLICABLE / 11 VALIDATION_OR_PROTOCOL), zero undeclared keys, zero unexpected 401/403/other; bounded collector regression PASS 144/144 with the bounded report intact (52/52 declarations, 138 scenarios, zero unexpected); parent-auth lane PASS 61/0 with 3 expected privileged-mode skips; authority-diagnostics lane PASS 62/62; full non-DB backend suite PASS 2674/2674.
TODO14 = Dispositions are now 40 `MYSQL_INTEGRATED_REQUIRED_AND_PROVEN`, 0 `MYSQL_INTEGRATED_REQUIRED_BUT_MISSING`, 6 `KNOWN_FAIL_CLOSED_AUTHORITY_GATE`, 3 `KNOWN_FAIL_CLOSED_SERVICE_GATE`, 2 `KNOWN_CRYPTO_DEVICE_GATE`, 1 `OPTIONAL_ROUTE`; UNREVIEWED = 0. TODO-14 remains IN_PROGRESS: `GLOBAL_AGGREGATE_STATUS` stays `NOT_YET_PROVEN` because the remaining 12 declarations are intentionally gated by TODO-12/TODO-15, never by missing evidence.
SUBAGENTS = The mandated seven specialist sub-agents were dispatched three times through the agent runner; every dispatch returned no usable output (two empty, one truncated fragment) and no files, so the coordinator executed the wave directly with the same bounded discipline. This tooling limitation and the resulting direct-execution model are recorded for the owner in the Wave-3 report.
GIT = One substantive commit carries the two suites, package.json registration, collector scope fix, crosswalk and both master ledgers; pushed to `pca-dev` and its exact-head CI result is reported with the Wave-3 report. `.vscode/` and root `0` remain untracked and excluded.
NEXT_ACTION = STOP for owner review of the Wave-3 evidence closure; do not begin TODO-12/15 or Platform work.

### 2026-09-28 23:21 UTC — Wave 4 architecture/security qualification complete (REV-2 amended)

GATE = Seven specialist sub-agents created; the preflight usability gate PASSED on attempt 1 (7/7 usable smoke reports, nine-field checklists with real paths and checkable evidence). Full-review dispatches: Agent 1 (backend), Agent 5 (schema) and Agent 4 (iOS, retry) delivered full reports; Agents 2 (crypto), 3 (Android) and 6 (web) full-review dispatches produced no output after the bounded two-attempt retry policy — their accepted usable smoke findings remain the evidence base for those domains, and the limitation is recorded for the owner. Agent 7 adversarial challenge round CONFIRMED all 10 load-bearing claims (dual-resolver gate; webRuleService absence; actor-field overload; policy discard + zero writers; no PAIRED-to-ACTIVE writer; un-mintable device sessions; no durable Trust Set/key-epoch store; iOS dead paths; Android audit-only lifecycle; CI registrations and 27-job arithmetic).
TODO12 = Verified dependency decomposition recorded (WAVE4_VERIFIED_DECOMPOSITION field): dual Trust-Set + child-profile-membership gate; Web Rules 503; FamilyAudit actor-field overload with call-site evidence; PCA-DEC-034/035 discard + zero writers; device-lane unreachability. Still IN_PROGRESS — no implementation authorized.
TODO15 = Verified Android/iOS/backend lifecycle facts recorded (WAVE4_VERIFIED_LIFECYCLE_FACTS field): backend PAIRED-to-ACTIVE has no writer; Android lifecycle is audit-only with state derived from backend status; iOS lifecycle machine/gate/ack/clearPolicy are tests-only or uncalled; crypto fails closed at two independent layers. Still IN_PROGRESS.
TODO14 = Unchanged: 40/52 database-backed declarations, GLOBAL_AGGREGATE_STATUS NOT_YET_PROVEN (the 12 remaining are intentionally gated). No source review justified changing these values.
SCHEMA = Qualification through 0059 complete (Agent 5): no server Trust Set/key-epoch store exists; eight candidate change classes analysed with full field tables; every required change is additive (new tables / nullable columns) with zero data loss and no backfill; migration ordering mandates floors + store BEFORE any non-rejecting verifier; do not reuse family_authority_chain_heads; family_rbac_policy_config is expected empty (zero writers) and is replaced last behind its successor.
DELIVERABLES = Dependency graph (20 nodes x 12 fields), 22 source-of-truth answers, schema change tables, Android/iOS field blocks, web action classification, the proposed Wave 5A-5F / 6A-6C / 7 / 8 sequence, and the owner policy decisions list — delivered in the Wave-4 report.
CRITICAL_SCAN = No CRITICAL_FINDING (no secret exposure, no signature/Trust-Set bypass, no cross-family bypass, no ACTIVE-without-crypto writer, no undocumented plaintext policy mutation, no unexpected live mutation); SUSPECTED_PROMPT_INJECTION = 0.
PLUGINS = Qualification performed non-mutating (metadata/help only; MUTATING_PLUGIN_AUTHORIZED = NO); all /mobile-app-family plugins classified TECHNOLOGY_MISMATCH (Expo/React Native/Power Apps/Dataverse versus native Kotlin/Swift); no plugin invoked; PLUGIN_FILES_CHANGED = NONE.
GIT = One evidence-only docs checkpoint updates both master ledgers; pushed to `pca-dev` with exact-head CI reported with the Wave-4 report. `.vscode/` and root `0` remain untracked and excluded. No production source, schema, migration, live DB, Azure or Platform change was made.
NEXT_ACTION = STOP for owner review of the Wave-4 qualification and the proposed implementation-wave sequence; do not begin TODO-12/15 implementation without explicit owner authorization.
### 2026-09-29 00:59 UTC — Wave 5A: durable Family Trust Set epoch persistence (storage only, repository-side)

IMPLEMENTATION = Migration `0060_family_trust_set_epoch_persistence.sql` adds two additive tables: `family_trust_set_epochs` (append-only signed epochs; PK (family_id, trust_set_epoch); CHECKs for epoch >= 1, superseded < current, bounded bytes/signature; no key material) and `family_epoch_floors` (per-family monotonic acceptance floors). Six new files under `backend/src/familytrustset/` (store interfaces + MySQL implementations; the single writer `appendAcceptedEpoch` serializes per family on the floors `SELECT ... FOR UPDATE`, checks duplicates before staleness, applies a strict-< trust-set floor with the virgin-genesis-1 rationale, and advances the key floor with GREATEST). Two new DB suites: `familyTrustSetEpochPersistence.mysql.test.mjs` (14 tests: 13 scenario sections including CONCURRENT_HIGHER_HIGHER, CONCURRENT_HIGHER_LOWER and SAME_VALUE_RETRY, plus a machine-readable outcomes emission) and `familyTrustSetEpochMigrationSafety.mysql.test.mjs` (4 upgrade/replay tests). Regenerated artifacts: schema.ts 94 tables / 58 migrations; verify-mysql 94 expected tables; runtimeGrantPlan 94 declarations (+`family_trust_set_epochs` SELECT,INSERT; +`family_epoch_floors` SELECT,INSERT,UPDATE); live-bootstrap 01/02 incl. journal row 0060; disposable bootstrap pair (94 tables / 806 columns / 94 primary keys / 142 indexes / 293 checks / 58 migrations); privacy CSV +14 rows; `backend/schema` snapshot regenerated (94 tables); `test:db:inner` 73/73 parity. `main.ts`, engines, routes, `android/`, `ios/`, `parent-web/` and `platform-admin-web/` are unchanged; the new stores have no production callers.
VALIDATION = Backend unit suite PASS 2674/2674. Disposable MySQL 8.4.11 full-DB lane all-certified: inner 664 tests / 656 pass / 0 fail / 8 pre-existing skips; certified production paths 273/273. Local migration-from-zero through 0060 PASS (58/58 applied; verify-mysql gate passed). Observed concurrency outcomes: CONCURRENT_HIGHER_HIGHER=[APPENDED,APPENDED]; CONCURRENT_HIGHER_LOWER=[APPENDED,REJECTED_STALE/STALE_TRUST_SET_EPOCH]; SAME_VALUE_RETRY=[APPENDED,IDEMPOTENT_MATCH]. `git diff --check` clean after LF normalization of all new/modified working-copy files.
REVIEWS = Independent specialist closure reviews by Agents 1–6 (backend, crypto/epoch, Android, iOS, schema, web) plus the Agent 7 QA/security/Git/CI/evidence closure; full outcomes are in the Wave-5A report. No CRITICAL_FINDING.
GIT = One storage-only commit on `pca-dev` over `7a3b2830` (13 modified + 9 new files; `.vscode/` and root `0` remain excluded); the commit SHA and its exact-head CI result are reported to the owner with the Wave-5A report and deliberately not re-committed.
FLAGS = WAVE_5A_STOPPED_FOR_OWNER_REVIEW = YES; LIVE_APPLICATION_AUTHORIZED = NO; REPO_SCHEMA_AHEAD_OF_LIVE_FOR_WAVE5A = YES.
NEXT_ACTION = STOP for owner review; do not begin TODO-12/15, store wiring, or further waves without explicit owner authorization.
### 2026-09-29 03:51 UTC — Wave 5B: verified trust-set acceptance + fail-closed resolver activation

IMPLEMENTATION = New `backend/src/familytrustset/decode.ts` (strict canonical netstring decoder: byte-length prefixes, full consumption, exact-ISO round-trip, bounds) and `P256TrustSetSignatureVerifier.ts` (PCA-DEC-020-R1 design baseline: ECDSA P-256/SHA-256/IEEE-P1363/low-S; imports the deviceauth strict base64url/scalar helpers; NOT production-activated). New `GenesisAnchorSource.ts` (`MySqlGenesisAnchorSource` direct SELECT + `GenesisAnchorStoreSource` adapter over the existing FamilyAuthorityGenesisStore). New `TrustSetEpochAcceptance.ts`: the acceptance pipeline (envelope bounds → strict decode + engine structural rules → family binding → canonical byte identity → keyEpoch ≥ 1 pin → durable reads with bounded consistent re-reads → genesis-anchor path / chain signer resolution + real signature verification → supersedes lineage → claimed-side-metadata equality → append strictly last), closed outcome union ACCEPTED/IDEMPOTENT/CONFLICT/REJECTED{12 reasons}, and zero writes on every rejection. New `StoreBackedTrustSetRoleResolver.ts` implementing the widened `TrustSetRoleResolver` (async allowed; device-local impls unchanged); fail-closed NO_TRUST_SET on empty store or any read/decode error. Wiring (the approved Wave-4 5B "role resolver activation (fail-closed swap)"): `TrustSetRoleResolver` interface widened; awaits added at `ParentActionAuthorizationService` (target resolution hoisted into `authorize()` so `evaluate()` stays I/O-free), `FamilyCommercialAuthorityResolver`, `RemovalDecisionAuthority`; `main.ts` swaps Unavailable → store-backed resolver over `MySqlTrustSetEpochStore`; the acceptance service has NO production caller and envelope floors stay rejecting; `test/tooling/ftsProductionWiring.test.mjs` pins this atomic set with a self-tested source guard. New tests: canonicalDecode (16), p256 verifier (8, real crypto), acceptance unit (32, real P-256 where crypto-relevant), tooling guard; DB acceptance suite `familyTrustSetEpochAcceptance.mysql.test.mjs` (real stores + real verifier + real anchor source; genesis/chain/key-rotation/rejection-classes/idempotent/conflict/restart/cross-family/concurrent-same-ts). Mutation scope gains PCA-SEC-020 declared mutants B-SEC020-001 (signature check neutralized) and B-SEC020-002 (stale trust-set chain check removed); the previously-stale B-FR137-004 Fastify anchor and check-backend-boundaries matcher were repaired to the current multiline source (required for the harness to run at all).
VALIDATION = Backend unit suite PASS 2734/2734. Disposable MySQL 8.4.11 full-DB lane all-certified: inner 666 pass / 0 fail / 8 pre-existing skips; certified production paths 273/273 (0 skipped, 0 failed). Mutation negative controls: both declared PCA-SEC020 mutants KILLED behaviorally in focused temp-copy kill-runs (control 40/40 PASS; B-SEC020-001 signature-check removal fails BAD_SIGNATURE_REJECTED/WRONG_KEY_REJECTED/REJECTED_LEAVES_STORE_UNTOUCHED; B-SEC020-002 chain stale-check removal fails STALE_TRUST_SET_REJECTED/REJECTED_LEAVES_STORE_UNTOUCHED). `git diff --check` clean; all new files LF.
REVIEWS = Independent specialist closure reviews by Agents 1–6 (backend, crypto, Android, iOS, schema, web) plus the Agent 7 QA/security/CI verification; full outcomes in the Wave-5B report. No CRITICAL_FINDING.
GIT = One substantive commit on `pca-dev` over `6cefdf1e`; the commit SHA and its exact-head CI result are reported to the owner with the Wave-5B report and deliberately not re-committed.
FLAGS = SCHEDULE_POLICY_ACTIVATED = NO; CURRENT_REPO_LIVE_PARITY = NO; LIVE_APPLICATION_AUTHORIZED = NO; production trust-set resolution fails closed (empty durable state only).
NEXT_ACTION = STOP for owner review; do not begin Wave 5C, store/route ingestion wiring, or further waves without explicit owner authorization.

### 2026-09-30 00:30 UTC — DeepSeek controlled stop; Codex handover (no new implementation)

STOP = Owner stopped DeepSeek development and assigned the next workflow to Codex. This entry records current truth only; no wave was started or continued.
WAVE5C = Real child-profile membership resolver for the second TODO-12 authority gate. Baseline verified (`91f7f6d4`, local = origin = server). §4 contract review: CONTRACT_CONFLICT = NO — doc 39 §3/§10 anticipate the real resolver as a later async trusted-source binding; the registry comment's "frozen/no-registry" wording is superseded; privacy/oracle constraints (opaque registry only; NOT_MEMBER_OR_NOT_FOUND collapse; single public deny) remain binding. Design prepared (async resolver contract, shared adapter over MyChildProfileRegistryRepository, exactly-once resolution, fail-closed negatives); Android specialist smoke review ANDROID_IMPACT = NONE. No implementation files changed, no tests run, no commits made by Wave 5C.
STATE_AT_HANDOVER = Waves 5A/5B certified at `91f7f6d4` (runs 36505757047 / 36519047489, 27/27 each); production Trust Set population EMPTY (accepted-epoch writer unwired; resolver fail-closed NO_TRUST_SET); child-profile membership resolver still Unavailable in production; schedule-policy dual gate therefore still closed; Web Rules 503; device crypto gates unchanged.
LOCAL_UAT = Prepared locally on 2026-09-29 (untracked, never committed): database `pca_local_owner_uat` (head 0060; 94 tables) + backend :4001, Parent Web :4000, Platform Admin :4100 + synthetic accounts; handoff `.agent-local-artifacts/local-uat-mission/PCA_LOCAL_UAT_HANDOFF.md` (credentials only there). Live `pca_pro` read-only verified at 0059; zero mutations; parity intentionally NO.
GIT = Clean worktree apart from the two exclusions; handover documentation commit pushed and reported with the handover report.
NEXT_ACTION = CODEX RESTART per the continuous-goal `## CODEX RESTART CHECKPOINT`; do not begin deployment/Platform/mobile work; TODO-18 remains the owner's gate.

### 2026-09-29 21:49 UTC — Codex Wave 5C implementation checkpoint (local, uncommitted)

REENTRY = Independently reconciled the attached handover against current source, migrations, tests, ledgers and Git. `pca-dev` HEAD, `origin/pca-dev`, and `git ls-remote` agree at `a8c37162ed6ec135b618a3942c4766bac3b8f508`; handover exact-head CI `36634164993` passed 27/27 there and does not certify current changes.
IMPLEMENTATION = Added `RegistryBackedChildProfileMembershipResolver` over the opaque exact-membership repository and wired one shared instance to Parent action authorization and child-request routes. It queries only after actor resolution, collapses non-member/unknown/unavailable to the same public `CROSS_FAMILY_TARGET` denial, skips malformed IDs, and does not expose child content or add caching/listing. No Trust Set writer/acceptance caller, cryptographic gate, route activation, migration, or live database change was added.
VALIDATION = Backend TypeScript build PASS. Focused child-profile resolver, Parent action authorization, child-request route and production-wiring tests PASS 81/81 serially; adjacent ChildRequestService, child-policy route and Web Rules suites PASS 70/70. Guarded UUID-named disposable MySQL 8.4.11 run passed migration/privacy/environment gate across 58 migrations and `childProfileRegistry.mysql.test.mjs` PASS 10/10, with owned database removed. Full registered non-DB suite, run per file to preserve isolation, PASS 274/279; five failures are subprocess checks that return Windows `spawn EPERM` or lose child-process output under the restricted runner (`checkNoAdTrackingSdks`, `RebuildR3DerivedLedgers`, `migrationIdentityFailClosed`, `disposableDatabaseTargetGate`, `disposableBootstrapArtifact`). The test registration suite passes 6/6 after adding the new file to `scripts/run-tests.mjs`. `git diff --check` PASS. Exact-head CI for Wave 5C is pending.
TODO12 = Remains IN_PROGRESS until MySQL-backed integration and broader critical-path dependencies (including Trust Set ingestion, encrypted Web Rules, audit/policy and device lifecycle) are separately implemented and validated. No route or device authority was activated.
GIT = Wave 5C source/tests, `backend/scripts/run-tests.mjs`, architecture doc 39, continuous-goal doc and both master-ledger updates are local and uncommitted. `git fetch` could not write `.git/FETCH_HEAD` and `git add` could not create `.git/index.lock` (permission denied); no staged changes, commit, or push were made. Authenticated GitHub ref API verified server pca-dev at the same a8c37162 base. Pre-existing `.vscode/` and root `0` remain excluded.
NEXT_ACTION = Obtain a workspace execution context with permitted `.git` metadata writes, then stage/commit the already-reviewed exact paths and push only as a fast-forward to `origin/pca-dev`; inspect exact-head CI. Parent TODO-12/14/15 and TODO-18 remain open; Platform remains held.

### 2026-09-29 22:03 UTC — Next Trust Set bootstrap dependency reviewed

SOURCE_REVIEW = PCA-DEC-037 first-login provisioning deliberately creates a Family, ACTIVE Administrator membership, service scope and MFA grace state without creating a device or rows in `family_authority_genesis_anchors`, `family_authority_attestations`, or `family_authority_chain_heads` (`backend/test/db/parentAccount.mysql.test.mjs:329-339`). The signed Trust Set acceptance service's genesis path requires a durable anchor whose device ID, DSK key ID and DSK public key exactly match the candidate Owner before verifying the signature (`backend/src/familytrustset/TrustSetEpochAcceptance.ts`; `GenesisAnchorSource.ts`).
DISPOSITION = The accepted-epoch writer remains unwired. No source currently defines how a newly TOTP-provisioned Parent family obtains a first device/root signer without reintroducing Parent Genesis or letting an untrusted device self-authorize. Do not guess a signer or synthesize a genesis anchor. This requires an explicit owner/security bootstrap protocol before trust-set ingestion, schedule-policy activation or device activation.
NEXT_ACTION = Finish Wave 5C publication/CI when `.git` writes are available; then implement only the owner-approved first-device/root ceremony. Keep all affected routes and Platform dependent work fail-closed in the meantime.

### 2026-09-29 22:44 UTC — Wave 5C raw-registry route bypass corrected (local, uncommitted)

REVIEW_CORRECTION = Independent re-entry review found the preceding Wave 5C statement that the child-request routes consumed the shared resolver was incomplete: `childRequestRoutes.ts` preferred a separately injected raw registry, and `buildServer.ts` forwarded that repository. The previous wiring test inspected `main.ts` only and did not cover this second composition boundary.
IMPLEMENTATION = Removed the raw-registry dependency and branch from `childRequestRoutes.ts` and stopped forwarding it from `buildServer.ts`. The shared `ChildProfileMembershipResolver` is now the sole child-request membership authority; the separately required raw registry injection for eye-protection routes remains unchanged. Strengthened the production-wiring test to inspect `buildServer.ts` and the route implementation.
VALIDATION = Backend TypeScript build PASS. Resolver, Parent authorization, child-request route and production-wiring suite PASS 81/81 serially with `--experimental-test-isolation=none --test-concurrency=1`. The ordinary worker invocation hit Windows `spawn EPERM`; it is an execution limitation, not a product-test result. `git diff --check` PASS. This local change is not covered by exact-head CI.
TODO12 = Remains IN_PROGRESS; this correction establishes only the shared membership boundary. It does not activate Trust Set acceptance, schedule-policy, Web Rules, child-device lifecycle or Platform Enrollment.
GIT = Changes remain uncommitted. `.vscode/` and root `0` remain excluded. No commit, push, live DB mutation, deployment or owner acceptance occurred.
NEXT_ACTION = Continue independent review and local validation of the current Wave 5C diff, then publish only when Git metadata writes are available; preserve the first-device/root owner-security gate and Platform hold.

### 2026-09-29 22:58 UTC — TODO-14 Parent-session route audit integrated (local, uncommitted)

IMPLEMENTATION = Extracted `createParentSessionChildRequestAuthorizer` as the production session-lane authority factory and changed `main.ts` to use the shared registry-backed resolver instead of directly querying the raw repository. Added fail-closed unit coverage and a MySQL HTTP integration suite for Parent child-request list/decide and bonus-time grant/active-grants/revoke. The fixture uses real DB-backed Parent accounts, issued sessions, active role rows and the opaque MySQL child-profile registry; request/grant state remains process-local as PCA-DEC-028 requires.
VALIDATION = Backend build PASS; focused resolver/authorization/route/service/wiring suites PASS 128/128; test registration gate PASS 6/6. All seven route-audit DB suites PASS 51/51 against a temporary UUID-owned local MySQL 8.4.11 database after the 58-migration privacy/environment gate passed. Current collector report: 45/52 declarations, 137 MYSQL_HTTP scenarios (50 allow, 75 expected denial, 1 protective-authority-not-applicable, 11 validation/protocol), zero unexpected 401/403/other, seven declarations intentionally gated/optional. Database cleanup passed and the generated report remained outside the repository. The standard wrapper hits Windows `spawn EPERM`; direct serial execution against the same controlled local disposable topology succeeded. Exact-head CI remains pending.
TODO14 = Integrated evidence rises from 40/52 to 45/52. The remaining seven are one schedule-policy Trust Set gate, three Web Rules service gates, two removal-decision crypto gates and one optional dashboard route. `GLOBAL_AGGREGATE_STATUS` remains `NOT_YET_PROVEN`; no gate was bypassed.
TODO12 = Parent-session request decisions/direct grants now share the same fail-closed child-profile membership adapter as Parent action authorization and direct child-request ledger routes. First-device/root bootstrap, Trust Set ingestion, encrypted Web Rules/audit/policy, and TODO-15 activation remain blocked by their recorded protocol/security gates.
GIT = Source, tests, crosswalk, architecture and ledgers remain uncommitted on base `a8c37162`; `.vscode/` and root `0` remain excluded. No live database, production, deployment or owner-acceptance mutation occurred.
NEXT_ACTION = Continue TODO-15 independent source/device-security audit and retain all explicit owner/external gates. Publish only reviewed paths after Git metadata writes are available, then require exact-head CI.

### 2026-09-29 23:04 UTC — TODO-15 mobile activation source rechecked

SOURCE_REVIEW = Android `EnrollmentState` has no PAIRED/ACTIVE coordinator states; production key generation remains `NotApprovedDeviceKeyPairGenerator`, which stops enrollment at `CryptoReviewRequired`, and `PairingApiClient` has no production implementation/caller. iOS `EnrollmentLifecycleMachine` and `PolicyApplicationGate` are test-only; `PCAApplication.applyVerifiedPolicy` has no production callsite. The public epoch gate alone does not constitute a signature/receipt/decrypt/apply path. Backend Wave 5A/5B durable epoch and Trust Set verification foundations exist, while main production composition has no accepted-epoch writer caller and new TOTP-provisioned families still lack a durable genesis DSK anchor.
DISPOSITION = No mobile activation source change is safe until the owner/security first-device root protocol, production signature verifier, signed policy receipt/application path and independent attestation are approved and implemented. TODO-15 remains IN_PROGRESS; no Android/iOS test campaign was run in this source-only recheck.
NEXT_ACTION = Continue the mission on independently actionable work; preserve the device activation gate and Platform hold.

### 2026-09-30 — Codex handover source review and FamilyAudit boundary reconfirmed

REENTRY_REVIEW = Re-read the attached Codex handover, current source, current local diffs, migrations, tests, and Parent/Platform ledgers. Local HEAD and `origin/pca-dev` tracking ref are both `a8c37162ed6ec135b618a3942c4766bac3b8f508`; the fresh `git ls-remote` attempt in this re-entry could not connect through the configured proxy, so current server equality is UNVERIFIED. Latest recorded exact-head CI remains run `36634164993`, 27/27 at `a8c37162`, and does not cover current local changes. No fetch, commit, push, deployment, or live DB mutation occurred.
DEEPSEEK_REVIEW = Committed Wave 5A migration 0060/storage and Wave 5B strict Trust Set verification/acceptance foundation remain accepted with follow-up: the reviewed production resolver stays fail-closed on empty Trust Set state; no first-device root ceremony or production acceptance writer is present. Wave 5C resolver/Parent-session integration and the recorded iOS/Android TODO-15 hardening are local/uncommitted and have only their recorded focused/disposable-DB evidence; no exact-head CI covers them.
FAMILYAUDIT = Re-traced the record type, producer/composer boundary, Parent projection, and backend audit writers. `actorDeviceId` still conflates device IDs, Parent account IDs, target device IDs, and service sentinels; `actorMemberId` remains unset by production writers. The opaque encrypted-event composer remains rejecting pending PCA-DEC-020 review. A typed actor contract would change the encrypted record/client projection and all writer call sites; no approved field-level actor schema or reviewed delivery implementation was found. No source, plaintext, or composer change was made. This subdependency remains IN_PROGRESS under TODO-12.
CURRENT_GATES = Parent remains 14 PASS / five IN_PROGRESS (TODO-12/14/15/19/20) / four TODO owner or release gates (TODO-18/21/22/23). Repository/local schema is 0060; live `pca_pro` is last verified at 0059, with no current live connection/read. Platform remains `HOLD_PARENT_DEPENDENCY`; literal owner `LOCALHOST ACCEPTED` remains pending.
NEXT_ACTION = Continue independently executable Parent source/security work and its recorded validation; retain Trust Set bootstrap, encrypted audit/policy delivery, device activation, live schema mutation, publication, Platform activation, and deployment behind their current gates.
BUILD = Current uncommitted Parent resolver/mobile source compiles successfully with `npm run build` (`tsc`) in `backend/`; this establishes TypeScript build evidence only, not test, exact-head CI, remote publication, or release acceptance.

### 2026-09-30 — Wave 5C current-source Parent validation refreshed

BUILD_AND_UNIT = Backend `npm run build` PASS. Focused resolver, Parent action authorization, Parent-session authorizer, ChildRequestService, child-request routes, production wiring, and runtime-grant-policy tests PASS 145/145 when run serially with `NODE_ENV=test`. The initial shell invocation omitted `NODE_ENV=test`, correctly selected production `__Host-` cookies, and produced fixture 401s; the documented test-environment rerun passed, so no source auth change was made for that invocation issue. Test-suite registration guard PASS 6/6.
MYSQL_ROUTE_AUDIT = After removing a duplicate child-request DB test-file entry from the route-audit command, the corrected disposable MySQL 8.4.11 campaign passed 51/51; migration/privacy/environment gate passed all 58 migrations. The UUID-owned database was removed. The status-only report matched 45/52 declarations and 137 scenarios (50 allow, 75 expected denials, 1 protective-authority-not-applicable, 11 validation/protocol), with zero unexpected 401/403/other. Seven declarations remain deliberately gated/optional; coverageComplete=false and GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN.
ANDROID = Focused Gradle command exited BUILD SUCCESSFUL; `testDebugUnitTest` was UP-TO-DATE. Current XML reports show EnrollmentCoordinatorTest 30 tests and HttpDeviceBootstrapApiClientTest 20 tests, each zero failures/errors/skips; test XML predates this invocation but postdates both source files, so this invocation confirms Gradle found those inputs unchanged and reused the recorded reports rather than executing tests anew. Xcode XCTest/simulator remains unavailable per prior evidence.
GIT_AND_GATES = All mission source remains uncommitted. Local HEAD/tracking ref stay `a8c37162`; fresh remote transport and exact-head CI remain unavailable/unverified. The latest recorded exact-head run `36634164993` (27/27 at `a8c37162`) predates these changes. TODO-12/14/15/19/20 remain IN_PROGRESS and Platform remains `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Preserve this exact local evidence, reconcile Git server state when transport is available, then checkpoint only reviewed Parent/Platform mission paths and require exact-head CI. Keep TODO-14 global aggregate, FamilyAudit encrypted actor-contract, Trust Set root, mobile activation, owner acceptance, and live-DB/release gates open.

### 2026-09-30 — Parent membership/mobile safety checkpoint committed locally

COMMIT = `59bfc331` (`security: enforce parent family scope and enrollment state`), 31 exact mission paths. It includes the shared fail-closed registry membership resolver/Parent-session authorizer, corrected disposable route-audit registration and test, Parent/iOS/Android safeguards, focused/MySQL tests, architecture/crosswalk, and synchronized ledgers. `.vscode/` and root `0` were excluded and remain untracked.
EVIDENCE = Backend build PASS; focused seven-file Parent suite 145/145 (`NODE_ENV=test`); test registration guard 6/6; corrected disposable MySQL 8.4.11 route campaign 51/51 after 58 migrations, cleanup PASS, report 45/52 declarations / 137 scenarios / zero unexpected 401/403/other, GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN. Android Gradle task succeeded UP-TO-DATE; existing XMLs show 30 + 20 tests, zero failures/errors/skips, and are post-source/pre-invocation evidence rather than a fresh execution. iOS standalone probe was recorded earlier; Xcode remains unavailable.
GIT = Local HEAD is now `59bfc331`, one local checkpoint beyond tracking ref `a8c37162`. A fresh `git ls-remote` remains unable to connect through the configured proxy; server equality, publication, and exact-head CI are not proven. Last certified CI remains run `36634164993` (27/27 at `a8c37162`) and does not cover this commit.
GATES = TODO-12/14/15/19/20 remain IN_PROGRESS; TODO-14 global aggregate remains unproven; live `pca_pro` last verified at 0059; TODO-18 owner acceptance remains pending. Platform stays `HOLD_PARENT_DEPENDENCY`; no activation, deployment, or live DB mutation occurred.
NEXT_ACTION = Publish this local fast-forward only after remote access is available and ancestry is freshly verified; then inspect exact-head CI and resume the earliest unfinished Parent dependency.

### 2026-09-30 — checkpoint `785323d2` published and CI running

PUBLICATION = Implementation commit `59bfc331` and ledger sync `785323d2e471d1fa35a27d93935b0451f1a58210` were pushed as an ordinary fast-forward from `a8c37162` to `origin/pca-dev`. Post-push fetch and fresh `git ls-remote` prove LOCAL_HEAD = TRACKING_HEAD = SERVER_HEAD = `785323d2e471d1fa35a27d93935b0451f1a58210`; the Parent/Platform master TODO files and new resolver, session-authorizer, and MySQL audit test are present in the remote tree.
CI = GitHub Quality gates run `36648259414` targets exact SHA `785323d2e471d1fa35a27d93935b0451f1a58210` and is currently IN_PROGRESS. No pass/fail conclusion yet.
NEXT_ACTION = Wait for run `36648259414`, record its final result, and continue the same Parent mission with TODO-12/14/15/20 and release gates open.
TODO20_REFRESH = A fresh bounded TCP probe to `pca-mysql.mysql.database.azure.com:3306` timed out. No live `pca_pro` read or mutation was performed; migration 0059 remains the last verified live head and repository/local remain 0060. This confirms TODO-20 cannot advance from this network context.

### 2026-09-30 — Codex re-entry assessment and exact-head CI result

REENTRY = No DeepSeek commits follow the accepted `91f7f6d4` checkpoint. The committed `a8c37162` handover, `59bfc331` 31-path implementation, and `785323d2` ledger sync are Codex-owned. No new DeepSeek migration exists; repository schema head remains 0060. Waves 5A/5B retain prior exact-head certification (runs `36505757047` and `36519047489`, 27/27 each).
REVIEW = Examined the production membership resolver, shared Parent-session authorizer and composition, Android lifecycle status guards, iOS trusted-floor guard, and associated authority/route changes. No security regression found in these reviewed deltas. Current exact-head Quality Gates run `36648259414` completed SUCCESS, 27/27, at SHA `785323d2e471d1fa35a27d93935b0451f1a58210`.
GIT = Fresh fetch and server ref agree with local and tracking refs at `785323d2e471d1fa35a27d93935b0451f1a58210`. This ledger-result sync is the only mission change currently local; `.vscode/` and root `0` remain excluded.
TODO_STATUS = 14 PASS / 5 IN_PROGRESS (12,14,15,19,20) / 4 TODO or owner-release gated (18,21,22,23) / 0 marked BLOCKED. TODO-14 remains 45/52 integrated and global aggregate NOT_YET_PROVEN. Platform remains `HOLD_PARENT_DEPENDENCY`.
DATABASE = Repository and recorded local owner-UAT schema head 0060; live `pca_pro` last verified at 0059; fresh TCP/3306 preflight timed out. Parity remains NO and no live DB read or mutation occurred. Local MySQL/backend ports are open; Parent/Platform web ports are closed. TODO-18 owner acceptance remains pending.
NEXT_ACTION = Continue TODO-15 independent source/device-security review without activating the first-device Trust Set, E2EE, attestation, or production gates.

### 2026-09-30 — Local Parent and Platform browser precheck

PARENT_BROWSER = Production-preview real-browser suite PASS 101/101 on Chromium using demo fixtures and a temporary IPv4-only Playwright config. It covered billing/RBAC, enrollment responsive layouts, PWA worker/offline behavior, keyboard/focus, contrast, RTL, and route links. The two 320px/375px device-page overflow cases pass in this run. The temporary config was removed after the campaign.
PLATFORM_BROWSER = Production build PASS; separate Platform real-browser suite PASS 21/21 on Chromium using HTTP-boundary mocks and a temporary IPv4-only config. It covered login/MFA contract states, session expiry/logout, role boundaries, Arabic/RTL, contrast, and forced-colors. This does not prove live API behavior; the separate real-backend E2E campaign is recorded in the local UAT handoff/history.
LOCAL_UAT_PRECHECK = Backend `/health` and `/health/db` returned HTTP 200 JSON. Parent `/login` and Platform `/login` returned HTTP 200 HTML on `127.0.0.1:4000` and `127.0.0.1:4100`; local disposable MySQL TCP port 33061 is reachable. Both web apps have been restored to the documented real-backend development configuration. `localhost` resolves to an unrelated IPv6 listener on the same web ports in this environment; use `127.0.0.1` URLs for owner testing.
OWNER_GATE = Technical precheck only. No owner `LOCALHOST ACCEPTED`, Trust Set/device ACTIVE state, production/live DB mutation, Platform activation, or deployment is claimed. Parent TODO-18 and Platform `HOLD_PARENT_DEPENDENCY` remain unchanged.
NEXT_ACTION = Continue the earliest unfinished Parent work with TODO-12/14/15/19/20 and owner/release gates open; preserve the first-device root/crypto gate and the Platform dependency hold.

### 2026-09-30 — Browser-precheck ledger checkpoint published

GIT = Ledger-only checkpoint `6acaf7e0b79b9ce0681d938092ff4b744311d71e` was pushed to `origin/pca-dev` by ordinary fast-forward. Fresh fetch, tracking ref, and `git ls-remote` agree at that SHA; both master TODO files exist in the remote tree. `.vscode/` and root `0` remain excluded.
CI = Latest previously verified exact-head result is Quality Gates run `36649336733` SUCCESS 27/27 at `235c9c65`. A fresh GitHub Actions query for `6acaf7e0` failed because the configured proxy endpoint `127.0.0.1:9` refused connection; CI for the new checkpoint is UNVERIFIED, not PASS.
NEXT_ACTION = Re-run isolated Platform real-backend E2E after restoring local MySQL access; preserve fail-closed crypto, owner, live DB, Platform, and deployment gates.

### 2026-09-30 — PCA Codex re-entry and local real-backend follow-up

REENTRY = Re-read the supplied handover and reconciled source, migrations, tests, Git, CI records, TODO ledgers, and security decisions. No DeepSeek commits follow accepted checkpoint `91f7f6d4`; Wave 5A/5B remain accepted foundations and `59bfc331` is Codex-owned. No security regression was found in reviewed deltas.
GIT = `pca-dev` local HEAD = `origin/pca-dev` = fresh server head `8e63d4738f3d4c0d06afd25b58adf383ca2352ad`. Current exact-head CI is UNVERIFIED; latest certified predecessor is run `36657492055`, SUCCESS 27/27 at ancestor `965479051b547cb659946c0c4a6fb8f237a5883c`. Current head differs from that CI SHA only in the two master TODO ledgers.
TODO_STATUS = 14 PASS / 5 IN_PROGRESS (12,14,15,19,20) / 4 owner or release gated (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 database-integrated declarations and `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`.
TODO15_REVIEW = Read-only Android/iOS/backend review found no legitimate device activation path: Android key generation stops pending crypto approval; iOS rejects a missing trusted epoch floor; production has no Trust Set acceptance caller and first-family provisioning supplies no device or genesis anchor. No signature, replay, family-binding or epoch-downgrade bypass was found in reviewed lifecycle code. Root protocol, crypto/key custody and signed policy receipt/application remain gated.
REAL_BROWSER = Parent real-backend Playwright E2E passed 1/1 against a UUID-owned disposable setup. Platform real-backend flow is NOT PASS: an existing local Parent already had an entitlement and was correctly rejected; a fresh isolated attempt did not reach DB health; a later setup attempt timed out before creating its UUID DB. The earlier second step-up UI hang remains undiagnosed and is not yet a proven product defect.
LOCAL_DB = TCP 127.0.0.1:33061 accepts connections but MySQL handshake times out. Docker service is stopped; Windows denied starting it (`Cannot open service`) and Docker Desktop's engine remained unavailable. The latest attempt created no test database. Owner UAT and live `pca_pro` were untouched; repository/local schema is 0060 and live last verified 0059.
DIRTY = The only tracked worktree changes are `parent-web/playwright.real.config.ts` and `platform-admin-web/playwright.real.config.ts`; `.vscode/` and root `0` remain excluded. Parent E2E passed with the revised config; Platform E2E awaits working local MySQL and step-up diagnosis.

### 2026-09-30 — Platform real-backend E2E completed

PLATFORM_REAL_BACKEND = PASS 1/1 on Chromium. Playwright JSON result started `2026-09-30T14:30:12.964Z`, duration 113,754 ms, expected 1, unexpected 0. The real Fastify + MySQL journey passed login/MFA, dashboard, entitlements, admin-user operation-scoped step-up and creation, audit, settings, and billing (`platform-admin-web/e2e-real/realBackend.spec.ts`).
LOCAL_TEST_TOPOLOGY = MySQL 8.4.11 on loopback port 33062; the runner passed 58 migrations and its privacy/environment gate, used only a generated `pca_test_codex_<UUID>` database and synthetic E2E accounts, then dropped it. A post-run INFORMATION_SCHEMA query found no `pca_test_codex_%` schemas. Owner-UAT database, live `pca_pro`, and production were not used or changed.
LOCAL_STORAGE = One directory for the earlier interrupted UUID database `pca_test_codex_049c1d8cb70343d5b8c36a84d25f988d` remains under the task-owned temporary MySQL datadir, although no matching schema exists. It has not been manually deleted while MySQL is running.
DIAGNOSTIC = The earlier pending admin-create request did not reproduce in this completed fresh run. A separate PowerShell launch timed out waiting for the Vite web server; the configured npm/Vite command started successfully under `cmd.exe` on port 4102, after which the full Playwright journey passed. Do not retain the prior UI hang as a confirmed product defect.
GATES = Parent TODO-12/14/15/19/20 remain IN_PROGRESS; TODO-14 aggregate remains NOT_YET_PROVEN. Exact-head CI at `8e63d473` remains UNVERIFIED; live schema/grants, owner `LOCALHOST ACCEPTED`, Platform projection acceptance, and deployment gates remain open. Platform stays `HOLD_PARENT_DEPENDENCY`.
NEXT_ACTION = Resume the earliest unfinished Parent work at TODO-12/14 within the approved Trust Set, FamilyAudit, and evidence boundaries; keep all owner, live-DB, Platform, and release gates open.

### 2026-09-30 — Parent MFA response-shape follow-up

CI = Run `36744571850` failed 1/27 at `fb901859`; 26 jobs passed. The MFA step-up response was HTTP 200 but lacked `sessionEstablished`, so the browser login is not certified.
DIAGNOSIS = Persisted replay-watermark use was added after the preceding E2E flow consumed TOTP counters. This run no longer produced the prior HTTP 401, but its 200 body is unexplained. Do not mark replay resolved or infer a successful session.
FOLLOWUP = The local test captures response content type, safe session/MFA flags, boolean TOTP-field presence, and email-OTP-only probe result. Test-discovery and syntax checks pass; exact-head CI is pending.
GATES = TODO-17/19 remain IN_PROGRESS. Parent TODO-12/14/15/20 and owner TODO-18 remain open; Platform stays `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Parent MFA regression and remote checkpoint closed

CI = Quality Gates run `36751605072` passed 27/27 at source checkpoint `cb9d9e1bd4f25913757a787d8ed02464bfabc006`. The MFA browser journey passed with cookie-backed session, `/api/parent/session` 200, and dashboard navigation.
LEDGER_SYNC = Commit `8d6fb0b458b69d70438a6492d65d33dac2b3a016` records the CI result and TODO-17/TODO-19 PASS statuses. Fresh fetch and `git ls-remote` matched local/tracking/server refs; exact-head run `36753042327` passed 27/27.
TODO_STATUS = 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 integrated, with seven gated/optional declarations. Platform remains `HOLD_PARENT_DEPENDENCY`; TODO-20 live schema/grants and owner/release gates remain open.
NEXT_ACTION = Resume TODO-20 by restoring/re-establishing only the disposable/local MySQL environment, reconciling repository schema 0060 against local truth, and retrying read-only live `pca_pro` preflight before any mutation.

### 2026-09-30 — Codex re-entry and TODO-20 local runtime diagnosis

REENTRY = Local/tracking/server refs were successfully verified equal at `fa428708efdbabcf36fdedae1c610ddca6bebf3a`; a later fetch/GitHub API attempt failed through the configured proxy. No DeepSeek-authored commit follows accepted checkpoint `91f7f6d4`. Recorded exact-head run `36754475958` is green after iOS job rerun `110026310916`; a fresh GitHub API result is unavailable through the current proxy.
TODO_STATUS = 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 database-integrated; global aggregate is NOT_YET_PROVEN.
TODO20 = Repository schema 0060 (58 migrations); local owner-UAT last recorded at 0060; live `pca_pro` last verified at 0059. No local MySQL listener exists. Docker engine pipe is absent, WSL enumeration returns E_ACCESSDENIED, and only MySQL 9.7 binaries were found; stopped MySQL80/MySQL97 were not started. Live DNS resolves to `4.161.89.178`, TCP/3306 is unreachable. No local or live DB read/mutation occurred.
PLATFORM_GATE = `HOLD_PARENT_DEPENDENCY`; owner localhost acceptance, first-device Trust Set root, Platform projection/release, live grants, deployment, and production acceptance remain open.

### 2026-09-30 — TODO-20 local schema, route, Trust Set, and grants validated

LOCAL_RUNTIME = Restored task-owned MySQL 8.4.11 on 127.0.0.1:33062 with UTC. Existing MySQL80/MySQL97 services were not started. After each validation, exact UUID databases were dropped; final check found zero `pca_test_codex_%` schemas and zero `pa_priv_%` users.
LOCAL_SCHEMA = Repository migration/privacy/environment gate PASS: 58/58 migrations, 94 tables, 806 columns; regenerated `current_schema.sql` and `schema_manifest.json` exactly match tracked files (`git diff --exit-code` PASS). This is a fresh disposable DB proof; owner-UAT itself was not connected.
VALIDATION = Backend build PASS. Parent route-audit MySQL suites PASS 51/51; collector confirms 45/52 database-integrated declarations over 137 scenarios, zero unexpected 401/403/other, global aggregate still NOT_YET_PROVEN. Migration-0060 runtime-grant acceptance PASS 6/6, including append-only epoch and no-delete floor boundaries with a real throwaway runtime principal. Trust Set migration-safety, persistence, and acceptance MySQL suites PASS 28/28. No seed/application data persisted after cleanup.
LIVE = Fresh DNS resolves to `4.161.89.178`; TCP/3306 remains unreachable. Live `pca_pro` is last verified at 0059; no live DB connection/read/mutation occurred. TODO-20 remains IN_PROGRESS until fresh live schema and grant preflight/reconciliation can be completed.
PLATFORM_GATE = `HOLD_PARENT_DEPENDENCY`; no Enrollment activation, deployment, production mutation, or owner acceptance occurred.

### 2026-09-30 — DeepSeek re-entry review and exact-head CI closure

REENTRY = The supplied DeepSeek handover reports head `3a4d0bb3`, an ancestor of accepted checkpoint `91f7f6d4`. No DeepSeek-authored commit follows `91f7f6d4`; the later membership/mobile-safety implementation `59bfc331` is coordinator-authored and was independently reviewed (`ACCEPT_WITH_FOLLOWUP`). Its registry-backed child-profile membership and Parent authorizer fail closed; Android remains capped at `PAIRING_PENDING`; iOS rejects a missing trusted epoch floor. No Trust Set root inference, acceptance-writer shortcut, accepting production device verifier, fake ACTIVE state, or authority bypass was found. The handover's browser owner-attestation findings are not active Parent checkout wiring: current checkout uses Parent active-Administrator plus fresh TOTP, and production device-signature verification remains rejecting. Preserve external crypto/key-custody gates before any dormant authority path is activated.
FILES_AND_MIGRATIONS_REVIEWED = Reviewed the 31-path `59bfc331` change (28 source/test paths plus mission documentation), current Trust Set/device/mobile composition and tests, both master TODOs, continuous-goal history, supplied DeepSeek handover, and local-UAT handoff metadata without copying credentials. Repository migration history remains at 0060; no later migration or schema change exists.
EXACT_HEAD_CI = Quality Gates run `36763771064` completed SUCCESS 27/27 at exact SHA `e12711f3986eedaa43a82f250a6365c8e5222b0d`. Full disposable-MySQL certification and real-backend Parent/Platform E2E completed. This is CI evidence, not owner acceptance or production evidence.
GIT = Fresh fetch, local HEAD, `origin/pca-dev`, and `git ls-remote` all matched `e12711f3986eedaa43a82f250a6365c8e5222b0d`. `.vscode/` and root `0` remain untracked and excluded.
TODO_STATUS = 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED. TODO-14 remains 45/52 database-integrated, with seven gated/optional declarations and `GLOBAL_AGGREGATE_STATUS=NOT_YET_PROVEN`.
DATABASE = Repository and previously validated disposable schema are 0060; live `pca_pro` remains last verified at 0059. Authenticated read-only live MySQL timed out before SQL; no live schema/grant read or mutation occurred. Owner-UAT MySQL 33061, disposable MySQL 33062, and app ports 4001/4000/4100 are currently stopped. Literal owner `LOCALHOST ACCEPTED` remains absent.
PLATFORM = `HOLD_PARENT_DEPENDENCY`; no enrollment activation, live DB mutation, deployment, or production acceptance.
TRUE_NEXT_DEPENDENCY = Continue safe Parent TODO-12/14/15 source review and evidence. First-device Trust Set root/key custody, encrypted policy/audit paths, production signature verification/attestation, and TODO-14 gated routes require their recorded security or architecture prerequisites. TODO-20 remains authorized but requires a fresh successful live target/schema/grant/data preflight before mutation.
SUPERVISOR = PROCEED with independently safe source/evidence work and the same TODO board; HOLD cryptographic activation, live mutation without preflight, owner acceptance claims, Platform Enrollment activation, Azure deployment, and production change.

### 2026-09-30 — Re-entry ledger publication CI closure

PUBLICATION = Ledger commit `e828546b53ef9c0e1f237d30398f251d506e4529` was pushed by ordinary fast-forward; post-push fetch and `git ls-remote` verified local/tracking/server equality and all three ledger paths on `origin/pca-dev`.
CI = Quality Gates run `36766189779` passed 27/27 at exact SHA `e828546b53ef9c0e1f237d30398f251d506e4529`. No source or schema changes occurred in the ledger checkpoint.
GATES = Parent TODO-12/14/15/20 and owner TODO-18 remain open; Platform stays `HOLD_PARENT_DEPENDENCY`; no owner localhost acceptance, live DB mutation, deployment, or production acceptance occurred.

### 2026-09-30 — Published sync CI and live preflight refresh

PUBLICATION = Ledger sync `22a10c06ace0244cc3b0e6b2cb731501e51fd2ad` was pushed by ordinary fast-forward; post-push fetch and server verification matched local/tracking/server refs, and all three ledgers are present remotely.
CI = Quality Gates run `36767517932` passed 27/27 at exact SHA `22a10c06ace0244cc3b0e6b2cb731501e51fd2ad`.
LIVE_PREFLIGHT = DNS resolved the live host to `4.161.89.178`; TCP/3306 returned false. No live query or mutation occurred; live schema remains last verified at 0059.
GATES = TODO-12/14/15/20 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Current ledger sync CI closure

PUBLICATION = Ledger sync `4eee477b0c77e2022596be16970bb86e3d010ad2` was pushed by ordinary fast-forward; post-push fetch and `git ls-remote` verified local/tracking/server equality and all three remote ledger paths.
CI = Quality Gates run `36768593806` passed 27/27 at exact SHA `4eee477b0c77e2022596be16970bb86e3d010ad2`.
LIVE_PREFLIGHT = TCP/3306 to the resolved live host is unreachable; no live query or mutation occurred. Live schema remains last verified at 0059.
GATES = Parent TODO-12/14/15/20 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-09-30 — Published ledger CI closure

PUBLICATION = Ledger sync `7f4531fe207c5f09b60f6b87c994028c782cc5e3` was pushed by ordinary fast-forward; post-push fetch and `git ls-remote` verified local/tracking/server equality and all three remote ledger paths.
CI = Quality Gates run `36769567273` passed 27/27 at exact SHA `7f4531fe207c5f09b60f6b87c994028c782cc5e3`.
GATES = Parent TODO-12/14/15/20 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`; no live query/mutation or owner acceptance occurred.

### 2026-09-30 — Latest ledger sync CI closure

PUBLICATION = Ledger sync `a41faf99ed0ecfda0587284a86bfb8b0b1ea6809` was pushed by ordinary fast-forward; post-push fetch and `git ls-remote` verified local/tracking/server equality and all three remote ledger paths.
CI = Quality Gates run `36771385817` passed 27/27 at exact SHA `a41faf99ed0ecfda0587284a86bfb8b0b1ea6809`.
GATES = Parent TODO-12/14/15/20 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`; no live query/mutation or owner acceptance occurred.

### 2026-09-30 — c0023645 exact-head CI and ledger status reconciliation

PUBLICATION = Ledger checkpoint `c0023645b08dc4313cfe8dbf51df5e6604f5eec5` was pushed by ordinary fast-forward. Post-push fetch and server-ref verification matched local/tracking/server heads; all three mission ledger paths exist on `origin/pca-dev`.
CI = Quality Gates run `36772627678` completed SUCCESS, 27/27, at exact SHA `c0023645b08dc4313cfe8dbf51df5e6604f5eec5`; GitHub run evidence includes successful full disposable-MySQL and real-backend E2E jobs.
STATUS_RECONCILIATION = The overall mission-history status table now matches this canonical board for TODO-02…10 and TODO-13; these are PASS. Parent remains 15 PASS / 4 IN_PROGRESS (TODO-12/14/15/20) / 4 TODO (TODO-18/21/22/23). TODO-14 aggregate remains NOT_YET_PROVEN; Platform remains `HOLD_PARENT_DEPENDENCY`.
GATES = Live `pca_pro` parity remains NO (repo/local 0060 versus last verified live 0059); current preflight has no authenticated SQL comparison or mutation. Owner localhost acceptance, device/root security review, deployment, and production acceptance remain open.

### 2026-09-30 — local route-audit campaign and 0541efe3 CI closure

LOCAL_MYSQL = Task-owned MySQL 8.4.11 at 127.0.0.1:33062 passed environment validation and all 58 migrations. Parent route-audit inner campaign passed 51/51; the schemaVersion-3 report confirms 45/52 integrated declarations, 137 scenarios, 50 allows, 75 expected denials, 11 validation/protocol, and zero unexpected 401/403/other. Seven declarations remain appropriately gated or optional; global aggregate stays `NOT_YET_PROVEN`. The run-owned UUID database was dropped; no owner-UAT/live DB or seed data was used.
CI = Quality Gates run `36774031399` completed SUCCESS 27/27 at exact SHA `0541efe35a0af955005c492f801ecc5c79fd5c46`.
GATES = TODO-12/14/15/20 and owner TODO-18 remain open; Platform remains `HOLD_PARENT_DEPENDENCY`; live TCP/3306 is unreachable and no live query/mutation occurred.

### 2026-10-01 — fc100efa exact-head CI and local real-backend browser precheck

EXACT_HEAD_CI = Quality Gates run `36778880069` completed SUCCESS 27/27 at exact SHA `fc100efadf2d3372fc25ed0fd6760235775aebf9`. Parent Chromium passed 101/101 and Platform Chromium 21/21.
LOCAL_PARENT_E2E = On task-owned MySQL 8.4.11 port 33062, the fresh-schema check applied 58 migrations. A synthetic Parent account was created and verified, Family provisioning completed, and the cookie-session dashboard/settings journey passed 1/1. The first sandbox execution was refused at `spawn EPERM` before DB creation; the guarded retry passed after authorized elevation.
LOCAL_PLATFORM_E2E = Real Fastify + MySQL + Chromium passed the Platform Admin login/MFA, dashboard, entitlements, admin-user step-up, audit, settings, and billing journey 1/1 with a generated UUID schema and synthetic fixtures. Post-run cleanup removed the schema.
LOCAL_POSTFLIGHT = Zero `pca_test_codex_%` schemas remain. The separate task-owned `pca_local_owner_uat` schema has 94 tables/806 columns at migration 0060 and zero Parent, Platform-admin, or Family rows. Owner-UAT app ports remain stopped and owner acceptance is absent.
LIVE_DB = Fresh DNS resolves to `4.161.89.178`; TCP/3306 is unreachable. No live SQL read/mutation occurred; live remains last verified 0059 versus repository/local 0060.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED; TODO-14 remains 45/52 and `NOT_YET_PROVEN`. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-01 — dd7a97ae exact-head CI and local browser precheck

EXACT_HEAD_CI = Quality Gates run `36781742335` completed SUCCESS 27/27 at exact SHA `dd7a97ae283e6c6c162a979e8966d3c303a79e31`, including full disposable MySQL, real-backend E2E, Parent/Platform browser suites, Android/iOS, security, and release-control jobs. This result was superseded by run `36783029602`, which completed SUCCESS 27/27 at ledger checkpoint `8631ed6164f3efcd6333ac9f18d60127bbbe1bc8`.
LOCAL_BROWSER = Local backend health check returned HTTP 200; Parent and Platform Vite servers are listening on 4000/4100 and proxy to local backend 4001. Parent browser reached `/login`. The browser URL policy blocked opening the ignored local credential manifest; no workaround was attempted and credentials were not exposed or entered. Authenticated manual screen coverage and literal owner localhost acceptance remain outstanding.
LOCAL_FIXTURES = Synthetic Parent/Family and pending synthetic Platform owner remain confined to task-owned local MySQL on 33062. Live DB was not touched. `.vscode/` and root `0` remain excluded.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED; TODO-14 remains 45/52 and `NOT_YET_PROVEN`. Platform remains `HOLD_PARENT_DEPENDENCY`; live TCP/3306 remains unreachable.

### 2026-10-01 — 9f6bd581 exact-head CI and pre-auth browser check

EXACT_HEAD_CI = Quality Gates run `36784297610` completed SUCCESS 27/27 at exact SHA `9f6bd581c203dd8d08fcf6f9abc811b93b7c98c3` on attempt 2. Attempt 1 had 26/27 jobs pass; iOS Xcode exited 65 after 571.9 seconds, with simulator FamilyControls/ManagedSettings service warnings and no failing XCTest named in the log. The generated `test-summary.json` is an `xcresulttool` CLI usage error. The iOS-only retry passed in 3m20s; no root cause is confirmed.
LOCAL_BROWSER = Read-only local Parent UI inspection showed registration requires first/last name, email, and password; phone and child count are optional; account type defaults to Parent/guardian; password minimum is 10 characters. Forgot-password copy sends a one-time code only if an account exists. No account was created, password/OTP was entered, or recovery code requested. Navigation to `/mfa/recover` began but the browser automation timed out before verified screen content. Authenticated manual screen coverage and literal owner localhost acceptance remain open.
LIVE_PREFLIGHT = Fresh DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 returned false. No live SQL read or mutation occurred.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED; TODO-14 remains 45/52 and `NOT_YET_PROVEN`. Platform remains `HOLD_PARENT_DEPENDENCY`.

### 2026-10-01 — 8631ed61 ledger exact-head CI closure

PUBLICATION = Commit `8631ed6164f3efcd6333ac9f18d60127bbbe1bc8` updates only the two tracked master TODO ledgers. Push and fresh fetch succeeded; local and `origin/pca-dev` matched, and both ledger paths existed remotely. `.vscode/` and root `0` remained excluded.
EXACT_HEAD_CI = Quality Gates run `36783029602` completed SUCCESS 27/27 at exact SHA `8631ed6164f3efcd6333ac9f18d60127bbbe1bc8`; full disposable MySQL, real-backend E2E, Parent/Platform web suites, Android/iOS, security, and release checks passed.
LIVE_PREFLIGHT = Fresh DNS resolved `pca-mysql.mysql.database.azure.com` to `4.161.89.178`; TCP/3306 returned false. No live SQL read or mutation occurred.
GATES = Parent remains 15 PASS / 4 IN_PROGRESS (12,14,15,20) / 4 TODO (18,21,22,23) / 0 BLOCKED; TODO-14 remains 45/52 and `NOT_YET_PROVEN`. Platform remains `HOLD_PARENT_DEPENDENCY`; authenticated local browser screens and literal owner acceptance remain outstanding.

### 2026-10-01 — Owner MFA recovery and password-lock policy amendment

OWNER_DECISION = No 24-hour MFA recovery hold. Five failed Parent password authentications in a rolling 15-minute window lock password sign-in for one hour. Forgot-password remains available during that lock; successful password reset clears it. Password, email OTP, TOTP, and MFA recovery-code failure budgets remain separate.
IMPLEMENTATION = The active worktree now clears the old TOTP immediately after password plus recovery-email OTP, revokes sessions/daily/step-up grants and pending challenges, and issues only the replacement-enrollment ticket. The replacement TOTP activates only after valid confirmation. Password reset clears lock state, revokes existing sessions/grants/challenges, sends `PASSWORD_CHANGED`, and preserves TOTP.
SCHEMA = Existing Parent rows had no durable password-failure fields, so additive migration `0061_parent_password_login_lock.sql` adds the three account-level fields and a consistency check. The canonical schema source and generated live/disposable bootstrap artifacts were updated; generation reports 94 tables, 809 columns, 59 migrations. `current_schema.sql` and `schema_manifest.json` remain untouched pending official MySQL introspection.
VALIDATION = Backend build PASS; Parent Web typecheck PASS; focused Parent Web recovery/auth tests 37/37 PASS; focused Parent account/MFA suite 18/18 PASS; Parent HTTP auth suite 8/8 PASS including reset rate limits; canonical schema drift 5/5 PASS; generated bootstrap check PASS. Full serial Parent Web suite 152 files / 1,076 tests PASS. Full non-DB backend runner completed 2,750/2,751 before the migration gate fix; the only failure was the new 0061 migration's retry-safety check. After changing 0061 to conditionally add each column and constraint, migration-resumability suite passed 5/5. The full backend runner has not been rerun after that targeted fix. Real-browser spec now discovers 14 tests, including recovery/setup/replacement-TOTP and lock/reset journeys; browser execution remains unavailable with local disposable MySQL stopped.
MYSQL = Official `npm run test:db:parent-auth` stopped before database creation with `ECONNREFUSED 127.0.0.1:33061`. No listener exists on 33061/33062; Docker Desktop engine is absent, and starting `com.docker.service` failed with an OS service-access error. No local schema snapshot, owner-UAT database, live database, or production data was changed.
PUBLICATION = Commit `e66b266dad9f503e2212754d3db020526ac0d8df` was pushed to `pca-dev` by ordinary fast-forward from `c9e43d90e3978d65ef6a9c40d0f488fe75a41316`. Post-push fetch verified `HEAD=origin/pca-dev=FETCH_HEAD=e66b266dad9f503e2212754d3db020526ac0d8df`; the migration and both tracked master TODO paths exist remotely. Untracked `.vscode/` and root `0` remain excluded.
EXACT_HEAD_CI = Not yet verified. `gh run list` could not reach GitHub Actions because its configured proxy at `127.0.0.1:9` refused the connection. No CI result is claimed for `e66b266d`.
BACKEND_FULL_SUITE = Full non-DB runner completed 2,750/2,751 before the migration correction; its sole failure was the newly added 0061 resumability guard. After making each DDL conditional, `migrationResumability.test.mjs` passed 5/5. The full backend runner was not repeated after that exact fix. Backend build, test-double conformance, schema privacy/server stages passed; no broad PASS is inferred from the partial rerun.
MYSQL_AND_BROWSER = `npm run test:db:parent-auth` stopped before database creation with `ECONNREFUSED 127.0.0.1:33061`; no disposable MySQL listener or Docker Desktop engine is available. Real-browser specs discover 14 tests but their execution needs that disposable MySQL. No local owner-UAT/live database or production data was changed.
GATES = `LOCALHOST ACCEPTED` remains NO; TODO-18 remains unchanged and is not PASS. TODO-20 remains IN_PROGRESS. Platform remains `HOLD_PARENT_DEPENDENCY`. No live DB/Azure/Platform/Trust Set/device-authority change occurred.


### 2026-10-01 — Parent recovery/password-lock validation and test-harness checkpoint

OWNER_DECISION = OWNER_MFA_RECOVERY_POLICY=NO_24_HOUR_HOLD; OWNER_PASSWORD_FAILURE_POLICY=5 failed Parent password authentications within a rolling 15-minute window => one-hour password-login lock; FORGOT_PASSWORD_DURING_LOCK=ALLOWED; PASSWORD_RESET_CLEARS_PASSWORD_LOCK=YES; MFA_AND_PASSWORD_FAILURE_COUNTERS=SEPARATE.
IMPLEMENTATION = Policy source commit e66b266dad9f503e2212754d3db020526ac0d8df. Test/harness checkpoint a8f08abcde68bc7ef11c0f6df910b8872cfde191 fixes mysql2 row extraction and isolates the password-lock browser case on its own enrolled Parent without changing rate limits. Push and post-push fetch confirmed local and origin/pca-dev equality at a8f08abc.
SCHEMA = Repository migration head 0061 has three additive account-level password-lock fields; disposable MySQL applied all 59 migrations from zero and replay/upgrade certification passed. Owner-UAT was last verified at 0060; live pca_pro was last verified at 0059. No owner-UAT or live schema mutation occurred.
VALIDATION = Backend full non-DB 2751/2751; Parent Web 152 files/1076 tests and typecheck PASS; disposable MySQL 669 pass/0 fail/9 expected skips; populated production-path DB 275/275 with zero skips; real-browser Parent MFA/optional setup 4/4 with zero skipped; four contract catalogues, security checks, repository checks, and git diff --check PASS.
CI = Exact-head Quality Gates for a8f08abc UNVERIFIED. GitHub run lookup failed because configured proxy 127.0.0.1:9 refused connection; no job-level CI result is claimed.
GATES = TODO-17 and TODO-19 IN_PROGRESS pending exact-head CI and ledger synchronization. Parent board is 13 PASS / 6 IN_PROGRESS / 4 TODO / 0 BLOCKED; TODO-14 remains 45/52 and NOT_YET_PROVEN. TODO-18 remains TODO; LOCALHOST ACCEPTED was not given. Platform remains HOLD_PARENT_DEPENDENCY. Trust Set/device, Platform, live DB, Azure, and deployment remain unchanged.
