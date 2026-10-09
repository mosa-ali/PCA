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
import { InboundReconnectService, envelopeToRawFamilyEnvelope, envelopeToRelayCiphertext, MAX_INBOUND_LIST_SIZE } from '../../dist/runtime-sync/index.js';
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
  const relayRepository = createInMemoryRelayRepository();
  const relayService = new RelayService(relayRepository, options.relayNow);
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
  return { relayService, relayRepository, syncCoordinator, inboundService };
}

test('a campaign traverses empty malformed pages and reaches later eligible ciphertext without ACKing the head', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const { relayService, inboundService } = buildHarness({ relayNow: () => now });
  for (let i = 0; i < 205; i += 1) {
    await relayService.queueEnvelope({ messageId: `a-malformed-${String(i).padStart(3, '0')}`, familyId: 'family-1',
      senderDeviceId: 'sender-device-1', recipientDeviceId: RECIPIENT_DEVICE_ID, ciphertext: Buffer.from('not an envelope') });
  }
  const tail = buildEnvelope({ messageId: 'z-eligible-tail' });
  await queueForRecipient(relayService, tail);
  let cursor;
  let reached = false;
  for (let page = 0; page < 4; page += 1) {
    const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now,
      { sessionIncarnation: 'a'.repeat(64), cursor });
    if (page < 2) { assert.deepEqual(outcome.applied, []); assert.equal(outcome.hasUnresolved, true); }
    reached ||= outcome.applied.some((item) => item.messageId === tail.messageId);
    if (!outcome.hasMore) { assert.equal(outcome.nextCursor, null); break; }
    assert.equal(typeof outcome.nextCursor, 'string');
    assert.notEqual(outcome.nextCursor, cursor);
    cursor = outcome.nextCursor;
  }
  assert.equal(reached, true);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 206);
});

test('an aggregate byte-full permanently held head cannot starve a valid tail in the same campaign', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const { relayService, inboundService } = buildHarness({ relayNow: () => now });
  for (let i = 0; i < 40; i += 1) await queueForRecipient(relayService, buildEnvelope({
    messageId: `a-held-${String(i).padStart(3, '0')}`, messageType: 'PARENT_DECISION',
    correlationId: `absent-request-${i}`, payload: Buffer.alloc(40 * 1024, 7),
  }));
  const tail = buildEnvelope({ messageId: 'z-byte-tail' });
  await queueForRecipient(relayService, tail);
  let cursor;
  let reached = false;
  let pages = 0;
  for (; pages < 6; pages += 1) {
    const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now,
      { sessionIncarnation: 'a'.repeat(64), cursor });
    reached ||= outcome.applied.some((item) => item.messageId === tail.messageId);
    assert.ok(outcome.receipts.every((item) => !outcome.droppedForListBound.includes(item.messageId)));
    if (!outcome.hasMore) break;
    assert.equal(typeof outcome.nextCursor, 'string');
    assert.notEqual(outcome.nextCursor, cursor);
    cursor = outcome.nextCursor;
  }
  assert.ok(pages > 0 && pages < 6);
  assert.equal(reached, true);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 41);
});

test('bounded supplemental predecessor admission cannot move the base cursor past unexamined rows', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const { relayService, inboundService } = buildHarness({ relayNow: () => now });
  const child = buildEnvelope({ messageId: 'z-supplement-child', messageType: 'CHILD_REQUEST' });
  const parent = buildEnvelope({ messageId: 'a-supplement-parent', messageType: 'PARENT_DECISION', correlationId: child.messageId });
  await queueForRecipient(relayService, parent);
  for (let i = 0; i < 110; i += 1) await relayService.queueEnvelope({
    messageId: `b-malformed-${String(i).padStart(3, '0')}`, familyId: 'family-1', senderDeviceId: 'sender-device-1',
    recipientDeviceId: RECIPIENT_DEVICE_ID, ciphertext: Buffer.from('malformed'),
  });
  await queueForRecipient(relayService, child);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now,
    { sessionIncarnation: 'a'.repeat(64) });
  assert.deepEqual(new Set(outcome.applied.map((item) => item.messageId)), new Set([child.messageId, parent.messageId]));
  const claim = JSON.parse(Buffer.from(outcome.nextCursor, 'base64url').toString());
  assert.equal(claim.after.messageId, 'b-malformed-098');
  assert.equal(outcome.hasMore, true);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 112);
});

