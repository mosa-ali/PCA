// PCA-DB-MYSQL-1 migration runner. Applies backend/migrations/*.sql in
// filename order to the database named by PCA_DATABASE_URL, tracking
// applied versions in schema_migrations.
//
// IMPORTANT: MySQL DDL (CREATE TABLE, ALTER TABLE, ...) is NOT transactional
// -- every DDL statement causes an implicit commit, unlike PostgreSQL. Each
// migration file therefore is NOT rolled back as a unit on partial failure;
// this runner stops immediately on the first failing statement and does NOT
// record that migration as applied, so a re-run will retry it, but any DDL
// that already executed within that file remains in place. Author migration
// files accordingly (prefer idempotent, additive DDL; avoid multi-table
// migrations that must all-or-nothing succeed).
//
// CONCURRENCY: because of that same non-transactional DDL, two deploy tasks
// running this script at once would both read schema_migrations, both see
// the same pending file, and both start executing its DDL against the same
// database -- half-applying migrations on top of each other. The whole run
// is therefore wrapped in a MySQL named advisory lock (GET_LOCK); a second
// concurrent runner waits, and fails loudly rather than proceeding if it
// cannot get the lock. See scripts/migrationAdvisoryLock.mjs.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS, MIGRATION_LOCK_NAME, withMigrationLock } from './migrationAdvisoryLock.mjs';

// PCA_MIGRATION_DATABASE_URL, if set, is a distinct, more-privileged
// migration/provisioning credential (able to CREATE/ALTER/DROP), separate
// from the least-privilege runtime credential the application itself uses
// at runtime (PCA_DATABASE_URL, read by backend/src/db/pool.ts, which this
// script never touches). Production SHOULD set this to a dedicated
// credential; local/dev/CI MAY simply not set it and collapse both roles
// onto PCA_DATABASE_URL -- this fallback keeps every existing workflow that
// only sets PCA_DATABASE_URL working completely unchanged.
const connectionString = process.env.PCA_MIGRATION_DATABASE_URL ?? process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL (or PCA_MIGRATION_DATABASE_URL) is required to run migrations.');

const migrationsDir = new URL('../migrations/', import.meta.url);

async function ensureMigrationsTableExists(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'`,
  );
  return rows[0].n > 0;
}

async function appliedVersions(connection) {
  const [rows] = await connection.query(`SELECT version FROM schema_migrations`);
  return new Set(rows.map((row) => row.version));
}

async function main() {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('No migration files found in backend/migrations/.');

  const connection = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    // The lock MUST be taken on this same connection -- GET_LOCK is
    // connection-scoped -- and around the read of schema_migrations too,
    // not just the DDL: the check ("which versions are already applied")
    // and the act ("apply the rest") are what must be mutually exclusive.
    await withMigrationLock(
      connection,
      async () => {
        const migrationsTableExists = await ensureMigrationsTableExists(connection);
        const applied = migrationsTableExists ? await appliedVersions(connection) : new Set();

        let appliedCount = 0;
        for (const file of files) {
          if (applied.has(file)) continue;
          const sql = await readFile(fileURLToPath(new URL(file, migrationsDir)), 'utf8');
          console.log(`Applying ${file}...`);
          try {
            await connection.query(sql);
            await connection.query(`INSERT INTO schema_migrations (version) VALUES (?)`, [file]);
          } catch (error) {
            console.error(`Migration ${file} FAILED: ${error.message}`);
            console.error('Stopping -- no further migrations were attempted.');
            process.exitCode = 1;
            return;
          }
          appliedCount++;
        }
        console.log(appliedCount > 0 ? `Applied ${appliedCount} migration(s).` : 'Database already up to date.');
      },
      { name: MIGRATION_LOCK_NAME, timeoutSeconds: lockTimeoutSeconds() },
    );
  } finally {
    await connection.end();
  }
}

/**
 * PCA_MIGRATION_LOCK_TIMEOUT_SECONDS lets an operator widen the wait for a
 * deployment whose migrations legitimately run long. An unset or malformed
 * value falls back to the default rather than silently becoming 0 (which
 * would make the lock non-blocking and defeat the point).
 */
function lockTimeoutSeconds() {
  const raw = process.env.PCA_MIGRATION_LOCK_TIMEOUT_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`Ignoring invalid PCA_MIGRATION_LOCK_TIMEOUT_SECONDS=${raw}; using ${DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS}s.`);
    return DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS;
  }
  return parsed;
}

await main();
