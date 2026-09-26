import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerPlatformAdminBillingReadRoutes } from '../../dist/http/routes/platformadmin/billingReadRoutes.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { BillingReadModel } from '../../dist/platformadmin/readmodels/BillingReadModel.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required.');
const configuredDb = new URL(process.env.PCA_DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(configuredDb.hostname) || configuredDb.pathname !== '/pca_test') {
  throw new Error('This integration test is restricted to the local disposable pca_test database.');
}

test('local custom-quote directory filters by normalized Parent email and inclusive calendar dates', async () => {
  const pool = getPool();
  const familyId = randomUUID();
  const accountId = randomUUID();
  const email = `quote-directory-${randomUUID()}@example.test`;
  const emailHash = hashParentEmail(email);
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const inRangeRequestId = randomUUID();
  const afterRangeRequestId = randomUUID();
  const planId = randomUUID();
  const planCode = `COMMERCIAL_DIRECTORY_${randomUUID()}`;
  const now = new Date();

  await pool.query('INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)', [familyId, randomBytes(32), now]);
  await pool.query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'test-only-password-hash', 'VERIFIED', ?, 'PERPETUAL', ?, ?)`,
    [accountId, emailHash, familyId, now, now],
  );
  await pool.query(
    `INSERT INTO entitlement_change_requests (request_id, family_id, limit_type, current_limit_at_request, target_limit, state, awaiting_admin_quote, created_at, updated_at)
     VALUES (?, ?, 'MANAGED_DEVICE_LIMIT', 2, 4, 'PENDING', 1, ?, ?)`,
    [inRangeRequestId, familyId, start, start],
  );
  await pool.query(
    `INSERT INTO entitlement_change_requests (request_id, family_id, limit_type, current_limit_at_request, target_limit, state, awaiting_admin_quote, created_at, updated_at)
     VALUES (?, ?, 'MANAGED_DEVICE_LIMIT', 2, 5, 'PENDING', 1, ?, ?)`,
    [afterRangeRequestId, familyId, nextDay, nextDay],
  );
  await pool.query(
    `INSERT INTO billing_plans (plan_id, plan_code, plan_version, status, billing_cadence, default_parent_member_limit, default_managed_device_limit, price_book_id, created_at)
     VALUES (?, ?, 1, 'ACTIVE', 'MONTHLY', 3, 5, NULL, ?)`,
    [planId, planCode, now],
  );

  try {
    const result = await new BillingReadModel().listPendingCustomQuoteRequests({ limit: 20, offset: 0 }, {
      parentEmailHash: emailHash,
      sinceCreatedAt: new Date(`${day}T00:00:00.000Z`),
      untilCreatedAt: new Date(`${day}T00:00:00.000Z`),
    });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].requestId, inRangeRequestId);

    const token = `pa_${randomBytes(32).toString('base64url')}`;
    const app = Fastify({ logger: false });
    const authService = { async validateSession(rawToken) {
      if (rawToken !== token) throw new Error('invalid session');
      return { adminId: randomUUID(), roles: ['APP_OWNER'], sessionId: randomUUID(), sessionExpiresAt: new Date(Date.now() + 60_000) };
    } };
    registerPlatformAdminBillingReadRoutes(app, { platformAdminAuthService: authService, rateLimiter: createRateLimiter() });
    await app.ready();
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/platform-admin/quotes/pending' });
      assert.equal(unauthorized.statusCode, 401);
      const query = new URLSearchParams({ parentEmail: ` ${email.toUpperCase()} `, since: day, until: day }).toString();
      const response = await app.inject({ method: 'GET', url: `/platform-admin/quotes/pending?${query}`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().total, 1);
      assert.equal(response.json().items[0].requestId, inRangeRequestId);
      assert.equal(response.body.includes(emailHash.toString('hex')), false);
      assert.equal(response.body.includes(email), false);
      const planQuery = new URLSearchParams({ planCode, status: 'ACTIVE', billingCadence: 'MONTHLY', limit: '1', offset: '0' }).toString();
      const planResponse = await app.inject({ method: 'GET', url: `/platform-admin/billing/plans?${planQuery}`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(planResponse.statusCode, 200);
      assert.equal(planResponse.json().total, 1);
      assert.equal(planResponse.json().items[0].planId, planId);
      assert.equal(planResponse.json().limit, 1);
      const invalid = await app.inject({ method: 'GET', url: '/platform-admin/quotes/pending?parentEmail=not-an-email', headers: { authorization: `Bearer ${token}` } });
      assert.equal(invalid.statusCode, 400);
    } finally {
      await app.close();
    }
  } finally {
    await pool.query('DELETE FROM entitlement_change_requests WHERE request_id IN (?, ?)', [inRangeRequestId, afterRangeRequestId]);
    await pool.query('DELETE FROM parent_accounts WHERE account_id = ?', [accountId]);
    await pool.query('DELETE FROM families WHERE family_id = ?', [familyId]);
    await pool.query('DELETE FROM billing_plans WHERE plan_id = ?', [planId]);
  }
});

test.after(async () => { await closePool(); });
