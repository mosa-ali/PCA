# PCA Live Database Settings

Source of truth for every database/session setting required for the canonical
schema to behave correctly. Derived from `backend/migrations/*.sql`,
`backend/src/db/pool.ts`, `backend/compose.yaml`, and by introspecting
Database A (all 38 migrations applied from zero to a disposable MySQL 8.4
instance). No global server setting is changed beyond what is already in
`backend/compose.yaml`'s startup flags — this document only makes the
existing, already-relied-upon settings explicit and auditable.

## 1. MySQL version

**MySQL 8.4** (LTS), per `backend/compose.yaml`'s `image: mysql:8.4` (the
convention used consistently across `backend/compose*.yaml` and the root
`docker-compose.yml`). Migration 0001's own header calls this "PCA-DB-MYSQL-1:
MySQL 8.4 baseline". CHECK constraints are enforced (not just parsed) as of
MySQL 8.0.16+, which every one of the 38 migrations relies on.

MySQL 8.0.x is very likely compatible (same CHECK-constraint enforcement,
same information_schema shape) but is UNVERIFIED by this mission — Database A
and B were both built on 8.4. Pin production to 8.4 unless the owner
independently verifies 8.0.

## 2. Character set and collation

- **Server**: `--character-set-server=utf8mb4 --collation-server=utf8mb4_bin`
  (`backend/compose.yaml`).
- **Every one of the 78 tables**: `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
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

Never overridden by the application or by any migration file. All 83 foreign
keys are enforced at all times during normal operation. The one-time bootstrap
script (`database/live-bootstrap/01_create_database_schema.sql`) transiently
sets `FOREIGN_KEY_CHECKS=0` only to avoid hand-solving a 75-table topological
creation order, then restores `FOREIGN_KEY_CHECKS=1` before the script ends —
this is the same technique `mysqldump` itself uses and is closed by
`03_post_validation.sql`, which independently re-queries
`information_schema.key_column_usage`/`referential_constraints` afterward and
fails if the restored FK set does not exactly match the expected 83.

## 7. Table/identifier case sensitivity

Every table and column name in all 38 migrations is lowercase snake_case with
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

100% InnoDB across all 78 tables (verified by introspection — zero
exceptions). Required for foreign keys, transactions, and row-level locking,
all of which the application depends on.

## 11. Preflight/verify hardening (DW-W1-C / FABLE-A009) — clarifying note

Appended after the original mission pass; nothing above was changed.

`database/live-bootstrap/00_preflight.sql`'s version check previously
admitted any MySQL 8.x (`>= 8`, including an unreleased 9.x) and merely
printed a non-blocking informational note for anything other than 8.4 —
contradicting its own "must be 8.x" error text (FABLE-A009). It now REQUIRES
exactly 8.4.x and fails CLOSED (SIGNAL) otherwise, and two checks were added
that previously did not exist anywhere in the bootstrap path: the TARGET
DATABASE's own default charset/collation (`information_schema.schemata`,
independent of the server-wide flags) must be utf8mb4/utf8mb4_bin, and both
`@@GLOBAL.time_zone` AND `@@SESSION.time_zone` must be `+00:00`.

On the time-zone check specifically: GLOBAL is the authoritative signal
because it is what a new connection inherits by default, and therefore what
actually governs the literal value `NOW()`/`CURRENT_TIMESTAMP()` write into
a `DEFAULT CURRENT_TIMESTAMP(3)` column. The application pool's own
`timezone: 'Z'` (section 3 above, `backend/src/db/pool.ts`) does NOT provide
this guarantee by itself — confirmed by reading `mysql2`'s own source
(`node_modules/mysql2/lib/base/connection.js`): the `timezone` option is fed
only to `SqlString.escape`/`format` for client-side JS-Date⇄SQL-literal
conversion, and `mysql2` never sends a server-side `SET time_zone` for it.
SESSION is asserted too, belt-and-braces, since that is the scope actually
in effect for the plain `mysql` client connection running the bootstrap
files themselves — demonstrated live: a `SET SESSION time_zone='+05:00'`
negative control was caught by the SESSION check alone (GLOBAL stayed
`+00:00`), which a GLOBAL-only check would have missed entirely.

`backend/scripts/verify-mysql.mjs` gained the identical three environment
assertions (checked BEFORE the 38 migrations run, so a wrong environment
fails in milliseconds rather than after a full migration run — confirmed:
pointed at a real MySQL 8.0.46 instance it fails immediately with
`Unsupported MySQL version: must be exactly 8.4.x. Found: 8.0.46`, never
reaching migration 0001), plus an AFTER-migrations column-collation spot
check: a handful of concrete ascii/ascii_bin UUID/hash-exception columns and
utf8mb4/utf8mb4_bin default columns are confirmed exactly as migration
0001's TYPE DECISIONS documents, and an aggregate
`information_schema.columns` query independently confirms no OTHER
charset/collation pair exists anywhere across the 78 tables. The pre-existing
table-set check is unchanged.

The mandatory equivalence proof (`PCA_SCHEMA_EQUIVALENCE_REPORT.md`) was
re-run after this hardening — no DDL was touched, only preflight/verify gate
logic — on real disposable MySQL 8.4.11: `compare-schema-snapshots.mjs`
still reports `EXACT_MATCH`, and `information_schema` was queried directly
(not merely trusted) on both a from-migrations database and a
from-bootstrap-files database, independently confirming MIGRATIONS=35,
TABLES=75, COLUMNS=626, FOREIGN_KEYS=83, NON_UNIQUE_INDEXES=117,
UNIQUE_NON_PK_INDEXES=31, CHECKS=228 on both — identical to the original
pass's numbers, as expected.

Negative controls confirmed fail-closed, each on a throwaway
container/schema and cleaned up immediately after, never touching the
shared instance's GLOBAL settings: wrong MySQL version (8.0.46, a real
throwaway container — MySQL 9.0 was attempted first per the mission's own
suggested command but its image pull stalled for several minutes in this
sandbox and was abandoned in favor of the mission's own listed alternative,
8.0, which is also the more direct regression check since 8.0.x is exactly
what the OLD `>= 8` check used to wrongly admit); wrong collation
(`utf8mb4_general_ci` throwaway schema); non-empty database (one throwaway
table); non-UTC (`SET SESSION time_zone='+05:00'` on a throwaway schema,
proving the SESSION check specifically, not just GLOBAL, is load-bearing).
