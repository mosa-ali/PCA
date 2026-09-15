# PCA First APP_OWNER Bootstrap — Disposable MySQL DB Certification

Session: SESSION 2C — FIRST APP_OWNER DISPOSABLE MYSQL CERTIFICATION
Date: 2026-09-15
Repository: `D:\PCA\pca-app`, branch `pca-dev`
Required starting SHA: `3ca7e2a4994b3b0fec6c54c5cc829f4692c184f7` — confirmed exact at session start.

No production database, no production APP_OWNER, no production email, no
deployment, no pcaSafe change, and no Android work was performed anywhere in
this session. Every mutation below happened against a disposable, local-only
MySQL container that the repository itself defines for exactly this purpose.

## 0. Scope and method

The mission's own status going in:

```text
BOOTSTRAP_ZERO_OWNER_PRECONDITION=PASS_SOURCE
BOOTSTRAP_SERIALIZATION=PASS_SOURCE
BOOTSTRAP_PENDING_CREDENTIAL=PASS_SOURCE
BOOTSTRAP_MFA_INITIAL_STATE=PASS_SOURCE
BOOTSTRAP_SECRET_OUTPUT_HARDENING=PASS_SOURCE
FIRST_OWNER_ACTIVATION_PATH=PASS_SOURCE
DB_CONCURRENT_SINGLE_WINNER=UNPROVED
DB_ROLLBACK=UNPROVED
FIRST_OWNER_END_TO_END_ACTIVATION=UNPROVED
CI=NO_STATUS_CHECK_EVIDENCE
```

The only existing test that touched `bootstrap-platform-owner.mjs`
(`backend/test/platformadmin/bootstrapPlatformOwner.test.mjs`) regex-matches
the script's source text (e.g. `assert.match(script, /GET_LOCK\(\?, \?\)/)`).
It never opens a MySQL connection. That confirms the mission's own
`UNPROVED` labels were accurate going in — nothing previously exercised real
DB behavior for this flow.

This session added a real integration test suite,
`backend/test/db/platformAdminBootstrap.mysql.test.mjs`, that calls the
SAME production classes the script and its HTTP routes use
(`MySqlPlatformAdminAuthRepository`, `MySqlPlatformAdminActivationRepository`,
`PlatformAdminActivationService`, `PlatformAdminAuthService`,
`PlatformAdminAccountService`, and `runBootstrap` itself, imported directly
from `backend/scripts/bootstrap-platform-owner.mjs`) against a real,
disposable MySQL 8.4.11 container, with no mocks. A new npm script,
`test:db:bootstrap`, resets and re-migrates that disposable database
immediately before running the suite, so the `ACTIVE_APP_OWNER_COUNT=0`
precondition genuinely holds at the start (the shared `test:db` suite's
other ~60 files create their own APP_OWNER/PLATFORM_ADMIN fixtures and would
otherwise falsely trip the "already bootstrapped" guard).

## 1. Disposable MySQL environment

```text
MYSQL_TEST_ENVIRONMENT=Docker container `pca-app-mysql-1` from the repository's own root docker-compose.yml ("Disposable MySQL" service), image mysql:8.4.11
MYSQL_VERSION=8.4.11
DATABASE_NAME=pca_test
HOST=127.0.0.1:33061 (Docker Desktop was not running at session start; started for this session)
PRODUCTION_DATABASE_USED=NO
```

Credentials came from `backend/test.db.env`, which already pointed at
`mysql://<redacted>@127.0.0.1:33061/pca_test` — the repository's own
pre-existing disposable-DB test configuration, not something invented for
this session. No password or connection string was printed at any point.
`backend/scripts/verify-mysql.mjs`'s own `assertDisposableDatabaseTarget`
guard, and `bootstrap-platform-owner.mjs`'s sibling script
(`bootstrap-e2e-parent-account.mjs`)'s hostname allowlist convention, both
independently restrict this tooling to `127.0.0.1`/`localhost`/`mysql`.

Migrations were applied via the repository's own runner
(`node scripts/verify-mysql.mjs`, i.e. `npm run db:verify`), not by hand.

## 2. Pre-existing defect found and fixed: schema verification was broken

Running `scripts/verify-mysql.mjs` against a freshly migrated disposable
database failed immediately:

```text
Error: Unexpected schema: ...,platform_admin_accounts,platform_admin_activation_tokens,platform_admin_audit_events,...
```

