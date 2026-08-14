// PCA-PA-1 Defect-1 correction: a REAL database-level privilege-boundary
// test. This is deliberately NOT a test of MySqlPlatformAdminAuditRepository
// refusing to call UPDATE/DELETE (that already existed before this
// correction and is not what's being fixed) -- it proves the DATABASE
// ITSELF, under the exact least-privilege credential shape production
// actually uses, rejects UPDATE/DELETE against platform_admin_audit_events
// independent of what SQL the application chooses to send. This replaces
// the removed CREATE TRIGGER enforcement (see migration 0005's own
// APPEND-ONLY ENFORCEMENT comment for why triggers cannot be used under a
// least-privilege MySQL 8 user with binary logging enabled).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { buildRuntimeGrantPlan, quoteUserAtHost } from '../../scripts/db/runtimeGrantPlan.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');
// Admin/provisioning-capable connection -- mirrors exactly what
// scripts/provision-runtime-db-grants.mjs itself resolves, so this test
// exercises the real production connection-resolution shape too.
const adminConnectionString = process.env.PCA_MIGRATION_DATABASE_URL ?? process.env.PCA_DATABASE_URL;

// A throwaway, randomly-named runtime-role user -- never a fixed/predictable
// name, generated fresh for this run, and dropped in test.after even if a
// test fails partway through.
const runtimeUsername = `pa_priv_${randomUUID().replace(/-/g, '')}`.slice(0, 32);
const runtimePassword = randomBytes(24).toString('base64url');
const runtimeHost = '%'; // matches whichever local/CI host this test's own connection originates from
const userAtHostLiteral = quoteUserAtHost(runtimeUsername, runtimeHost);

const adminConnection = await mysql.createConnection({ uri: adminConnectionString, timezone: 'Z' });
const [dbRows] = await adminConnection.query('SELECT DATABASE() AS db');
const databaseName = dbRows[0]?.db;
if (!databaseName) throw new Error('platformAdminAuditPrivileges test: the admin connection string must select a database.');

await adminConnection.query(`CREATE USER ${userAtHostLiteral} IDENTIFIED BY ?`, [runtimePassword]);

// Enumerate every base table actually present -- exactly the same
// self-adjusting enumeration provision-runtime-db-grants.mjs uses, never a
// hardcoded list -- and issue the SAME grant-building logic that script
// uses (imported directly, not hand-rolled) against this real schema.
const [tableRows] = await adminConnection.query(
  `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
);
const tableNames = tableRows.map((row) => row.table_name);
const grantStatements = buildRuntimeGrantPlan(databaseName, tableNames, userAtHostLiteral);
for (const statement of grantStatements) {
  await adminConnection.query(statement);
}
await adminConnection.query('FLUSH PRIVILEGES');

// A SEPARATE, real second connection authenticated AS the throwaway
// runtime user -- not the admin connection issuing statements "on behalf
// of" it. This is the whole point: prove the database itself enforces the
// boundary for a connection that really is that principal.
const adminUrl = new URL(adminConnectionString);
const runtimeConnection = await mysql.createConnection({
  host: adminUrl.hostname,
  port: adminUrl.port ? Number(adminUrl.port) : 3306,
  user: runtimeUsername,
  password: runtimePassword,
  database: databaseName,
  timezone: 'Z',
});

function isTableAccessDenied(error) {
  return typeof error === 'object' && error !== null && error.code === 'ER_TABLEACCESS_DENIED_ERROR' && error.errno === 1142;
}

test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal can INSERT and SELECT platform_admin_audit_events', async () => {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  await runtimeConnection.query(
    `INSERT INTO platform_admin_audit_events
       (event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json)
     VALUES (?, 'ADMIN_LOGIN', NULL, NULL, NULL, 'SUCCESS', NOW(3), ?, NULL)`,
    [eventId, correlationId],
  );
  const [rows] = await runtimeConnection.query(`SELECT event_id FROM platform_admin_audit_events WHERE event_id = ?`, [eventId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_id, eventId);
});

test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting UPDATE on platform_admin_audit_events', async () => {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  await runtimeConnection.query(
    `INSERT INTO platform_admin_audit_events
       (event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json)
     VALUES (?, 'ADMIN_LOGIN', NULL, NULL, NULL, 'SUCCESS', NOW(3), ?, NULL)`,
    [eventId, correlationId],
  );
  await assert.rejects(
    () => runtimeConnection.query(`UPDATE platform_admin_audit_events SET result = 'FAILURE' WHERE event_id = ?`, [eventId]),
    isTableAccessDenied,
  );
});

test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting DELETE on platform_admin_audit_events', async () => {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  await runtimeConnection.query(
    `INSERT INTO platform_admin_audit_events
       (event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json)
     VALUES (?, 'ADMIN_LOGIN', NULL, NULL, NULL, 'SUCCESS', NOW(3), ?, NULL)`,
    [eventId, correlationId],
  );
  await assert.rejects(
    () => runtimeConnection.query(`DELETE FROM platform_admin_audit_events WHERE event_id = ?`, [eventId]),
    isTableAccessDenied,
  );
});

test('MySQL PRIVILEGE BOUNDARY control: the SAME runtime connection CAN UPDATE and DELETE an ordinary non-audit table it has full grants on -- proving the restriction is genuinely scoped to the audit table, not an accidental blanket lockout', async () => {
  const attemptId = randomUUID();
  await runtimeConnection.query(
    `INSERT INTO platform_admin_login_attempts (attempt_id, email_hash, outcome, occurred_at) VALUES (?, UNHEX(SHA2(?, 256)), 'FAILED_CREDENTIALS', NOW(3))`,
    [attemptId, `privtest-${randomUUID()}`],
  );
  await assert.doesNotReject(() =>
    runtimeConnection.query(`UPDATE platform_admin_login_attempts SET outcome = 'SUCCESS' WHERE attempt_id = ?`, [attemptId]),
  );
  await assert.doesNotReject(() =>
    runtimeConnection.query(`DELETE FROM platform_admin_login_attempts WHERE attempt_id = ?`, [attemptId]),
  );
});

test.after(async () => {
  await runtimeConnection.end().catch(() => {});
  await adminConnection.query(`DROP USER IF EXISTS ${userAtHostLiteral}`).catch(() => {});
  await adminConnection.end().catch(() => {});
});
