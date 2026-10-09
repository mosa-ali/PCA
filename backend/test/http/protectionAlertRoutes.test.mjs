import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerProtectionAlertRoutes } from '../../dist/http/routes/protectionAlertRoutes.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

const PROTECTION_ALERTS_ROUTE = '/api/parent/families/:familyId/protection-alerts';

after(async () => {
  await writeParentRouteScenarioReport();
});

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-01-01T00:00:00.000Z');

const FAMILY = 'family-protection-alerts-http-1';
const OTHER_FAMILY = 'family-protection-alerts-http-other';

function buildApp({ ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW), role = 'ADMINISTRATOR' } = {}) {
  const sessions = new Map([
    ['session-owner', { accountId: 'acct-owner', familyId: FAMILY }],
    ['session-other-owner', { accountId: 'acct-other-owner', familyId: OTHER_FAMILY }],
    ['session-no-family', { accountId: 'acct-no-family', familyId: null }],
  ]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() { return role; },
  };
  const deviceSessions = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-other-parent-device', { deviceId: 'dev-other-parent-device', familyId: FAMILY }],
    ['dev-token-other-family', { deviceId: 'dev-other-family', familyId: OTHER_FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      const identity = deviceSessions.get(token);
      if (!identity || identity.familyId !== familyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return identity;
    },
  };

  const app = Fastify();
  registerProtectionAlertRoutes(app, { parentAccountService, deviceSessionService, protectionAlertLedger: ledger });
  return { app, ledger };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner', authorization: 'Bearer dev-token-owner' };

test('an active Parent browser receives only its own device-scoped opaque protection-alert envelopes', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  await ledger.record({
    alertId: 'alert-owner-1',
    familyId: FAMILY,
    deviceId: 'child-device-1',
    parentDeviceId: 'dev-owner',
    trigger: 'PROTECTION_DEGRADED',
    keyEpoch: 4,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'b3BhcXVl',
    nonceB64: 'bm9uY2U',
  });
  await ledger.record({
    alertId: 'alert-someone-else-1',
    familyId: FAMILY,
    deviceId: 'child-device-2',
    parentDeviceId: 'dev-a-different-parent-device',
    trigger: 'REPEATED_INVALID_PIN',
    keyEpoch: 4,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'c2hvdWxkLW5vdC1hcHBlYXI',
    nonceB64: 'bm9uY2U',
  });
  await ledger.record({
    alertId: 'alert-other-family-1',
    familyId: OTHER_FAMILY,
    deviceId: null,
    parentDeviceId: 'dev-owner',
    trigger: 'INVITATION_REDEEMED',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'b3RoZXItZmFtaWx5',
    nonceB64: 'bm9uY2U',
  });
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'protection_alerts_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    const body = response.json();
    assert.equal(body.alerts.length, 1);
    assert.deepEqual(body.alerts.map((alert) => alert.alertId), ['alert-owner-1']);
    assert.equal(body.alerts.some((alert) => alert.alertId === 'alert-other-family-1'), false);
    assert.equal(body.alerts.some((alert) => alert.alertId === 'alert-someone-else-1'), false);
    assert.equal(body.alerts[0].trigger, 'PROTECTION_DEGRADED');
    assert.equal(body.alerts[0].encryptedPayloadB64, 'b3BhcXVl');
    // The route's own response-shape check: no family-scoped internal field
    // (familyId/parentDeviceId) is ever present -- only the fields a
    // caller's authenticated device is entitled to see for its own queue, and the
    // payload/nonce stay fully opaque (base64 ciphertext, never decoded or
    // interpreted server-side).
    const keys = Object.keys(body.alerts[0]).sort();
    assert.deepEqual(keys, ['alertId', 'deviceId', 'encryptedPayloadB64', 'generatedAtUtc', 'keyEpoch', 'nonceB64', 'trigger']);
  } finally {
    await app.close();
  }
});

test('missing actor-device-session bearer token is rejected even with an active Parent session', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: { cookie: ownerHeaders.cookie },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'actor_device_session_required');
  } finally {
    await app.close();
  }
});

test('a device from a different family cannot read this family’s protection-alert queue', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: { cookie: 'pca_family_session=session-other-owner' },
    });
    // session-other-owner's own familyId (OTHER_FAMILY) never matches the :familyId path param (FAMILY).
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'protection_alerts_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(response.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});

test('a same-family bearer selects only its authenticated Parent-device queue', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  await ledger.record({
    alertId: 'alert-owner-1',
    familyId: FAMILY,
    deviceId: null,
    parentDeviceId: 'dev-owner',
    trigger: 'UNENROLLMENT',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'eA',
    nonceB64: 'eQ',
  });
  await ledger.record({
    alertId: 'alert-other-parent-device-1',
    familyId: FAMILY,
    deviceId: null,
    parentDeviceId: 'dev-other-parent-device',
    trigger: 'UNENROLLMENT',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'b3RoZXItZGV2aWNl',
    nonceB64: 'eQ',
  });
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-other-parent-device' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().alerts.map((alert) => alert.alertId), ['alert-other-parent-device-1']);
  } finally {
    await app.close();
  }
});

test('invalid and foreign-family actor-device sessions fail closed', async () => {
  const { app } = buildApp();
  try {
    for (const token of ['unknown-token', 'dev-token-other-family']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/parent/families/${FAMILY}/protection-alerts`,
        headers: { ...ownerHeaders, authorization: `Bearer ${token}` },
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error, 'actor_device_session_invalid');
    }
  } finally {
    await app.close();
  }
});

test('an active Viewer Parent session can read only its own device queue', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  await ledger.record({
    alertId: 'viewer-alert', familyId: FAMILY, deviceId: null, parentDeviceId: 'dev-owner',
    trigger: 'PROTECTION_DEGRADED', keyEpoch: 2, generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'eA', nonceB64: 'eQ',
  });
  const { app } = buildApp({ ledger, role: 'VIEWER' });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts`, headers: ownerHeaders });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().alerts.map((alert) => alert.alertId), ['viewer-alert']);
  } finally {
    await app.close();
  }
});

test('when actor-device session verification is not configured, the route fails closed', async () => {
  const app = Fastify();
  registerProtectionAlertRoutes(app, {
    parentAccountService: {
      async readSession() { return { accountId: 'acct-owner', familyId: FAMILY }; },
      async activeFamilyRole() { return 'ADMINISTRATOR'; },
    },
    protectionAlertLedger: new InMemoryProtectionAlertLedger(() => LEDGER_NOW),
  });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'not_configured');
  } finally {
    await app.close();
  }
});

test('no session cookie -> 401', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts` });
    assert.equal(response.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'protection_alerts_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
    assert.equal(response.json().error, 'unauthorized');
  } finally {
    await app.close();
  }
});

test('an account with no family scope yet is rejected honestly, not treated as an empty family', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: { cookie: 'pca_family_session=session-no-family', authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'protection_alerts_no_family_scope_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(response.json().error, 'family_scope_required');
  } finally {
    await app.close();
  }
});

test('when protectionAlertLedger is not supplied, the route registers nothing (mirrors registerFamilyAuditEventRoutes’ optional-feature convention)', async () => {
  const app = Fastify();
  registerProtectionAlertRoutes(app, {
    parentAccountService: { async readSession() { throw new Error('should never be called'); } },
  });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts` });
    assert.equal(response.statusCode, 404);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'protection_alerts_optional_route_absent', classification: 'OPTIONAL_ROUTE_ABSENT', expectedStatus: 404, response });
  } finally {
    await app.close();
  }
});
