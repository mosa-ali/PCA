# PCA Live Database — One-Time Bootstrap Runbook

This is the owner's exact execution runbook for creating the **first**
PCA production database, using this `database/live-bootstrap/` package. It
assumes no PCA production database currently exists anywhere. Read the whole
document before running anything.

**STOP condition, upfront:** do not run this against a database you are not
certain is a brand-new, empty, dedicated PCA database. This package creates;
it does not merge, reconcile, or upgrade an existing schema.

## Preconditions

- [ ] MySQL 8.4 server provisioned (8.0.16+ accepted but unverified — see
      `docs/database/PCA_LIVE_DATABASE_SETTINGS.md` §1). Server started with
      `--character-set-server=utf8mb4 --collation-server=utf8mb4_bin
      --default-time-zone=+00:00` (or the equivalent config-file settings).
- [ ] A brand-new, empty database/schema created for PCA and nothing else
      (e.g. `CREATE DATABASE pca_production;`).
- [ ] Two credentials provisioned per
      `docs/database/PCA_LIVE_DATABASE_SETTINGS.md` §9:
      - A **migration/provisioning** credential with CREATE, ALTER, DROP,
        REFERENCES, INDEX, INSERT on the target database. Used ONLY for this
        bootstrap and for future migrations — never by the running
        application.
      - A **least-privilege runtime** credential (SELECT/INSERT/UPDATE/DELETE
        only, and explicitly excluding UPDATE/DELETE on
        `platform_admin_audit_events` — see
        `backend/scripts/provision-runtime-db-grants.mjs` /
        `backend/scripts/db/runtimeGrantPlan.mjs`). Used by the running
        application (`PCA_DATABASE_URL`), never for migrations.
- [ ] Both credential secrets are stored in the owner's secret manager, never
      in a shell history, ticket, chat log, or this repository. This runbook
      never asks you to paste a password anywhere it would be persisted.
- [ ] A recent, verified backup/snapshot capability exists for the target
      MySQL instance (needed for the "immediately after creation" backup
      step below), even though the database is empty going in.
