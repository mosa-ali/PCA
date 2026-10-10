import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { closePool } from '../../dist/db/pool.js';
import { MySqlSafeZoneRepository } from '../../dist/location/MySqlSafeZoneRepository.js';
import { SafeZoneError } from '../../dist/location/SafeZoneRepository.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlSafeZoneRepository();

function newZone(familyId = randomUUID()) {
  return {
    familyId,
    recipientEndpointId: randomUUID(),
    ciphertextB64: 'AQID',
    nonceB64: 'AAECAwQFBgcICQoL',
    keyEpoch: 2,
  };
}

after(async () => {
  await closePool();
});

test('MySQL Safe Zone: key epoch may advance with a complete ciphertext/nonce pair and cannot roll back', async () => {
  const created = await repository.create(newZone());
  const advanced = await repository.update(created.familyId, created.zoneId, {
    ciphertextB64: 'BAUG',
    nonceB64: 'EBESExQVFhcYGRob',
    keyEpoch: 4,
  });

  assert.equal(advanced.keyEpoch, 4);
  assert.equal(advanced.revision, created.revision + 1);
  assert.equal(advanced.ciphertextB64, 'BAUG');
  assert.equal(advanced.nonceB64, 'EBESExQVFhcYGRob');
  assert.equal(advanced.deliveryState, 'PENDING_OFFLINE');

  await assert.rejects(
    () => repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BwgJ',
      nonceB64: 'ICEiIyQlJicoKSor',
      keyEpoch: 3,
    }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );

  const [afterRejectedRollback] = await repository.list(created.familyId);
  assert.equal(afterRejectedRollback.keyEpoch, 4);
  assert.equal(afterRejectedRollback.revision, advanced.revision);
  assert.equal(afterRejectedRollback.ciphertextB64, advanced.ciphertextB64);
  assert.equal(afterRejectedRollback.nonceB64, advanced.nonceB64);
});

test('MySQL Safe Zone: create snapshots the validated payload before asynchronous database work', async () => {
  const input = newZone();
  const expected = { ...input };
  const pending = repository.create(input);
  input.familyId = `mutated-${randomUUID()}`;
  input.recipientEndpointId = `mutated-${randomUUID()}`;
  input.ciphertextB64 = 'not-canonical-base64url!';
  input.nonceB64 = 'short';
  input.keyEpoch = 0;

  const created = await pending;
  assert.equal(created.familyId, expected.familyId);
  assert.equal(created.recipientEndpointId, expected.recipientEndpointId);
  assert.equal(created.ciphertextB64, expected.ciphertextB64);
  assert.equal(created.nonceB64, expected.nonceB64);
  assert.equal(created.keyEpoch, expected.keyEpoch);
  assert.equal(created.revision, 1);
  assert.equal(created.deliveryState, 'PENDING_OFFLINE');
});

test('MySQL Safe Zone: update snapshots the validated ciphertext, nonce, and epoch before asynchronous database work', async () => {
  const created = await repository.create(newZone());
  const patch = {
    ciphertextB64: 'BAUG',
    nonceB64: 'EBESExQVFhcYGRob',
    keyEpoch: 4,
  };
  const pending = repository.update(created.familyId, created.zoneId, patch);
  patch.ciphertextB64 = 'not-canonical-base64url!';
  patch.nonceB64 = 'short';
  patch.keyEpoch = 0;

  const updated = await pending;
  assert.equal(updated.ciphertextB64, 'BAUG');
  assert.equal(updated.nonceB64, 'EBESExQVFhcYGRob');
  assert.equal(updated.keyEpoch, 4);
  assert.equal(updated.revision, created.revision + 1);
  assert.equal(updated.deliveryState, 'PENDING_OFFLINE');
});

test('MySQL Safe Zone: family-scoped update hides a zone owned by another family', async () => {
  const created = await repository.create(newZone());

  await assert.rejects(
    () => repository.update(randomUUID(), created.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 9,
    }),
    (error) => error instanceof SafeZoneError && error.code === 'NOT_FOUND',
  );

  const [unchanged] = await repository.list(created.familyId);
  assert.equal(unchanged.keyEpoch, 2);
  assert.equal(unchanged.revision, created.revision);
  assert.equal(unchanged.ciphertextB64, created.ciphertextB64);
  assert.equal(unchanged.nonceB64, created.nonceB64);
});

test('MySQL Safe Zone delivery: list is restricted to the authenticated family and recipient device', async () => {
  const familyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const otherDeviceId = randomUUID();
  const otherFamilyId = randomUUID();
  const recipientZone = await repository.create({ ...newZone(familyId), recipientEndpointId: recipientDeviceId });
  await repository.create({ ...newZone(familyId), recipientEndpointId: otherDeviceId });
  await repository.create({ ...newZone(otherFamilyId), recipientEndpointId: recipientDeviceId });

  const result = await repository.listForRecipient(familyId, recipientDeviceId);
  assert.deepEqual(result.safeZones.map((zone) => zone.zoneId), [recipientZone.zoneId]);
  assert.equal(result.safeZones[0].ciphertextB64, recipientZone.ciphertextB64);
  assert.equal(result.safeZones[0].deliveryState, 'PENDING_OFFLINE');
  assert.equal(result.nextCursor, null);
  assert.deepEqual(await repository.listForRecipient(randomUUID(), recipientDeviceId), { safeZones: [], nextCursor: null });
});

test('MySQL Safe Zone delivery: pages are bounded and advance without crossing recipient scope', async () => {
  const familyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const created = [];
  for (let index = 0; index < 18; index += 1) {
    created.push(await repository.create({
      familyId,
      recipientEndpointId: recipientDeviceId,
      ciphertextB64: Buffer.from(`policy-${index}`).toString('base64url'),
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 1,
    }));
  }
  const firstPage = await repository.listForRecipient(familyId, recipientDeviceId);
  assert.equal(firstPage.safeZones.length, 16);
  assert.ok(firstPage.nextCursor);
  const secondPage = await repository.listForRecipient(familyId, recipientDeviceId, firstPage.nextCursor);
  assert.equal(secondPage.safeZones.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(
    [...firstPage.safeZones, ...secondPage.safeZones].map((zone) => zone.zoneId).sort(),
    created.map((zone) => zone.zoneId).sort(),
  );
});

test('MySQL Safe Zone CONCURRENCY: serialized epoch updates leave the highest accepted key epoch', async () => {
  const created = await repository.create(newZone());
  const attempts = await Promise.allSettled([
    repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 4,
    }),
    repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BwgJ',
      nonceB64: 'ICEiIyQlJicoKSor',
      keyEpoch: 3,
    }),
  ]);

  assert.ok(attempts.some((attempt) => attempt.status === 'fulfilled'));
  for (const attempt of attempts) {
    if (attempt.status === 'rejected') {
      assert.ok(attempt.reason instanceof SafeZoneError);
      assert.equal(attempt.reason.code, 'INVALID_INPUT');
    }
  }
  const [persisted] = await repository.list(created.familyId);
  assert.equal(persisted.keyEpoch, 4);
  assert.ok(persisted.revision === created.revision + 1 || persisted.revision === created.revision + 2);
});
