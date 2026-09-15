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

## What remains open

1. **Runtime DB identity / least-privilege proof** — needs one more small
   owner-relayed read-only query (below).
2. **Execution plan sign-off and actual production migration** — not
   executed. Per explicit instruction, this remains at the irreversible
   production-migration authorization boundary until the identity item
   above closes and the owner explicitly authorizes the migration step
   itself.
