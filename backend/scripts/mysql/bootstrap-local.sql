-- Owner-run bootstrap for local MySQL 8.4 development/test databases.
-- Run this manually as an admin user (e.g. `mysql -u root -p < bootstrap-local.sql`)
-- -- it is NOT executed automatically by any script, and no password here
-- is real; replace CHANGE_ME_DEV / CHANGE_ME_TEST before running, then set
-- the matching PCA_DB_PASSWORD / PCA_DATABASE_URL values in your local .env.
--
-- Creates the two dedicated local databases and their least-privilege
-- application users. Never touches any other database.

CREATE DATABASE IF NOT EXISTS pca_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS pca_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE USER IF NOT EXISTS 'pca_dev_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_DEV';
CREATE USER IF NOT EXISTS 'pca_test_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_TEST';

-- This single convenience local dev/test user plays BOTH roles by default
-- (migration/provisioning AND runtime application) -- it therefore needs
-- the full DDL + DML grant below so it can run `npm run db:migrate` itself
-- (migrations are not purely additive DDL: e.g.
-- 0004_envelope_ledger_family_scope.sql legitimately issues real DELETE
-- statements as part of its one-time cleanup, and migrate.mjs itself
-- INSERTs into schema_migrations after every applied file).
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON pca_dev.* TO 'pca_dev_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON pca_test.* TO 'pca_test_app'@'127.0.0.1';

FLUSH PRIVILEGES;

-- After running migrations (`npm run db:migrate`) against pca_dev/pca_test
-- with this same user, narrow it down to the correct least-privilege
-- RUNTIME grant set (including the platform_admin_audit_events append-only
-- restriction) by running, for each database:
--
--   PCA_MIGRATION_DATABASE_URL=mysql://root:<admin-password>@127.0.0.1:3306/pca_dev \
--   PCA_RUNTIME_DB_USER=pca_dev_app PCA_RUNTIME_DB_HOST=127.0.0.1 \
--   node scripts/provision-runtime-db-grants.mjs
--
-- (and the equivalent for pca_test_app/pca_test). This is the SAME script
-- production uses, so local dev/test converges to the exact same
-- least-privilege model as production rather than silently keeping a
-- weaker/broader one.
--
-- WHY THIS WORKS despite the broad db-level grant above: MySQL privilege
-- grants are additive/union across global -> database -> table -> column
-- scope, and a SCOPED `REVOKE ... ON db.table FROM user` can never narrow a
-- privilege that was granted at the broader database level -- but
-- provision-runtime-db-grants.mjs does NOT issue a scoped revoke. It issues
-- an UNSCOPED `REVOKE ALL PRIVILEGES, GRANT OPTION FROM user` first (no ON
-- clause -- this wipes literally every privilege this user holds at every
-- scope, DDL included), then re-grants ONLY the intended per-table DML
-- set from scratch. That is genuinely "grant per-table from the start" --
-- it just starts from zero every time the script runs, which is also what
-- makes it idempotent. The practical consequence: after running this
-- script, `pca_dev_app`/`pca_test_app` can no longer run further
-- migrations (its DDL is gone too) until bootstrap-local.sql's GRANT
-- statements above are re-run -- an accepted tradeoff of collapsing the
-- migration and runtime roles onto one local convenience credential. Set
-- PCA_MIGRATION_DATABASE_URL to a genuinely separate credential (see
-- backend/.env.example) to avoid this local-only wrinkle entirely.
