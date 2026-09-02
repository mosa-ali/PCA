import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerProtectionAlertRoutes } from '../../dist/http/routes/protectionAlertRoutes.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

const FAMILY = 'family-protection-alerts-http-1';
const OTHER_FAMILY = 'family-protection-alerts-http-other';

function buildApp({ ledger = new InMemoryProtectionAlertLedger() } = {}) {
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
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-other-owner', { deviceId: 'dev-other-owner', familyId: OTHER_FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      const identity = deviceTokens.get(token);
      if (!identity || identity.familyId !== expectedFamilyId) {
        throw new RuntimeSyncAuthError('UNAUTHORIZED');
      }
      return identity;
    },
  };

  const app = Fastify();
  registerProtectionAlertRoutes(app, { parentAccountService, deviceSessionService, protectionAlertLedger: ledger });
  return { app, ledger };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner' };

test('a parent device receives only its OWN family/device-scoped opaque protection-alert envelopes -- never another device’s queue, never a family it does not belong to', async () => {
  const ledger = new InMemoryProtectionAlertLedger();
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
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.alerts.length, 1);
    assert.equal(body.alerts[0].alertId, 'alert-owner-1');
    assert.equal(body.alerts[0].trigger, 'PROTECTION_DEGRADED');
    assert.equal(body.alerts[0].encryptedPayloadB64, 'b3BhcXVl');
    // The route's own response-shape check: no family-scoped internal field
    // (familyId/parentDeviceId) is ever present -- only the fields a
    // caller's own device is entitled to see for its own queue, and the
    // payload/nonce stay fully opaque (base64 ciphertext, never decoded or
    // interpreted server-side).
    const keys = Object.keys(body.alerts[0]).sort();
    assert.deepEqual(keys, ['alertId', 'deviceId', 'encryptedPayloadB64', 'generatedAtUtc', 'keyEpoch', 'nonceB64', 'trigger']);
  } finally {
    await app.close();
  }
});

test('no actor-device-session bearer token -> 401, never a silent empty list', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts`, headers: ownerHeaders });
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
      headers: { cookie: 'pca_family_session=session-other-owner', authorization: 'Bearer dev-token-owner' },
    });
    // session-other-owner's own familyId (OTHER_FAMILY) never matches the :familyId path param (FAMILY).
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});

test('an actor device bound to a different family cannot use its bearer token to read this family’s queue even with a matching session cookie', async () => {
  const ledger = new InMemoryProtectionAlertLedger();
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
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/protection-alerts`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-other-owner' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'actor_device_session_invalid');
  } finally {
    await app.close();
  }
});

test('no session cookie -> 401', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts` });
    assert.equal(response.statusCode, 401);
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
    assert.equal(response.json().error, 'family_scope_required');
  } finally {
    await app.close();
  }
});

test('when protectionAlertLedger is not supplied, the route registers nothing (mirrors registerFamilyAuditEventRoutes’ optional-feature convention)', async () => {
  const app = Fastify();
  registerProtectionAlertRoutes(app, {
    parentAccountService: { async readSession() { throw new Error('should never be called'); } },
    deviceSessionService: { async requireActorDeviceInFamily() { throw new Error('should never be called'); } },
  });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/protection-alerts` });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
