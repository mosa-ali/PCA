import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import '../../scripts/require-owned-disposable-db.mjs';
import { closePool } from '../../dist/db/pool.js';
import { MySqlSafeZoneRepository } from '../../dist/location/MySqlSafeZoneRepository.js';
import { registerSafeZoneDeliveryRoutes } from '../../dist/http/routes/safeZoneDeliveryRoutes.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlSafeZoneRepository();

function newZone(familyId, recipientEndpointId, label) {
  return {
    familyId,
    recipientEndpointId,
    ciphertextB64: Buffer.from(`opaque-policy-${label}`).toString('base64url'),
    nonceB64: randomBytes(12).toString('base64url'),
    keyEpoch: 3,
  };
}

function appFor(identity, resolvedScopes, { role = 'CHILD', safeZoneRepository = repository } = {}) {
  const app = Fastify();
  registerSafeZoneDeliveryRoutes(app, {
    deviceSessionService: {
      async validateSession(token) {
        assert.equal(token, 'verified-session-token');
        return identity;
      },
    },
    trustSetRoleResolver: {
      async resolveActor(familyId, deviceId, dskKeyId) {
        resolvedScopes.push({ familyId, deviceId, dskKeyId });
        return {
          familyId,
          deviceId,
          role,
          trustSetEpoch: 4,
          keyEpoch: 3,
        };
      },
    },
    deviceChildBindingRepository: {
      async resolveBinding(familyId, deviceId) {
        return familyId === identity.familyId && deviceId === identity.deviceId
          ? { outcome: 'BOUND', childProfileId: 'child-profile-from-enrollment' }
          : { outcome: 'UNBOUND' };
      },
    },
    childProfileRegistryRepository: {
      async resolveMembership(familyId, childProfileId) {
        return familyId === identity.familyId && childProfileId === 'child-profile-from-enrollment'
          ? 'MEMBER'
          : 'NOT_MEMBER_OR_NOT_FOUND';
      },
    },
    safeZoneRepository,
    rateLimiter: () => async () => {},
  });
  return app;
}

after(async () => {
  await closePool();
});

test('MySQL HTTP Safe Zone delivery uses verified session scope, returns opaque pages, and excludes other recipients/families', async (t) => {
  const familyId = `family-${randomUUID()}`;
  const recipientDeviceId = `device-${randomUUID()}`;
  const dskKeyId = `dsk-${randomUUID()}`;
  const otherDeviceId = `device-${randomUUID()}`;
  const otherFamilyId = `family-${randomUUID()}`;
  const identity = { familyId, deviceId: recipientDeviceId, dskKeyId };
  const created = [];
  for (let index = 0; index < 18; index += 1) {
    created.push(await repository.create(newZone(familyId, recipientDeviceId, `recipient-${index}`)));
  }
  const staleEpochZone = await repository.create({ ...newZone(familyId, recipientDeviceId, 'stale-epoch'), keyEpoch: 2 });
  const futureEpochZone = await repository.create({ ...newZone(familyId, recipientDeviceId, 'future-epoch'), keyEpoch: 4 });
  await repository.create(newZone(familyId, otherDeviceId, 'same-family-other-device'));
  await repository.create(newZone(otherFamilyId, recipientDeviceId, 'other-family-same-device'));

  const resolvedScopes = [];
  const app = appFor(identity, resolvedScopes);
  t.after(() => app.close());

  const firstResponse = await app.inject({
    method: 'GET',
    url: '/v1/runtime-sync/safe-zones?familyId=attacker-family&deviceId=attacker-device',
    headers: { authorization: 'Bearer verified-session-token' },
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.headers['cache-control'], 'private, no-store');
  const firstPage = firstResponse.json();
  assert.equal(firstPage.safeZones.length, 16);
  assert.ok(firstPage.nextCursor);
  assert.deepEqual(resolvedScopes, [
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
  ]);
  assert.deepEqual(Object.keys(firstPage.safeZones[0]).sort(), [
    'ciphertextB64', 'deliveryState', 'keyEpoch', 'nonceB64', 'revision', 'updatedAtUtc', 'zoneId',
  ]);
  assert.ok(firstPage.safeZones.every((zone) => zone.deliveryState === 'PENDING_OFFLINE'));

  const secondResponse = await app.inject({
    method: 'GET',
    url: `/v1/runtime-sync/safe-zones?cursor=${encodeURIComponent(firstPage.nextCursor)}&familyId=attacker-family`,
    headers: { authorization: 'Bearer verified-session-token' },
  });

  assert.equal(secondResponse.statusCode, 200);
  const secondPage = secondResponse.json();
  assert.equal(secondPage.safeZones.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.ok([...firstPage.safeZones, ...secondPage.safeZones].every((zone) => zone.deliveryState === 'PENDING_OFFLINE'));
  assert.deepEqual(resolvedScopes, [
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
    { familyId, deviceId: recipientDeviceId, dskKeyId },
  ]);
  assert.deepEqual(
    [...firstPage.safeZones, ...secondPage.safeZones].map((zone) => zone.zoneId).sort(),
    created.map((zone) => zone.zoneId).sort(),
  );
  assert.ok(
    [...firstPage.safeZones, ...secondPage.safeZones].every((zone) =>
      created.some((expected) => expected.zoneId === zone.zoneId &&
        expected.ciphertextB64 === zone.ciphertextB64 && expected.nonceB64 === zone.nonceB64)),
  );
  assert.equal([...firstPage.safeZones, ...secondPage.safeZones].some((zone) =>
    zone.zoneId === staleEpochZone.zoneId || zone.zoneId === futureEpochZone.zoneId), false);

  const persisted = await repository.listForRecipient(familyId, recipientDeviceId, 3);
  assert.equal(persisted.safeZones.length, 16);
  assert.ok(persisted.safeZones.every((zone) => zone.deliveryState === 'PENDING_OFFLINE'));
});

test('MySQL HTTP Safe Zone delivery rejects an accepted active Parent or Viewer before querying envelopes', async (t) => {
  for (const role of ['OWNER', 'ADMINISTRATOR', 'VIEWER']) {
    const familyId = `family-${randomUUID()}`;
    const deviceId = `device-${randomUUID()}`;
    const calls = [];
    const deviceIdentity = { familyId, deviceId, dskKeyId: `dsk-${randomUUID()}` };
    const guardedRepository = {
      async listForRecipient(...args) {
        calls.push(args);
        return repository.listForRecipient(...args);
      },
    };
    const app = appFor(deviceIdentity, [], { role, safeZoneRepository: guardedRepository });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/safe-zones', headers: { authorization: 'Bearer verified-session-token' } });
    assert.equal(response.statusCode, 403, role);
    assert.deepEqual(response.json(), { error: 'forbidden' }, role);
    assert.deepEqual(calls, [], `${role} cannot query the child Safe Zone store`);
  }
});
