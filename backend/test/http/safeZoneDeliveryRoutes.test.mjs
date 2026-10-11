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

async function appFor({ sessionResult, repository, trustSetRoleResolver, deviceChildBindingRepository, childProfileRegistryRepository } = {}) {
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
    deviceChildBindingRepository: deviceChildBindingRepository ?? {
      async resolveBinding(familyId, deviceId) {
        calls.push(['resolveBinding', familyId, deviceId]);
        return { outcome: 'BOUND', childProfileId: 'child-profile-a' };
      },
    },
    childProfileRegistryRepository: childProfileRegistryRepository === null
      ? undefined
      : childProfileRegistryRepository ?? {
          async resolveMembership(familyId, childProfileId) {
            calls.push(['resolveMembership', familyId, childProfileId]);
            return familyId === 'session_family' && childProfileId === 'child-profile-a' ? 'MEMBER' : 'NOT_MEMBER_OR_NOT_FOUND';
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
    ['resolveBinding', 'session_family', 'session_device'],
    ['resolveMembership', 'session_family', 'child-profile-a'],
    ['resolveActor', 'session_family', 'session_device', 'session_dsk'],
    ['listForRecipient', 'session_family', 'session_device', 2, undefined],
    ['resolveBinding', 'session_family', 'session_device'],
    ['resolveMembership', 'session_family', 'child-profile-a'],
    ['resolveActor', 'session_family', 'session_device', 'session_dsk'],
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

test('device Safe Zone delivery fails closed when durable child binding is unavailable or not uniquely BOUND', async (t) => {
  for (const scenario of [
    { name: 'unconfigured binding resolver', bindingRepository: null, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'binding dependency failure', bindingRepository: { async resolveBinding() { throw new Error('binding store sentinel'); } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'unbound device', bindingRepository: { async resolveBinding() { return { outcome: 'UNBOUND' }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { name: 'ambiguous child binding', bindingRepository: { async resolveBinding() { return { outcome: 'AMBIGUOUS' }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { name: 'inactive device binding', bindingRepository: { async resolveBinding() { return { outcome: 'DEVICE_INACTIVE' }; } }, expectedStatus: 403, expectedError: 'forbidden' },
  ]) {
    const app = Fastify();
    const repositoryCalls = [];
    registerSafeZoneDeliveryRoutes(app, {
      deviceSessionService: { async validateSession() { return { familyId: 'family', deviceId: 'device', dskKeyId: 'dsk' }; } },
      trustSetRoleResolver: { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 2, keyEpoch: 2 }; } },
      deviceChildBindingRepository: scenario.bindingRepository ?? undefined,
      childProfileRegistryRepository: { async resolveMembership() { return 'MEMBER'; } },
      safeZoneRepository: { async listForRecipient(...args) { repositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
      rateLimiter: () => async () => {},
    });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, scenario.expectedStatus, scenario.name);
    assert.deepEqual(response.json(), { error: scenario.expectedError }, scenario.name);
    assert.deepEqual(repositoryCalls, [], `${scenario.name} must not read encrypted envelopes`);
  }
});

test('device Safe Zone delivery requires current family registry membership for the bound child profile', async (t) => {
  for (const scenario of [
    { name: 'registry dependency missing', registry: null, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'registry read fails', registry: { async resolveMembership() { throw new Error('membership store sentinel'); } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'bound profile was not registered in this family', registry: { async resolveMembership() { return 'NOT_MEMBER_OR_NOT_FOUND'; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { name: 'registry returned an unknown outcome', registry: { async resolveMembership() { return 'UNKNOWN'; } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
  ]) {
    const repositoryCalls = [];
    const { app } = await appFor({
      childProfileRegistryRepository: scenario.registry,
      repository: { async listForRecipient(...args) { repositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
    });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, scenario.expectedStatus, scenario.name);
    assert.deepEqual(response.json(), { error: scenario.expectedError }, scenario.name);
    assert.deepEqual(repositoryCalls, [], `${scenario.name} must fail before encrypted reads`);
  }
});

test('device Safe Zone delivery rechecks exact active CHILD authority after binding and after reading the page', async (t) => {
  for (const scenario of ['changes_after_binding', 'changes_during_repository_read']) {
    let authorityReads = 0;
    let repositoryReads = 0;
    const repositoryCalls = [];
    const resolver = {
      async resolveActor(familyId, deviceId) {
        authorityReads += 1;
        const changed = scenario === 'changes_after_binding'
          ? authorityReads >= 2
          : authorityReads >= 3 && repositoryReads === 1;
        return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 2, keyEpoch: changed ? 3 : 2 };
      },
    };
    const repository = {
      async listForRecipient(...args) {
        repositoryReads += 1;
        repositoryCalls.push(args);
        return { safeZones: [{ ...opaqueZone }], nextCursor: null };
      },
    };
    const { app } = await appFor({ trustSetRoleResolver: resolver, repository });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, 409, scenario);
    assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' }, scenario);
    assert.equal(repositoryReads, scenario === 'changes_after_binding' ? 0 : 1, scenario);
    assert.deepEqual(repositoryCalls.length, repositoryReads);
    assert.equal(response.body.includes('ciphertextB64'), false, 'the stale-authority page must not reach the device');
  }
});

test('device Safe Zone delivery rejects a changed binding or registry membership after the encrypted page read', async (t) => {
  for (const scenario of ['binding_changed', 'membership_revoked']) {
    let bindingReads = 0;
    let membershipReads = 0;
    const repositoryCalls = [];
    const { app } = await appFor({
      deviceChildBindingRepository: {
        async resolveBinding() {
          bindingReads += 1;
          return {
            outcome: 'BOUND',
            childProfileId: scenario === 'binding_changed' && bindingReads > 1 ? 'child-profile-b' : 'child-profile-a',
          };
        },
      },
      childProfileRegistryRepository: {
        async resolveMembership(_familyId, childProfileId) {
          membershipReads += 1;
          if (scenario === 'membership_revoked' && membershipReads > 1) return 'NOT_MEMBER_OR_NOT_FOUND';
          return childProfileId === 'child-profile-a' ? 'MEMBER' : 'NOT_MEMBER_OR_NOT_FOUND';
        },
      },
      repository: {
        async listForRecipient(...args) {
          repositoryCalls.push(args);
          return { safeZones: [{ ...opaqueZone }], nextCursor: null };
        },
      },
    });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, 403, scenario);
    assert.deepEqual(response.json(), { error: 'forbidden' }, scenario);
    assert.equal(repositoryCalls.length, 1, 'the first authorized read occurs before the simulated binding/registry change');
    assert.equal(response.body.includes('AQID'), false, 'an envelope is not returned after the binding/registry changes');
  }
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
  assert.deepEqual(calls.map(([name]) => name), [
    'validateSession', 'resolveActor', 'resolveBinding', 'resolveMembership', 'resolveActor', 'listForRecipient',
  ]);
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

test('device Safe Zone delivery is restricted to an accepted active CHILD recipient', async (t) => {
  for (const role of ['OWNER', 'ADMINISTRATOR', 'VIEWER']) {
    const repositoryCalls = [];
    const { app } = await appFor({
      trustSetRoleResolver: {
        async resolveActor(_familyId, deviceId) {
          return { deviceId, role, trustSetEpoch: 2, keyEpoch: 2 };
        },
      },
      repository: { async listForRecipient(...args) { repositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
    });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
    assert.equal(response.statusCode, 403, role);
    assert.deepEqual(response.json(), { error: 'forbidden' }, role);
    assert.deepEqual(repositoryCalls, [], `${role} must not read child Safe Zone envelopes`);
  }

  const inactiveRepositoryCalls = [];
  const { app } = await appFor({
    trustSetRoleResolver: { async resolveActor() { return 'DEVICE_NOT_ACTIVE'; } },
    repository: { async listForRecipient(...args) { inactiveRepositoryCalls.push(args); return { safeZones: [], nextCursor: null }; } },
  });
  t.after(() => app.close());
  const inactive = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer valid-session' } });
  assert.equal(inactive.statusCode, 403);
  assert.deepEqual(inactiveRepositoryCalls, []);
});

test('device Safe Zone delivery validates and forwards the epoch-bound cursor', async (t) => {
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
    url: `/v1/runtime-sync/safe-zones?cursor=${encodeURIComponent('v1~2~zone_16')}`,
    headers: { authorization: 'Bearer valid-session' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.filter(([name]) => name === 'listForRecipient').at(-1), ['listForRecipient', 'session_family', 'session_device', 2, 'v1~2~zone_16']);
});

test('device Safe Zone delivery accepts legacy raw cursors for repository restart handling', async (t) => {
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
    url: '/v1/runtime-sync/safe-zones?cursor=legacy_zone_16',
    headers: { authorization: 'Bearer valid-session' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.filter(([name]) => name === 'listForRecipient').at(-1), ['listForRecipient', 'session_family', 'session_device', 2, 'legacy_zone_16']);
});

test('device Safe Zone delivery rejects malformed or oversized cursors without reading the repository', async (t) => {
  const { app, calls } = await appFor();
  t.after(() => app.close());
  const cursors = [
    'bad/cursor',
    'v2~2~zone_16',
    'v1~0~zone_16',
    'v1~2~',
    'v1~2~zone_16~extra',
    'x'.repeat(161),
  ];
  for (const cursor of cursors) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runtime-sync/safe-zones?cursor=${encodeURIComponent(cursor)}`,
      headers: { authorization: 'Bearer valid-session' },
    });
    assert.equal(response.statusCode, 400, cursor);
    assert.equal(response.json().error, 'invalid_cursor', cursor);
  }
  assert.equal(calls.some(([name]) => name === 'listForRecipient'), false);
});
