import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InboundReconnectService, OutboundRelayService, envelopeToRelayCiphertext } from '../../dist/runtime-sync/index.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createTestOnlyEnvelopeSignatureVerifier, signTestOnlyEnvelope } from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const SENDER_PUBLIC_KEY = 'sender-public-key';
const RECIPIENT_DEVICE_ID = 'recipient-1';

function buildEnvelope(overrides = {}) {
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: 'stable-msg-1',
    familyId: 'family-1',
    senderDeviceId: 'sender-device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: RECIPIENT_DEVICE_ID },
    senderKeyId: 'key-1',
    messageType: 'POLICY_UPDATE',
    sequenceOrNonce: 'nonce-1',
    issuedAt: new Date('2026-01-01T00:00:01.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from('policy-bytes'),
    ...overrides,
  };
  return { ...unsigned, signature: signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned)) };
}

function resolveContext(nowUtc) {
  return () => ({ senderPublicKey: SENDER_PUBLIC_KEY, minimumAcceptedTrustSetEpoch: 0, minimumAcceptedKeyEpoch: 0, now: nowUtc });
}

test('flapping reconnect: the same envelope redelivered across repeated online/offline/online cycles is applied exactly once', async () => {
  const relayService = new RelayService(createInMemoryRelayRepository());
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: () => false },
  );
  const inboundService = new InboundReconnectService(relayService, syncCoordinator);
  const envelope = buildEnvelope();

  await relayService.queueEnvelope({
    messageId: envelope.messageId,
    familyId: envelope.familyId,
    senderDeviceId: envelope.senderDeviceId,
    recipientDeviceId: RECIPIENT_DEVICE_ID,
    ciphertext: envelopeToRelayCiphertext(envelope),
  });

  const now = new Date('2026-01-01T01:00:00.000Z');
  // online (first drain applies it and acknowledges in relay)
  const firstDrain = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(now), now);
  assert.equal(firstDrain.applied.length, 1);

  // offline / online / offline / online -- flap several times. Each flap
  // re-triggers a reconnect drain; since relay already acknowledged the
  // envelope, listQueuedForRecipient no longer returns it, so nothing is
  // redelivered, let alone reapplied.
  for (let flap = 0; flap < 4; flap += 1) {
    const drain = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(now), now);
    assert.equal(drain.applied.length, 0);
  }

  // Simulate the sender's own outbox not yet knowing the envelope already
  // reached and was acknowledged by the recipient (e.g. it crashed right
  // after relay accepted it but before persisting that fact) and
  // redelivering the identical envelope to relay again. Relay's own
  // idempotent-create returns IDEMPOTENT_MATCH without resetting the
  // already-ACKNOWLEDGED record back to QUEUED -- so it is never
  // re-surfaced to the recipient, and never reapplied. This is the "exactly
  // once" guarantee holding even across a sender-side resend, layered on
  // top of (not a replacement for) FamilyEnvelopeVerifier's own
  // message-id-idempotency ledger.
  await relayService.queueEnvelope({
    messageId: envelope.messageId,
    familyId: envelope.familyId,
    senderDeviceId: envelope.senderDeviceId,
    recipientDeviceId: RECIPIENT_DEVICE_ID,
    ciphertext: envelopeToRelayCiphertext(envelope),
  });
  const redeliveryDrain = await inboundService.reconnectDrainForRecipient(RECIPIENT_DEVICE_ID, resolveContext(now), now);
  assert.equal(redeliveryDrain.applied.length, 0);
});

test('flapping outbound: resubmitting the same batch after a reconnect never double-queues or conflicts', async () => {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  const familyId = `family-${randomUUID()}`;

  async function registerDevice() {
    const deviceId = `device-${randomUUID()}`;
    await deviceRepository.createDeviceWithKey(
      { deviceId, familyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null },
      { deviceId, keyId: `key-${randomUUID()}`, keyPurpose: 'DSK', publicKey: `pubkey-${randomUUID()}`, status: 'ACTIVE', createdAt: new Date(), revokedAt: null },
    );
    return deviceId;
  }
  const senderDeviceId = await registerDevice();
  const recipientDeviceId = await registerDevice();

  const batch = [
    { messageId: 'flap-1', recipientDeviceId, ciphertext: Buffer.from('a'), messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 1 },
    { messageId: 'flap-2', recipientDeviceId, ciphertext: Buffer.from('b'), messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 2 },
  ];

  // Attempt 1 "succeeds" server-side but the device never sees the response
  // (connection drops mid-flight) -- its outbox still has both items PENDING.
  const attempt1 = await outboundService.submitBatch(senderDeviceId, familyId, batch);
  assert.ok(attempt1.results.every((r) => r.outcome === 'QUEUED'));

  // Reconnect -- device resubmits the identical, still-PENDING batch.
  const attempt2 = await outboundService.submitBatch(senderDeviceId, familyId, batch);
  assert.ok(attempt2.results.every((r) => r.outcome === 'QUEUED'));

  const queued = await relayService.listQueuedForRecipient(recipientDeviceId);
  assert.equal(queued.length, 2); // not 4 -- relay's own idempotent create collapsed the resubmission
});
