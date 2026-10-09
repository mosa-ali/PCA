import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRecoveryTransactionStore } from '../../dist/recoverytransaction/RecoveryTransactionStore.js';

const NOW = new Date('2026-02-01T00:00:00.000Z');

function beginInput(overrides = {}) {
  return {
    recoveryTransactionId: 'recovery-txn-1',
    familyId: 'family-1',
    proposedTrustSetEpoch: 4,
    proposedKeyEpoch: 3,
    now: new Date(NOW.getTime()),
    ...overrides,
  };
}

test('beginOrGetExisting snapshots input dates and returns a detached record', async () => {
  const store = new InMemoryRecoveryTransactionStore();
  const input = beginInput();
  const result = await store.beginOrGetExisting(input);

  input.now.setTime(0);
  result.familyId = 'family-mutated';
  result.status = 'FAILED';
  result.proposedTrustSetEpoch = 99;
  result.initiatedAtUtc.setTime(0);

  const stored = await store.get(input.recoveryTransactionId);
  assert.equal(stored.familyId, 'family-1');
  assert.equal(stored.status, 'INITIATED');
  assert.equal(stored.proposedTrustSetEpoch, 4);
  assert.equal(stored.initiatedAtUtc.toISOString(), NOW.toISOString());
});

test('get and repeated beginOrGetExisting results cannot mutate stored records', async () => {
  const store = new InMemoryRecoveryTransactionStore();
  const input = beginInput();
  await store.beginOrGetExisting(input);

  const fromGet = await store.get(input.recoveryTransactionId);
  const fromResume = await store.beginOrGetExisting(beginInput({ familyId: 'ignored-on-resume' }));
  fromGet.familyId = 'changed-by-get-caller';
  fromGet.initiatedAtUtc.setTime(0);
  fromResume.status = 'COMPLETE';
  fromResume.completedAtUtc = new Date(0);

  const stored = await store.get(input.recoveryTransactionId);
  assert.equal(stored.familyId, 'family-1');
  assert.equal(stored.status, 'INITIATED');
  assert.equal(stored.completedAtUtc, null);
  assert.equal(stored.initiatedAtUtc.toISOString(), NOW.toISOString());
});

test('terminal transition inputs and returned records are detached snapshots', async () => {
  const store = new InMemoryRecoveryTransactionStore();
  await store.beginOrGetExisting(beginInput());

  const completedAt = new Date('2026-02-02T00:00:00.000Z');
  const completeResult = await store.markComplete('recovery-txn-1', completedAt);
  completedAt.setTime(0);
  completeResult.completedAtUtc.setTime(0);
  completeResult.status = 'FAILED';

  const storedComplete = await store.get('recovery-txn-1');
  assert.equal(storedComplete.status, 'COMPLETE');
  assert.equal(storedComplete.completedAtUtc.toISOString(), '2026-02-02T00:00:00.000Z');

  const failedAt = new Date('2026-02-03T00:00:00.000Z');
  const failedStore = new InMemoryRecoveryTransactionStore();
  await failedStore.beginOrGetExisting(beginInput());
  const failedResult = await failedStore.markFailed('recovery-txn-1', 'REJECTED', failedAt);
  failedAt.setTime(0);
  failedResult.completedAtUtc.setTime(0);
  failedResult.failureReason = 'MUTATED';

  const storedFailure = await failedStore.get('recovery-txn-1');
  assert.equal(storedFailure.status, 'FAILED');
  assert.equal(storedFailure.failureReason, 'REJECTED');
  assert.equal(storedFailure.completedAtUtc.toISOString(), '2026-02-03T00:00:00.000Z');
});
