import assert from 'node:assert/strict';
import test from 'node:test';
import { RecoveryTransactionCoordinator } from '../../dist/recoverytransaction/RecoveryTransactionCoordinator.js';

const invalidTimes = [new Date(Number.NaN), null, '2026-01-01T00:00:00Z'];

test('beginOrResume rejects invalid lifecycle time before touching the transaction store', async () => {
  let storeCalls = 0;
  const transactions = {
    async beginOrGetExisting() { storeCalls += 1; throw new Error('must not reach store'); },
  };
  const coordinator = new RecoveryTransactionCoordinator(transactions);

  for (const now of invalidTimes) {
    await assert.rejects(
      () => coordinator.beginOrResume('txn-1', { familyId: 'family-1', trustSetEpoch: 1, keyEpoch: 1 }, now),
      /Recovery transaction time must be a valid Date/,
    );
  }
  assert.equal(storeCalls, 0);
});

test('finalize rejects invalid lifecycle time before transaction, Trust Set, verifier, or ledger access', async () => {
  let transactionCalls = 0;
  let trustSetCalls = 0;
  let verifierCalls = 0;
  let ledgerCalls = 0;
  const coordinator = new RecoveryTransactionCoordinator({
    async beginOrGetExisting() { transactionCalls += 1; throw new Error('must not reach transactions'); },
  });
  const epoch = { familyId: 'family-1', trustSetEpoch: 2, keyEpoch: 2 };
  const opened = { recoveryTransactionId: 'txn-1', familyId: 'family-1' };
  const trustSetStore = { getCurrentEpoch() { trustSetCalls += 1; throw new Error('must not read Trust Set'); } };
  const verifier = { async verify() { verifierCalls += 1; throw new Error('must not verify'); } };
  const ledger = { async claimTransaction() { ledgerCalls += 1; throw new Error('must not claim ledger'); } };

  for (const now of invalidTimes) {
    await assert.rejects(
      () => coordinator.finalize('txn-1', epoch, opened, trustSetStore, verifier, ledger, now),
      /Recovery transaction time must be a valid Date/,
    );
  }
  assert.deepEqual([transactionCalls, trustSetCalls, verifierCalls, ledgerCalls], [0, 0, 0, 0]);
});
