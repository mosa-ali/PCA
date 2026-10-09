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