- [ ] `node` (v22, matching `backend/package.json`'s `engines`) is available
      on the machine running this bootstrap, for the Node-based steps.
      `mysql` CLI client is also required for the pure-SQL steps.

## How credentials are supplied

Set two environment variables in the shell that runs this bootstrap, never
inline in a command that gets logged:

```
export PCA_MIGRATION_DATABASE_URL="mysql://<migration_user>:<password>@<host>:<port>/<database>"
export PCA_DATABASE_URL="$PCA_MIGRATION_DATABASE_URL"   # bootstrap runs as the migration credential throughout
```

(`PCA_DATABASE_URL` is reused as an alias here purely because
`backend/scripts/*.mjs` read that variable name; it is set to the
**migration** credential only for the duration of this bootstrap. Before the
application itself starts, reset `PCA_DATABASE_URL` to the **runtime**
credential in its actual deployment environment/secret store — never leave
the migration credential wired into the running application.)

## Step 1 — Preflight (fail-closed)

```
mysql --defaults-extra-file=<(echo "[client]"; echo "host=<host>"; echo "port=<port>"; echo "user=<migration_user>"; echo "password=<password>") \
  <database> < database/live-bootstrap/00_preflight.sql
```

Read the full output. The last line must be:

```
PCA-LIVE-DB-0 PREFLIGHT: ALL CHECKS PASSED -- safe to proceed to 01_create_database_schema.sql
```

**If it fails: STOP.** Do not proceed. Do not edit `00_preflight.sql` to
remove the failing check. Investigate the actual condition it found (wrong
database selected, unexpected existing tables, wrong MySQL version,
insufficient privileges) and resolve it at the infrastructure level, then
re-run this step from scratch.

## Step 2 — Create schema

```
mysql ... <database> < database/live-bootstrap/01_create_database_schema.sql
```

This creates all 75 tables, 82 foreign keys, 31 unique indexes, 116
non-unique indexes, 228 CHECK constraints, and 4 generated columns —
generated deterministically from `backend/src/db/schema.ts`. It contains no
application data. If any statement fails, the script stops at that
statement (no `DROP TABLE IF EXISTS` pattern is used, so nothing is silently
overwritten) — investigate and re-run Step 1 fresh before retrying, since a
partial failure here means the database is no longer empty.

## Step 3 — Reference data

```
mysql ... <database> < database/live-bootstrap/02_reference_data.sql
```

Inserts exactly 34 `schema_migrations` bookkeeping rows (marking every
accepted migration 0001–0036 as already applied, so a **future**
`npm run db:migrate` only applies new migrations from 0037 onward — without
this step, the next migration run would try to recreate tables that already
exist and fail) plus 14 production reference/lookup rows (currencies,
commercial markets, country routing, the FREE_STARTER entitlement default —
see `docs/database/PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv` for exactly
which rows and why each is required). No test, demo, or QA data of any kind.

## Step 4 — Post-validation (fail-closed)

```
mysql ... <database> < database/live-bootstrap/03_post_validation.sql
```

Checks exact table/column/foreign-key/index counts, engine/charset
consistency, and reference-data row counts. Then run the dynamic checks
(per-table emptiness beyond the 5 reference tables, a live prohibited-column-
name scan, and the authoritative schema fingerprint) with Node:

```
PCA_DATABASE_URL="$PCA_MIGRATION_DATABASE_URL" node backend/scripts/post-validate.mjs
```

Both must report **ALL PASSED** / **ALL CHECKS PASSED**. The fingerprint
check must report:

```
PASS: schema fingerprint matches expected sha256:11a85f4d0c096d79a97dedc59ae1a09115104784513dbf3ea99b276e5d39a1d1
```

**If it fails: STOP.** Do not proceed to Step 5. This means the live database
does not structurally match the accepted canonical schema
(`backend/src/db/schema.ts`) — treat this the same as a failed preflight:
investigate, do not paper over.

Optionally, also run the Node-independent secondary fingerprint and record
its value for your own future drift-checking convenience:

```
mysql ... <database> < database/live-bootstrap/04_schema_fingerprint.sql
```

(Its hash format differs from the authoritative one above by design — see
that file's own header. Do not compare the two values to each other.)

## Step 5 — Application connection smoke test

1. Point the **runtime** credential (`PCA_DATABASE_URL`, in the application's
   actual deployment secret store) at the new database. Do **not** use the
   migration credential here.
2. Start exactly one instance of the backend (`node dist/main.js`, or your
   deployment's normal start command) against it.
3. Confirm the process starts without a connection or schema error.
4. Exercise ONE real read and ONE real write through the application's own
   API (e.g. a health check that touches the database, or — if you have a
   safe way to do so — an actual first parent registration). Do not insert
   ad hoc rows directly via `mysql` to "test" the connection; use the
   application itself, so you are also validating the runtime credential's
   grants (in particular that it can do everything it needs EXCEPT
   UPDATE/DELETE on `platform_admin_audit_events`).
5. Stop that instance once satisfied, if this was a temporary smoke-test
   deployment rather than the real production rollout.

## Step 6 — Backup immediately after creation

Take a full backup/snapshot of the database **now**, while its known-good
state is exactly: schema + the 14 reference rows + the 34 bookkeeping rows +
whatever Step 5's smoke test wrote. Label it clearly (e.g.
`pca-production-post-bootstrap-<date>`) and record its identifier somewhere
durable (not only in this runbook). This is your rollback point for
everything that happens next.

## Rollback / abort conditions

- Any failure in Steps 1 or 4: STOP, do not proceed further, investigate.
- A failure partway through Step 2 or 3: the database is no longer empty and
  no longer safe to re-run this bootstrap against as-is. Do not attempt to
  "resume" by re-running the failed file — restore from a snapshot taken
  before Step 1 (or, if none exists because this is truly the first attempt,
  drop and recreate the empty target database, then restart from Step 1).
- Anything unexpected discovered in Step 5 (schema error, grant error,
  unexpected data): stop the smoke-test instance, do not point real traffic
  at this database, and restore/recreate before retrying.

## What NOT to do

- Do not run `01_create_database_schema.sql` more than once against the same
  database.
- Do not run `02_reference_data.sql` more than once against the same
  database (it is not idempotent by design — see that file's own header;
  re-running it would duplicate the 34 bookkeeping rows and violate
  `schema_migrations`' PRIMARY KEY, which is itself a safe failure mode, but
  don't rely on that as your safety net).
- Do not add test accounts, demo parents/children, fake devices,
  invitations, licenses, or entitlements to `02_reference_data.sql`, ever.
- Do not weaken `00_preflight.sql` or `03_post_validation.sql`'s checks to
  get past a failure.
- Do not use the migration credential as the application's runtime
  credential, even temporarily "just to get it working."
- Do not skip Step 6.

## First deploy vs. future changes

- **FIRST_DEPLOY**: this `database/live-bootstrap/` package (one time only).
- **FUTURE_CHANGES**: a new, numbered file in `backend/migrations/`
  (`0037_...sql` onward), applied via `npm run db:migrate` — never by
  re-running this bootstrap package. After a new migration is accepted,
  regenerate `backend/src/db/schema.ts` and this entire
  `database/live-bootstrap/` directory from it (see
  `docs/database/PCA_CANONICAL_SCHEMA_REPORT.md`'s Authority Model section),
  and recompute the expected fingerprint in this file and in
  `backend/scripts/post-validate.mjs`.
- **PERIODIC_CHECK**: re-run `backend/scripts/post-validate.mjs`'s
  fingerprint check against the live database at any time to confirm it
  still matches the currently accepted canonical schema — a mismatch after
  an *undeployed* migration is a real drift signal; a mismatch right after a
  *deployed* migration is expected until the fingerprint constant itself is
  updated to match.

## Do not re-run the full bootstrap after go-live

Once Step 6's backup is taken and real traffic is flowing, this package's
job is done. It is a one-time creation tool, never a repeatable
reconciliation or sync tool — running `01_create_database_schema.sql` again
later, even "just to check," is not a safe operation.
