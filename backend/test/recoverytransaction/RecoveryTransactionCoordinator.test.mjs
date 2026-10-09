import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptEpoch } from '../../dist/familytrustset/FamilyTrustSetEngine.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { InMemoryRecoveryTransactionLedger } from '../../dist/familytrustset/RecoveryTransactionLedger.js';
import { RecoveryTransactionCoordinator } from '../../dist/recoverytransaction/RecoveryTransactionCoordinator.js';
import { InMemoryRecoveryTransactionStore } from '../../dist/recoverytransaction/RecoveryTransactionStore.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';
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

test('concurrent finalize calls through separate coordinators sharing a store return the persisted COMPLETE result', async () => {
  const trustSetStore = new InMemoryFamilyTrustSetStore();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), trustSetStore, createTestOnlyTrustSetSignatureVerifier());

  let signalVerificationStarted;
  const verificationStarted = new Promise((resolve) => { signalVerificationStarted = resolve; });
  let releaseVerification;
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  let verificationCalls = 0;
  const verifier = {
    async verify(publicKey, canonicalBytes, signature) {
      verificationCalls += 1;
      signalVerificationStarted();
      await verificationGate;
      return signature === signTestOnlyEpoch(publicKey, canonicalBytes);
    },
  };

  const transactions = new InMemoryRecoveryTransactionStore();
  const firstCoordinator = new RecoveryTransactionCoordinator(transactions);
  const secondCoordinator = new RecoveryTransactionCoordinator(transactions);
  let ledgerCalls = 0;
  const ledger = { async claimTransaction() { ledgerCalls += 1; return true; } };
  const candidate = buildRecoveryEpoch();
  const proof = opened();

  const first = firstCoordinator.finalize('txn-1', candidate, proof, trustSetStore, verifier, ledger, NOW);
  await verificationStarted;
  const duplicateCandidate = buildRecoveryEpoch();
  const duplicate = secondCoordinator.finalize('txn-1', duplicateCandidate, proof, trustSetStore, verifier, ledger, NOW);
  duplicateCandidate.trustSetEpoch = 99;
  releaseVerification();

  const outcomes = await Promise.all([first, duplicate]);
  assert.deepEqual(outcomes.map((result) => result.outcome), ['COMPLETE', 'COMPLETE']);
  assert.equal(verificationCalls, 1, 'shared-store finalization is serialized across coordinator instances');
  assert.equal(ledgerCalls, 1);
  assert.equal(trustSetStore.getCurrentEpoch().trustSetEpoch, 2);
  const persisted = await transactions.get('txn-1');
  assert.equal(persisted.status, 'COMPLETE');
  assert.deepEqual(outcomes.map((result) => result.record.status), ['COMPLETE', 'COMPLETE']);
});

test('a thrown acceptance attempt leaves INITIATED resumable and releases the per-transaction queue', async () => {
  const { store, ledger, transactions } = await harness();
  let failOnce = true;
  const verifier = {
    async verify(publicKey, canonicalBytes, signature) {
      if (failOnce) {
        failOnce = false;
        throw new Error('temporary verifier failure');
      }
      return signature === signTestOnlyEpoch(publicKey, canonicalBytes);
    },
  };
  const coordinator = new RecoveryTransactionCoordinator(transactions);
  const candidate = buildRecoveryEpoch();
  const proof = opened();

  await assert.rejects(
    () => coordinator.finalize('txn-1', candidate, proof, store, verifier, ledger, NOW),
    /temporary verifier failure/,
  );
  assert.equal((await transactions.get('txn-1')).status, 'INITIATED');

  const resumed = await coordinator.finalize('txn-1', candidate, proof, store, verifier, ledger, NOW);
  assert.equal(resumed.outcome, 'COMPLETE');
  assert.equal((await transactions.get('txn-1')).status, 'COMPLETE');
});

test('out-of-range recovery candidate is rejected before creating a transaction record or verifying', async () => {
  const { store, verifier, ledger, coordinator, transactions } = await harness();
  const valid = buildRecoveryEpoch();
  const overRange = { ...valid, trustSetEpoch: MAX_FAMILY_EPOCH + 1 };

  await assert.rejects(
    () => coordinator.finalize('txn-1', overRange, opened(), store, verifier, ledger, NOW),
    /within the supported family epoch range/,
  );
  assert.equal(await transactions.get('txn-1'), null);
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);
});

test('opened recovery envelope must match transaction id and family before a lifecycle record is created', async () => {
  const { store, verifier, ledger, coordinator, transactions } = await harness();
  const epoch = buildRecoveryEpoch();

  await assert.rejects(
    () => coordinator.finalize('txn-1', epoch, opened({ recoveryTransactionId: 'txn-other' }), store, verifier, ledger, NOW),
    /does not match the requested transaction/,
  );
  await assert.rejects(
    () => coordinator.finalize('txn-1', buildRecoveryEpoch({ familyId: 'family-other' }), opened(), store, verifier, ledger, NOW),
    /does not match the requested transaction/,
  );
  assert.equal(await transactions.get('txn-1'), null);
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);
});

test('a resumed transaction cannot finalize a different family or epoch proposal', async () => {
  const { store, verifier, ledger, coordinator, transactions } = await harness();
  const firstProposal = buildRecoveryEpoch();
  await coordinator.beginOrResume('txn-1', firstProposal, NOW);
  const changedProposal = buildRecoveryEpoch({ trustSetEpoch: 3, keyEpoch: 3 });

  const outcome = await coordinator.finalize('txn-1', changedProposal, opened(), store, verifier, ledger, NOW);

  assert.equal(outcome.outcome, 'REJECTED');
  assert.equal(outcome.reason, 'ENVELOPE_EPOCH_MISMATCH');
  assert.equal(outcome.record.status, 'INITIATED', 'mismatched attempts do not consume or alter the valid transaction');
  assert.equal((await transactions.get('txn-1')).proposedTrustSetEpoch, 2);
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);
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
