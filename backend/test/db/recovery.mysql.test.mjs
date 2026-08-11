import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RecoveryService, RecoveryError } from '../../dist/recovery/RecoveryService.js';
import { MySqlRecoveryRepository } from '../../dist/recovery/MySqlRecoveryRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlRecoveryRepository();
const service = new RecoveryService(repository, () => new Date());

function family() {
  return `family-${randomUUID()}`;
}

test('MySQL: create then fetch a recovery envelope', async () => {
  const familyId = family();
  const stored = await service.storeEnvelope(familyId, Buffer.from('wrapped-material'), 0);
  assert.equal(stored.version, 1);
  const fetched = await service.fetchEnvelope(familyId);
  assert.equal(fetched.ciphertext.toString(), 'wrapped-material');
});

test('MySQL: replace with correct version succeeds and increments version', async () => {
  const familyId = family();
  const first = await service.storeEnvelope(familyId, Buffer.from('first'), 0);
  const second = await service.storeEnvelope(familyId, Buffer.from('second'), first.version);
  assert.equal(second.version, 2);
});

test('MySQL: replace with stale version is a VERSION_MISMATCH, no lost update', async () => {
  const familyId = family();
  await service.storeEnvelope(familyId, Buffer.from('first'), 0);
  await service.storeEnvelope(familyId, Buffer.from('second'), 1);
  const error = await service.storeEnvelope(familyId, Buffer.from('third'), 1).catch((e) => e);
  assert.ok(error instanceof RecoveryError);
  assert.equal(error.code, 'VERSION_MISMATCH');
  assert.equal(error.currentVersion, 2);
  const current = await service.fetchEnvelope(familyId);
  assert.equal(current.ciphertext.toString(), 'second', 'the stale write must not have overwritten the real current value');
});

test('MySQL: delete removes the envelope', async () => {
  const familyId = family();
  await service.storeEnvelope(familyId, Buffer.from('material'), 0);
  await service.deleteEnvelope(familyId);
  await assert.rejects(() => service.fetchEnvelope(familyId), { code: 'NOT_FOUND' });
});

test('MySQL REQUIRED CONCURRENCY: multiple writers using the same expectedVersion -- exactly 1 succeeds, others VERSION_MISMATCH', async () => {
  const familyId = family();
  const base = await service.storeEnvelope(familyId, Buffer.from('base'), 0);

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => service.storeEnvelope(familyId, Buffer.from(`candidate-${i}`), base.version)),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent writer must succeed');
  assert.equal(rejected.length, 19);
  for (const failure of rejected) assert.equal(failure.reason.code, 'VERSION_MISMATCH');

  const final = await service.fetchEnvelope(familyId);
  assert.equal(final.version, 2, 'no silent lost update -- version must have advanced exactly once');
});

test.after(async () => {
  await closePool();
});
