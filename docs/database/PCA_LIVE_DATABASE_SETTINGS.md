# PCA Live Database Settings

Source of truth for every database/session setting required for the canonical
schema to behave correctly. Derived from `backend/migrations/*.sql`,
`backend/src/db/pool.ts`, `backend/compose.yaml`, and by introspecting
Database A (all 34 migrations applied from zero to a disposable MySQL 8.4
instance). No global server setting is changed beyond what is already in
`backend/compose.yaml`'s startup flags — this document only makes the
existing, already-relied-upon settings explicit and auditable.

## 1. MySQL version

**MySQL 8.4** (LTS), per `backend/compose.yaml`'s `image: mysql:8.4` (the
convention used consistently across `backend/compose*.yaml` and the root
`docker-compose.yml`). Migration 0001's own header calls this "PCA-DB-MYSQL-1:
MySQL 8.4 baseline". CHECK constraints are enforced (not just parsed) as of
MySQL 8.0.16+, which every one of the 34 migrations relies on.

MySQL 8.0.x is very likely compatible (same CHECK-constraint enforcement,
same information_schema shape) but is UNVERIFIED by this mission — Database A
and B were both built on 8.4. Pin production to 8.4 unless the owner
independently verifies 8.0.

## 2. Character set and collation

- **Server**: `--character-set-server=utf8mb4 --collation-server=utf8mb4_bin`
  (`backend/compose.yaml`).
- **Every one of the 75 tables**: `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  (verified by introspecting Database A — zero exceptions).
- **Column-level exception, by design** (migration 0001 TYPE DECISIONS): columns
  holding an application-generated UUID or a fixed-length lowercase-hex hash
  use `CHARACTER SET ascii COLLATE ascii_bin` instead — a deliberately
  narrower, byte-exact charset for values that are never non-ASCII. All other
  text columns are `utf8mb4 COLLATE utf8mb4_bin` (exact byte-for-byte
  comparison — never case- or accent-folded — matching the previous
  PostgreSQL schema's default C-collation TEXT comparison).
- **Connection**: the application (`mysql2`) does not set an explicit
  connection charset in `backend/src/db/pool.ts`; `mysql2`'s default
  (`utf8mb4`) is relied upon. The bootstrap scripts issue an explicit
  `SET NAMES utf8mb4` at the top of each session for the same reason
  documentation should never rely on an implicit driver default.

## 3. Time zone and timestamp strategy

- **Server**: `--default-time-zone=+00:00` (`backend/compose.yaml`).
- **Application pool**: `backend/src/db/pool.ts` pins `timezone: 'Z'` on every
  connection, so no query ever depends on the MySQL server's session
  timezone — this is the explicit, independent UTC guarantee (belt-and-braces
  with the server default).
- **Column type**: every temporal column is `DATETIME`, never `TIMESTAMP`.
  This is a deliberate migration-0001 decision: MySQL's `TIMESTAMP` type
  auto-converts between the session time zone and UTC on read/write, which is
  exactly the session-dependent behavior the pool's `timezone: 'Z'` pin and
  the explicit-UTC application contract are designed to avoid. `DATETIME`
  stores and returns the literal value with no implicit conversion.
- **Precision**: 146 of 149 timestamp-shaped columns are `DATETIME(3)`
  (millisecond). Three are `DATETIME(6)` (microsecond) —
  `eye_protection_settings.updated_at`, `parent_account_preferences.updated_at`,
  `safe_zones.created_at`/`safe_zones.updated_at`. This is a real, harmless
  precision inconsistency introduced by their respective migrations (0020,
  0032) rather than a defect discovered by this mission; see
  `PCA_CANONICAL_SCHEMA_REPORT.md` §Timestamp Audit for the full list and a
  recommendation to standardize on `DATETIME(3)` in a future migration. The
  canonical schema preserves the existing precision exactly, since canonical
  state must match the accepted migration history, not an idealized redesign.

## 4. Transaction isolation

**READ COMMITTED**, explicitly set per-transaction by the application
(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED` in
`backend/src/db/pool.ts`'s `runInTransaction`) — **not** InnoDB's server
default of REPEATABLE READ. This is required correctness behavior, not an
optional tuning knob: multiple repositories run an
"UPDATE guard; if zero rows affected, SELECT again to find out why" pattern
(invitation redemption, device/key revocation, challenge consumption, relay
ack, recovery CAS, release publish) that depends on the disambiguating SELECT
observing another transaction's just-committed write — which REPEATABLE READ's
fixed-at-first-read snapshot would hide. This setting lives in application
code, not in the database bootstrap; it is recorded here because a live
database created without an application pool configured identically would
silently reintroduce the concurrency bug pool.ts's own comment describes
having actually reproduced. **Do not set `tx_isolation`/
`transaction_isolation` globally to anything other than the InnoDB default
(REPEATABLE READ)** — only the application's own transactions should run at
READ COMMITTED; changing the server default would be an unrelated, broader
behavior change than what has actually been verified.

