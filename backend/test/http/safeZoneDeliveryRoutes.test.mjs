import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { registerSafeZoneDeliveryRoutes } from '../../dist/http/routes/safeZoneDeliveryRoutes.js';

const opaqueZone = {
  zoneId: 'zone_1',
  familyId: 'family_internal',
  recipientEndpointId: 'device_internal',
  ciphertextB64: 'AQID',
  nonceB64: 'AAECAwQFBgcICQoL',
  keyEpoch: 2,
  revision: 3,
  deliveryState: 'PENDING_OFFLINE',
  createdAtUtc: '2026-10-10T00:00:00.000Z',
  updatedAtUtc: '2026-10-10T00:00:01.000Z',
};

async function appFor({ sessionResult, repository, trustSetRoleResolver } = {}) {
  const app = Fastify();
  const calls = [];
  registerSafeZoneDeliveryRoutes(app, {
    deviceSessionService: {
      async validateSession(token) {
        calls.push(['validateSession', token]);
        if (sessionResult instanceof Error) throw sessionResult;
        return sessionResult ?? { familyId: 'session_family', deviceId: 'session_device', dskKeyId: 'session_dsk' };
      },
    },
    safeZoneRepository: repository === null
      ? undefined
      : repository === undefined
        ? { async listForRecipient(...args) { calls.push(['listForRecipient', ...args]); return { safeZones: [opaqueZone], nextCursor: null }; } }
        : repository,
    trustSetRoleResolver: trustSetRoleResolver ?? {
      async resolveActor(familyId, deviceId, dskKeyId) {
        calls.push(['resolveActor', familyId, deviceId, dskKeyId]);
        return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 2, keyEpoch: 2 };
      },
    },
    rateLimiter: () => async () => {},
  });
  return { app, calls };
}

test('device Safe Zone delivery derives family and recipient from the verified session and returns opaque fields only', async (t) => {
  const { app, calls } = await appFor();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/runtime-sync/safe-zones?familyId=attacker_family&deviceId=attacker_device',
    headers: { authorization: 'Bearer valid-session' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(calls, [
    ['validateSession', 'valid-session'],
    ['resolveActor', 'session_family', 'session_device', 'session_dsk'],
    ['listForRecipient', 'session_family', 'session_device', undefined],
  ]);
  assert.deepEqual(response.json(), {
    safeZones: [{
      zoneId: 'zone_1',
      ciphertextB64: 'AQID',
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 2,
      revision: 3,
      deliveryState: 'PENDING_OFFLINE',
      updatedAtUtc: '2026-10-10T00:00:01.000Z',
    }],
    nextCursor: null,
  });
});

test('device Safe Zone delivery rejects missing or invalid sessions before repository access', async (t) => {
  for (const scenario of [
    { name: 'missing bearer', headers: {}, sessionResult: undefined },
    { name: 'invalid bearer', headers: { authorization: 'Bearer invalid' }, sessionResult: new RuntimeSyncAuthError('UNAUTHORIZED') },
  ]) {
    const { app, calls } = await appFor({ sessionResult: scenario.sessionResult });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: scenario.headers });
    assert.equal(response.statusCode, 401, scenario.name);
    assert.equal(calls.some(([name]) => name === 'listForRecipient' || name === 'resolveActor'), false, scenario.name);
  }
});

test('device Safe Zone delivery maps session dependency failures and malformed identities to a sanitized 503', async (t) => {
  for (const scenario of [
    { name: 'session dependency failed', sessionResult: new Error('session store sentinel') },
    { name: 'malformed verified identity', sessionResult: { familyId: '', deviceId: 'session_device', dskKeyId: 'session_dsk' } },
  ]) {
    const { app, calls } = await appFor({ sessionResult: scenario.sessionResult });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, 503, scenario.name);
    assert.deepEqual(response.json(), { error: 'device_session_unavailable' }, scenario.name);
    assert.equal(response.body.includes('session store sentinel'), false, scenario.name);
    assert.deepEqual(calls.map(([name]) => name), ['validateSession'], scenario.name);
  }
});

test('device Safe Zone delivery fails closed when the repository is not configured', async (t) => {
  const { app, calls } = await appFor({ repository: null });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(calls.map(([name]) => name), ['validateSession']);
});

test('device Safe Zone delivery fails closed when accepted Trust Set resolution is not configured', async (t) => {
  const app = Fastify();
  const repositoryCalls = [];
  registerSafeZoneDeliveryRoutes(app, {
    deviceSessionService: { async validateSession() { return { familyId: 'family', deviceId: 'device', dskKeyId: 'dsk' }; } },
    safeZoneRepository: { async listForRecipient(...args) { repositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
    rateLimiter: () => async () => {},
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'family_authority_unavailable');
  assert.deepEqual(repositoryCalls, []);
});

test('device Safe Zone delivery maps repository failures to a sanitized 503', async (t) => {
  const { app, calls } = await appFor({
    repository: {
      async listForRecipient(...args) {
        calls.push(['listForRecipient', ...args]);
        throw new Error('database ciphertext sentinel');
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'safe_zone_unavailable' });
  assert.equal(response.body.includes('database ciphertext sentinel'), false);
  assert.deepEqual(calls.map(([name]) => name), ['validateSession', 'resolveActor', 'listForRecipient']);
});

test('device Safe Zone delivery rejects devices missing from the accepted Trust Set', async (t) => {
  const denied = Fastify();
  const deniedCalls = [];
  registerSafeZoneDeliveryRoutes(denied, {
    deviceSessionService: { async validateSession() { return { familyId: 'session_family', deviceId: 'session_device', dskKeyId: 'session_dsk' }; } },
    trustSetRoleResolver: { async resolveActor() { return 'DEVICE_NOT_IN_TRUST_SET'; } },
    safeZoneRepository: { async listForRecipient(...args) { deniedCalls.push(args); return { safeZones: [], nextCursor: null }; } },
    rateLimiter: () => async () => {},
  });
  t.after(() => denied.close());
  const response = await denied.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(deniedCalls, []);
});

test('device Safe Zone delivery rejects malformed accepted-member projections before storage access', async (t) => {
  const repositoryCalls = [];
  const { app } = await appFor({
    trustSetRoleResolver: { async resolveActor() { return { deviceId: 'session_device', role: 'UNRECOGNIZED', trustSetEpoch: 2, keyEpoch: 2 }; } },
    repository: { async listForRecipient(...args) { repositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  assert.deepEqual(repositoryCalls, []);
});

test('device Safe Zone delivery validates and forwards the bounded keyset cursor', async (t) => {
  const { app, calls } = await appFor({
    repository: {
      async listForRecipient(...args) {
        calls.push(['listForRecipient', ...args]);
        return { safeZones: [], nextCursor: null };
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/v1/runtime-sync/safe-zones?cursor=zone_16',
    headers: { authorization: 'Bearer valid-session' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['listForRecipient', 'session_family', 'session_device', 'zone_16']);
});

test('device Safe Zone delivery rejects malformed cursors without reading the repository', async (t) => {
  const { app, calls } = await appFor();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/v1/runtime-sync/safe-zones?cursor=bad%2Fcursor',
    headers: { authorization: 'Bearer valid-session' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'invalid_cursor');
  assert.equal(calls.some(([name]) => name === 'listForRecipient'), false);
});
