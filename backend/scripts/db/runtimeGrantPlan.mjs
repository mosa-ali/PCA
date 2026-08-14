// Pure, dependency-free, synchronous grant-planning logic for the runtime
// (least-privilege, application) MySQL principal. No DB connection here --
// this module only decides WHICH GRANT statement shape applies to a given
// table and builds the exact SQL string, so that:
//   (a) backend/scripts/provision-runtime-db-grants.mjs can import and
//       execute this against a real database, and
//   (b) backend/test/db/platformAdminAuditPrivileges.mysql.test.mjs can
//       import the SAME function and exercise the SAME grant-building code
//       path a real provisioning run would use, rather than a hand-rolled
//       parallel reimplementation that could silently drift from what
//       production actually runs.
//
// THE RULE (Defect-1 correction -- replaces the removed
// platform_admin_audit_events triggers, see migration 0005's own
// APPEND-ONLY ENFORCEMENT comment for the full MySQL-privilege-scoping
// rationale):
//   - platform_admin_audit_events: SELECT, INSERT only -- never
//     UPDATE/DELETE. This is the actual database-level append-only
//     enforcement mechanism.
//   - schema_migrations: SELECT only -- the runtime application never
//     writes migration bookkeeping.
//   - every other base table: SELECT, INSERT, UPDATE, DELETE (ordinary
//     DML). Never CREATE/ALTER/DROP/INDEX/REFERENCES/TRIGGER/SUPER/GRANT
//     OPTION, and never a database-level (`db`.*) grant -- always
//     table-level, always for exactly one named table.

export const AUDIT_TABLE_NAME = 'platform_admin_audit_events';
export const MIGRATIONS_TABLE_NAME = 'schema_migrations';

/** Backtick-quotes a MySQL identifier (database or table name), doubling any embedded backtick per MySQL's own escaping rule. */
export function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error(`quoteIdentifier: expected a non-empty string, got ${JSON.stringify(identifier)}`);
  }
  return '`' + identifier.replace(/`/g, '``') + '`';
}

/** Single-quotes a MySQL user/host literal for use in `'user'@'host'`, escaping backslashes and single quotes. */
export function quoteUserAtHost(user, host) {
  if (typeof user !== 'string' || user.length === 0) throw new Error('quoteUserAtHost: user is required.');
  if (typeof host !== 'string' || host.length === 0) throw new Error('quoteUserAtHost: host is required.');
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escape(user)}'@'${escape(host)}'`;
}

/**
 * Which of the three privilege shapes applies to a given table name.
 * Exported separately from buildRuntimeGrantStatement so callers (and
 * tests) can assert the classification independently of SQL string
 * formatting.
 */
export function privilegesForTable(tableName) {
  if (tableName === AUDIT_TABLE_NAME) return ['SELECT', 'INSERT'];
  if (tableName === MIGRATIONS_TABLE_NAME) return ['SELECT'];
  return ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
}

/**
 * Builds the exact `GRANT ... ON `db`.`table` TO 'user'@'host'` statement
 * for one table, given the already-quoted `'user'@'host'` literal (build it
 * once via quoteUserAtHost and reuse across every table in a plan).
 */
export function buildRuntimeGrantStatement(databaseName, tableName, userAtHostLiteral) {
  const privileges = privilegesForTable(tableName).join(', ');
  const qualifiedTable = `${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`;
  return `GRANT ${privileges} ON ${qualifiedTable} TO ${userAtHostLiteral}`;
}

/**
 * Builds the full ordered list of GRANT statements for every table in
 * `tableNames` (as enumerated from information_schema.tables by the
 * caller -- this function never hardcodes a table list).
 */
export function buildRuntimeGrantPlan(databaseName, tableNames, userAtHostLiteral) {
  return tableNames.map((tableName) => buildRuntimeGrantStatement(databaseName, tableName, userAtHostLiteral));
}
