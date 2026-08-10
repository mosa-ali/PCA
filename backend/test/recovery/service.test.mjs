import assert from 'node:assert/strict';
import test from 'node:test';
import { RecoveryService, RecoveryError } from '../../dist/recovery/RecoveryService.js';
import { MAX_ENVELOPE_BYTES, MAX_OPAQUE_ID_LENGTH } from '../../dist/recovery/policy.js';
import { createInMemoryRecoveryRepository } from '../support/inMemoryRecoveryRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function buildService() {
  const repository = createInMemoryRecoveryRepository();
  let currentTime = BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
  };
  const service = new RecoveryService(repository, clock.now);
  return { service, repository, clock };
}

const FAMILY_A = 'family-opaque-A';
const FAMILY_B = 'family-opaque-B';

test('fetchEnvelope for a family with no envelope yet is NOT_FOUND', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.fetchEnvelope(FAMILY_A), { code: 'NOT_FOUND' });
});

test('storeEnvelope creates a new envelope at version 1 with expectedVersion 0', async () => {
  const { service } = buildService();
  const record = await service.storeEnvelope(FAMILY_A, Buffer.from('wrapped-recovery-material'), 0);
  assert.equal(record.version, 1);
  assert.equal(record.familyId, FAMILY_A);
});

test('fetchEnvelope returns the stored ciphertext intact', async () => {
  const { service } = buildService();
  const ciphertext = Buffer.from('wrapped-recovery-material');
  await service.storeEnvelope(FAMILY_A, ciphertext, 0);
  const fetched = await service.fetchEnvelope(FAMILY_A);
  assert.equal(fetched.ciphertext.equals(ciphertext), true);
});

test('creating with expectedVersion 0 when an envelope already exists is a version mismatch, not a silent overwrite', async () => {
  const { service } = buildService();
  await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  const error = await service.storeEnvelope(FAMILY_A, Buffer.from('second'), 0).catch((e) => e);
  assert.ok(error instanceof RecoveryError);
  assert.equal(error.code, 'VERSION_MISMATCH');
  assert.equal(error.currentVersion, 1);
  const stillFirst = await service.fetchEnvelope(FAMILY_A);
  assert.equal(stillFirst.ciphertext.toString(), 'first');
});

test('replacing with the correct current version succeeds and increments the version', async () => {
  const { service } = buildService();
  const first = await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  const second = await service.storeEnvelope(FAMILY_A, Buffer.from('second'), first.version);
  assert.equal(second.version, 2);
  assert.equal(second.ciphertext.toString(), 'second');
});

test('replacing with a stale version is rejected', async () => {
  const { service } = buildService();
  await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  await service.storeEnvelope(FAMILY_A, Buffer.from('second'), 1);
  await assert.rejects(
    () => service.storeEnvelope(FAMILY_A, Buffer.from('third'), 1), // stale: current is now 2
    { code: 'VERSION_MISMATCH', currentVersion: 2 },
  );
});

test('createdAt is preserved across replacement while updatedAt advances', async () => {
  const { service, clock } = buildService();
  const first = await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  clock.advance(60_000);
  const second = await service.storeEnvelope(FAMILY_A, Buffer.from('second'), first.version);
  assert.equal(second.createdAt.getTime(), first.createdAt.getTime());
  assert.equal(second.updatedAt.getTime() > first.updatedAt.getTime(), true);
});

test('concurrent replacement attempts with the same expectedVersion: exactly one succeeds', async () => {
  const { service } = buildService();
  const first = await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, (_, i) => service.storeEnvelope(FAMILY_A, Buffer.from(`candidate-${i}`), first.version)),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 14);
  for (const failure of rejected) assert.equal(failure.reason.code, 'VERSION_MISMATCH');
});

test('deleteEnvelope removes the envelope; subsequent fetch is NOT_FOUND', async () => {
  const { service } = buildService();
  await service.storeEnvelope(FAMILY_A, Buffer.from('material'), 0);
  await service.deleteEnvelope(FAMILY_A);
  await assert.rejects(() => service.fetchEnvelope(FAMILY_A), { code: 'NOT_FOUND' });
});

test('deleteEnvelope on a family with no envelope is NOT_FOUND', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.deleteEnvelope(FAMILY_A), { code: 'NOT_FOUND' });
});

test('after deletion, a fresh envelope can be created again with expectedVersion 0', async () => {
  const { service } = buildService();
  await service.storeEnvelope(FAMILY_A, Buffer.from('first'), 0);
  await service.deleteEnvelope(FAMILY_A);
  const recreated = await service.storeEnvelope(FAMILY_A, Buffer.from('second'), 0);
  assert.equal(recreated.version, 1);
});

test('cross-family isolation: storing/replacing family A never affects family B', async () => {
  const { service } = buildService();
  await service.storeEnvelope(FAMILY_A, Buffer.from('a-material'), 0);
  await assert.rejects(() => service.fetchEnvelope(FAMILY_B), { code: 'NOT_FOUND' });
  await service.storeEnvelope(FAMILY_B, Buffer.from('b-material'), 0);
  const a = await service.fetchEnvelope(FAMILY_A);
  const b = await service.fetchEnvelope(FAMILY_B);
  assert.equal(a.ciphertext.toString(), 'a-material');
  assert.equal(b.ciphertext.toString(), 'b-material');
});

test('empty and oversized ciphertext rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.storeEnvelope(FAMILY_A, Buffer.alloc(0), 0), { code: 'INVALID_INPUT' });
  await assert.rejects(
    () => service.storeEnvelope(FAMILY_A, Buffer.alloc(MAX_ENVELOPE_BYTES + 1), 0),
    { code: 'INVALID_INPUT' },
  );
});

test('oversized familyId rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.storeEnvelope('f'.repeat(MAX_OPAQUE_ID_LENGTH + 1), Buffer.from('x'), 0),
    { code: 'INVALID_INPUT' },
  );
});

test('negative or non-integer expectedVersion rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.storeEnvelope(FAMILY_A, Buffer.from('x'), -1), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.storeEnvelope(FAMILY_A, Buffer.from('x'), 1.5), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.storeEnvelope(FAMILY_A, Buffer.from('x'), Number.NaN), { code: 'INVALID_INPUT' });
});

test('errors never carry ciphertext or family id in their message', async () => {
  const { service } = buildService();
  const secretLooking = Buffer.from('SENTINEL-family-root-recovery-secret-marker');
  await service.storeEnvelope(FAMILY_A, secretLooking, 0);
  const error = await service.storeEnvelope(FAMILY_A, Buffer.from('other'), 0).catch((e) => e);
  assert.equal(error.code, 'VERSION_MISMATCH');
  assert.equal(error.message.includes('SENTINEL'), false);
  assert.equal(JSON.stringify(error).includes('SENTINEL'), false);
});

test('record shape carries no plaintext recovery-secret field, only opaque ciphertext', async () => {
  const { service } = buildService();
  const record = await service.storeEnvelope(FAMILY_A, Buffer.from('material'), 0);
  assert.deepEqual(
    Object.keys(record).sort(),
    ['familyId', 'ciphertext', 'version', 'createdAt', 'updatedAt'].sort(),
  );
  const forbidden = ['plaintext', 'secret', 'recoveryKey', 'password', 'pin'];
  for (const field of forbidden) assert.equal(field in record, false);
});