test('oversized persisted legacy ciphertext is skipped without loading or ACKing it', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const { relayService, relayRepository, inboundService } = buildHarness({ relayNow: () => now });
  await relayRepository.createOrMatchEnvelope({ messageId: 'a-oversized', familyId: 'family-1', senderDeviceId: 'sender-device-1',
    recipientDeviceId: RECIPIENT_DEVICE_ID, ciphertext: Buffer.alloc(65537), state: 'QUEUED', createdAt: now,
    expiresAt: new Date(now.getTime() + 86400000), acknowledgedAt: null });
  const tail = buildEnvelope({ messageId: 'z-after-oversized' });
  await queueForRecipient(relayService, tail);
  const page = await relayRepository.listQueuedPageForRecipient(RECIPIENT_DEVICE_ID, 'family-1', now,
    { after: null, highWater: null, limit: 100 });
  assert.equal(page.records[0].ciphertext, null);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now,
    { sessionIncarnation: 'a'.repeat(64) });
  assert.deepEqual(outcome.unparseableMessageIds, ['a-oversized']);
  assert.equal(outcome.applied[0].messageId, tail.messageId);
  assert.equal(outcome.hasUnresolved, true);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 2);
});

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
  return () => ({ senderPublicKey: SENDER_PUBLIC_KEY, minimumAcceptedTrustSetEpoch: 0, minimumAcceptedKeyEpoch: 0, familyId: 'family-1', now: nowUtc });
}

test('large valid wrappers are paged before acceptance and remain queued until explicit custody ACK', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelopes = Array.from({ length: 100 }, () => buildEnvelope({ payload: Buffer.alloc(40 * 1024, 7) }));
  for (const envelope of envelopes) await queueForRecipient(relayService, envelope);
  const now = new Date('2026-01-01T01:00:00.000Z');
  const first = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now);
  assert.ok(first.applied.length > 0 && first.applied.length < 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.receipts.length, first.applied.length);
  const boundedResponse = {
    scope: { familyId: 'family-1', recipientDeviceId: RECIPIENT_DEVICE_ID },
    applied: first.applied.map(envelopeToRawFamilyEnvelope),
    receipts: first.receipts.map((receipt) => ({
      messageId: receipt.messageId,
      outcome: receipt.outcome,
      atUtc: receipt.atUtc.toISOString(),
      reason: receipt.reason,
    })),
    unparseableMessageIds: first.unparseableMessageIds,
    droppedForListBound: first.droppedForListBound,
    hasMore: first.hasMore,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(boundedResponse), 'utf8') < 2 * 1024 * 1024);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 100);
  const replay = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now);
  assert.deepEqual(replay.applied, first.applied);
  for (const envelope of first.applied) await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, envelope.messageId);
  const next = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now);
  assert.ok(next.applied.length > 0);
  assert.ok(next.applied.every((envelope) => !first.applied.some((prior) => prior.messageId === envelope.messageId)));
});

test('continuation diagnostics are bounded independently of total queue depth', async () => {
  const { relayService, inboundService } = buildHarness();
  for (let i = 0; i < 305; i += 1) await queueForRecipient(relayService, buildEnvelope());
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'), { sessionIncarnation: 'a'.repeat(64) });
  assert.equal(outcome.applied.length, 100);
  assert.equal(outcome.droppedForListBound.length, 0); // unfetched rows are represented by navigation, not an unbounded queue load
  assert.equal(typeof outcome.nextCursor, 'string');
  assert.equal(outcome.hasMore, true);
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 305);
});