`verify-mysql.mjs`'s hardcoded `expected` table list (used to catch an
accidental new table / privacy-scope regression) was never updated when
migration 0041 added `platform_admin_activation_tokens`, so `npm run
test:db` — and by extension `npm run db:verify` — could not pass against
any fully-migrated database, disposable or otherwise. This is exactly the
kind of drift the mission's own §12 warned about ("do NOT use the historical
78-table fingerprint as current truth without reconciliation").

Fixed with a one-line, minimal change adding `platform_admin_activation_tokens`
in its correct alphabetical position (`backend/scripts/verify-mysql.mjs`).
After the fix, `db:verify` passes cleanly:

```text
Environment OK: MySQL 8.4.11, db charset utf8mb4/utf8mb4_bin, time_zone +00:00.
Column-collation spot check OK (5 column(s) verified, no unexpected charset/collation pairs).
MySQL migration/privacy/environment gate passed (39 migration(s)).
```

This was a genuine, pre-existing tooling defect on `pca-dev`, not something
introduced this session; it blocked the mission's own required work
(`npm run test:db`) until fixed. No production schema or grants were
touched — this changes only a test-side assertion string.

## 3. New test suite: `backend/test/db/platformAdminBootstrap.mysql.test.mjs`

Run via the new `npm run test:db:bootstrap` script (rebuild → reset
`pca_test` → re-migrate → run). Final clean run, 8/8 passing:

```text
tests 8
pass 8
fail 0
cancelled 0
skipped 0
todo 0
```

### 3a. DB_CONCURRENCY_TEST (mission §3)

Two `runBootstrap()` calls were started concurrently in-process against two
distinct email addresses, each acquiring its own real connection from the
shared MySQL pool (`pool.getConnection()`), genuinely racing for the
`pca:first-app-owner-bootstrap` advisory lock (`GET_LOCK`).

```text
DB_CONCURRENCY_TEST=PASS
CONCURRENT_ATTEMPTS=2
SUCCESSFUL_BOOTSTRAPS=1
FAILED_BOOTSTRAPS=1
FINAL_ACTIVE_APP_OWNER_COUNT=1
FINAL_ACTIVE_APP_OWNER_ROLE_COUNT=1
WINNER_MFA_STATUS=PENDING_SETUP
LOSER_PARTIAL_STATE_ROWS=0
CONCURRENT_SINGLE_WINNER=PASS
```

The loser's rejection message is `assertNoExistingAppOwner`'s real error
text ("An active APP_OWNER account already exists..."). The loser created
**zero** rows under its own email — it fails closed *before* attempting any
insert, once it acquires the lock and re-checks the precondition, not via a
rollback of a partial write.

### 3b. LOCK_FAILURE_TEST (mission §4)

A separate real connection held the named advisory lock; `runBootstrap()`
was then invoked with its own real (unshortened) `LOCK_TIMEOUT_SECONDS=30`.
It genuinely waited the full 30 seconds and failed closed:

```text
ACCOUNT_CREATED=NO
ROLE_CREATED=NO
MFA_CREATED=NO
ACTIVATION_CREATED=NO
LOCK_FAILURE_FAIL_CLOSED=PASS
```

### 3c. BOOTSTRAP_CREATION_ROLLBACK (mission §5)

`MySqlPlatformAdminAuthRepository.createAccount` was called directly with
two audit events sharing the same `eventId`, forcing `ER_DUP_ENTRY` on the
second audit insert — *after* the account, role assignment, and MFA-state
inserts had already run earlier in the same `runInTransaction` block. All
four insert groups rolled back:

```text
ACCOUNT_DELTA=0
ROLE_DELTA=0
MFA_DELTA=0
AUDIT_DELTA=0
BOOTSTRAP_CREATION_ROLLBACK=PASS
```

### 3d. ACTIVATION_ISSUANCE_FAILURE — release-grade finding (mission §6)

This is the most important result of this certification.

Reading `backend/scripts/bootstrap-platform-owner.mjs` (lines 97–144)
confirms account creation and activation issuance are **two separate
database transactions**, not one atomic operation:

```js
await repository.createAccount({ ... });                 // transaction 1 — commits
const { rawToken, tokenHash } = generateActivationToken();
await activationRepository.issue({ ... });                // transaction 2 — separate
await emailSender.sendPlatformAdminActivationLink(...);    // never throws on delivery failure
```

The test reproduced this exact sequence with the exact same real
repository classes, then forced the second operation
(`activationRepository.issue`) to fail with a real `ER_DUP_ENTRY` (a
pre-inserted row occupying the `activation_id` primary key), *after* the
first operation had already committed:

