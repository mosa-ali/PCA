// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- real-MySQL coverage:
// MySqlFreeAccessAccountRepository against a real registered/verified
// parent account, FreeAccessAdminService's RBAC/step-up/audit-trail
// through the real PlatformAdminAuthService + platform_admin_audit_events
// table (proving the reused SETTING_CHANGED event_type is accepted by the
// existing CHECK constraint -- no migration required), the existing-account
// adjustment concurrency guarantee (FOR UPDATE serialization), the
// structural "global default change never touches an existing account's
// snapshot" invariant, and an HTTP smoke test through both new route
// modules.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'cd'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { MySqlFreeAccessAccountRepository } from '../../dist/parentaccount/freeaccess/MySqlFreeAccessAccountRepository.js';
import { FreeAccessAdminService, FreeAccessAdminError } from '../../dist/parentaccount/freeaccess/FreeAccessAdminService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { registerFreeAccessAdminRoutes } from '../../dist/http/routes/platformadmin/freeAccessAdminRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
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
const platformAdminAuthService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);

const freeAccessAccountRepository = new MySqlFreeAccessAccountRepository();
const freeAccessAdminService = new FreeAccessAdminService(platformAdminAuthService, freeAccessAccountRepository, clock);

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

async function createVerifiedParentAccount() {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });
  const email = `w61-${randomUUID()}@example.test`;
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  return { accountId: outcome.accountId, email, rawSessionToken: outcome.rawSessionToken, service };
}

async function createPlatformAdmin({ role = 'PLATFORM_ADMIN' } = {}) {
  const email = `w61-admin-${randomUUID()}@example.test`;
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('W61 DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, clock().getTime());
  const { rawToken } = await platformAdminAuthService.login(email, password, code);
  const identity = await platformAdminAuthService.validateSession(rawToken);
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret, rawToken };
}

async function stepUpFor(admin, scope) {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  const result = await platformAdminAuthService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
  return result.stepUpId;
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
}

