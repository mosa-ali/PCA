# PCA production migration 0041/0042 reconciliation (2026-09-16)

Owner-relayed production SQL (`pca_pro`, MySQL 8.4.9-azure) confirmed
production is at migration `0040` (38 applied migrations) and lacks `0041`
(`platform_admin_activation_tokens`) and `0042`
(`parent_login_step_up_codes` + `parent_accounts.first_login_completed_at`).
This closes the reconciliation and safety-proof work requested before any
production migration execution. **No production database was touched.**
Evidence class: `SOURCE` + `DISPOSABLE_MYSQL` throughout; the one item that
cannot be closed without further owner action is marked as such.

## 1. Migration-file/numbering reconciliation

`backend/migrations/` contains exactly 40 `.sql` files, numbered `0001`
through `0042` — `0009` and `0010` were never used (confirmed via `git log
--diff-filter=A` across the repo's full history: no file at either number
was ever added and later removed; this is original numbering, not a gap
introduced by this work). This fully explains the owner-observed
"`MIGRATION_COUNT=38`, `LATEST_MIGRATION=0040`" alongside a 42-numbered
latest filename: 40 real files minus the 2 not-yet-applied (`0041`, `0042`)
= 38 applied, and nothing exists between production's `0040` and the
repository's `HEAD` other than those exact two files. `MIGRATION_0022=APPLIED`
matches the repository (`0022_enrollment_administration_persistence.sql`
exists and is unconditionally required by nothing after it that's missing).

```
REPOSITORY_MIGRATION_FILE_COUNT = 40
PRODUCTION_APPLIED_COUNT        = 38
GAP                             = exactly {0041, 0042}, nothing else
NUMBERING_GAP_0009_0010         = ORIGINAL (never-used numbers, not deleted files)
```

## 2. What 0041 and 0042 do, and their dependencies

- `0041_platform_admin_activation_tokens.sql`: one `CREATE TABLE`, pure
  additive, FK to `platform_admin_accounts` (already exists since `0005`).
  No dependency on anything past `0040`.
- `0042_parent_login_step_up_codes.sql`: one `CREATE TABLE` (FK to
  `parent_accounts`, already exists since `0013`) plus one `ALTER TABLE
  parent_accounts ADD COLUMN first_login_completed_at DATETIME(3) NULL AFTER
  verified_at`. No dependency on anything past `0040`.

Neither migration depends on the other, and neither depends on any
migration between production's `0040` and repository `HEAD` other than
themselves — confirmed there is no such migration (§1).

## 3. Forward-migration proof against a production-shaped disposable database

Built a fresh disposable MySQL 8.4 database from **exactly** the first 38
migration files (`0001`–`0040`, `0041`/`0042` excluded) — the same file set,
in the same order, production is actually at. Seeded it with representative
pre-existing data mirroring the owner-reported production state: one
`ACTIVE` `platform_admin_accounts` row with an active `PLATFORM_ADMIN` role
and `MFA_STATE.status = 'PENDING_SETUP'` (matching `mdrwesh@outlook.com`'s
reported state exactly), and one `VERIFIED` `parent_accounts` row (standing
in for any pre-existing real parent user). Then ran the real migration
runner logic against `0041` and `0042`.

```
FORWARD_MIGRATION_SUCCESS        = PASS (both migrations applied cleanly, no error)
EXISTING_ADMIN_ROW_PRESERVED     = PASS (still ACTIVE, still PLATFORM_ADMIN, still 1 row)
EXISTING_PARENT_ROW_PRESERVED    = PASS (still VERIFIED, still 1 row)
PLATFORM_ADMIN_ACTIVATION_TOKENS_TABLE_PRESENT = PASS
PARENT_LOGIN_STEP_UP_CODES_TABLE_PRESENT       = PASS
PARENT_ACCOUNTS.FIRST_LOGIN_COMPLETED_AT_PRESENT = PASS
MIGRATION_JOURNAL_CORRECTNESS    = PASS (schema_migrations: 40 rows, latest = 0042_parent_login_step_up_codes.sql, both 0041/0042 present)
IDEMPOTENCY                      = PASS (re-running the migration runner immediately afterward applies 0 migrations, reports success, no error)
SCHEMA_FINGERPRINT_AFTER_MIGRATION = sha256:638155c4f808cd673d31464ef881c42e68b7e493498324d8a1f8b20b9f48f3b1
  (EXACT_MATCH to the already-certified canonical fingerprint in
  backend/scripts/post-validate.mjs and docs/database/PCA_CANONICAL_SCHEMA_REPORT.md
  §21 -- i.e. migrating forward from a real production-shaped, non-empty
  starting point reaches the byte-identical schema shape already proven
  against the full disposable-MySQL test suite. This is direct evidence of
  application compatibility: the passing test suite already runs against
  this exact schema shape.)
```

## 4. A genuine finding: partial-failure recovery gap in migration `0042`

`backend/scripts/migrate.mjs`'s own header already documents that MySQL DDL
auto-commits per statement and a migration file is not rolled back as a
unit on partial failure. `0042` is the one migration in this reconciliation
with **two** DDL statements (`CREATE TABLE` then `ALTER TABLE`). Empirically
reproduced the failure mode: manually created just
`parent_login_step_up_codes` (simulating the `CREATE TABLE` succeeding and
the `ALTER TABLE` failing or the process being killed in between, before
`schema_migrations` is updated), then ran the real migration runner logic
again:

```
RETRY_RESULT = FAIL: ER_TABLE_EXISTS_ERROR -- "Table 'parent_login_step_up_codes' already exists"
```

The runner does not treat this as "already applied" (no `schema_migrations`
row exists yet for `0042`), so it re-attempts the whole file and immediately
fails on the `CREATE TABLE` clause, before ever reaching the `ALTER TABLE`.
This is a genuine, previously-undocumented operational gap — low severity
(this exact interruption window, between two DDL statements in one
migration file, is narrow, and `0041`/`0040` and every other prior migration
in this repository apparently already followed a one-DDL-statement-per-file
discipline that avoids this class entirely) but real. **Manual recovery
procedure if this is ever observed in production**: connect with a
privileged (migration) credential, run only the remaining `ALTER TABLE
parent_accounts ADD COLUMN first_login_completed_at DATETIME(3) NULL AFTER
verified_at;` statement, then `INSERT INTO schema_migrations (version) VALUES
('0042_parent_login_step_up_codes.sql');`, then re-run the normal migration
command to confirm `Database already up to date.`

## 5. Privilege architecture (item 4): already supports a separate migration identity

`backend/scripts/migrate.mjs` already reads `PCA_MIGRATION_DATABASE_URL`
first, falling back to `PCA_DATABASE_URL` only if unset — this is existing,
already-implemented design, not something built for this reconciliation.
Production's App Service settings (read-only, names-only, confirmed via
Azure ARM in a prior session and re-confirmed this session) do **not**
currently include a `PCA_MIGRATION_DATABASE_URL` setting — meaning, as
configured today, running `migrate.mjs` against production would fall back
to whatever `PCA_DATABASE_URL` resolves to.

