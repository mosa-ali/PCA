# PCA disposable-database bootstrap

Two generated SQL files that create the complete current PCA schema in a
**disposable / integration** database in one paste, and then verify what landed.

| File | Purpose |
|---|---|
| `PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql` | Creates the whole schema + the migration journal |
| `PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql` | Reports counts against repository-derived expectations |

**Not for production.** Production is bootstrapped through
`database/live-bootstrap/` and its `OWNER_RUNBOOK.md`, which carry the
preflight, post-validation, backup and rollback steps these two files
deliberately do not.

## Both files are generated, never hand-written

```bash
cd backend
node scripts/generate-disposable-bootstrap.mjs          # regenerate
node scripts/generate-disposable-bootstrap.mjs --check  # fail on drift
```

The DDL comes from `generateSqlFromSchema` — the same exported generator that
produces `database/live-bootstrap/01_create_database_schema.sql` — reading
`PCA_CANONICAL_SCHEMA` from `backend/src/db/schema.ts`. The journal rows come
from the actual filenames in `backend/migrations/`. Every expected count in the
verification script is **computed** from those same sources at generation time,
never typed in.

`npm test` runs `--check`, so a schema change that does not regenerate these
files fails the build rather than leaving a stale artifact for someone to paste
into a database.

## Target

**MySQL 8.4.x exactly.** PCA does not support 8.0.x or 9.x, and the
verification script re-checks the running server version. The database's
default collation must be `utf8mb4_bin`.

## Manual execution

```sql
CREATE DATABASE `disposable` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
```

Then, against that database:

1. Run `PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql`
2. Run `PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql`

Every row of the `result` column must read `PASS`. The verification covers
tables, columns, primary keys, foreign keys, unique non-PK indexes, non-unique
indexes, CHECK constraints, the migration journal (count and first/last entry),
server version, charset/collation, and that no application data exists.

## What is and is not in the file

**In:** all 78 tables with their columns, types, nullability, defaults,
character sets and collations; primary keys; 83 foreign keys with their
referential actions; 32 unique and 119 non-unique indexes; 233 CHECK
constraints; and the 38 `schema_migrations` journal rows.

**Out:** any application or business data. The journal rows are bookkeeping —
without them a bootstrapped database looks un-migrated and the migration runner
would try to apply migration 0001 on top of an existing schema. Reference data
(currencies, commercial markets, entitlement defaults) is a separate, deliberate
step in `database/live-bootstrap/02_reference_data.sql`; the DB-backed test
suite does not need it.

## Proven equivalent to migrating

A database built from this artifact and a database built by running all 38
migrations from zero produce a **byte-identical** canonical schema fingerprint,
confirmed by two independent methods (`schema-fingerprint.mjs` and
`compare-schema-snapshots.mjs`), on real MySQL 8.4.11.