```text
ACTIVATION_ISSUANCE_FAILURE_STATE=ACTIVE_ACCOUNT_PLUS_APP_OWNER_ROLE_PLUS_PENDING_SETUP_MFA_PLUS_PENDING_CREDENTIAL_PLUS_NO_USABLE_ACTIVATION
RECOVERY_PATH_PROVEN=NO
FIRST_OWNER_STRANDING_RISK=YES
```

Verified directly against the database: the account (`status=ACTIVE`,
`password_credential=PCA_PENDING_FIRST_OWNER_ACTIVATION`), its `APP_OWNER`
role assignment, and its `PENDING_SETUP` MFA row all persist. No row exists
in `platform_admin_activation_tokens` for the token that was supposed to be
issued.

The only other way to issue an activation link,
`PlatformAdminActivationService.issueActivation`, requires an **already
authenticated actor holding `MANAGE_ADMIN_ACCOUNTS`**
(`rbacPolicy.authorizePlatformAdminOperation`). The test called it with an
unauthenticated actor shape and it correctly refused
(`PlatformAdminActivationError`). For a genuine first-ever bootstrap, no
such actor can exist: the only account with `APP_OWNER` is the stranded one
itself, and it cannot log in (no usable password, MFA `PENDING_SETUP` with
no secret material) — so no authenticated session, hence no
`MANAGE_ADMIN_ACCOUNTS` actor, can ever be produced through the
application's own reachable surface.

Re-running `bootstrap-platform-owner.mjs` does not help either: it refuses
immediately, because `assertNoExistingAppOwner` now sees the stranded
account as "already bootstrapped."

**This means: if the activation-issuance step of a real first-owner
bootstrap fails for any DB-level reason (deadlock, disk full, connection
drop, replica lag, etc.) after account creation has already committed, the
operator is left with a permanently un-activatable `APP_OWNER` account and
no in-application recovery path.** The only recovery available today is a
direct, manual database operation (hand-inserting a new
`platform_admin_activation_tokens` row, or deleting/disabling the stranded
account) by someone with raw DB access outside the application entirely —
not an authenticated, audited path.