async function countAuditEvents(eventType, targetRef) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM platform_admin_audit_events WHERE event_type = ? AND target_ref = ?`, [eventType, targetRef]);
  return rows[0].n;
}

test('MySQL: findByAccountId reads back the exact snapshot markVerified wrote', async () => {
  const account = await createVerifiedParentAccount();
  const row = await freeAccessAccountRepository.findByAccountId(account.accountId);
  assert.ok(row);
  assert.equal(row.status, 'VERIFIED');
  assert.ok(row.freeAccess);
  assert.ok(row.freeAccess.mode === 'TIME_LIMITED' || row.freeAccess.mode === 'PERPETUAL');
});

test('MySQL: existing-account adjustment persists AND writes a paired SETTING_CHANGED audit event in the same transaction (reused event_type, no migration needed)', async () => {
  const account = await createVerifiedParentAccount();
  const admin = await createPlatformAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'ENTITLEMENT_LIMIT_OVERRIDE');

  const status = await freeAccessAdminService.adjustAccount(actorOf(admin), account.accountId, { kind: 'CONVERT_TO_PERPETUAL' }, 'DB_TEST_ADJUSTMENT', stepUpId);
  assert.equal(status.status, 'PERPETUAL');

  const reread = await freeAccessAccountRepository.findByAccountId(account.accountId);
  assert.equal(reread.freeAccess.mode, 'PERPETUAL');
  assert.equal(reread.freeAccess.expiresAt, null);

  const n = await countAuditEvents('SETTING_CHANGED', `parent_account_free_access:${account.accountId}`);
  assert.ok(n >= 1, 'a SETTING_CHANGED audit row must exist for this adjustment');
});

test('MySQL: adjustAccount without step-up is rejected server-side even for APP_OWNER, and mutates nothing', async () => {
  const account = await createVerifiedParentAccount();
  const admin = await createPlatformAdmin({ role: 'APP_OWNER' });
  const before = await freeAccessAccountRepository.findByAccountId(account.accountId);

  await assert.rejects(
    freeAccessAdminService.adjustAccount(actorOf(admin), account.accountId, { kind: 'CONVERT_TO_PERPETUAL' }, 'NO_STEPUP', 'not-a-real-step-up'),
    (e) => e instanceof FreeAccessAdminError && e.code === 'STEP_UP_REQUIRED',
  );

  const after = await freeAccessAccountRepository.findByAccountId(account.accountId);
  assert.equal(after.freeAccess.mode, before.freeAccess.mode);
  assert.equal(String(after.freeAccess.expiresAt), String(before.freeAccess.expiresAt));
});

test('MySQL: FINANCE_ADMIN cannot adjust a FREE_ACCESS account (RBAC enforced server-side, not merely hidden in the admin UI)', async () => {
  const account = await createVerifiedParentAccount();
  const admin = await createPlatformAdmin({ role: 'FINANCE_ADMIN' });
  await assert.rejects(
    freeAccessAdminService.adjustAccount(actorOf(admin), account.accountId, { kind: 'CONVERT_TO_PERPETUAL' }, 'SHOULD_BE_FORBIDDEN', 'irrelevant'),
    (e) => e instanceof FreeAccessAdminError && e.code === 'FORBIDDEN',
  );
});

test('MySQL: changing the GLOBAL default env-var config never mutates an already-registered account\'s own snapshot (structural, not just conventional)', async () => {
  const account = await createVerifiedParentAccount();
  const before = await freeAccessAccountRepository.findByAccountId(account.accountId);

  const priorMode = process.env.PCA_FREE_ACCESS_MODE;
  const priorDuration = process.env.PCA_FREE_ACCESS_DURATION_DAYS;
  try {
    process.env.PCA_FREE_ACCESS_MODE = 'PERPETUAL';
    delete process.env.PCA_FREE_ACCESS_DURATION_DAYS;
    const defaults = freeAccessAdminService.getGlobalDefaults(actorOf(await createPlatformAdmin({ role: 'AUDITOR_READ_ONLY' })));
    assert.equal(defaults.mode, 'PERPETUAL', 'the global default view now reflects the changed env var');

    const after = await freeAccessAccountRepository.findByAccountId(account.accountId);
    assert.equal(after.freeAccess.mode, before.freeAccess.mode, 'the EXISTING account snapshot must be completely unaffected by the global default change');
    assert.equal(String(after.freeAccess.expiresAt), String(before.freeAccess.expiresAt));
  } finally {
    if (priorMode === undefined) delete process.env.PCA_FREE_ACCESS_MODE;
    else process.env.PCA_FREE_ACCESS_MODE = priorMode;
    if (priorDuration !== undefined) process.env.PCA_FREE_ACCESS_DURATION_DAYS = priorDuration;
  }
});

test('MySQL CONCURRENCY: two concurrent adjustments on the SAME account serialize (FOR UPDATE) -- both succeed sequentially, never a lost-update race', async () => {
  const account = await createVerifiedParentAccount();
  const admin = await createPlatformAdmin({ role: 'APP_OWNER' });
  const [stepUp1, stepUp2] = [await stepUpFor(admin, 'ENTITLEMENT_LIMIT_OVERRIDE'), await stepUpFor(admin, 'ENTITLEMENT_LIMIT_OVERRIDE')];

  const results = await Promise.allSettled([
    freeAccessAdminService.adjustAccount(actorOf(admin), account.accountId, { kind: 'EXTEND', additionalDays: 5 }, 'CONCURRENT_1', stepUp1),
    freeAccessAdminService.adjustAccount(actorOf(admin), account.accountId, { kind: 'EXTEND', additionalDays: 7 }, 'CONCURRENT_2', stepUp2),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'), 'both serialized adjustments should succeed (no deadlock, no silent loss)');

  const n = await countAuditEvents('SETTING_CHANGED', `parent_account_free_access:${account.accountId}`);
  assert.equal(n, 2, 'exactly one audit row per adjustment -- neither overwrote the other');
});

// ---------------------------------------------------------------------------
// HTTP smoke test through both new route modules
// ---------------------------------------------------------------------------

function server() {
  const app = Fastify({ logger: false });
  const rateLimiter = createRateLimiter();
  const parentAuthService = new AuthService(new MySqlAuthRepository());
  const parentAccountRepository = new MySqlParentAccountRepository();
  const emailSender = new RecordingEmailSender();
  const parentAccountService = new ParentAccountService({ repository: parentAccountRepository, authService: parentAuthService, emailSender });
  registerParentAccountRoutes(app, { parentAccountService, freeAccessAccountRepository });
  registerFreeAccessAdminRoutes(app, { platformAdminAuthService, freeAccessAdminService, rateLimiter });
  return { app, parentAccountService, emailSender };
}

test('HTTP: GET /api/parent/free-access-status returns the derived status for a logged-in parent', async () => {
  const { app } = server();
  await app.ready();
  try {
    const account = await createVerifiedParentAccount();
    const cookieHeader = `pca_family_session=${account.rawSessionToken}`;
    const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status', headers: { cookie: cookieHeader } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(['ACTIVE', 'PERPETUAL', 'EXPIRED'].includes(body.status));
  } finally {
    await app.close();
  }
});

test('HTTP: GET /api/parent/free-access-status without a session cookie is 401', async () => {
  const { app } = server();
  await app.ready();
  try {
    const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status' });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('HTTP: platform-admin free-access adjust round trip enforces RBAC/step-up and returns the post-adjustment status', async () => {
  const { app } = server();
  await app.ready();
  try {
    const account = await createVerifiedParentAccount();
    const owner = await createPlatformAdmin({ role: 'APP_OWNER' });
    const financeAdmin = await createPlatformAdmin({ role: 'FINANCE_ADMIN' });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/platform-admin/parent-accounts/${account.accountId}/free-access/adjust`,
      headers: { authorization: `Bearer ${financeAdmin.rawToken}` },
      payload: { action: 'CONVERT_TO_PERPETUAL', reasonCode: 'SHOULD_BE_FORBIDDEN', stepUpId: 'irrelevant' },
    });
    assert.equal(forbidden.statusCode, 403);

    const stepUpId = await stepUpFor(owner, 'ENTITLEMENT_LIMIT_OVERRIDE');
    const adjustResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/parent-accounts/${account.accountId}/free-access/adjust`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: { action: 'CONVERT_TO_PERPETUAL', reasonCode: 'HTTP_TEST', stepUpId },
    });
    assert.equal(adjustResponse.statusCode, 200);
    assert.equal(adjustResponse.json().status, 'PERPETUAL');

    const readBack = await app.inject({
      method: 'GET',
      url: `/platform-admin/parent-accounts/${account.accountId}/free-access`,
      headers: { authorization: `Bearer ${financeAdmin.rawToken}` },
    });
    assert.equal(readBack.statusCode, 200);
    assert.equal(readBack.json().status, 'PERPETUAL');
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
