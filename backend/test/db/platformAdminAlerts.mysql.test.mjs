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