Per the mission's own instruction: **this is a release-grade finding. The
bootstrap is NOT classified production-ready.** `bootstrap-platform-owner.mjs`
should not be run against production until this gap is closed (e.g. by
wrapping both operations in one transaction, or by adding an idempotent,
lock-protected "resume activation issuance for the existing zero-token
APP_OWNER" recovery path that does not require prior authentication).

One sub-finding worth separating clearly from the above: if *only email
delivery* fails (SMTP/Graph outage) after activation issuance has
*succeeded*, that is **not** a stranding risk — `EmailService` durably
enqueues the outbox row before attempting delivery and never propagates a
delivery failure, so the background `EmailOutboxProcessor` retries it. The
risk proven above is specifically about the `activationRepository.issue()`
database operation itself failing, which has no such retry path.

### 3e. FIRST_OWNER_END_TO_END_ACTIVATION (mission §7)

Full lifecycle proved against real MySQL and real AES-256-GCM/scrypt/HMAC-SHA1
crypto, at the **service layer** (the same `PlatformAdminActivationService`
and `PlatformAdminAuthService` classes the HTTP routes
(`backend/src/http/routes/platformadmin/activationRoutes.ts`,
`backend/src/http/routes/platformAdminAuthRoutes.ts`) call directly) rather
than through Fastify's HTTP layer — an explicit, honest scoping choice
given effort constraints; the route handlers themselves are thin
validate-then-delegate wrappers already covered by
`test/platformadmin/fastifyPlatformAdminAuthPlugin.test.mjs`.

```text
PRE_ACTIVATION_LOGIN=DENIED
MFA_STATUS=ACTIVE
PASSWORD_FORMAT=SCRYPT
POST_ACTIVATION_LOGIN=PASS
TOKEN_REUSE=DENIED
TOTP_REPLAY=DENIED
FIRST_OWNER_END_TO_END_ACTIVATION=PASS
```

Specifically proved, in order: only the SHA-256 hash of the activation token
is ever persisted (`token_hash` column equals `hashActivationToken(rawToken)`,
and does not literally contain the raw token); login before activation is
denied; `activation/start` returns a real `otpauth://` URI backed by a
freshly generated, AES-256-GCM-encrypted TOTP secret; a valid TOTP code
completes activation (sets a real `scrypt$...` password credential, flips
MFA to `ACTIVE`, marks the token `used_at`); a fresh TOTP code then logs the
owner in; the resulting session identifies the `APP_OWNER` role; logout
revokes the session; the old session token is rejected afterward; and the
already-accepted TOTP code is rejected on reuse (replay defense).

### 3f. ACTIVATION_REISSUE (mission §8)

```text
ACTIVATION_REISSUE=PASS
OLD_TOKEN_INVALIDATION=PASS
OLD_TOTP_INVALIDATION=PASS
```

Issuing a second activation (B) for the same admin, after the first (A) had
already begun MFA enrollment (a pending TOTP secret persisted), proved: A is
revoked and rejected by `activation/start`; A's pending TOTP secret is wiped
(`totp_secret_ciphertext`/`totp_secret_nonce` both `NULL`) by B's issuance,
in the same transaction; B is accepted, uses a genuinely fresh TOTP secret
(different `otpauth://` URI), and successfully completes activation.

### 3g. EXISTING_PLATFORM_ADMIN_SAFETY (mission §9)

```text
EXISTING_PLATFORM_ADMIN_UNCHANGED=PASS
SILENT_ROLE_ELEVATION=NO
```

A fixture `PLATFORM_ADMIN` account (`ACTIVE`, real password, real `ACTIVE`
MFA with a real encrypted TOTP secret) was created first. A full,
successful first-owner bootstrap was then run. A before/after snapshot of
the fixture's account row, role-assignment row(s), and MFA-state row
(including the raw ciphertext/nonce bytes) were compared with
`assert.deepEqual` and found byte-for-byte identical; it kept exactly one
active role, `PLATFORM_ADMIN`, never `APP_OWNER`.

### 3h. BOOTSTRAP_OUTPUT_HYGIENE (mission §10)

`bootstrap-platform-owner.mjs` was run as a genuine child process
(`node scripts/bootstrap-platform-owner.mjs`), and its real stdout/stderr
were captured and scanned for password/password-hash/raw-token/activation-URL/
TOTP-secret/`otpauth://`/DB-credential/session-token patterns.

```text
BOOTSTRAP_OUTPUT_HYGIENE=PASS
```

By source inspection, the script's success path prints exactly one line,
`FIRST_OWNER_BOOTSTRAP=ACTIVATION_ISSUED PROVIDER=<name>`, and its failure
path prints only `error.message` for the (static, non-secret) errors this
script can throw. `EmailService` additionally logs one non-secret
diagnostic line (`kind`/`provider`/`outcome`/`attempt` only) before that —
explicitly allowed by this section's own "non-secret status/provider name
is acceptable" rule, and confirmed to carry no secret material.

## 4. Existing test/typecheck evidence (mission §11)

```text
BACKEND_TYPECHECK=PASS (npm run build / tsc, zero errors)
BOOTSTRAP_DIRECT_TESTS=PASS (test/platformadmin/bootstrapPlatformOwner.test.mjs, unit-level, source-shape only — existed before this session)
ACTIVATION_TESTS=PASS (test/platformadmin/activation.test.mjs)
AUTH_TESTS=PASS (test/platformadmin/authService.test.mjs, accountService.test.mjs, crossRealm.test.mjs, totp.test.mjs, fastifyPlatformAdminAuthPlugin.test.mjs, rbacPolicy.test.mjs)
DB_CONCURRENCY_TEST=PASS (this session's new suite, §3a above)
DB_ROLLBACK_TEST=PASS (this session's new suite, §3c above)
CI_STATUS=NO_STATUS_CHECK_EVIDENCE
```

92/92 existing platform-admin unit tests pass. `CI_STATUS` was independently
re-confirmed by reading `.github/workflows/quality-gates.yml` directly: it
explicitly documents that the MySQL-backed `test:db` suite (which now
includes this certification's own tests) is deliberately not wired into CI
("a KNOWN, DOCUMENTED gap rather than a silent one"), because that workflow
is read-only/credential-free by design. This matches the mission's own
`CI=NO_STATUS_CHECK_EVIDENCE` premise exactly — no CI signal validates any
of this today, on any branch.

## 5. Schema reconciliation (mission §12)

Queried directly against the freshly migrated disposable database, not
assumed from any historical fingerprint:

```text
CURRENT_TABLE_COUNT=79
ACTIVATION_TOKEN_TABLE_PRESENT=YES
CURRENT_MIGRATION_JOURNAL=39 files, 0001…0041 (0009/0010 numbers absent — a pre-existing gap, not new), last = 0041_platform_admin_activation_tokens.sql
MIGRATION_0022_STATUS=0022_enrollment_administration_persistence.sql — unrelated to platform-admin bootstrap; applied to the DISPOSABLE test database only (required for a full, representative schema), never to production, matching PRODUCTION_CHANGED=NO below
```

This is evidence for a later production schema/grant reconciliation, as the
mission requested — it does not itself change or query production.

## 6. Final decision

```text
LOCAL_HEAD=3ca7e2a4994b3b0fec6c54c5cc829f4692c184f7
REMOTE_HEAD=3ca7e2a4994b3b0fec6c54c5cc829f4692c184f7 (pushed and independently verified in the prior session; unchanged this session until this evidence commit)
WORKTREE_CLEAN=YES at session start

MYSQL_TEST_ENVIRONMENT=Docker mysql:8.4.11, disposable Compose service `mysql`, host 127.0.0.1:33061
PRODUCTION_DATABASE_USED=NO

DB_CONCURRENCY_TEST=PASS
CONCURRENT_SINGLE_WINNER=PASS
LOCK_FAILURE_FAIL_CLOSED=PASS
BOOTSTRAP_CREATION_ROLLBACK=PASS

ACTIVATION_ISSUANCE_FAILURE_STATE=ACTIVE_ACCOUNT_PLUS_APP_OWNER_ROLE_PLUS_PENDING_SETUP_MFA_PLUS_PENDING_CREDENTIAL_PLUS_NO_USABLE_ACTIVATION
RECOVERY_PATH_PROVEN=NO
FIRST_OWNER_STRANDING_RISK=YES

PRE_ACTIVATION_LOGIN=DENIED
POST_ACTIVATION_LOGIN=PASS
TOKEN_REUSE=DENIED
TOTP_REPLAY=DENIED
ACTIVATION_REISSUE=PASS
OLD_TOKEN_INVALIDATION=PASS
OLD_TOTP_INVALIDATION=PASS

EXISTING_PLATFORM_ADMIN_UNCHANGED=PASS
BOOTSTRAP_OUTPUT_HYGIENE=PASS

CURRENT_TABLE_COUNT=79
ACTIVATION_TOKEN_TABLE_PRESENT=YES
CURRENT_MIGRATION_JOURNAL=39 files (0001-0041, 0009/0010 absent), last=0041_platform_admin_activation_tokens.sql
MIGRATION_0022_STATUS=APPLIED_TO_DISPOSABLE_TEST_DB_ONLY_NOT_PRODUCTION

BACKEND_TYPECHECK=PASS
BOOTSTRAP_DIRECT_TESTS=PASS
ACTIVATION_TESTS=PASS
AUTH_TESTS=PASS
CI_STATUS=NO_STATUS_CHECK_EVIDENCE

SCHEMA_CHANGED=NO (disposable DB only; migrations already existed and were only applied, not authored)
MIGRATION_ADDED=NO

PRODUCTION_CHANGED=NO
DEPLOYED=NO
BOOTSTRAP_EXECUTION_AUTHORIZED=NO

BLOCKERS=FIRST_OWNER_STRANDING_RISK=YES (release-grade: account-creation and activation-issuance are two separate, non-atomic transactions with no authenticated recovery path if the second one fails after the first commits) is a genuine production blocker independent of, and in addition to, the standing owner-authorization gate already documented in PCA_SESSION_2C_LIVE_ACCEPTANCE_2026-09-15.md.
NEXT_ACTION=fix the activation-issuance non-atomicity (single transaction, or an authenticated-free, lock-protected "resume issuance for a zero-token bootstrapped owner" recovery path) and re-run this same disposable-DB suite before any production bootstrap is authorized; separately, wire `test:db:bootstrap` (or the full `test:db`) into CI so this stops being an undetected regression risk.
```

## 7. Source changes made this session

- `backend/scripts/verify-mysql.mjs` — one-line fix: added the missing
  `platform_admin_activation_tokens` table to the expected-schema list
  (§2 above). Without this, `npm run db:verify`/`npm run test:db` cannot
  pass against any fully migrated database.
- `backend/package.json` — added `test:db:bootstrap`, a focused script
  following the repository's own existing `test:db:pa2`/`test:db:comp`
  convention: reset the disposable test DB, re-migrate, then run only this
  certification's test file.
- `backend/test/db/platformAdminBootstrap.mysql.test.mjs` — new, real-MySQL
  integration test suite (8 tests, all passing) proving the DB-backed
  claims in this document.

No other file was modified. No production, database, or deployment target
was touched.