test('queued correlation predecessors are paged ahead of large dependents so byte limits cannot starve them', async () => {
  const { relayService, inboundService } = buildHarness();
  const requests = Array.from({ length: 20 }, () => buildEnvelope({
    messageType: 'CHILD_REQUEST', senderDeviceId: 'child-device', payload: Buffer.from('request'),
  }));
  const decisions = requests.map((request) => buildEnvelope({
    messageType: 'PARENT_DECISION', senderDeviceId: 'parent-device', correlationId: request.messageId,
    payload: Buffer.alloc(40 * 1024, 9),
  }));
  for (const decision of decisions) await queueForRecipient(relayService, decision);
  for (const request of requests) await queueForRecipient(relayService, request);

  const now = new Date('2026-01-01T01:00:00.000Z');
  let outcome = await inboundService.reconnectDrainForRecipient(
    RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now, { sessionIncarnation: 'a'.repeat(64) },
  );
  const appliedIds = new Set(outcome.applied.map((envelope) => envelope.messageId));
  assert.ok(requests.some((request) => appliedIds.has(request.messageId)));
  assert.ok(outcome.hasMore);
  for (let page = 0; outcome.hasMore && page < 10; page += 1) {
    assert.equal(typeof outcome.nextCursor, 'string');
    outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now,
      { sessionIncarnation: 'a'.repeat(64), cursor: outcome.nextCursor });
    outcome.applied.forEach((envelope) => appliedIds.add(envelope.messageId));
  }
  assert.equal(outcome.hasMore, false);
  assert.ok(requests.every((request) => appliedIds.has(request.messageId)));
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 40);
});

test('accepted ciphertext remains queued across response loss until explicit acknowledgement', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope();
  await queueForRecipient(relayService, envelope);

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.applied[0].messageId, envelope.messageId);
  assert.equal(outcome.receipts.some((r) => r.messageId === envelope.messageId && r.outcome === 'APPLIED'), true);
  assert.equal(outcome.hasUnresolved, false);

  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, 1);
  const retry = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.deepEqual(retry.applied, outcome.applied);
  assert.equal(retry.receipts[0].reason, 'idempotent redelivery');
  await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, envelope.messageId);
  await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, envelope.messageId);
  assert.deepEqual(await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID), []);
});

test('concurrent reconnect retries return idempotent accepted state and leave ACK ownership with the recipient', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope();
  await queueForRecipient(relayService, envelope);
  const now = new Date('2026-01-01T01:00:00.000Z');

  const [first, second] = await Promise.all([
    inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now),
    inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now),
  ]);

  for (const outcome of [first, second]) {
    assert.deepEqual(outcome.applied.map((item) => item.messageId), [envelope.messageId]);
    assert.deepEqual(outcome.receipts.map((receipt) => [receipt.messageId, receipt.outcome]), [[envelope.messageId, 'APPLIED']]);
    assert.equal(outcome.hasUnresolved, false);
  }
  assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 1);
  await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, envelope.messageId);
  assert.deepEqual(await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID), []);
});

test('the payload is never touched -- applied envelopes still carry ciphertext bytes verbatim', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope({ payload: Buffer.from('opaque-e2ee-bytes') });
  await queueForRecipient(relayService, envelope);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
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

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  const appliedIds = outcome.applied.map((e) => e.messageId).sort();
  assert.deepEqual(appliedIds, [first.messageId, second.messageId].sort());
});

test('a replayed sequenceOrNonce under a different messageId is rejected, never applied twice', async () => {
  const { relayService, inboundService } = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: 'shared-nonce' });
  await queueForRecipient(relayService, envelope);
  await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));

  await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, envelope.messageId);

  const replay = buildEnvelope({ sequenceOrNonce: 'shared-nonce' });
  await queueForRecipient(relayService, replay);
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
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

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  const appliedIds = outcome.applied.map((e) => e.messageId).sort();
  assert.deepEqual(appliedIds, [childRequest.messageId, parentDecision.messageId].sort());
  assert.deepEqual(new Map(outcome.receipts.map((receipt) => [receipt.messageId, receipt.outcome])),
    new Map([[childRequest.messageId, 'APPLIED'], [parentDecision.messageId, 'APPLIED']]));
  assert.equal(outcome.hasUnresolved, false);
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

  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'));
  assert.deepEqual(outcome.unparseableMessageIds, ['malformed-1']);
  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, 1);
});

