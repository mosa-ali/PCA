# SUPERSEDED -- do not use

The `.sql` files in this directory are the **obsolete PostgreSQL** DDL from the
project's pre-MySQL period. PCA targets **MySQL 8.4.x only**; nothing in the
repository references these files (verified 2026-09-08 by search).

The authoritative schema is `backend/migrations/*.sql` (38 files), rendered
canonically by `backend/src/db/schema.ts` into
`database/live-bootstrap/01_create_database_schema.sql` and
`docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql`.

Kept only as historical record. Any agent or engineer grepping
`docs/database/**/*.sql` for schema truth must skip this directory.
