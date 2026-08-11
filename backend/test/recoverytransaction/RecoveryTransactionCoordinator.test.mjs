import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptEpoch } from '../../dist/familytrustset/FamilyTrustSetEngine.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { InMemoryRecoveryTransactionLedger } from '../../dist/familytrustset/RecoveryTransactionLedger.js';
import { RecoveryTransactionCoordinator } from '../../dist/recoverytransaction/RecoveryTransactionCoordinator.js';
import { InMemoryRecoveryTransactionStore } from '../../dist/recoverytransaction/RecoveryTransactionStore.js';
import {
  createTestOnlyTrustSetSignatureVerifier,
  signTestOnlyEpoch,
} from '../support/testOnlyTrustSetSignatureVerifier.mjs';

function entry(overrides = {}) {
  return {
    deviceId: 'owner-device',
    role: 'OWNER',
    dskKeyId: 'owner-dsk-key',
    dskPublicKey: 'owner-dsk-pub',
    dekKeyId: 'owner-dek-key',
    dekPublicKey: 'owner-dek-pub',
    status: 'ACTIVE',
    ...overrides,
  };
}

function buildEpoch(signerPublicKey, overrides = {}) {
  const unsigned = {
    familyId: 'family-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [entry()],
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: null,
    ...overrides,
  };
  const signature = signTestOnlyEpoch(signerPublicKey, canonicalizeTrustSetEpoch(unsigned));
  return { ...unsigned, signature };
}

function buildRecoveryEpoch(overrides = {}) {
  const unsigned = {
    familyId: 'family-1',
    trustSetEpoch: 2,
    keyEpoch: 2,
    entries: [
      entry({ status: 'REVOKED' }),
      entry({
        deviceId: 'replacement-parent-device',
        dskKeyId: 'new-owner-dsk-key',
        dskPublicKey: 'new-owner-dsk-pub',
        dekKeyId: 'new-owner-dek-key',
        dekPublicKey: 'new-owner-dek-pub',
      }),
    ],
    issuedAt: new Date('2026-02-01T00:00:00.000Z'),
    supersedesEpoch: 1,
    ...overrides,
  };
  const signature = signTestOnlyEpoch('new-owner-dsk-pub', canonicalizeTrustSetEpoch(unsigned));
  return { ...unsigned, signature };
}

function opened(overrides = {}) {
  return {
    familyId: 'family-1',
    recoveryEnvelopeId: 'envelope-1',
    recoveryTransactionId: 'txn-1',
    boundTrustSetEpoch: 1,
    boundKeyEpoch: 1,
    ...overrides,
  };
}

async function harness() {
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, verifier);
  const transactions = new InMemoryRecoveryTransactionStore();
  const coordinator = new RecoveryTransactionCoordinator(transactions);
  return { store, verifier, ledger, transactions, coordinator };
}

const NOW = new Date('2026-02-01T00:00:00.000Z');

test('beginOrResume creates exactly one INITIATED record for a fresh transaction id', async () => {
  const { coordinator } = await harness();
  const record = await coordinator.beginOrResume('txn-1', buildRecoveryEpoch(), NOW);

  assert.equal(record.status, 'INITIATED');
  assert.equal(record.recoveryTransactionId, 'txn-1');
});

test('beginOrResume called twice with the same id returns the SAME record, not a second one', async () => {
  const { coordinator } = await harness();
  const first = await coordinator.beginOrResume('txn-1', buildRecoveryEpoch(), NOW);
  const second = await coordinator.beginOrResume('txn-1', buildRecoveryEpoch({ trustSetEpoch: 99 }), NOW);

  assert.deepEqual(second, first);
  assert.equal(second.proposedTrustSetEpoch, first.proposedTrustSetEpoch); // the later call's differing proposal is ignored
});

test('finalize on a valid recovery completes the transaction and applies the epoch', async () => {
  const { store, verifier, ledger, coordinator } = await harness();
  const epoch = buildRecoveryEpoch();

  const outcome = await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);

  assert.equal(outcome.outcome, 'COMPLETE');
  assert.equal(outcome.record.status, 'COMPLETE');
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 2);
});