```
SEPARATE_MIGRATION_IDENTITY_MECHANISM = ALREADY_IMPLEMENTED (migrate.mjs, PCA_MIGRATION_DATABASE_URL)
SEPARATE_MIGRATION_IDENTITY_CONFIGURED_IN_PRODUCTION = NO (no such App Setting exists today)
```

`backend/scripts/db/runtimeGrantPlan.mjs` defines the exact intended
least-privilege runtime grant shape: table-level only, `SELECT,INSERT` on
`platform_admin_audit_events`, `SELECT`-only on `schema_migrations`,
ordinary DML on every other table, **never** `CREATE`/`ALTER`/`DROP`/`GRANT
OPTION`/a database-level `db.*` grant. This is the signature to check the
live runtime identity against.

## 6. Actual production runtime DB identity — NOT YET independently proven

Per the owner's own correct caution, `mmali@%`'s broad grants (`CREATE`,
`DROP`, `CREATE USER`, `ROLE_ADMIN`, replication privileges, `WITH GRANT
OPTION`) are the owner's own interactive SQL session identity, not
necessarily what the running `pca` App Service authenticates as via its
Key-Vault-resolved `PCA_DATABASE_URL`. This cannot be determined from
outside the database (no production DB credentials are available to this
session), nor safely inferred from Azure App Service configuration alone
(the Key Vault secret value must never be read). It requires exactly one
more small, safe, read-only owner-relayed query — provided below — that
reveals only MySQL usernames/hosts and grant shapes (no passwords, no
connection strings), which is the same class of information already safely
shared for `mmali@%` this session.

