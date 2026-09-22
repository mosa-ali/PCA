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
//
// R2 CORRECTION (two-tier test contract): proving this requires CREATE USER
// authority, which the ordinary least-privilege runtime credential
// (PCA_DATABASE_URL, e.g. the Compose `pca_test_app` user) MUST NOT hold --
// granting it would defeat the whole point of a least-privilege runtime
// principal. Previously this file fell back to PCA_DATABASE_URL for its
// admin/provisioning connection when PCA_MIGRATION_DATABASE_URL was unset,
// which made `npm run test:db` hard-fail with a CREATE USER permission
// error for the repository's own standard, ordinary DB-regression
// invocation (only PCA_DATABASE_URL set) -- exactly the class of command
// every local/CI run is expected to use. That fallback is REMOVED here.
//
// This file now serves two distinct roles depending on environment, never
// silently:
//   - STANDARD DB REGRESSION (`npm run test:db`, PCA_MIGRATION_DATABASE_URL
//     unset): every test below is explicitly, visibly `test.skip`'d with a
//     reason pointing at the mandatory privileged command below. No DB
//     connection is attempted at all in this mode -- nothing here requires
//     CREATE USER just to run the ordinary suite.
//   - PRIVILEGE ACCEPTANCE GATE (`npm run test:db:platform-admin-privileges`,
//     which requires PCA_MIGRATION_DATABASE_URL to be set -- see
//     backend/scripts/require-privileged-db-env.mjs, which that npm script
//     runs BEFORE this file, failing the whole command non-zero if the
//     variable is absent): every test below runs for real, using
//     PCA_MIGRATION_DATABASE_URL directly (never falling back to
//     PCA_DATABASE_URL for this admin/provisioning connection) to create a
//     throwaway probe user and prove the exact grant boundary. A genuine
//     connection/permission error in THIS mode (wrong password, migration
//     user itself lacking CREATE USER, wrong host/db) is a real test
//     FAILURE, never converted to a skip -- the operator explicitly asked
//     for this gate by setting the variable and invoking this command.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { buildRuntimeGrantPlan, quoteUserAtHost } from '../../scripts/db/runtimeGrantPlan.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const SKIP_REASON =
  'privileged audit-grant verification requires PCA_MIGRATION_DATABASE_URL; run npm run ' +
  'test:db:platform-admin-privileges for the mandatory privilege gate.';

/**
 * Registered under this exact name in BOTH modes, from one constant rather than
 * two literals: the skip mode's whole job is to advertise accurately what the
 * privileged mode would have run, and duplicated names are how the two silently
 * drift apart.
 */
const PRODUCTION_PATH_TEST_NAME =
  'PRODUCTION PATH: the real MySqlPlatformAdminAuditRepository writer and its queryForRole reader both work under the exact runtime grant plan production uses';