test('MAX_INBOUND_LIST_SIZE bounds a reconnect page; retained tail is reached by continuation', async () => {
  const { relayService, inboundService } = buildHarness();
  for (let i = 0; i < MAX_INBOUND_LIST_SIZE + 3; i += 1) {
    await queueForRecipient(relayService, buildEnvelope());
  }
  const now = new Date('2026-01-01T01:00:00.000Z');
  const outcome = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now,
    { sessionIncarnation: 'a'.repeat(64) });
  assert.equal(outcome.applied.length, MAX_INBOUND_LIST_SIZE);
  assert.deepEqual(outcome.droppedForListBound, []);
  assert.equal(outcome.hasMore, true);
  const tail = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), now,
    { sessionIncarnation: 'a'.repeat(64), cursor: outcome.nextCursor });
  assert.equal(tail.applied.length, 3);
  assert.equal(tail.hasMore, false);
  assert.equal(tail.nextCursor, null);
  assert.ok(tail.applied.every((item) => !outcome.applied.some((prior) => prior.messageId === item.messageId)));

  const stillQueued = await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID);
  assert.equal(stillQueued.length, MAX_INBOUND_LIST_SIZE + 3);
});

for (const [label, innerChanges, authenticatedFamily] of [
  ['message ID', { messageId: 'forged-inner-id' }, 'family-1'],
  ['family ID', { familyId: 'forged-family' }, 'family-1'],
  ['sender device', { senderDeviceId: 'forged-sender' }, 'family-1'],
  ['recipient device', { recipient: { kind: 'DEVICE', recipientDeviceId: 'other-device' } }, 'family-1'],
  ['unapproved group', { recipient: { kind: 'GROUP', recipientGroup: 'all-devices' } }, 'family-1'],
  ['authenticated family', {}, 'other-authenticated-family'],
]) {
  test(`transport binding rejects ${label} before acceptance or acknowledgement`, async () => {
    const base = buildEnvelope();
    const signed = buildEnvelope({ ...base, ...innerChanges });
    const relayService = new RelayService(createInMemoryRelayRepository());
    let acceptanceCalls = 0;
    const inboundService = new InboundReconnectService(relayService, {
      async reconnectDrain() { acceptanceCalls++; throw new Error('unbound envelope reached acceptance'); },
    });
    await relayService.queueEnvelope({
      messageId: base.messageId, familyId: base.familyId, senderDeviceId: base.senderDeviceId,
      recipientDeviceId: RECIPIENT_DEVICE_ID, ciphertext: envelopeToRelayCiphertext(signed),
    });
    const result = await inboundService.reconnectDrainForRecipient(
      RECIPIENT_DEVICE_ID, authenticatedFamily, resolveContext(), new Date('2026-01-01T01:00:00.000Z'),
    );
    assert.equal(acceptanceCalls, 0);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.receipts, []);
    // An authenticated-family mismatch is excluded by the repository itself,
    // so it exposes neither ciphertext nor diagnostic IDs from that family.
    assert.deepEqual(result.unparseableMessageIds, authenticatedFamily === base.familyId ? [base.messageId] : []);
    assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 1);
  });
}

test('invalid transport binding cannot poison a valid envelope in the same batch', async () => {
  const { relayService, inboundService } = buildHarness();
  const valid = buildEnvelope();
  await queueForRecipient(relayService, valid);
  const invalid = buildEnvelope({ senderDeviceId: 'signed-other-sender' });
  await relayService.queueEnvelope({
    messageId: invalid.messageId, familyId: invalid.familyId, senderDeviceId: 'outer-sender',
    recipientDeviceId: RECIPIENT_DEVICE_ID, ciphertext: envelopeToRelayCiphertext(invalid),
  });
  const result = await inboundService.reconnectDrainForRecipient(
    RECIPIENT_DEVICE_ID, 'family-1', resolveContext(), new Date('2026-01-01T01:00:00.000Z'),
  );
  assert.deepEqual(result.applied.map(e => e.messageId), [valid.messageId]);
  assert.deepEqual(result.unparseableMessageIds, [invalid.messageId]);
  await relayService.acknowledgeEnvelope(RECIPIENT_DEVICE_ID, valid.messageId);
  assert.deepEqual((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).map(e => e.messageId), [invalid.messageId]);
});