```
ACTUAL_RUNTIME_DB_IDENTITY = UNVERIFIED (owner SQL below closes this)
DB_LEAST_PRIVILEGE (application runtime) = UNVERIFIED (same gate)
```

## 7. Rollback/recovery strategy

This repository has no per-migration `DOWN` scripts by design (confirmed:
`migrate.mjs`'s header, and no rollback tooling exists anywhere in
`backend/scripts/`). The established convention (`database/live-bootstrap/
OWNER_RUNBOOK.md`) is backup/snapshot-before, restore-from-snapshot if
needed — i.e., the recovery unit is the whole database snapshot, not a
per-migration reverse script. Both `0041` and `0042` are purely additive
(new table, new nullable column) — there is no existing data these
migrations could corrupt or make unreadable, and no application code path
reads the new table/column until the corresponding feature (activation
tokens, login step-up) is actually exercised, so even an incomplete/aborted
migration attempt (beyond the one narrow gap in §4) leaves the
already-running application fully functional throughout.

## 8. Privacy invariants

Not independently re-scanned against a live database this session (the
disposable database used in §3 was reused for a partial-failure
reproduction and torn down before a live TLS-gated privacy pass could run
against it cleanly) — but the schema-fingerprint `EXACT_MATCH` in §3 is
sufficient: it proves the resulting schema is byte-identical, table for
table and column for column, to the one already certified `PASS` by
`backend/test/canonicalSchemaChildFieldsRegression.test.mjs` in
`docs/database/PCA_CANONICAL_SCHEMA_REPORT.md` §21. No new column was
introduced by this reconciliation that wasn't already covered by that
certification.

## 9. Activation lifecycle / parent email-OTP step-up lifecycle

Not re-run this session as fresh evidence — deliberately, per the mission's
own "do not repeat already-passed tests unless migration changes materially
affect them" instruction. The schema-fingerprint `EXACT_MATCH` in §3 is the
justification: `backend/test/db/platformAdminBootstrap.mysql.test.mjs`
(10/10), `platformAdminFirstOwnerPromotion.mysql.test.mjs` (8/8), and
`parentLoginStepUp.mysql.test.mjs` (8/8) already certified these lifecycles
against this exact schema shape (same fingerprint) in the prior turn of this
mission. Migrating forward from a real production-shaped starting point
changes nothing about that schema shape, so those results still apply
unchanged.

## 10. Addendum (2026-09-16, continued): runtime identity proof, fail-closed migration identity, 0042 hardening, execution runbook

### 10.1 Runtime DB identity — positive attribution method

The owner correctly rejected inferring identity from a broad `mysql.user`
enumeration (proves account existence, not which one the app actually
uses). Checked both preferred alternatives before falling back to a new
mechanism:

- **A. Prior authoritative capture**: none exists —
  `PCA_SESSION_2D_SCHEMA_DB_PREBOOTSTRAP_CERTIFICATION_2026-09-15.md` §G–J
  itself already records `DB_RUNTIME_ACCOUNT=UNVERIFIED`.
- **B. Azure/App Service/Key-Vault metadata, without resolving
  `PCA_DATABASE_URL`**: checked whether `pca-mysql`'s connection/audit logs
  are shipped anywhere queryable — confirmed, via the ARM diagnostic-settings
  API (`GET .../flexibleServers/pca-mysql/providers/microsoft.insights/diagnosticSettings`),
  that **zero** diagnostic settings exist (`{"value": []}`). No connection
  audit trail exists to attribute the runtime identity from outside the
  database. Also checked whether the `pca` App Service (Linux,
  `sitecontainers`/custom-container, Basic tier) supports the Kudu SSH
  console, which would let the owner run one query using the container's
  own already-resolved credential without ever displaying it — confirmed,
  by reading `backend/Dockerfile`, that no SSH server is configured in the
  image, so that path does not exist today either (adding one would itself
  be a new permanent piece of attack surface, worse than the alternative
  below).
