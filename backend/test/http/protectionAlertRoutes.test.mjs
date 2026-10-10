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

function buildApp({ ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW), role = 'ADMINISTRATOR', trustSetRoleResolver, useTrustSetRoleResolver = true } = {}) {
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
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY, dskKeyId: 'dsk-dev-owner' }],
    ['dev-token-other-parent-device', { deviceId: 'dev-other-parent-device', familyId: FAMILY, dskKeyId: 'dsk-dev-other-parent-device' }],
    ['dev-token-other-family', { deviceId: 'dev-other-family', familyId: OTHER_FAMILY, dskKeyId: 'dsk-dev-other-family' }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      const identity = deviceSessions.get(token);
      if (!identity || identity.familyId !== familyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return identity;
    },
  };

  const resolvedRoles = new Map([
    ['dev-owner', 'OWNER'],
    ['dev-other-parent-device', 'VIEWER'],
    ['dev-other-family', 'OWNER'],
  ]);
  const roleResolver = trustSetRoleResolver ?? {
    async resolveActor(familyId, deviceId, dskKeyId) {
      const identity = [...deviceSessions.values()].find((candidate) => candidate.deviceId === deviceId);
      if (!identity || identity.familyId !== familyId || identity.dskKeyId !== dskKeyId) return 'DEVICE_NOT_ACTIVE';
      return { deviceId, role: resolvedRoles.get(deviceId), trustSetEpoch: 2, keyEpoch: 1 };
    },
  };

  const app = Fastify();
  registerProtectionAlertRoutes(app, {
    parentAccountService,
    deviceSessionService,
    protectionAlertLedger: ledger,
    ...(useTrustSetRoleResolver ? { trustSetRoleResolver: roleResolver } : {}),
  });
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
    assert.equal(response.headers['cache-control'], 'private, no-store');
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

test('protection-alert read rejects a zero accepted key epoch before ledger access', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  let listCalls = 0;
  const list = ledger.listForParentDevice.bind(ledger);
  ledger.listForParentDevice = async (...args) => { listCalls += 1; return list(...args); };
  const resolverCalls = [];
  const trustSetRoleResolver = {
    async resolveActor(...args) {
      resolverCalls.push(args);
      return { deviceId: 'dev-owner', role: 'OWNER', trustSetEpoch: 3, keyEpoch: 0 };
    },
  };
  const { app } = buildApp({ ledger, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(resolverCalls, [[FAMILY, 'dev-owner', 'dsk-dev-owner']]);
    assert.equal(listCalls, 0, 'an impossible accepted key epoch must not authorize a ciphertext queue read');
  } finally {
    await app.close();
  }
});

test('Parent alert reads accept only Parent-capable Trust Set device roles and reject a child before ledger access', async () => {
  for (const role of ['OWNER', 'ADMINISTRATOR', 'VIEWER']) {
    let listCalls = 0;
    const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
    const list = ledger.listForParentDevice.bind(ledger);
    ledger.listForParentDevice = async (...args) => { listCalls += 1; return list(...args); };
    const { app } = buildApp({
      ledger,
      trustSetRoleResolver: {
        async resolveActor(familyId, deviceId, dskKeyId) {
          assert.deepEqual([familyId, deviceId, dskKeyId], [FAMILY, 'dev-owner', 'dsk-dev-owner']);
          return { deviceId, role, trustSetEpoch: 2, keyEpoch: 1 };
        },
      },
    });
    try {
      const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts`, headers: ownerHeaders });
      assert.equal(response.statusCode, 200, `${role} device should remain eligible under an authorized Parent session`);
      assert.equal(listCalls, 1);
    } finally {
      await app.close();
    }
  }

  let childListCalls = 0;
  const childLedger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const childList = childLedger.listForParentDevice.bind(childLedger);
  childLedger.listForParentDevice = async (...args) => { childListCalls += 1; return childList(...args); };
  const { app } = buildApp({
    ledger: childLedger,
    trustSetRoleResolver: {
      async resolveActor(familyId, deviceId, dskKeyId) {
        assert.deepEqual([familyId, deviceId, dskKeyId], [FAMILY, 'dev-owner', 'dsk-dev-owner']);
        return { deviceId, role: 'CHILD', trustSetEpoch: 2, keyEpoch: 1 };
      },
    },
  });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts`, headers: ownerHeaders });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(childListCalls, 0, 'a child actor must be rejected before its queue is read through a Parent endpoint');
  } finally {
    await app.close();
  }
});

test('stale/mismatched DSK authority fails closed before reading the protection-alert ledger', async () => {
  const failures = [
    ['old DSK', async () => 'DEVICE_NOT_ACTIVE'],
    ['mismatched device projection', async () => ({ deviceId: 'dev-other-parent-device', role: 'OWNER', trustSetEpoch: 2, keyEpoch: 1 })],
    ['malformed projection', async () => ({ deviceId: 'dev-owner', role: 'OWNER', trustSetEpoch: 0, keyEpoch: 1 })],
    ['zero key epoch projection', async () => ({ deviceId: 'dev-owner', role: 'OWNER', trustSetEpoch: 2, keyEpoch: 0 })],
    ['out-of-range key epoch projection', async () => ({ deviceId: 'dev-owner', role: 'OWNER', trustSetEpoch: 2, keyEpoch: 2_147_483_648 })],
    ['resolver outage', async () => { throw new Error('authority unavailable'); }],
  ];
  for (const [label, resolveActor] of failures) {
    const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
    let listCalls = 0;
    const list = ledger.listForParentDevice.bind(ledger);
    ledger.listForParentDevice = async (...args) => { listCalls += 1; return list(...args); };
    const { app } = buildApp({ ledger, trustSetRoleResolver: { resolveActor } });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/parent/families/${FAMILY}/protection-alerts`,
        headers: ownerHeaders,
      });
      assert.equal(response.statusCode, label === 'resolver outage' ? 503 : 403, label);
      assert.equal(listCalls, 0, `${label}: authority denial must precede ledger access`);
    } finally {
      await app.close();
    }
  }
});

test('missing Trust Set resolver fails closed before reading the protection-alert ledger', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  let listCalls = 0;
  const list = ledger.listForParentDevice.bind(ledger);
  ledger.listForParentDevice = async (...args) => { listCalls += 1; return list(...args); };
  const { app } = buildApp({ ledger, useTrustSetRoleResolver: false });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'authority_unavailable');
    assert.equal(listCalls, 0);
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
