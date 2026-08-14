// PCA-DB-MYSQL-1 correction (Defect 1): provisions the LEAST-PRIVILEGE
// runtime/application MySQL principal's exact grant set, table-by-table,
// replacing the removed platform_admin_audit_events append-only triggers
// (see migration 0005's own APPEND-ONLY ENFORCEMENT comment for the full
// rationale: a least-privilege MySQL 8 user under binary logging cannot
// CREATE TRIGGER without SUPER, and granting SUPER to work around that
// would itself weaken the production security posture).
//
// Run this once after `npm run db:migrate` (and again any time a new
// migration adds tables -- it is idempotent and self-adjusting, see below)
// against BOTH local dev/test (see scripts/mysql/bootstrap-local.sql) and
// production, so every environment converges to the same least-privilege
// model rather than local/dev quietly keeping a broader one.
//
// Connects using PCA_MIGRATION_DATABASE_URL ONLY -- an admin/
// provisioning-capable credential, NEVER the runtime credential itself
// (which is only ever the TARGET of the grants issued here, not the
// connection issuing them). GRANT/REVOKE is a materially more privileged
// class of operation than the ordinary schema DDL migrate.mjs/
// verify-mysql.mjs fall back to PCA_DATABASE_URL for -- this script
// deliberately has NO such fallback (R2 correction: a privileged operation
// must never silently degrade to the least-privilege runtime URL, which
// would either fail confusingly or mask a misconfiguration where that
// "runtime" URL actually holds elevated authority it shouldn't).
//
// Required env:
//   PCA_MIGRATION_DATABASE_URL -- admin/provisioning connection (required,
//     no fallback to PCA_DATABASE_URL).
//   PCA_RUNTIME_DB_USER -- the runtime principal's username (never hardcoded).
//   PCA_RUNTIME_DB_HOST -- the runtime principal's host pattern, e.g.
//     127.0.0.1 or % (never hardcoded).
import mysql from 'mysql2/promise';
import { buildRuntimeGrantPlan, quoteUserAtHost } from './db/runtimeGrantPlan.mjs';

const AUDIT_TABLE_NAME = 'platform_admin_audit_events';
const MIGRATIONS_TABLE_NAME = 'schema_migrations';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run provision-runtime-db-grants.mjs.`);
  return value;
}

const connectionString = requireEnv('PCA_MIGRATION_DATABASE_URL');
const runtimeUser = requireEnv('PCA_RUNTIME_DB_USER');
const runtimeHost = requireEnv('PCA_RUNTIME_DB_HOST');

/** MySQL/InnoDB error 1141 (ER_NONEXISTING_GRANT): "There is no such grant defined for user ... on host ...". The only REVOKE failure this script tolerates -- it means the principal currently holds zero privileges, which is exactly the state a REVOKE-before-GRANT convergence run is happy to start from. */
function isNoSuchGrant(error) {
  return typeof error === 'object' && error !== null && (error.errno === 1141 || error.code === 'ER_NONEXISTING_GRANT');
}

async function main() {
  const connection = await mysql.createConnection({ uri: connectionString, timezone: 'Z' });
  try {
    const [dbRows] = await connection.query('SELECT DATABASE() AS db');
    const databaseName = dbRows[0]?.db;
    if (!databaseName) throw new Error('provision-runtime-db-grants.mjs: the admin connection string must select a database.');

    const [tableRows] = await connection.query(
      `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const tableNames = tableRows.map((row) => row.table_name);
    if (tableNames.length === 0) {
      throw new Error('provision-runtime-db-grants.mjs: no base tables found -- run `npm run db:migrate` first.');
    }

    const userAtHostLiteral = quoteUserAtHost(runtimeUser, runtimeHost);

    // Converge to exactly the intended minimal grant set: strip whatever
    // this principal currently holds (from a previous, possibly stale, run)
    // before re-granting from the enumerated table list, so re-running this
    // script never accumulates broader-than-intended grants left over from
    // an earlier migration state.
    try {
      await connection.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${userAtHostLiteral}`);
    } catch (error) {
      if (!isNoSuchGrant(error)) throw error;
      // Tolerated: the principal currently holds zero privileges (first run,
      // or a previous run already converged to nothing) -- nothing to strip.
    }

    const grantStatements = buildRuntimeGrantPlan(databaseName, tableNames, userAtHostLiteral);
    for (const statement of grantStatements) {
      await connection.query(statement);
    }

    await connection.query('FLUSH PRIVILEGES');

    const ordinaryTableCount = tableNames.filter((name) => name !== AUDIT_TABLE_NAME && name !== MIGRATIONS_TABLE_NAME).length;
    console.log(`Provisioned ${grantStatements.length} table-level grant(s) for ${userAtHostLiteral} on database "${databaseName}".`);
    console.log(`  - ${AUDIT_TABLE_NAME}: SELECT, INSERT only (append-only enforcement).`);
    console.log(`  - ${MIGRATIONS_TABLE_NAME}: SELECT only.`);
    console.log(`  - every other table (${ordinaryTableCount}): SELECT, INSERT, UPDATE, DELETE.`);
  } finally {
    await connection.end();
  }
}

await main();