- **C. Minimum authenticated, sanitized runtime proof** — built, since A
  and B are both genuinely unavailable. `src/http/routes/platformadmin/
  tempRuntimeIdentityDiagnostic.ts` (new): a route that queries the app's
  own already-configured pool (`getPool()` — identical TLS posture,
  identical credential, identical everything a real request uses) for
  `CURRENT_USER()`/`DATABASE()`/`VERSION()`/`Ssl_version`/`Ssl_cipher`
  only, returns exactly those five fields and nothing else. Deliberately
  **not** Platform-Admin-session-gated (no admin can complete
  activation/MFA and log in yet — that's the very thing this
  reconciliation is unblocking), so it is gated instead by a dedicated
  bearer token read from `PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN`,
  absent by default in every environment including production today — the
  route does not exist at all unless the token is explicitly configured. A
  missing/wrong token 404s (never 401), so it cannot even be distinguished
  from "route removed." Rate-limited (5/hour) in its own bucket.
  Certified: `test/http/tempRuntimeIdentityDiagnostic.test.mjs` (3/3 —
  absent by default, wrong-token 404, no-token 404, all without touching
  the database) and `test/db/tempRuntimeIdentityDiagnostic.mysql.test.mjs`
  (1/1 — correct token returns exactly the five sanctioned fields, and the
  response body is scanned to confirm it never contains `DATABASE_URL`,
  `password`, `PASSWORD`, or a `mysql://` connection string).

  **This route is not deployed.** It ships in source only, ready to be
  included in the already-required clean backend deployment (§10.5 below),
  used exactly once immediately after that deploy to capture the identity,
  and removed in the very next deploy with a 404 proof — never left running
  as a permanent diagnostic.

Once the identity is known, Task 2's grant classification needs nothing new
from this session: the owner's own already-authorized admin SQL session can
simply run `SHOW GRANTS FOR '<returned user>'@'<returned host>';` directly
and compare it against `backend/scripts/db/runtimeGrantPlan.mjs`'s
documented shape (table-level `SELECT,INSERT,UPDATE,DELETE` on ordinary
tables, `SELECT,INSERT`-only on `platform_admin_audit_events`,
`SELECT`-only on `schema_migrations`, **never** `CREATE`/`ALTER`/`DROP`/
`GRANT OPTION`/a database-level grant).

### 10.2 Migration identity now fails closed (Task 3 — implemented and tested)

`backend/scripts/migrate.mjs` previously fell back from
`PCA_MIGRATION_DATABASE_URL` to `PCA_DATABASE_URL` unconditionally. Now
uses the same `isProductionSensitiveRuntime` authority every other
production-sensitive gate in this codebase already uses (`src/db/pool.ts`'s
`PCA_DATABASE_TLS` gate is the direct precedent) — a production-sensitive
runtime (`NODE_ENV` not exactly `"test"` or `"development"`) with no
`PCA_MIGRATION_DATABASE_URL` set now refuses to start, before ever
attempting a connection. Local/dev/CI workflows that only set
`PCA_DATABASE_URL` are completely unaffected (verified: `NODE_ENV=test`/
`development` still fall back exactly as before).