for (const [label, changes, reason] of [
  ['trust floor', { minimumAcceptedTrustSetEpoch: 2 }, 'STALE_TRUST_SET_EPOCH'],
  ['key floor', { minimumAcceptedKeyEpoch: 2 }, 'STALE_KEY_EPOCH'],
  ['expiry', { now: new Date('2026-01-02T00:00:00.000Z') }, 'EXPIRED'],
  ['current sender key', { senderPublicKey: 'different-current-key' }, 'INVALID_SIGNATURE'],
  ['production rejecting floor', { minimumAcceptedTrustSetEpoch: Number.MAX_SAFE_INTEGER }, 'STALE_TRUST_SET_EPOCH'],
]) {
  test(`previous acceptance cannot bypass delivery ${label}`, async () => {
    const { relayService, inboundService, syncCoordinator } = buildHarness();
    const envelope = buildEnvelope();
    await queueForRecipient(relayService, envelope);
    const now = new Date('2026-01-01T01:00:00.000Z');
    await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', resolveContext(now), now);
    const oldContext = resolveContext(now)();
    const retry = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', () => ({ ...oldContext, ...changes }), now);
    assert.deepEqual(retry.applied, []);
    assert.ok(retry.receipts.some(r => r.messageId === envelope.messageId && r.outcome === 'REJECTED' && r.reason === reason));
    assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 1);
    // Historical exact acceptance survives; only current delivery was denied.
    assert.deepEqual((await syncCoordinator.submit(envelope, oldContext)).decision, { kind: 'APPLY_NOW', idempotent: true });
  });
}

for (const rotateParentKey of [false, true]) {
  test(`cross-sender pending drain uses its own current key (rotation=${rotateParentKey})`, async () => {
    const { relayService, inboundService, syncCoordinator } = buildHarness();
    const now = new Date('2026-01-01T01:00:00.000Z');
    const child = buildEnvelope({ senderKeyId: 'child-key', senderDeviceId: 'child-device',
      messageType: 'CHILD_REQUEST', senderPublicKeyOverride: 'child-public-key' });
    const parent = buildEnvelope({ senderKeyId: 'parent-key', senderDeviceId: 'parent-device',
      messageType: 'PARENT_DECISION', correlationId: child.messageId, senderPublicKeyOverride: 'parent-public-key' });
    let currentParentKey = 'parent-public-key';
    const context = senderKeyId => ({ ...resolveContext(now)(),
      senderPublicKey: senderKeyId === 'parent-key' ? currentParentKey : 'child-public-key' });
    await queueForRecipient(relayService, parent);
    const held = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', context, now);
    assert.deepEqual(held.applied, []);
    assert.equal(held.receipts.find((receipt) => receipt.messageId === parent.messageId)?.outcome, 'HELD_PENDING');
    assert.equal(held.hasUnresolved, true);
    if (rotateParentKey) currentParentKey = 'rotated-parent-public-key';
    await queueForRecipient(relayService, child);
    const result = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, 'family-1', context, now);
    assert.equal(result.applied.some(e => e.messageId === child.messageId), true);
    assert.equal(result.applied.some(e => e.messageId === parent.messageId), !rotateParentKey);
    const accepted = await syncCoordinator.messageIdempotencyLedger.getAcceptedCanonicalBytes('family-1', parent.messageId);
    if (rotateParentKey) {
      assert.equal(accepted, null);
      assert.ok(result.receipts.some(r => r.messageId === parent.messageId && r.outcome === 'REJECTED' && r.reason === 'INVALID_SIGNATURE'));
    } else {
      assert.equal(accepted, canonicalizeEnvelope(parent));
    }
    assert.equal((await relayService.listQueuedForRecipient(RECIPIENT_DEVICE_ID)).length, 2);
  });
}
