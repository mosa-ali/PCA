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
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

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
  } finally {
    await connection.end();
  }
}

await main();
