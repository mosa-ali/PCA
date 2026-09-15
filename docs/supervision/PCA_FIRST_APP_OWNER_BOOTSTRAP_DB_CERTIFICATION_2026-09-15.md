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

> **UPDATE, same day, follow-up session:** this finding is now **CLOSED**.
> See §8 below for the root cause, the architectural fix (a single atomic
> transaction), failure-injection proof that the fix actually works, and
> proof that a *post-commit* provider failure still cannot strand anyone.
> The rest of this section is kept as-is as the historical reproduction
> record.

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

## 6. §1–5 final decision as of the FIRST session (superseded)

The block below is preserved verbatim as the historical record of what the
first certification session concluded, before the fix in §8. It is
**superseded** by §9's final decision — `FIRST_OWNER_STRANDING_RISK` is now
`CLOSED`, not `YES`.

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

## 7. Source changes made in the FIRST session

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

## 8. Stranding defect closure (follow-up session, same day)

### 8a. Root cause

`backend/scripts/bootstrap-platform-owner.mjs` called
`MySqlPlatformAdminAuthRepository.createAccount` and
`MySqlPlatformAdminActivationRepository.issue` as two independent
`runInTransaction` calls. A failure in the second one — proven reproducible
in §3d above — left a permanently active, permanently un-activatable
`APP_OWNER` behind, with no authenticated recovery path.

### 8b. Architectural correction

A new module, `backend/src/platformadmin/auth/MySqlFirstOwnerBootstrapRepository.ts`,
exports `createFirstOwnerBootstrap(input)`: **one** `runInTransaction` call
that persists, in order, the account, the `APP_OWNER` role assignment, the
`PENDING_SETUP` MFA state, the bootstrap audit events, the first activation
token, **and** the durable `email_outbox` row. If any step fails, everything
rolls back together.

This reuses the exact same SQL every other caller already relies on, rather
than duplicating it: `MySqlAuthRepository.createAccount`,
`MySqlPlatformAdminActivationRepository.issue`, and
`MySqlEmailOutboxRepository.insert` each now wrap a newly-extracted,
connection-scoped helper —
`insertPlatformAdminAccountOnConnection`/`issueActivationTokenOnConnection`/
`insertEmailOutboxRowOnConnection` respectively — in their own
single-operation `runInTransaction`. `createFirstOwnerBootstrap` calls the
identical three helpers inside its own, wider transaction instead of
duplicating their SQL. Ordinary (non-bootstrap) account creation, activation
reissue, and email enqueue are unchanged and still pass their own existing
tests unmodified (94/94 unit tests, 23/23 spot-checked real-MySQL tests for
platform-admin/outbox/migration-lock areas — see §9c).

