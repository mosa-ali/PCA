import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { OutboundRelayService } from '../../dist/runtime-sync/index.js';
import { MAX_OUTBOUND_BATCH_SIZE } from '../../dist/runtime-sync/policy.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

async function registerDevice(deviceRepository, familyId) {
  const deviceId = `device-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    {
      deviceId,
      familyId,
      platform: 'ANDROID',
      status: 'ACTIVE',
      createdAt: new Date(),
      revokedAt: null,
      pairedAt: null,
      pairedByAccountId: null,
    },
    {
      deviceId,
      keyId: `key-${randomUUID()}`,
      keyPurpose: 'DSK',
      publicKey: `pubkey-${randomUUID()}`,
      status: 'ACTIVE',
      createdAt: new Date(),
      revokedAt: null,
    },
  );
  return deviceId;
}

function buildHarness() {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  return { deviceRepository, relayService, outboundService };
}

function item(overrides = {}) {
  return {
    messageId: `msg-${randomUUID()}`,
    recipientDeviceId: 'recipient-1',
    ciphertext: Buffer.from('opaque-bytes'),
    messageType: 'STATUS_SNAPSHOT',
    enqueuedAtEpochMillis: Date.now(),
    ...overrides,
  };
}

test('a recipient in the caller\'s own family is queued', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId })]);
  assert.equal(result.results[0].outcome, 'QUEUED');
});

test('IDOR: a recipient device that belongs to a DIFFERENT family is rejected, not queued', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyA = `family-${randomUUID()}`;
  const familyB = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyA);
  const victimDeviceInOtherFamily = await registerDevice(deviceRepository, familyB);

  const result = await outboundService.submitBatch(senderDeviceId, familyA, [
    item({ recipientDeviceId: victimDeviceInOtherFamily }),
  ]);
  assert.equal(result.results[0].outcome, 'CROSS_FAMILY_RECIPIENT');

  const queuedForVictim = await relayService.listQueuedForRecipient(victimDeviceInOtherFamily);
  assert.equal(queuedForVictim.length, 0);
});

test('IDOR: a recipientDeviceId that does not exist at all is rejected identically to a cross-family one', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId: 'totally-unknown-device' }),
  ]);
  assert.equal(result.results[0].outcome, 'CROSS_FAMILY_RECIPIENT');
});

test('a batch larger than MAX_OUTBOUND_BATCH_SIZE only attempts the bound, reporting the rest as explicitly dropped', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  const items = Array.from({ length: MAX_OUTBOUND_BATCH_SIZE + 5 }, (_, i) =>
    item({ recipientDeviceId, messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: i }),
  );
  const result = await outboundService.submitBatch(senderDeviceId, familyId, items);
  assert.equal(result.results.length, MAX_OUTBOUND_BATCH_SIZE);
  assert.equal(result.droppedForBatchBound.length, 5);
});

test('high-priority items win the bounded batch\'s slots over low-priority ones', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  const lowPriority = Array.from({ length: MAX_OUTBOUND_BATCH_SIZE }, (_, i) =>
    item({ recipientDeviceId, messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: i, messageId: `low-${i}` }),
  );
  const highPriority = item({ recipientDeviceId, messageType: 'KEY_ROTATION', enqueuedAtEpochMillis: 99999, messageId: 'high-1' });

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [...lowPriority, highPriority]);
  assert.equal(result.results.length, MAX_OUTBOUND_BATCH_SIZE);
  assert.ok(result.results.some((r) => r.messageId === 'high-1' && r.outcome === 'QUEUED'));
  assert.equal(result.droppedForBatchBound.length, 1);
  assert.ok(!result.droppedForBatchBound.includes('high-1'));
});

test('idempotent resubmission of the same messageId+content reports QUEUED again, not CONFLICT', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const dup = item({ recipientDeviceId, messageId: 'dup-1' });

  const first = await outboundService.submitBatch(senderDeviceId, familyId, [dup]);
  const second = await outboundService.submitBatch(senderDeviceId, familyId, [dup]);
  assert.equal(first.results[0].outcome, 'QUEUED');
  assert.equal(second.results[0].outcome, 'QUEUED');
});

test('resubmitting the same messageId with DIFFERENT content is a CONFLICT', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId, messageId: 'conflict-1', ciphertext: Buffer.from('version-a') }),
  ]);
  const second = await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId, messageId: 'conflict-1', ciphertext: Buffer.from('version-b') }),
  ]);
  assert.equal(second.results[0].outcome, 'CONFLICT');
});