## 5. `sql_mode`

Not overridden anywhere in the codebase (`grep -ri sql_mode` across
`backend/` returns no matches). MySQL 8.4's own default `sql_mode` is relied
upon as-is, which already includes `STRICT_TRANS_TABLES` (rejects bad/
truncated data instead of silently coercing it — required for the CHECK
constraints and bounded VARCHAR lengths throughout the schema to behave as
documented) and folds in the old `NO_ZERO_DATE`/`NO_ZERO_IN_DATE` behavior.
**Do not weaken `sql_mode`** (e.g. do not remove `STRICT_TRANS_TABLES`) on the
live server — no migration or application code has ever been exercised
against a non-strict mode, so its behavior under one is unverified.

## 6. `foreign_key_checks`

Never overridden by the application or by any migration file. All 82 foreign
keys are enforced at all times during normal operation. The one-time bootstrap
script (`database/live-bootstrap/01_create_database_schema.sql`) transiently
sets `FOREIGN_KEY_CHECKS=0` only to avoid hand-solving a 75-table topological
creation order, then restores `FOREIGN_KEY_CHECKS=1` before the script ends —
this is the same technique `mysqldump` itself uses and is closed by
`03_post_validation.sql`, which independently re-queries
`information_schema.key_column_usage`/`referential_constraints` afterward and
fails if the restored FK set does not exactly match the expected 82.

## 7. Table/identifier case sensitivity

Every table and column name in all 34 migrations is lowercase snake_case with
no two identifiers differing only by case. This is deliberately resilient to
either MySQL `lower_case_table_names` mode (0 = case-sensitive, the common
Linux/production default; 1 or 2 = case-insensitive, common on Windows/macOS
dev installs) — the schema does not depend on which mode the live server
uses, but the live server's mode should still be recorded at creation time
(captured in `00_preflight.sql`) so a later environment mismatch is
detectable rather than silently changing behavior.

## 8. Connection/pool sizing

Application-side only (`backend/src/db/pool.ts`): `connectionLimit: 10`,
`waitForConnections: true`, `queueLimit: 0`, `connectTimeout: 10_000`ms,
`enableKeepAlive: true`. This bounds only a single backend process's pool.
The live MySQL instance's `max_connections` must accommodate
`10 × (number of concurrently running backend instances)` plus headroom for
the migration/provisioning credential and any operational/monitoring
connections — an operational sizing decision for the owner at deploy time,
not a schema concern; recorded here so it isn't lost.

## 9. Two-credential model

`backend/scripts/migrate.mjs` reads `PCA_MIGRATION_DATABASE_URL` (falling
back to `PCA_DATABASE_URL`) — a distinct, more-privileged
CREATE/ALTER/DROP-capable credential intended for migrations/provisioning
only, separate from the least-privilege runtime credential
(`PCA_DATABASE_URL`) the application pool (`backend/src/db/pool.ts`) uses at
runtime and never elevates. Production should set both env vars to distinct
credentials; the one-time bootstrap runbook (`OWNER_RUNBOOK.md`) assumes this
same split. `backend/scripts/provision-runtime-db-grants.mjs` and
`backend/scripts/db/runtimeGrantPlan.mjs` already encode the intended runtime
grant (in particular: the runtime credential must never hold UPDATE/DELETE on
`platform_admin_audit_events`, since append-only enforcement for that table is
grant-based, not trigger-based — MySQL 8 under binary logging refuses
`CREATE TRIGGER` to a least-privilege principal without `SUPER`, per migration
0005's own comment).

## 10. Engine

100% InnoDB across all 75 tables (verified by introspection — zero
exceptions). Required for foreign keys, transactions, and row-level locking,
all of which the application depends on.
