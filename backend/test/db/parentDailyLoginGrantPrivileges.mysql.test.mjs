// 2026-09-24 production defect (daily-login-grant touch, MySQL 1143): the
// runtime grant plan declared INSERT/UPDATE for parent_daily_login_grants
// without SELECT, while validateAndTouchDailyLoginGrant's UPDATE reads its
// columns in the WHERE clause -- MySQL refuses that without SELECT on those
// columns, so every re-sign-in from a browser holding a daily grant failed
// with ER_COLUMNACCESS_DENIED_ERROR and surfaced as HTTP 500. (The FIRST
// sign-in never runs the statement, which is exactly why the flow passed
// acceptance until a real second sign-in touched it.)
//
// This file is the disposable-principal proof that the real repository's
// daily-grant calls actually execute under the grant set the plan builds. The
// verbs are imported from the SAME module provision-runtime-db-grants.mjs
// uses, never re-derived here -- a parallel hand-rolled grant list could drift
// from provisioning and would then certify nothing.
//
// TWO-TIER CONTRACT (mirrors platformAdminAuditPrivileges.mysql.test.mjs):
//   - STANDARD DB REGRESSION (`npm run test:db`, PCA_MIGRATION_DATABASE_URL
//     unset): every test below is explicitly, visibly skipped -- no
//     connection, CREATE USER, or GRANT is attempted.
//   - PRIVILEGE ACCEPTANCE GATE (`npm run
//     test:db:parent-daily-login-grant-privileges`, which requires
//     PCA_MIGRATION_DATABASE_URL -- see backend/scripts/require-privileged-db-env.mjs,
//     which that npm script runs BEFORE this file, failing the whole command
//     non-zero if the variable is absent): every test runs for real against a
//     throwaway randomly-named principal that holds EXACTLY the plan's verbs,
//     and the REAL MySqlParentAccountRepository methods are driven through it
//     with a CURRENT_USER non-vacuity guard -- so the certification can never
//     silently run as the admin connection instead.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { buildRuntimeGrantPlan, quoteUserAtHost } from '../../scripts/db/runtimeGrantPlan.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const SKIP_REASON =
  'privileged daily-grant verification requires PCA_MIGRATION_DATABASE_URL; run npm run ' +
  'test:db:parent-daily-login-grant-privileges for the mandatory privilege gate.';

/**
 * Registered under this exact name in BOTH modes, from one constant: the skip
 * mode's whole job is to advertise accurately what the privileged mode would
 * have run, and duplicated names are how the two silently drift apart.
 */
const PRODUCTION_PATH_TEST_NAME =
  'PRODUCTION PATH: the real MySqlParentAccountRepository insert/touch/revoke daily-grant calls all execute under the exact runtime grant plan production uses';

