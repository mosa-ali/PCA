// PCA-ADD-PA-017 (Writer65): real-MySQL tests for the narrowest real slice
// of family-account suspend/reactivate -- FamilyAccountStatusService sets
// families.status (migration 0016) under real RBAC/step-up/audit, and
// AccountsReadModel/DashboardReadModel now report it as AVAILABLE (never
// UNAVAILABLE). Mirrors settlement.mysql.test.mjs's admin/step-up helpers.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { FamilyAccountStatusService, FamilyAccountStatusError } from '../../dist/platformadmin/accounts/FamilyAccountStatusService.js';
import { AccountsReadModel } from '../../dist/platformadmin/readmodels/AccountsReadModel.js';
import { DashboardReadModel } from '../../dist/platformadmin/readmodels/DashboardReadModel.js';
import { registerPlatformAdminAccountsRoutes } from '../../dist/http/routes/platformadmin/accountsRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { PlatformAdminAuthService, PlatformAdminAuthError } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const familyStatusService = new FamilyAccountStatusService(authService, clock);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'PLATFORM_ADMIN' } = {}) {
  const email = uniqueEmail('admin');
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, clock().getTime());
  const { rawToken } = await authService.login(email, password, code);
  const identity = await authService.validateSession(rawToken);
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret, rawToken };
}

async function stepUpFor(admin, scope) {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  const result = await authService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
  return result.stepUpId;
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
}

async function createFamily() {
  const familyId = randomUUID();
  await getPool().query(`INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`, [familyId, randomBytes(32)]);
  return familyId;
}