test('finalize on an invalid recovery marks the transaction FAILED with the rejection reason', async () => {
  const { store, verifier, ledger, coordinator } = await harness();
  const staleEpoch = buildRecoveryEpoch({ trustSetEpoch: 1 });

  const outcome = await coordinator.finalize('txn-1', staleEpoch, opened(), store, verifier, ledger, NOW);

  assert.equal(outcome.outcome, 'REJECTED');
  assert.equal(outcome.reason, 'TRUST_SET_EPOCH_NOT_ADVANCED');
  assert.equal(outcome.record.status, 'FAILED');
  assert.equal(outcome.record.failureReason, 'TRUST_SET_EPOCH_NOT_ADVANCED');
});

// --- Resume / interrupted recovery -----------------------------------------

test('calling finalize again after COMPLETE returns the cached outcome without reapplying (idempotent replay of the coordinator call itself)', async () => {
  const { store, verifier, ledger, coordinator } = await harness();
  const epoch = buildRecoveryEpoch();
  await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);
  const storeStateAfterFirst = store.getCurrentEpoch();

  const second = await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);

  assert.equal(second.outcome, 'COMPLETE');
  assert.deepEqual(store.getCurrentEpoch(), storeStateAfterFirst); // no further mutation
});

test('calling finalize again after FAILED returns the cached failure without re-running acceptance', async () => {
  const { store, verifier, ledger, coordinator } = await harness();
  const staleEpoch = buildRecoveryEpoch({ trustSetEpoch: 1 });
  await coordinator.finalize('txn-1', staleEpoch, opened(), store, verifier, ledger, NOW);

  const second = await coordinator.finalize('txn-1', staleEpoch, opened(), store, verifier, ledger, NOW);

  assert.equal(second.outcome, 'REJECTED');
  assert.equal(second.reason, 'TRUST_SET_EPOCH_NOT_ADVANCED');
});

test('an interrupted recovery (begin, then a later finalize) resumes the SAME transaction rather than starting a new one', async () => {
  const { store, verifier, ledger, coordinator, transactions } = await harness();
  const epoch = buildRecoveryEpoch();

  // "App killed after begin, before finalize" -- simulated by calling beginOrResume alone first.
  const begun = await coordinator.beginOrResume('txn-1', epoch, NOW);
  assert.equal(begun.status, 'INITIATED');

  // Recovery resumes later (new process, same transaction id).
  const outcome = await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);

  assert.equal(outcome.outcome, 'COMPLETE');
  const all = await transactions.get('txn-1');
  assert.equal(all.status, 'COMPLETE');
});

test('an interrupted recovery never produces two owners, two transactions, or mixed epochs for the same id', async () => {
  const { store, verifier, ledger, coordinator } = await harness();
  const epoch = buildRecoveryEpoch();

  // Simulate three separate "resume" attempts against the same interrupted transaction.
  await coordinator.beginOrResume('txn-1', epoch, NOW);
  await coordinator.beginOrResume('txn-1', epoch, NOW);
  const finalOutcome = await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);

  assert.equal(finalOutcome.outcome, 'COMPLETE');
  // Exactly one owner, exactly one epoch value, no partial/mixed state.
  const current = store.getCurrentEpoch();
  const activeOwners = current.entries.filter((e) => e.role === 'OWNER' && e.status === 'ACTIVE');
  assert.equal(activeOwners.length, 1);
  assert.equal(current.trustSetEpoch, 2);
  assert.equal(current.keyEpoch, 2);
});

// --- No support-master-key bypass -------------------------------------------

test('the coordinator has no method that accepts a "support" or "master" credential in place of a real OpenedRecoveryEnvelope', async () => {
  const { coordinator } = await harness();
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(coordinator));
  assert.ok(!methodNames.some((m) => /support|master|bypass|override|admin/i.test(m)));
});

test('finalize with no prior successful epoch acceptance never marks a family RECOVERY_REQUIRED as silently resolved', async () => {
  // Recovery against a family that was never established at all: FamilyTrustSetRecoveryEngine's
  // NO_ESTABLISHED_FAMILY path, surfaced faithfully through the coordinator (no special-casing
  // that would let a not-yet-existing family be "recovered" into existence via this path --
  // that's genesis/acceptEpoch's job, never recovery's).
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();
  const coordinator = new RecoveryTransactionCoordinator(new InMemoryRecoveryTransactionStore());
  const epoch = buildRecoveryEpoch();

  const outcome = await coordinator.finalize('txn-1', epoch, opened(), store, verifier, ledger, NOW);

  assert.equal(outcome.outcome, 'REJECTED');
  assert.equal(outcome.reason, 'NO_ESTABLISHED_FAMILY');
  assert.equal(store.getCurrentEpoch(), null);
});