if (!process.env.PCA_MIGRATION_DATABASE_URL) {
  test(
    'MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal can INSERT and UPDATE parent_daily_login_grants (the daily-grant touch statement)',
    { skip: SKIP_REASON },
    () => {},
  );
  test(
    'MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is still rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting DELETE on parent_daily_login_grants',
    { skip: SKIP_REASON },
    () => {},
  );
  test(PRODUCTION_PATH_TEST_NAME, { skip: SKIP_REASON }, () => {});
} else {
  const adminConnectionString = process.env.PCA_MIGRATION_DATABASE_URL;

  // A throwaway, randomly-named runtime-role user -- never fixed/predictable,
  // generated fresh for this run and dropped in test.after even on failure.
  const runtimeUsername = `pdg_priv_${randomUUID().replace(/-/g, '')}`.slice(0, 32);
  const runtimePassword = randomBytes(24).toString('base64url');
  const runtimeHost = '%'; // matches whichever local/CI host this test's own connection originates from
  const userAtHostLiteral = quoteUserAtHost(runtimeUsername, runtimeHost);

  const adminConnection = await mysql.createConnection({ uri: adminConnectionString, timezone: 'Z' });
  const [dbRows] = await adminConnection.query('SELECT DATABASE() AS db');
  const databaseName = dbRows[0]?.db;
  if (!databaseName) throw new Error('parentDailyLoginGrantPrivileges test: the admin connection string must select a database.');

  await adminConnection.query(`CREATE USER ${userAtHostLiteral} IDENTIFIED BY ?`, [runtimePassword]);

  // Enumerate every base table actually present -- exactly the self-adjusting
  // enumeration provision-runtime-db-grants.mjs uses, never a hardcoded list --
  // and issue the SAME grant-building logic that script uses (imported
  // directly, not hand-rolled) against this real schema.
  const [tableRows] = await adminConnection.query(
    `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const tableNames = tableRows.map((row) => row.table_name);
  const grantStatements = buildRuntimeGrantPlan(databaseName, tableNames, userAtHostLiteral);
  for (const statement of grantStatements) {
    await adminConnection.query(statement);
  }
  await adminConnection.query('FLUSH PRIVILEGES');

  // A SEPARATE, real second connection authenticated AS the throwaway runtime
  // user -- not the admin connection issuing statements "on behalf of" it.
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

  const seededAccountIds = [];
  const seededGrantIds = [];

  /** Minimal VERIFIED parent account the grants FK can point at -- seeded by the admin connection, not by the principal under test. Constraint-valid per parent_accounts_verified_has_free_access_check (VERIFIED requires verified_at + free_access_mode) and parent_accounts_time_limited_has_duration_check (TIME_LIMITED requires a duration). */
  async function seedVerifiedAccount() {
    const accountId = randomUUID();
    await adminConnection.query(
      `INSERT INTO parent_accounts
         (account_id, email_hash, password_hash, status, verified_at, free_access_mode, free_access_duration_days, free_access_started_at, free_access_expires_at)
       VALUES (?, UNHEX(SHA2(?, 256)), 'not-a-real-password-hash', 'VERIFIED', NOW(3), 'TIME_LIMITED', 30, NOW(3), DATE_ADD(NOW(3), INTERVAL 30 DAY))`,
      [accountId, `pdg-priv-${randomUUID()}@example.test`],
    );
    seededAccountIds.push(accountId);
    return accountId;
  }

  test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal can INSERT and UPDATE parent_daily_login_grants (the daily-grant touch statement)', async () => {
    const accountId = await seedVerifiedAccount();
    const grantId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');

    await runtimeConnection.query(
      `INSERT INTO parent_daily_login_grants (grant_id, account_id, token_hash, purpose, created_at, expires_at)
       VALUES (?, ?, ?, 'PARENT_DAILY_LOGIN', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
      [grantId, accountId, tokenHash],
    );
    seededGrantIds.push(grantId);

    // The exact WHERE shape validateAndTouchDailyLoginGrant executes -- the
    // statement whose missing read privilege was the 2026-09-24 production
    // 1143. Post-fix this must succeed through the REAL database, under the
    // exact verbs the plan grants.
    const [result] = await runtimeConnection.query(
      `UPDATE parent_daily_login_grants
       SET last_used_at = NOW(3)
       WHERE account_id = ? AND token_hash = ? AND purpose = 'PARENT_DAILY_LOGIN'
         AND revoked_at IS NULL AND expires_at > NOW(3)`,
      [accountId, tokenHash],
    );
    assert.equal(result.affectedRows, 1, 'the touch must match and update the seeded grant under the plan verbs');
  });

  test('MySQL PRIVILEGE BOUNDARY: the least-privilege runtime principal is still rejected by the DATABASE ITSELF (ER_TABLEACCESS_DENIED_ERROR / 1142) attempting DELETE on parent_daily_login_grants', async () => {
    const accountId = await seedVerifiedAccount();
    const grantId = randomUUID();
    await runtimeConnection.query(
      `INSERT INTO parent_daily_login_grants (grant_id, account_id, token_hash, purpose, created_at, expires_at)
       VALUES (?, ?, ?, 'PARENT_DAILY_LOGIN', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
      [grantId, accountId, randomBytes(32).toString('hex')],
    );
    seededGrantIds.push(grantId);
    await assert.rejects(
      () => runtimeConnection.query(`DELETE FROM parent_daily_login_grants WHERE grant_id = ?`, [grantId]),
      isTableAccessDenied,
      'the plan deliberately declares no DELETE on this table; the boundary must still hold',
    );
  });

  test(PRODUCTION_PATH_TEST_NAME, async () => {
    // WHY THIS CASE EXISTS AT ALL. The cases above drive RAW SQL. That proves
    // the database accepts the touch's statement shape under the plan verbs --
    // and it proves nothing about whether the REAL repository calls work: if
    // MySqlParentAccountRepository's INSERT, the touch's UPDATE, or the revoke
    // UPDATEs needed any privilege the plan does not grant, production would
    // fail with 1143/1142 while everything else stayed green.
    // STORE_TEST_PASS != PRODUCTION_PATH_PASS unless the real writer is driven
    // through the real principal.
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

    const { MySqlParentAccountRepository } = await import('../../dist/parentaccount/MySqlParentAccountRepository.js');
    const { closePool, getPool } = await import('../../dist/db/pool.js');
    try {
      // NON-VACUITY GUARD: if the repoint silently failed to take effect (say
      // db/pool.js had already been pulled in by an earlier import), the pool
      // would be the ADMIN connection, every assertion below would still pass,
      // and the test would claim to certify a least-privilege writer while
      // certifying nothing. Ask the database who the pool actually is.
      const [whoRows] = await getPool().query('SELECT CURRENT_USER() AS db_principal');
      assert.match(
        String(whoRows[0]?.db_principal),
        new RegExp(`^${runtimeUsername}@`),
        'the pool must genuinely be the throwaway least-privilege principal -- not the admin connection',
      );

      const accountId = await seedVerifiedAccount();
      const repository = new MySqlParentAccountRepository();
      const grantId = randomUUID();
      const tokenHash = randomBytes(32).toString('hex');
      seededGrantIds.push(grantId);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // 1. THE REAL WRITER -- the exact call completeLoginStepUp performs.
      await repository.insertDailyLoginGrant({
        grantId,
        accountId,
        tokenHash,
        purpose: 'PARENT_DAILY_LOGIN', // the DB check constraint pins this value
        createdAt: now,
        expiresAt,
      });

      // 2. THE TOUCH -- the statement that failed in production with 1143 for
      //    every second sign-in. It must return true for the grant just written.
      const touched = await repository.validateAndTouchDailyLoginGrant(accountId, tokenHash, new Date());
      assert.equal(touched, true, 'the real touch call must succeed for a live grant it just wrote');

      // 3. THE REVOKE CALLS (sign-out / credential-reset paths).
      await repository.revokeDailyLoginGrant(accountId, tokenHash, new Date());
      const revokedAll = await repository.revokeAllDailyLoginGrants(accountId, new Date());
      assert.equal(typeof revokedAll, 'number');

      // 4. AND THE BOUNDARY STILL HOLDS FOR THE SAME PRINCIPAL that just drove
      //    the real writer: the plan grants no DELETE on this table, so rows
      //    cannot be erased even by the real code path.
      await assert.rejects(
        () => runtimeConnection.query(`DELETE FROM parent_daily_login_grants WHERE grant_id = ?`, [grantId]),
        isTableAccessDenied,
      );
    } finally {
      await closePool().catch(() => {});
    }
  });

  test.after(async () => {
    if (seededGrantIds.length > 0) {
      await adminConnection
        .query(`DELETE FROM parent_daily_login_grants WHERE grant_id IN (?)`, [seededGrantIds])
        .catch(() => {});
    }
    if (seededAccountIds.length > 0) {
      await adminConnection.query(`DELETE FROM parent_accounts WHERE account_id IN (?)`, [seededAccountIds]).catch(() => {});
    }
    await runtimeConnection.end().catch(() => {});
    await adminConnection.query(`DROP USER IF EXISTS ${userAtHostLiteral}`).catch(() => {});
    await adminConnection.end().catch(() => {});
  });
}