One genuine bug was found and fixed while building this: the extracted
`insertEmailOutboxRowOnConnection` — like the `insert()` method it came
from — treats any `ER_DUP_ENTRY` (whether on `outbox_id`'s primary key or
`idempotency_key`'s unique constraint) as a soft `'DUPLICATE_IDEMPOTENCY_KEY'`
outcome rather than throwing (the correct behavior for `EmailService`'s
ordinary "this exact send was already durably enqueued once" dedup case).
`createFirstOwnerBootstrap` did not originally check that outcome, so a
forced outbox-insert failure in testing silently "succeeded" with no outbox
row at all — exactly the kind of partial state §1 requires never exist.
Fixed by making `createFirstOwnerBootstrap` throw (forcing a full rollback)
whenever the outbox outcome is not `'INSERTED'`; bootstrap has no
prior-attempt history to legitimately defer to, unlike `EmailService`'s
ordinary callers.

### 8c. Transaction boundary and email semantics

Per the mission's required model, the durable outbox **row** is created
inside the atomic transaction; the external provider **delivery attempt**
(`attemptDeliveryAndRecordOutcome`, the same primitive `EmailService` and
the background worker already use) happens strictly afterward, outside both
the transaction and the advisory lock:

```text
FIRST_OWNER_TRANSACTION_BOUNDARY=SINGLE_TRANSACTION (account + APP_OWNER role + PENDING_SETUP MFA + bootstrap audit + activation token + email_outbox row, all in one runInTransaction call)
ADVISORY_LOCK_HELD_THROUGH_COMMIT=YES (released in a finally{} that wraps ONLY the precondition re-check + createFirstOwnerBootstrap call -- never held across the later delivery attempt)
EXTERNAL_PROVIDER_CALL_INSIDE_TRANSACTION=NO
```

Verified directly in `bootstrap-platform-owner.mjs`'s own source (and
pinned by a new unit test,
`test/platformadmin/bootstrapPlatformOwner.test.mjs`'s *"advisory lock is
released only after the atomic bootstrap transaction resolves, never held
across the email delivery attempt"*): the lock-acquire call precedes
`createFirstOwnerBootstrap`, which precedes `releaseBootstrapLock`, which
precedes `attemptDeliveryAndRecordOutcome` — in that exact order, always.

### 8d. Failure-injection proof (mission §6)

Two independent real-`ER_DUP_ENTRY` fault injections, both against the real
disposable database, both now roll back **everything**:

```text
BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE=PASS

# Fault injected at the activation-token insert (the EXACT step that
# stranded a first owner before this fix):
ACCOUNT_DELTA=0
APP_OWNER_ROLE_DELTA=0
MFA_DELTA=0
ACTIVATION_DELTA=0
OUTBOX_DELTA=0
AUDIT_DELTA=0

# Fault injected at the outbox-row insert (the NEW bug found and fixed in
# §8b -- previously would have left account/role/MFA/activation-token
# committed with no outbox row):
ACCOUNT_DELTA=0
APP_OWNER_ROLE_DELTA=0
MFA_DELTA=0
ACTIVATION_DELTA=0
AUDIT_DELTA=0
```

### 8e. Post-commit provider-failure proof (mission §7)

A real, successful `createFirstOwnerBootstrap` commit, followed by a
genuine `RejectingEmailProviderAdapter` delivery failure (no real
Mailgun/SMTP call — an adapter that always throws
`EmailDeliveryError(..., retryable=true, ...)`), proves the owner is not
invalidated:

```text
APP_OWNER_EXISTS=YES
MFA_STATUS=PENDING_SETUP
ACTIVATION_TOKEN_EXISTS=YES
OUTBOX_MESSAGE_EXISTS=YES
OUTBOX_RETRYABLE=YES
POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE=PASS
```

A second bootstrap attempt for a different email, run immediately after,
was correctly refused (`assertNoExistingAppOwner`) — no second `APP_OWNER`
becomes possible while this one exists, delivery-failed or not.

### 8f. Concurrency re-proof, strengthened to independent OS processes

The mission asked, "if practical," to strengthen the concurrency proof
beyond same-process/separate-connections. It was practical: the test now
launches **two genuinely independent `node scripts/bootstrap-platform-owner.mjs`
subprocesses** (via `child_process.execFile`, not two calls inside one
Node process) racing for the real advisory lock against the same disposable
database:

```text
CONCURRENCY_EXECUTION_MODEL=INDEPENDENT_NODE_SUBPROCESSES
STARTING_ACTIVE_APP_OWNER_COUNT=0
CONCURRENT_ATTEMPTS=2
SUCCESSFUL_BOOTSTRAPS=1
FINAL_ACTIVE_APP_OWNER_COUNT=1
FINAL_ACTIVE_APP_OWNER_ROLE_COUNT=1
LOSER_PARTIAL_STATE_ROWS=0
DB_CONCURRENT_SINGLE_WINNER=PASS
```

### 8g. Full regression

`backend/test/db/platformAdminBootstrap.mysql.test.mjs` now has 10 tests
(previously 8), all passing, both standalone (`npm run test:db:bootstrap`,
which resets the disposable DB first) and — see §8h — interleaved inside
the full shared `test:db` suite:

```text
DB_CONCURRENCY_TEST=PASS
LOCK_FAILURE_FAIL_CLOSED=PASS
BOOTSTRAP_CREATION_ROLLBACK=PASS
BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE=PASS (both injection points)
POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE=PASS
FIRST_OWNER_END_TO_END_ACTIVATION=PASS
  PRE_ACTIVATION_LOGIN=DENIED
  MFA_STATUS=ACTIVE
  PASSWORD_FORMAT=SCRYPT
  POST_ACTIVATION_LOGIN=PASS
  TOKEN_REUSE=DENIED
  TOTP_REPLAY=DENIED
ACTIVATION_REISSUE=PASS
  OLD_TOKEN_INVALIDATION=PASS
  OLD_TOTP_INVALIDATION=PASS
EXISTING_PLATFORM_ADMIN_UNCHANGED=PASS
  SILENT_ROLE_ELEVATION=NO
BOOTSTRAP_OUTPUT_HYGIENE=PASS
```

Also re-run and passing:

```text
BACKEND_TYPECHECK=PASS (npm run build / tsc, zero errors)
BOOTSTRAP_DIRECT_TESTS=PASS (test/platformadmin/bootstrapPlatformOwner.test.mjs, 6/6 -- rewritten this session to check the new atomic-transaction structure directly, since the old assertions checked the now-removed two-transaction shape)
ACTIVATION_TESTS=PASS, AUTH_TESTS=PASS (test/platformadmin/{activation,authService,accountService,crossRealm,totp,fastifyPlatformAdminAuthPlugin,rbacPolicy}.test.mjs -- 94/94 unit tests)
```

### 8h. CI wiring (mission §11)

`.github/workflows/quality-gates.yml` gained a new job,
`backend-bootstrap-certification`, running `npm run test:db:bootstrap`
against a GitHub Actions MySQL **service container** (image `mysql:8.4.11`,
the SAME hardcoded, explicitly-non-secret `pca_test_only_not_a_secret`
credential the repository's own root `docker-compose.yml` already uses for
local development, host port `33061` matching `backend/test.db.env`
exactly — no GitHub Secret, no change to the workflow's
`permissions: contents: read` posture, and no existing job weakened or
removed). The full ~550-test `test:db` suite remains deliberately NOT
wired into CI (a separate, larger, still-open, explicitly documented gap in
`backend-tests`' own comment) — only this mission's focused certification
is.

This was validated locally (YAML parses; the exact command
`npm run test:db:bootstrap` passes; the service-container config mirrors
the repository's own already-working `docker-compose.yml` MySQL service
field-for-field), but this session has no way to trigger or observe an
actual GitHub Actions run, so:

```text
CI_BOOTSTRAP_CERTIFICATION=WIRED_NOT_YET_OBSERVED
```

It will run automatically on the push this session makes to `pca-dev` (the
workflow triggers on `push: branches: [pca-dev]`); a human or a future
session should confirm the run went green.

### 8i. Full shared `test:db` suite coexistence (extra verification)

`test/meta/testSuiteRegistration.test.mjs` (a pre-existing anti-orphan gate)
requires every `test/db/*.test.mjs` file to be listed in package.json's
shared `test:db` script — which runs ~60 files sequentially against ONE
database with **no reset between files**. Several of those files (e.g.
`test/db/platformadmin.mysql.test.mjs`) create their own `APP_OWNER`
fixtures and never revoke them, which would break this file's zero-owner
preconditions if it merely *asserted* zero. Fixed by having every
zero-owner-dependent test call a `forceZeroActiveAppOwners()` helper
(revoke any pre-existing owner, then proceed) instead of asserting and
failing.

`backend/test/db/platformAdminBootstrap.mysql.test.mjs` was added to the
`test:db` script's file list, and the full suite was run once, fresh, to
confirm real coexistence:

```text
npm run test:db: 546 tests, 542 pass, 0 fail, 4 skipped (pre-existing, unrelated skips), duration ~141s
```

All 10 of this file's own tests passed within that run, interleaved
immediately after `platformadmin.mysql.test.mjs`'s own APP_OWNER-creating
tests — proving the design works, not just asserting it.

### 8j. Unrelated finding disclosed, not fixed (out of this mission's scope)

Running the full non-DB `npm test` suite (2364 tests; not itself required
by this mission, run as extra diligence) surfaced a **pre-existing, unrelated**
schema-drift defect: `backend/src/db/schema.ts`'s hand-maintained,
privacy-classified `PCA_CANONICAL_SCHEMA` array — a **separate** source of
truth from the migrations themselves, used to generate
`docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql`/`_VERIFY.sql`
— is missing the `platform_admin_activation_tokens` table entirely, the
same class of "migration 0041 added a table, a hand-maintained fingerprint
elsewhere was never updated" drift as the `verify-mysql.mjs` bug fixed in
§2, just in a different file. This causes
`test/scripts/disposableBootstrapArtifact.test.mjs` to fail (2 of 2364
`npm test` tests).

This predates both certification sessions (migration 0041 already existed
at the required starting SHA) and is unrelated to the atomic-bootstrap fix.
It was **not** fixed here: `PCA_CANONICAL_SCHEMA` requires a deliberate
per-column privacy classification judgment call (each column is annotated
`privacy: "..."`), which is a distinct, separately-scoped task, not
something to rush under this mission's time budget. Flagged here so it is
not silently lost.

```text
NPM_TEST_UNRELATED_FINDING=schema.ts PCA_CANONICAL_SCHEMA missing platform_admin_activation_tokens (migration 0041); causes test/scripts/disposableBootstrapArtifact.test.mjs to fail; pre-existing, not caused by this session, not fixed here, recommend a dedicated follow-up.
```

## 9. Final decision (supersedes §6)

```text
LOCAL_HEAD=<see final report in the session transcript for the exact post-commit SHA>
REMOTE_HEAD=<same, independently verified via git ls-remote after push>
WORKTREE_CLEAN=YES

FIRST_OWNER_TRANSACTION_BOUNDARY=SINGLE_TRANSACTION
ADVISORY_LOCK_HELD_THROUGH_COMMIT=YES
EXTERNAL_PROVIDER_CALL_INSIDE_TRANSACTION=NO

BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE=PASS
ACCOUNT_DELTA_ON_FAILURE=0
ROLE_DELTA_ON_FAILURE=0
MFA_DELTA_ON_FAILURE=0
ACTIVATION_DELTA_ON_FAILURE=0
OUTBOX_DELTA_ON_FAILURE=0
AUDIT_DELTA_ON_FAILURE=0

POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE=PASS
OUTBOX_RETRYABLE=YES

DB_CONCURRENCY_TEST=PASS
CONCURRENCY_EXECUTION_MODEL=INDEPENDENT_NODE_SUBPROCESSES
CONCURRENT_SINGLE_WINNER=PASS

PRE_ACTIVATION_LOGIN=DENIED
POST_ACTIVATION_LOGIN=PASS
TOKEN_REUSE=DENIED
TOTP_REPLAY=DENIED
ACTIVATION_REISSUE=PASS
OLD_TOKEN_INVALIDATION=PASS
OLD_TOTP_INVALIDATION=PASS

EXISTING_PLATFORM_ADMIN_UNCHANGED=PASS
BOOTSTRAP_OUTPUT_HYGIENE=PASS

BACKEND_TYPECHECK=PASS
BOOTSTRAP_DIRECT_TESTS=PASS
DB_BOOTSTRAP_TESTS=PASS
ACTIVATION_TESTS=PASS
AUTH_TESTS=PASS
CI_BOOTSTRAP_CERTIFICATION=WIRED_NOT_YET_OBSERVED
CI_STATUS=NO_STATUS_CHECK_EVIDENCE_FOR_FULL_test:db_SUITE_STILL (backend-tests already runs the full non-DB suite; the NEW backend-bootstrap-certification job now runs the focused DB suite -- see §8h)

CURRENT_TABLE_COUNT=79
ACTIVATION_TOKEN_TABLE_PRESENT=YES

SCHEMA_CHANGED=NO
MIGRATION_ADDED=NO

FIRST_OWNER_STRANDING_RISK=CLOSED

PRODUCTION_CHANGED=NO
DEPLOYED=NO
BOOTSTRAP_EXECUTION_AUTHORIZED=NO

BLOCKERS=None specific to first-owner bootstrap atomicity (closed). The standing owner-authorization gate (PCA_SESSION_2C_LIVE_ACCEPTANCE_2026-09-15.md) is unaffected and still applies -- this session did not and could not authorize a production bootstrap. §8j's unrelated schema.ts drift remains open (non-blocking, disclosed). §8h's CI job has not yet been observed passing in a real GitHub Actions run.
NEXT_ACTION=Confirm the new backend-bootstrap-certification CI job goes green on this push; separately schedule the §8j schema.ts/PCA_CANONICAL_SCHEMA reconciliation as its own task.
```

## 10. Source changes made in this follow-up session

- `backend/src/platformadmin/auth/MySqlFirstOwnerBootstrapRepository.ts` —
  **new**: the single atomic transaction boundary (§8b).
- `backend/src/platformadmin/auth/MySqlAuthRepository.ts` — extracted
  `insertPlatformAdminAccountOnConnection` (connection-scoped); `createAccount`
  now wraps it in `runInTransaction`, unchanged behavior.
- `backend/src/platformadmin/auth/MySqlPlatformAdminActivationRepository.ts` —
  extracted `issueActivationTokenOnConnection` (connection-scoped); `issue`
  now wraps it, unchanged behavior.
- `backend/src/email/MySqlEmailOutboxRepository.ts` — extracted
  `insertEmailOutboxRowOnConnection` (connection-scoped); `insert` now wraps
  it, unchanged behavior.
- `backend/src/email/EmailService.ts` — exported the previously-private
  `OUTBOX_MESSAGE_TTL_MS` constant so the bootstrap script reuses the same
  value instead of a second copy.
- `backend/scripts/bootstrap-platform-owner.mjs` — rewritten to call
  `createFirstOwnerBootstrap` once, then attempt delivery afterward, outside
  the lock and the transaction (§8c).
- `backend/test/db/platformAdminBootstrap.mysql.test.mjs` — rewritten:
  concurrency strengthened to real subprocesses; two new tests
  (`BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE` ×2, `POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE`);
  zero-owner preconditions made order-independent (`forceZeroActiveAppOwners`);
  registered in the shared `test:db` script.
- `backend/test/platformadmin/bootstrapPlatformOwner.test.mjs` — rewritten to
  check the new atomic-transaction source shape; also newly registered in
  `backend/scripts/run-tests.mjs` (it was an orphan — never run by `npm test`
  — before this session, unrelated to the atomicity fix but found and fixed
  while touching this file).
- `backend/package.json` — `platformAdminBootstrap.mysql.test.mjs` added to
  the shared `test:db` script's file list (required by the pre-existing
  anti-orphan gate, §8i).
- `.github/workflows/quality-gates.yml` — new `backend-bootstrap-certification`
  job (§8h).

No production, database, or deployment target was touched. No migration was
added; the schema is unchanged (`CURRENT_TABLE_COUNT=79`, same as the first
session).
