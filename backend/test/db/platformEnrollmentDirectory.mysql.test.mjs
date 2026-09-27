import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerPlatformAdminAccountsRoutes } from '../../dist/http/routes/platformadmin/accountsRoutes.js';
import { registerPlatformAdminEntitlementRoutes } from '../../dist/http/routes/platformadmin/entitlementRoutes.js';
import { registerComplimentaryGrantRoutes } from '../../dist/http/routes/platformadmin/complimentaryGrantRoutes.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { AccountsReadModel } from '../../dist/platformadmin/readmodels/AccountsReadModel.js';
import { EntitlementRequestsReadModel } from '../../dist/platformadmin/readmodels/EntitlementRequestsReadModel.js';
import { ComplimentaryCapacityReadModel } from '../../dist/platformadmin/readmodels/ComplimentaryCapacityReadModel.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required.');
const configuredDb = new URL(process.env.PCA_DATABASE_URL);
const ownedRun = process.env.PCA_DISPOSABLE_TEST_DATABASE_OWNER === 'with-disposable-db';
const allowedDatabase = configuredDb.pathname === '/pca_test' ||
  (ownedRun && /^\/pca_test_codex_[a-f0-9]{32}$/.test(configuredDb.pathname));
if (!(['127.0.0.1', 'localhost'].includes(configuredDb.hostname) || (ownedRun && configuredDb.hostname === 'mysql')) || !allowedDatabase) {
  throw new Error('This integration test is restricted to local pca_test or a verifier-owned disposable database.');
}

test('MySQL local Platform directory read models support server pagination, calendar filters, and hashed Parent email matching', async () => {
  const pool = getPool();
  const familyId = randomUUID();
  const accountId = randomUUID();
  const email = `directory-${randomUUID()}@example.test`;
  const emailHash = hashParentEmail(email);
  const now = new Date();
  const createdDate = now.toISOString().slice(0, 10);

  await pool.query('INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)', [familyId, randomBytes(32), now]);
  await pool.query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'test-only-password-hash', 'VERIFIED', ?, 'PERPETUAL', ?, ?)`,
    [accountId, emailHash, familyId, now, now],
  );
  await pool.query(
    `INSERT INTO account_entitlements (family_id, plan_ref, parent_member_limit, managed_device_limit, created_at, updated_at)
     VALUES (?, 'FREE_STARTER', 3, 5, ?, ?)`,
    [familyId, now, now],
  );
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO entitlement_change_requests (request_id, family_id, limit_type, current_limit_at_request, target_limit, state, created_at, updated_at)
     VALUES (?, ?, 'PARENT_MEMBER_LIMIT', 3, 4, 'PENDING', ?, ?)`,
    [requestId, familyId, now, now],
  );

  const page = { limit: 20, offset: 0 };
  const accounts = await new AccountsReadModel().list(page, false, { parentEmailHash: emailHash, createdFrom: createdDate, createdTo: createdDate });
  assert.equal(accounts.total, 1);
  assert.equal(accounts.items[0].familyId, familyId);
  assert.equal(accounts.items[0].entitlement?.planRef, 'FREE_STARTER');

  const requests = await new EntitlementRequestsReadModel().list(page, { state: 'PENDING', createdFrom: createdDate, createdTo: createdDate, parentEmailHash: emailHash });
  assert.equal(requests.total, 1);
  assert.equal(requests.items[0].requestId, requestId);

  const capacity = await new ComplimentaryCapacityReadModel().list(page, { createdFrom: createdDate, createdTo: createdDate, parentEmailHash: emailHash });
  assert.equal(capacity.total, 1);
  assert.equal(capacity.items[0].familyId, familyId);
  assert.equal(capacity.items[0].planRef, 'FREE_STARTER');
  assert.equal(capacity.items[0].activeGrantCount, 0);
  assert.equal(capacity.items[0].complimentaryAccess, false);

  const token = `pa_${randomBytes(32).toString('base64url')}`;
  const app = Fastify({ logger: false });
  const authService = { async validateSession(rawToken) {
    if (rawToken !== token) throw new Error('invalid session');
    return { adminId: randomUUID(), roles: ['APP_OWNER'], sessionId: randomUUID(), sessionExpiresAt: new Date(Date.now() + 60_000) };
  } };
  const rateLimiter = createRateLimiter();
  registerPlatformAdminAccountsRoutes(app, { platformAdminAuthService: authService, rateLimiter });
  registerPlatformAdminEntitlementRoutes(app, { platformAdminAuthService: authService, platformAdminEntitlementService: {}, changeRequestRepository: {}, rateLimiter });
  registerComplimentaryGrantRoutes(app, { platformAdminAuthService: authService, platformAdminComplimentaryGrantService: {}, rateLimiter });
  await app.ready();
  try {
    const unauthorized = await app.inject({ method: 'GET', url: '/platform-admin/complimentary-capacity' });
    assert.equal(unauthorized.statusCode, 401);
    const query = new URLSearchParams({ limit: '20', offset: '0', parentEmail: email, createdFrom: createdDate, createdTo: createdDate }).toString();
    const [accountResponse, requestResponse, capacityResponse] = await Promise.all([
      app.inject({ method: 'POST', url: '/platform-admin/accounts/search', headers: { authorization: `Bearer ${token}` }, payload: { limit: 20, offset: 0, parentEmail: email, createdFrom: createdDate, createdTo: createdDate } }),
      app.inject({ method: 'GET', url: `/platform-admin/entitlement-requests?${query}&state=PENDING`, headers: { authorization: `Bearer ${token}` } }),
      app.inject({ method: 'GET', url: `/platform-admin/complimentary-capacity?${query}`, headers: { authorization: `Bearer ${token}` } }),
    ]);
    assert.equal(accountResponse.statusCode, 200);
    assert.equal(requestResponse.statusCode, 200);
    assert.equal(capacityResponse.statusCode, 200);
    assert.equal(accountResponse.json().items[0].familyId, familyId);
    assert.equal(requestResponse.json().items[0].requestId, requestId);
    assert.equal(capacityResponse.json().items[0].familyId, familyId);
    const wireText = `${accountResponse.body}${requestResponse.body}${capacityResponse.body}`;
    assert.equal(wireText.includes(emailHash.toString('hex')), false, 'email hashes never leave the backend');
  } finally {
    await app.close();
  }
});

test.after(async () => { await closePool(); });
