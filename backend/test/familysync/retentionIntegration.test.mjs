import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import { applyDeleteNow } from '../../dist/retention/deleteNow.js';
import { InMemoryDeleteNowLedger } from '../../dist/retention/InMemoryDeleteNowLedger.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

// PCA-11 / PCA-12 cross-phase integration (brief Section 30): a
// RETENTION_DELETION_INSTRUCTION and its correlated RETENTION_RECEIPT are
// ordinary FamilyEnvelope message types PCA-11's SyncCoordinator already
// holds pending on an unresolved correlationId (familysync/policy.ts's
// requiresCorrelationPredecessor). This test proves the two lanes compose
// correctly through that existing mechanism -- no new coordinator code is
// added here, and the actual purge decision is PCA-12's own domain logic
// (retention/deleteNow.js), never re-decided by the sync layer.

const SENDER_PUBLIC_KEY = 'sender-public-key-1';
let messageCounter = 0;

function buildEnvelope(overrides = {}) {
  messageCounter += 1;
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: `msg-${messageCounter}`,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: 'key-1',
    messageType: 'STATUS_SNAPSHOT',
    sequenceOrNonce: `nonce-${messageCounter}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from('opaque'),
    ...overrides,
  };
  const signature = signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned));
  return { ...unsigned, signature };
}

function buildCoordinator() {
  return new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: () => false },
  );
}

function baseContext(overrides = {}) {
  return {
    senderPublicKey: SENDER_PUBLIC_KEY,
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
    now: new Date('2026-01-01T00:30:00.000Z'),
    ...overrides,
  };
}

test('retention deletion instruction arrives out of order relative to its receipt: receipt holds pending, applies once, exactly once, after the instruction', async () => {
  const coordinator = buildCoordinator();

  const instruction = buildEnvelope({ messageType: 'RETENTION_DELETION_INSTRUCTION', messageId: 'del-instr-1' });
  const receipt = buildEnvelope({
    messageType: 'RETENTION_RECEIPT',
    messageId: 'del-receipt-1',
    correlationId: 'del-instr-1',
  });

  // Receipt arrives first (e.g. relayed out of order) -- must hold, never apply against an instruction that hasn't landed yet.
  const receiptFirst = await coordinator.submit(receipt, baseContext());
  assert.deepEqual(receiptFirst.decision, {
    kind: 'HOLD_PENDING',
    reason: 'MISSING_CORRELATION_PREDECESSOR',
    waitingOnMessageId: 'del-instr-1',
  });

  // Duplicate receipt delivery while still pending must not create a second pending entry or change the outcome.
  const receiptDuplicate = await coordinator.submit(receipt, baseContext());
  assert.deepEqual(receiptDuplicate.decision, receiptFirst.decision);

  // Instruction arrives -> applies, and the now-eligible receipt drains with it, exactly once.
  const instructionResult = await coordinator.submit(instruction, baseContext());
  assert.equal(instructionResult.decision.kind, 'APPLY_NOW');
  assert.deepEqual(instructionResult.drained, [{ messageId: 'del-receipt-1', decision: { kind: 'APPLY_NOW', idempotent: false } }]);

  // Resubmitting the receipt again afterward is now a stable idempotent apply, not a second HOLD or a second side effect.
  const receiptAgain = await coordinator.submit(receipt, baseContext());
  assert.deepEqual(receiptAgain.decision, { kind: 'APPLY_NOW', idempotent: true });
});

test('an expired deletion instruction never applies, even once its "predecessor problem" is irrelevant -- expiry is independent and authoritative', async () => {
  const coordinator = buildCoordinator();
  const instruction = buildEnvelope({
    messageType: 'RETENTION_DELETION_INSTRUCTION',
    messageId: 'del-instr-2',
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
  });
  const result = await coordinator.submit(instruction, baseContext({ now: new Date('2026-01-01T01:00:00.000Z') }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'EXPIRED' });
});

test('reconnect after a local Delete Now must not restore deleted data: the purge decision lives in retention/deleteNow, independent of and unaffected by envelope resync', async () => {
  const ledger = new InMemoryDeleteNowLedger();
  const records = [{ entityClass: 'WEB_VISIT', id: 'r1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') }];
  const localDeletion = applyDeleteNow('delete-now-1', records, ledger, new Date('2026-01-05T00:00:00.000Z'));
  assert.deepEqual(localDeletion.plan.toDelete.map((e) => e.id), ['r1']);

  // Simulate the device dropping the deleted record from its local store (what a real deletion does),
  // then "reconnecting" and re-running the SAME planning/ledger call with the now-smaller working set.
  const remainingRecords = [];
  const afterReconnect = applyDeleteNow('delete-now-1', remainingRecords, ledger, new Date('2026-01-06T00:00:00.000Z'));
  assert.equal(afterReconnect.idempotent, true);
  assert.deepEqual(afterReconnect.plan.toDelete.map((e) => e.id), ['r1'], 'the ledger recalls the original plan; it never re-derives from the (now-empty) working set');
});