if (!process.env.PCA_MIGRATION_DATABASE_URL) {
  // STANDARD DB REGRESSION mode: no admin/provisioning credential was
  // supplied, so this file does not attempt any connection, CREATE USER, or
  // GRANT/REVOKE at all -- it only registers four explicitly-skipped tests
  // so a `npm run test:db` run visibly reports "skipped", never silently
  // omits or (worse) silently reports these as passed.
  test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal can INSERT and SELECT platform_admin_audit_events', { skip: SKIP_REASON }, () => {});
  test(
    'MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting UPDATE on platform_admin_audit_events',
    { skip: SKIP_REASON },
    () => {},
  );
  test(
    'MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting DELETE on platform_admin_audit_events',
    { skip: SKIP_REASON },
    () => {},
  );
  test(
    'MySQL PRIVILEGE BOUNDARY control: the SAME runtime connection CAN UPDATE and DELETE an ordinary non-audit table it has full grants on -- proving the restriction is genuinely scoped to the audit table, not an accidental blanket lockout',
    { skip: SKIP_REASON },
    () => {},
  );
  test(PRODUCTION_PATH_TEST_NAME, { skip: SKIP_REASON }, () => {});
} else {
  // PRIVILEGE ACCEPTANCE GATE mode: PCA_MIGRATION_DATABASE_URL is set --
  // this is a real, mandatory run. Never fall back to PCA_DATABASE_URL for
  // this admin/provisioning connection (Defect: a "privileged" connection
  // that silently degrades to the least-privilege runtime URL would either
  // fail confusingly on CREATE USER, or -- worse -- mask a
  // misconfiguration where the "runtime" URL actually points at an
  // over-privileged account).
  const adminConnectionString = process.env.PCA_MIGRATION_DATABASE_URL;

  // A throwaway, randomly-named runtime-role user -- never a
  // fixed/predictable name, generated fresh for this run, and dropped in
  // test.after even if a test fails partway through.
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

  const isTableAccessDenied = (error) =>
    typeof error === 'object' && error !== null && error.code === 'ER_TABLEACCESS_DENIED_ERROR' && error.errno === 1142;

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

  test(PRODUCTION_PATH_TEST_NAME, async () => {
    // WHY THIS CASE EXISTS AT ALL. Every case above drives RAW SQL. That proves
    // the grant plan rejects mutation, and it proves nothing about whether the
    // real writer can write: if MySqlPlatformAdminAuditRepository's INSERT, or
    // queryForRole's SELECT, needed a privilege the runtime plan does not grant,
    // the whole file would still pass while production failed with 1142 on the
    // first admin action. STORE_TEST_PASS != PRODUCTION_PATH_PASS unless the
    // real writer-to-reader path is certified too.
    //
    // The real repository takes its connection from db/pool.js, which reads
    // PCA_DATABASE_URL when that module is first evaluated. Nothing imported
    // earlier in this file pulls it in, so repointing the variable immediately
    // before a DYNAMIC import genuinely creates the pool as the throwaway
    // least-privilege principal rather than as the admin connection.
    const runtimeUrlString =
      `${adminUrl.protocol}//${encodeURIComponent(runtimeUsername)}:${encodeURIComponent(runtimePassword)}` +
      `@${adminUrl.hostname}:${adminUrl.port ? adminUrl.port : 3306}/${databaseName}`;
    process.env.PCA_DATABASE_URL = runtimeUrlString;

    const { MySqlPlatformAdminAuditRepository } = await import('../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js');
    const { closePool, getPool } = await import('../../dist/db/pool.js');
    try {
      // NON-VACUITY GUARD, and it is the difference between a real certification
      // and a self-congratulatory one: if the repoint above silently failed to
      // take effect (say db/pool.js had already been pulled in by an earlier
      // import), the pool would be the ADMIN connection, every assertion below
      // would still pass, and the test would claim to certify a least-privilege
      // writer while certifying nothing. Ask the database who the pool actually
      // is, and require it to be the throwaway principal.
      const [whoRows] = await getPool().query('SELECT CURRENT_USER() AS db_principal');
      assert.match(
        String(whoRows[0]?.db_principal),
        new RegExp(`^${runtimeUsername}@`),
        'the pool must genuinely be the throwaway least-privilege principal -- not the admin connection',
      );

      const repository = new MySqlPlatformAdminAuditRepository();
      const eventId = randomUUID();
      const correlationId = randomUUID();
      const occurredAt = new Date('2026-01-01T00:00:00.000Z');

      // 1. THE REAL WRITER, as the real principal. This is the assertion that
      //    would have caught an INSERT needing a column the plan omits.
      await repository.insert({
        eventId,
        eventType: 'ADMIN_LOGIN',
        actorAdminId: null,
        actorRole: null,
        targetRef: null,
        result: 'SUCCESS',
        occurredAt,
        correlationId,
        metadata: { probe: 'production-path' },
      });

      // 2. THE REAL READER, not the table: proves queryForRole's SELECT is also
      //    inside the grant, and that the exact value/semantics survive the
      //    round trip (timestamp and the JSON-typed metadata column).
      const rows = await repository.queryForRole(['APP_OWNER'], 'probe-admin', { limit: 50 });
      const readBack = rows.find((row) => row.eventId === eventId);
      assert.ok(readBack, 'the real consumer must see the row the real writer just inserted');
      assert.equal(readBack.correlationId, correlationId);
      assert.equal(readBack.eventType, 'ADMIN_LOGIN');
      assert.equal(readBack.result, 'SUCCESS');
      assert.equal(readBack.occurredAt.getTime(), occurredAt.getTime());
      assert.deepEqual(readBack.metadata, { probe: 'production-path' });

      // 3. HOSTILE-INPUT PATH: the same writer must refuse a malformed event at
      //    the writer, rather than persisting something the reader then has to
      //    cope with. Asserting the throw is the point -- an audit writer that
      //    silently accepted an unknown type would be an unauditable action.
      await assert.rejects(
        () =>
          repository.insert({
            eventId: randomUUID(),
            eventType: 'NOT_A_REAL_AUDIT_EVENT_TYPE',
            actorAdminId: null,
            actorRole: null,
            targetRef: null,
            result: 'SUCCESS',
            occurredAt,
            correlationId: randomUUID(),
            metadata: null,
          }),
        /Unknown Platform Administration audit event type/,
      );

      // 4. AND THE BOUNDARY STILL HOLDS FOR THE SAME PRINCIPAL that just wrote
      //    the row through the real writer: writing is not editing.
      await assert.rejects(
        () => runtimeConnection.query(`UPDATE platform_admin_audit_events SET result = 'FAILURE' WHERE event_id = ?`, [eventId]),
        isTableAccessDenied,
      );
    } finally {
      await closePool().catch(() => {});
    }
  });

  test.after(async () => {
    await runtimeConnection.end().catch(() => {});
    await adminConnection.query(`DROP USER IF EXISTS ${userAtHostLiteral}`).catch(() => {});
    await adminConnection.end().catch(() => {});
  });
}
