import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlPlatformAdminAlertAdapter } from '../../dist/platformadmin/auth/MySqlPlatformAdminAlertAdapter.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

test.after(async () => {
  await closePool();
});

function emailHash(value) {
  return createHash('sha256').update(value).digest();
}

async function createAdmin(adminId, role, label) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO platform_admin_accounts
       (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
     VALUES (?, ?, ?, 'test-only', 'ACTIVE', NOW(3), NULL)`,
    [adminId, emailHash(`${label}-${adminId}@example.test`), label],
  );
  await pool.query(
    `INSERT INTO platform_admin_role_assignments
       (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id)
     VALUES (?, ?, ?, NOW(3), NULL, NULL)`,
    [randomUUID(), adminId, role],
  );
}

test('MySQL: PA-020 alert adapter creates one durable pending row per other active APP_OWNER and is idempotent', async () => {
  const sourceAdminId = randomUUID();
  const recipientAdminId = randomUUID();
  const supportAdminId = randomUUID();
  await createAdmin(sourceAdminId, 'FINANCE_ADMIN', 'Source Finance Admin');
  await createAdmin(recipientAdminId, 'APP_OWNER', 'Recipient Owner');
  await createAdmin(supportAdminId, 'SUPPORT_ADMIN', 'Support Admin');

  const correlationId = randomUUID();
  const adapter = new MySqlPlatformAdminAlertAdapter();
  const event = {
    kind: 'LOCKED_OUT',
    sourceAdminId,
    adminEmailHash: emailHash('source@example.test'),
    correlationId,
    occurredAt: new Date(),
  };
  await adapter.notifyAppOwners(event);
  await adapter.notifyAppOwners(event);

  const [eligibleOwners] = await getPool().query(
    `SELECT DISTINCT recipient.admin_id AS admin_id
       FROM platform_admin_accounts recipient
       INNER JOIN platform_admin_role_assignments assignment
         ON assignment.admin_id = recipient.admin_id
        AND assignment.role = 'APP_OWNER'
        AND assignment.revoked_at IS NULL
      WHERE recipient.status = 'ACTIVE' AND recipient.admin_id <> ?`,
    [sourceAdminId],
  );
  const [rows] = await getPool().query(
    `SELECT recipient_admin_id, source_admin_id, kind, delivery_state, delivered_at
       FROM platform_admin_security_alerts
      WHERE correlation_id = ?`,
    [correlationId],
  );
  assert.equal(rows.length, eligibleOwners.length);
  const expectedRecipients = new Set(eligibleOwners.map((row) => row.admin_id));
  const actualRecipients = new Set(rows.map((row) => row.recipient_admin_id));
  assert.deepEqual(actualRecipients, expectedRecipients);
  assert.equal(actualRecipients.has(recipientAdminId), true);
  assert.equal(actualRecipients.has(sourceAdminId), false);
  assert.equal(actualRecipients.has(supportAdminId), false);
  for (const row of rows) {
    assert.equal(row.source_admin_id, sourceAdminId);
    assert.equal(row.kind, 'LOCKED_OUT');
    assert.equal(row.delivery_state, 'PENDING');
    assert.equal(row.delivered_at, null);
  }
});

test('MySQL: PA-020 alert adapter does not create a recipient row when the source identity is unavailable', async () => {
  const correlationId = randomUUID();
  const adapter = new MySqlPlatformAdminAlertAdapter();
  await adapter.notifyAppOwners({
    kind: 'LOGIN_FAILED',
    sourceAdminId: null,
    adminEmailHash: emailHash('unknown@example.test'),
    correlationId,
    occurredAt: new Date(),
  });
  const [rows] = await getPool().query(`SELECT alert_id FROM platform_admin_security_alerts WHERE correlation_id = ?`, [correlationId]);
  assert.equal(rows.length, 0);
});

// PCA-DEC-033 register row: REAL WRITER, not a direct adapter call.
//
// The two tests above drive `MySqlPlatformAdminAlertAdapter` DIRECTLY -- they
// construct it and call `notifyAppOwners` themselves. That proves the adapter
// writes correctly, and proves nothing about whether anything in production ever
// calls it. `STORE_TEST_PASS != PRODUCTION_PATH_PASS` is exactly this shape: a
// store whose own test passes while no running system reaches it.
//
// This test drives the REAL consumer chain instead, end to end: a genuine failed
// login through `PlatformAdminAuthService.login` (the real service, the real MySQL
// repository) reaches `recordFailureAndMaybeAlert`, which resolves the ACCOUNT's
// own active roles and, because the source holds APP_OWNER, calls the injected
// `alertPort` -- injected here as the REAL `MySqlPlatformAdminAlertAdapter`. The
// durable row is then read back from the database. Nothing between the HTTP-facing
// service and the row is a double.
//
// The case is chosen so the alert path is the ONLY thing that can produce the row:
// the account is ACTIVE and holds APP_OWNER (so `roles` is non-empty), and the
// password is a real scrypt credential for a DIFFERENT password (so the failure is
// a genuine credential mismatch rather than a malformed-credential short circuit).
test('MySQL REAL-WRITER: a failed login through the REAL PlatformAdminAuthService reaches the real alert adapter and durably notifies the other APP_OWNER', async () => {
  const { MySqlPlatformAdminAuthRepository } = await import('../../dist/platformadmin/auth/MySqlAuthRepository.js');
  const { PlatformAdminAuthService, PlatformAdminAuthError } = await import('../../dist/platformadmin/auth/PlatformAdminAuthService.js');
  const { hashAdminEmail } = await import('../../dist/platformadmin/auth/emailHash.js');
  const { hashPassword } = await import('../../dist/platformadmin/auth/passwordCredential.js');

  const sourceAdminId = randomUUID();
  const recipientAdminId = randomUUID();
  const sourceEmail = `real-writer-source-${sourceAdminId}@example.test`;
  const pool = getPool();

  await pool.query(
    `INSERT INTO platform_admin_accounts
       (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
     VALUES (?, ?, 'Real Writer Source Owner', ?, 'ACTIVE', NOW(3), NULL)`,
    [sourceAdminId, hashAdminEmail(sourceEmail), await hashPassword('the-real-password')],
  );
  await pool.query(
    `INSERT INTO platform_admin_role_assignments
       (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id)
     VALUES (?, ?, 'APP_OWNER', NOW(3), NULL, NULL)`,
    [randomUUID(), sourceAdminId],
  );
  await createAdmin(recipientAdminId, 'APP_OWNER', 'Real Writer Recipient Owner');

  const [beforeRows] = await pool.query(
    `SELECT alert_id FROM platform_admin_security_alerts WHERE source_admin_id = ?`,
    [sourceAdminId],
  );
  assert.equal(beforeRows.length, 0, 'precondition: this account has produced no alert rows yet');

  const service = new PlatformAdminAuthService(new MySqlPlatformAdminAuthRepository(), new MySqlPlatformAdminAlertAdapter());
  await assert.rejects(
    () => service.login(sourceEmail, 'definitely-not-the-real-password', '000000'),
    (err) => err instanceof PlatformAdminAuthError,
    'a wrong password must fail with the single generic error',
  );

  const [rows] = await pool.query(
    `SELECT recipient_admin_id, source_admin_id, kind, delivery_state, delivered_at
       FROM platform_admin_security_alerts
      WHERE source_admin_id = ?`,
    [sourceAdminId],
  );
  assert.ok(rows.length > 0, 'the real service must have reached the real adapter and written a durable alert row');
  const recipients = rows.map((row) => row.recipient_admin_id);
  assert.equal(
    recipients.includes(recipientAdminId),
    true,
    'the other active APP_OWNER must be notified -- this is the property the direct adapter tests could not reach',
  );
  assert.equal(recipients.includes(sourceAdminId), false, 'the source owner must never be notified of its own failure');
  for (const row of rows) {
    assert.equal(row.kind, 'LOGIN_FAILED', 'a wrong password is LOGIN_FAILED, not LOCKED_OUT');
    assert.equal(row.delivery_state, 'PENDING');
    assert.equal(row.delivered_at, null, 'the row must not claim an external delivery happened');
  }

  // Nothing is fabricated on the failure path: the login attempt itself was
  // recorded too, so the alert is an addition to the audit trail, not a
  // substitute for it.
  const [attempts] = await pool.query(
    `SELECT outcome FROM platform_admin_login_attempts WHERE email_hash = ? ORDER BY occurred_at DESC LIMIT 1`,
    [hashAdminEmail(sourceEmail)],
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, 'FAILED_CREDENTIALS');
});
