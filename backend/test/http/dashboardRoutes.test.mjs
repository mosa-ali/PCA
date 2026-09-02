import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerDashboardRoutes } from '../../dist/http/routes/dashboardRoutes.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';

const FAMILY = 'family-dashboard-http-1';
const OTHER_FAMILY = 'family-dashboard-http-other';

function buildApp({ dashboardAggregatorService } = {}) {
  const sessions = new Map([
    ['session-owner', { accountId: 'acct-owner', familyId: FAMILY }],
    ['session-other-owner', { accountId: 'acct-other-owner', familyId: OTHER_FAMILY }],
    ['session-no-family', { accountId: 'acct-no-family', familyId: null }],
  ]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new ParentAccountError('UNAUTHORIZED');
      return session;
    },
  };

  const app = Fastify();
  registerDashboardRoutes(app, { parentAccountService, dashboardAggregatorService });
  return { app };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner' };

test('a parent reads only its own family\'s dashboard cards, requested as a FULL_FAMILY scope', async () => {
  let calledWith = null;
  const dashboardAggregatorService = {
    async getDashboard(familyId, scope) {
      calledWith = { familyId, scope };
      return [
        { kind: 'WEB_FILTERING', capabilityState: 'AVAILABLE', lastAcknowledgedPolicyRevision: null, pendingOrOfflineStatus: 'NONE', summaryLabel: '2 recent site blocks' },
        { kind: 'YOUTUBE', capabilityState: 'LIMITED', lastAcknowledgedPolicyRevision: null, pendingOrOfflineStatus: 'NONE', summaryLabel: null },
      ];
    },
  };
  const { app } = buildApp({ dashboardAggregatorService });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/dashboard`,
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.cards.length, 2);
    assert.equal(body.cards[0].kind, 'WEB_FILTERING');
    assert.equal(body.cards[0].summaryLabel, '2 recent site blocks');
    assert.deepEqual(calledWith, { familyId: FAMILY, scope: { kind: 'FULL_FAMILY' } });
    const keys = Object.keys(body.cards[0]).sort();
    assert.deepEqual(keys, ['capabilityState', 'kind', 'lastAcknowledgedPolicyRevision', 'pendingOrOfflineStatus', 'summaryLabel']);
  } finally {
    await app.close();
  }
});

test('no session cookie -> 401, never a silent empty dashboard', async () => {
  const { app } = buildApp({ dashboardAggregatorService: { async getDashboard() { throw new Error('should never be called'); } } });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/dashboard` });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'unauthorized');
  } finally {
    await app.close();
  }
});

test('a parent session scoped to a different family cannot read this family\'s dashboard', async () => {
  const { app } = buildApp({ dashboardAggregatorService: { async getDashboard() { throw new Error('should never be called'); } } });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/dashboard`,
      headers: { cookie: 'pca_family_session=session-other-owner' },
    });
    // session-other-owner's own familyId (OTHER_FAMILY) never matches the :familyId path param (FAMILY).
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});

test('an account with no family scope yet is rejected honestly, not treated as an empty family', async () => {
  const { app } = buildApp({ dashboardAggregatorService: { async getDashboard() { throw new Error('should never be called'); } } });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/dashboard`,
      headers: { cookie: 'pca_family_session=session-no-family' },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'family_scope_required');
  } finally {
    await app.close();
  }
});

test('an invalid/unknown session token -> 401', async () => {
  const { app } = buildApp({ dashboardAggregatorService: { async getDashboard() { throw new Error('should never be called'); } } });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/dashboard`,
      headers: { cookie: 'pca_family_session=not-a-real-session' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'unauthorized');
  } finally {
    await app.close();
  }
});

test('when dashboardAggregatorService is not supplied, the route registers nothing (mirrors registerFamilyAuditEventRoutes\' optional-feature convention)', async () => {
  const app = Fastify();
  registerDashboardRoutes(app, {
    parentAccountService: { async readSession() { throw new Error('should never be called'); } },
  });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/dashboard` });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