Certified via real subprocess execution of the actual script (not a
reimplementation) in `test/tooling/migrationIdentityFailClosed.test.mjs`
(5/5): production-sensitive + no dedicated URL → refuses with the exact
identity-gate error, before any connection attempt; production-sensitive +
dedicated URL set → proceeds past the gate (fails only on the deliberately
unreachable connection, proving the gate didn't fire); test/development →
unchanged fallback behavior.

**Practical consequence for production**: since no
`PCA_MIGRATION_DATABASE_URL` App Setting exists on `pca` today (confirmed,
Azure ARM, names-only), migration `0041`/`0042` execution will now refuse
to run at all until the owner explicitly provisions one — this is the
intended effect, not a bug. See §10.5's runbook for exactly when to do
that.

### 10.3 Migration 0042 hardened to be safely resumable (Task 4 — implemented and re-proven)

Migration `0042` is not yet applied anywhere in production, so it was
edited directly (no already-applied production migration was touched).
Both its DDL statements are now safely re-runnable:

- `CREATE TABLE parent_login_step_up_codes` → `CREATE TABLE IF NOT EXISTS
  parent_login_step_up_codes` (standard MySQL syntax).
- The `ALTER TABLE parent_accounts ADD COLUMN first_login_completed_at`
  step → MySQL has **no** `ADD COLUMN IF NOT EXISTS` (confirmed by testing:
  that's a MariaDB-only extension; MySQL 8.4 raises `ER_PARSE_ERROR` on it).
  Replaced with the standard MySQL conditional-DDL idiom: check
  `information_schema.columns` for the column, build the `ALTER TABLE`
  text only if it's genuinely absent (otherwise an inert `SELECT 1`), then
  `PREPARE`/`EXECUTE`/`DEALLOCATE PREPARE` it.

Re-ran the exact same empirical proofs as §3/§4 against fresh disposable
databases with the hardened file:

```
FRESH_EXECUTION                    = PASS (verify-mysql.mjs, 40 migrations, clean)
PARTIAL_FAILURE_INJECTION_RETRY    = PASS (manually created just the table, simulating the exact interruption window from §4; a resumed run now completes cleanly instead of ER_TABLE_EXISTS_ERROR)
POST_RESUME_STATE_CORRECT          = PASS (column present, exactly 1 schema_migrations row for 0042)
IDEMPOTENCY_OF_HARDENED_FILE       = PASS (re-running an already-fully-applied database still applies 0 migrations)
SCHEMA_FINGERPRINT_UNCHANGED       = PASS (sha256:638155c4... -- identical to before hardening; this was a purely operational fix, not a schema change)
```

Also re-ran `test:db:bootstrap` (10/10), `test:db:promotion` (8/8),
`parentLoginStepUp.mysql.test.mjs` (8/8), and the full `test:db` suite
(558/558, 4 pre-existing skips, 0 failures) against the hardened migration
— no regression.

### 10.4 Non-DB test suite

`npm test`: 2364 (pre-cbfe77a) → 2369 (after `migrationIdentityFailClosed.test.mjs`'s
5 new cases) → **2372/2372** (after `tempRuntimeIdentityDiagnostic.test.mjs`'s
3 non-DB cases). Registered in `scripts/run-tests.mjs`'s explicit list (this repo's anti-orphan gate would
otherwise flag them as unregistered).

### 10.5 Production execution runbook

```
PRECHECK
  - Confirm MIGRATION_0041/0042 still NOT_APPLIED (re-run the owner SQL's
    migration_0041_present/migration_0042_present checks).
  - Confirm MFA_KEY_GATE=PASS still holds (already certified; re-check only
    if any Key Vault/App Service config changed since).
  - Confirm CI green on the commit being deployed.

RECOVERY/BACKUP CHECKPOINT
  - Take a verified backup/snapshot of pca-mysql RIGHT BEFORE this window
    (per database/live-bootstrap/OWNER_RUNBOOK.md's own established
    convention -- this repo has no per-migration rollback scripts by
    design; the recovery unit is the whole-database snapshot).
  - Record the snapshot ID/timestamp in this document's evidence trail.

MIGRATION IDENTITY VERIFICATION
  - Provision PCA_MIGRATION_DATABASE_URL as a NEW App Setting on `pca`,
    Key-Vault-referenced exactly like PCA_DATABASE_URL/PCA_SMTP_PASSWORD
    (same proven pattern), pointing at a credential with ONLY
    CREATE/ALTER/DROP/REFERENCES/INDEX/INSERT on pca_pro -- never
    SUPER/GRANT OPTION/CREATE USER. This is a NEW, separate credential from
    the runtime one; do not reuse the runtime identity for this.
  - Because of §10.2, migrate.mjs will now refuse to run at all in
    production without this -- treat that refusal as confirmation the
    identity gate is working if it fires before this step is done.

0041
  - Run `node scripts/migrate.mjs` with PCA_MIGRATION_DATABASE_URL set,
    scoped to apply through 0041 conceptually (the script applies all
    pending files in order -- 0041 will apply before 0042 in the same run
    unless deliberately split; running them in one invocation is fine and
    was exactly what was proven in §3/§10.3, since 0041 has no partial-
    failure risk of its own -- single DDL statement).

VERIFY 0041
  - Re-run the owner SQL's platform_admin_activation_tokens presence check.

0042
  - Already applies in the same invocation as 0041 unless split
    deliberately. If split, run migrate.mjs again -- idempotent either way
    per §10.3.

VERIFY 0042
  - Re-run the owner SQL's parent_login_step_up_codes /
    first_login_completed_at presence checks.

MIGRATION JOURNAL VERIFICATION
  - schema_migrations: migration_count=40, latest=0042_parent_login_step_up_codes.sql.

CANONICAL SCHEMA RECONCILIATION
  - Full owner SQL block (table/column/PK/FK/index/check-constraint counts)
    must match this document's §3 disposable-MySQL baseline exactly:
    table_count=80, column_count=662, primary_key_count=80,
    foreign_key_count=85, unique_non_pk_index_count=33,
    non_unique_index_count=121, check_constraint_count=236.

BACKEND CLEAN-IMAGE BUILD/DEPLOY
  - Build from the exact commit that includes this reconciliation.
  - If runtime-identity evidence (§10.1) has not yet been captured,
    INCLUDE the temporary diagnostic route in this build (set
    PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN as a one-time App Setting
    for this deploy only) and capture the evidence immediately after
    deploying, before proceeding further in this runbook.
  - Deploy to `pca` only. Never touch `pcaSafe`.

REMOVE TEMPORARY DIAGNOSTIC ROUTE (if it was used this cycle)
  - Unset PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN, and in the very next
    deploy, remove tempRuntimeIdentityDiagnostic.ts and its buildServer.ts
    wiring from source entirely.
  - PROVE 404: GET /platform-admin/internal/temp-runtime-identity returns
    404 with no token header, confirming the route is genuinely gone (not
    merely token-gated).

HEALTH CHECKS
  - GET /health = 200
  - GET /health/db = 200
  - GET /health/email = 200
  - GET (the OLD, already-removed-from-source) /platform-admin/internal/db-runtime-diagnostic = 404
    (re-confirms the SESSION 2D finding that source removal has actually
    reached the deployed image).

PARENT EMAIL-OTP COMPATIBILITY CHECK
  - One real registration + verification + first login through the actual
    deployed API, confirming STEP_UP_REQUIRED fires exactly once and
    completes normally (mirrors parentLoginStepUp.mysql.test.mjs's own
    proven flow, now against the real deployment).

PLATFORM ADMIN ACTIVATION COMPATIBILITY CHECK
  - Confirm platform_admin_activation_tokens is reachable by the runtime
    identity (SELECT/INSERT only, per runtimeGrantPlan.mjs) before
    attempting any real activation flow.

ABORT CRITERIA (any one of these stops the run immediately, before
proceeding to the next step, and triggers restore-from-snapshot if data was
already touched):
  - Any owner SQL re-verification after 0041/0042 does not match the
    expected values above.
  - migrate.mjs's identity gate fires unexpectedly (proves
    PCA_MIGRATION_DATABASE_URL misconfigured) -- STOP, do not work around it.
  - Any health check fails or returns non-200/non-404 as specified.
  - The temporary diagnostic route (if used) ever returns anything beyond
    its five sanctioned fields.
  - 0042's partial-failure state is ever observed mid-run (should not
    happen post-hardening, but if `parent_login_step_up_codes` exists
    without `first_login_completed_at`, this is the exact §4/§10.3
    scenario) -- the hardened migration is safe to simply re-run; this is
    informational, not an abort trigger, but must be logged as evidence
    the hardening was exercised for real.
  - 0042 recovery procedure (still valid even though hardened, as defense
    in depth): if a resume is ever needed with the OLD unhardened file for
    any reason, manually run the remaining ALTER TABLE statement, then
    INSERT the schema_migrations row, then re-run to confirm
    "Database already up to date."

## What remains open

1. **Runtime DB identity capture** — requires the already-planned clean
   backend deployment (§10.5); not yet executed.
2. **`PCA_MIGRATION_DATABASE_URL` provisioning** — a new, dedicated,
   owner-approved migration credential must be created and configured
   before migration execution; not yet done. Production migration cannot
   proceed without it (enforced automatically by §10.2's fail-closed gate).
3. **Actual production migration execution and clean deployment** — not
   executed. Remains at the irreversible production-mutation authorization
   boundary pending items 1–2 above and explicit owner go-ahead.
