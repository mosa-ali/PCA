import assert from 'node:assert/strict';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InboundReconnectService, envelopeToRelayCiphertext, MAX_INBOUND_LIST_SIZE } from '../../dist/runtime-sync/index.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createTestOnlyEnvelopeSignatureVerifier, signTestOnlyEnvelope } from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const SENDER_PUBLIC_KEY = 'sender-public-key';
const RECIPIENT_DEVICE_ID = 'recipient-1';
let counter = 0;

function buildEnvelope(overrides = {}) {
  counter += 1;
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: `msg-${counter}`,
    familyId: 'family-1',
    senderDeviceId: 'sender-device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: RECIPIENT_DEVICE_ID },
    senderKeyId: 'key-1',
    messageType: 'STATUS_SNAPSHOT',
    sequenceOrNonce: `nonce-${counter}`,
    issuedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, counter)),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from(`payload-${counter}`),
    ...overrides,
  };
  const signature = signTestOnlyEnvelope(overrides.senderPublicKeyOverride ?? SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned));
  return { ...unsigned, signature };
}

function buildHarness(options = {}) {
  const relayService = new RelayService(createInMemoryRelayRepository());
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: options.isNumericSequenceSender ?? (() => false) },
  );
  const inboundService = new InboundReconnectService(relayService, syncCoordinator);
  return { relayService, syncCoordinator, inboundService };
}

async function queueForRecipient(relayService, envelope) {
  await relayService.queueEnvelope({
    messageId: envelope.messageId,
    familyId: envelope.familyId,
    senderDeviceId: envelope.senderDeviceId,
    recipientDeviceId: envelope.recipient.recipientDeviceId,
    ciphertext: envelopeToRelayCiphertext(envelope),
  });
}

function resolveContext(nowUtc = new Date('2026-01-01T01:00:00.000Z')) {
  return () => ({ senderPublicKey: SENDER_PUBLIC_KEY, minimumAcceptedTrustSetEpoch: 0, minimumAcceptedKeyEpoch: 0, now: nowUtc });
}

test('a valid queued envelope is applied, receipted, and acknowledged in relay', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope();
  await queueForRecipient(relayService, envelope);

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.applied[0].messageId, envelope.messageId);
  assert.equal(outcome.receipts.some((r) => r.messageId === envelope.messageId && r.outcome === 'APPLIED'), true);

  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, 0); // acknowledged, no longer QUEUED
});

test('the payload is never touched -- applied envelopes still carry ciphertext bytes verbatim', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope({ payload: Buffer.from('opaque-e2ee-bytes') });
  await queueForRecipient(relayService, envelope);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.ok(outcome.applied[0].payload.equals(Buffer.from('opaque-e2ee-bytes')));
});

test('deterministic (issuedAt, messageId) ordering: an out-of-order numeric-sequence gap holds pending until its predecessor arrives, then both apply', async () => {
  const { relayService, inboundService } = buildHarness({ isNumericSequenceSender: () => true });
  // STATUS_SNAPSHOT (not version-gated) is used here so this test exercises
  // ONLY the numeric-sequence gap dependency, independent of
  // requiresStrictVersionIncrease's separate POLICY_UPDATE-only check.
  const first = buildEnvelope({ sequenceOrNonce: '1', messageType: 'STATUS_SNAPSHOT' });
  const second = buildEnvelope({ sequenceOrNonce: '2', messageType: 'STATUS_SNAPSHOT' });
  // Queue in reverse-arrival order to simulate a relay-order that is NOT authoritative.
  await queueForRecipient(relayService, second);
  await queueForRecipient(relayService, first);

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  const appliedIds = outcome.applied.map((e) => e.messageId).sort();
  assert.deepEqual(appliedIds, [first.messageId, second.messageId].sort());
});

test('a replayed sequenceOrNonce under a different messageId is rejected, never applied twice', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: 'shared-nonce' });
  await queueForRecipient(relayService, envelope);
  await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));

  const replay = buildEnvelope({ sequenceOrNonce: 'shared-nonce' });
  await queueForRecipient(relayService, replay);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.receipts.some((r) => r.messageId === replay.messageId && r.outcome === 'REJECTED'), true);
});

test('correlationId dependency: a PARENT_DECISION from a different sender waits for its CHILD_REQUEST, both in the same reconnect drain', async () => {
  const { relayService, inboundService } = buildHarness();
  const childRequest = buildEnvelope({ messageType: 'CHILD_REQUEST', senderKeyId: 'child-key', senderDeviceId: 'child-device' });
  const parentDecision = buildEnvelope({
    messageType: 'PARENT_DECISION',
    senderKeyId: 'parent-key',
    senderDeviceId: 'parent-device',
    correlationId: childRequest.messageId,
  });

  // Queue the decision BEFORE its predecessor to prove ordering isn't relay-arrival-order.
  await queueForRecipient(relayService, parentDecision);
  await queueForRecipient(relayService, childRequest);

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  const appliedIds = outcome.applied.map((e) => e.messageId).sort();
  assert.deepEqual(appliedIds, [childRequest.messageId, parentDecision.messageId].sort());
});

test('a structurally malformed relay entry is left queued (not acknowledged) rather than silently discarded', async () => {
  const { relayService, inboundService } = buildHarness();
  await relayService.queueEnvelope({
    messageId: 'malformed-1',
    familyId: 'family-1',
    senderDeviceId: 'sender-device-1',
    recipientDeviceId: RECIPIENT_DEVICE_ID,
    ciphertext: Buffer.from('not a valid envelope'),
  });

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.deepEqual(outcome.unparseableMessageIds, ['malformed-1']);
  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, 1);
});

test('MAX_INBOUND_LIST_SIZE bounds a single reconnect attempt; the rest are reported dropped, never silently lost', async () => {
  const { relayService, inboundService } = buildHarness();
  for (let i = 0; i < MAX_INBOUND_LIST_SIZE + 3; i += 1) {
    await queueForRecipient(relayService, buildEnvelope());
  }
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.equal(outcome.applied.length, MAX_INBOUND_LIST_SIZE);
  assert.equal(outcome.droppedForListBound.length, 3);

  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, 3);
});