async function countAuditEvents(eventType, targetRef) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM platform_admin_audit_events WHERE event_type = ? AND target_ref = ?`, [eventType, targetRef]);
  return rows[0].n;
}

test('suspend: a real PLATFORM_ADMIN, with real step-up, sets families.status = SUSPENDED and records a real ACCOUNT_SUSPENDED audit row', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const familyId = await createFamily();
  const stepUpId = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');

  const record = await familyStatusService.suspend(actorOf(admin), familyId, 'Fraudulent chargeback pattern', stepUpId);
  assert.equal(record.status, 'SUSPENDED');
  assert.equal(record.suspensionReason, 'Fraudulent chargeback pattern');
  assert.ok(record.suspendedAt);

  const [rows] = await getPool().query(`SELECT status, suspended_by_admin_id FROM families WHERE family_id = ?`, [familyId]);
  assert.equal(rows[0].status, 'SUSPENDED');
  assert.equal(rows[0].suspended_by_admin_id, admin.adminId);

  const auditCount = await countAuditEvents('ACCOUNT_SUSPENDED', `family:${familyId}`);
  assert.equal(auditCount, 1);
});

test('reactivate: a real PLATFORM_ADMIN, with real step-up, sets a suspended family back to ACTIVE, clears suspension fields, and audits ACCOUNT_REACTIVATED', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const familyId = await createFamily();
  const suspendStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
  await familyStatusService.suspend(actorOf(admin), familyId, 'test reason', suspendStepUp);

  const reactivateStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_REACTIVATE');
  const record = await familyStatusService.reactivate(actorOf(admin), familyId, reactivateStepUp);
  assert.equal(record.status, 'ACTIVE');
  assert.equal(record.suspensionReason, null);
  assert.equal(record.suspendedAt, null);

  const auditCount = await countAuditEvents('ACCOUNT_REACTIVATED', `family:${familyId}`);
  assert.equal(auditCount, 1);
});

test('suspend is idempotent-safe against a double-suspend and reactivate against a double-reactivate: the SECOND call fails with ALREADY_SUSPENDED/ALREADY_ACTIVE, never a silent double-audit', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const familyId = await createFamily();

  const stepUp1 = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
  await familyStatusService.suspend(actorOf(admin), familyId, 'first', stepUp1);
  const stepUp2 = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
  await assert.rejects(() => familyStatusService.suspend(actorOf(admin), familyId, 'second', stepUp2), (err) => err instanceof FamilyAccountStatusError && err.code === 'ALREADY_SUSPENDED');
  const auditCount = await countAuditEvents('ACCOUNT_SUSPENDED', `family:${familyId}`);
  assert.equal(auditCount, 1, 'the rejected second attempt must not have written a second audit row');

  const reactivateStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_REACTIVATE');
  await familyStatusService.reactivate(actorOf(admin), familyId, reactivateStepUp);
  const reactivateStepUp2 = await stepUpFor(admin, 'FAMILY_ACCOUNT_REACTIVATE');
  await assert.rejects(() => familyStatusService.reactivate(actorOf(admin), familyId, reactivateStepUp2), (err) => err instanceof FamilyAccountStatusError && err.code === 'ALREADY_ACTIVE');
});

test('RBAC: FINANCE_ADMIN, SUPPORT_ADMIN, and AUDITOR_READ_ONLY cannot suspend or reactivate a family account (only APP_OWNER/PLATFORM_ADMIN can, per rbacPolicy.ts)', async () => {
  const familyId = await createFamily();
  for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']) {
    const admin = await createAdmin({ role });
    await assert.rejects(
      () => familyStatusService.suspend(actorOf(admin), familyId, 'denied', 'irrelevant-step-up-id'),
      (err) => err instanceof FamilyAccountStatusError && err.code === 'FORBIDDEN',
    );
  }
  const [rows] = await getPool().query(`SELECT status FROM families WHERE family_id = ?`, [familyId]);
  assert.equal(rows[0].status, 'ACTIVE', 'a denied RBAC attempt must never mutate status');
});

test('step-up: suspend rejects a real-but-wrong-scope step-up grant (an admin who stepped up for SETTLEMENT_BANK_CONFIG cannot use it to suspend a family)', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const familyId = await createFamily();
  const wrongScopeStepUp = await stepUpFor(admin, 'SETTLEMENT_BANK_CONFIG');
  await assert.rejects(() => familyStatusService.suspend(actorOf(admin), familyId, 'reason', wrongScopeStepUp), PlatformAdminAuthError);
  const [rows] = await getPool().query(`SELECT status FROM families WHERE family_id = ?`, [familyId]);
  assert.equal(rows[0].status, 'ACTIVE');
});

test('AccountsReadModel + DashboardReadModel report families.status as AVAILABLE (never UNAVAILABLE) and reflect a real suspension', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const familyId = await createFamily();
  const before = await new DashboardReadModel().build();
  assert.equal(before.accountsActiveSuspended.capability, 'AVAILABLE');

  const stepUpId = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
  await familyStatusService.suspend(actorOf(admin), familyId, 'reason', stepUpId);

  const after = await new DashboardReadModel().build();
  assert.equal(after.accountsActiveSuspended.suspended, before.accountsActiveSuspended.suspended + 1);

  const readModel = new AccountsReadModel();
  const account = await readModel.getById(familyId);
  assert.equal(account.statusCapability, 'AVAILABLE');
  assert.equal(account.status, 'SUSPENDED');
});

test('HTTP: POST /platform-admin/accounts/:id/suspend then /reactivate round-trips through the real route module, with a 409 on a real double-suspend attempt', async () => {
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const familyId = await createFamily();

  const app = Fastify({ logger: false });
  registerPlatformAdminAccountsRoutes(app, { platformAdminAuthService: authService, rateLimiter: createRateLimiter() });
  await app.ready();
  try {
    const suspendStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
    const suspendResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/accounts/${familyId}/suspend`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { reason: 'HTTP round-trip test', stepUpId: suspendStepUp },
    });
    assert.equal(suspendResponse.statusCode, 200);
    assert.equal(suspendResponse.json().status, 'SUSPENDED');

    const doubleStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_SUSPEND');
    const doubleResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/accounts/${familyId}/suspend`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { reason: 'second attempt', stepUpId: doubleStepUp },
    });
    assert.equal(doubleResponse.statusCode, 409);

    const reactivateStepUp = await stepUpFor(admin, 'FAMILY_ACCOUNT_REACTIVATE');
    const reactivateResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/accounts/${familyId}/reactivate`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { stepUpId: reactivateStepUp },
    });
    assert.equal(reactivateResponse.statusCode, 200);
    assert.equal(reactivateResponse.json().status, 'ACTIVE');
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
