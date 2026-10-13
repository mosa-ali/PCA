import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { RelayAuthorityChangedError } from '../../dist/relay/RelayRepository.js';
import { OutboundRelayService } from '../../dist/runtime-sync/index.js';
import { MAX_OUTBOUND_BATCH_SIZE } from '../../dist/runtime-sync/policy.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

async function registerDevice(deviceRepository, familyId, platform = 'ANDROID') {
  const deviceId = `device-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    {
      deviceId,
      familyId,
      platform,
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

function buildHarness(now = () => new Date()) {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository(), now);
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  return { deviceRepository, relayService, outboundService };
}

test('a slow recipient lookup cannot queue ciphertext past the signed validUntil', async () => {
  let currentTime = Date.UTC(2026, 0, 1);
  const { deviceRepository, relayService } = buildHarness(() => new Date(currentTime));
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const originalLookup = deviceRepository.findDeviceForFamily.bind(deviceRepository);
  let enteredLookup;
  const lookupEntered = new Promise((resolve) => { enteredLookup = resolve; });
  let releaseLookup;
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  deviceRepository.findDeviceForFamily = async (...args) => {
    enteredLookup();
    await lookupGate;
    return originalLookup(...args);
  };
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  const validUntil = new Date(currentTime + 5_000);
  const submission = outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId, validUntil })], async () => authoritySnapshot(familyId, senderDeviceId, recipientDeviceId));
  await lookupEntered;
  currentTime = validUntil.getTime();
  releaseLookup();

  const result = await submission;
  assert.equal(result.results[0].outcome, 'EXPIRED');
  assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
});

test('a slow recipient lookup cannot replace caller-owned ciphertext before enqueue', async () => {
  const { deviceRepository, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const originalLookup = deviceRepository.findDeviceForFamily.bind(deviceRepository);
  let enteredLookup;
  const lookupEntered = new Promise((resolve) => { enteredLookup = resolve; });
  let releaseLookup;
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  deviceRepository.findDeviceForFamily = async (...args) => {
    enteredLookup();
    await lookupGate;
    return originalLookup(...args);
  };
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  const callerOwnedCiphertext = Buffer.from('signed-envelope-bytes');
  const expectedCiphertext = Buffer.from(callerOwnedCiphertext);
  const submission = outboundService.submitBatch(
    senderDeviceId,
    familyId,
    [item({ recipientDeviceId, ciphertext: callerOwnedCiphertext })],
    authorize(familyId, senderDeviceId, recipientDeviceId),
  );
  await lookupEntered;
  callerOwnedCiphertext.fill(0x78);
  releaseLookup();

  const result = await submission;
  assert.equal(result.results[0].outcome, 'QUEUED');
  const queued = await relayService.listQueuedForRecipient(recipientDeviceId);
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].ciphertext, expectedCiphertext);
});

test('outbound enqueue keeps malformed non-Buffer ciphertext fail-closed', async () => {
  const { deviceRepository, relayService, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const messageId = `invalid-ciphertext-${randomUUID()}`;

  const result = await outboundService.submitBatch(
    senderDeviceId,
    familyId,
    [item({ messageId, recipientDeviceId, ciphertext: 'not-a-buffer' })],
    authorize(familyId, senderDeviceId, recipientDeviceId),
  );

  assert.deepEqual(result.results, [{ messageId, outcome: 'INVALID' }]);
  assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
});

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

function authoritySnapshot(familyId, senderDeviceId, recipientDeviceId) {
  return {
    familyId,
    trustSetEpoch: 1,
    keyEpoch: 1,
    sender: { deviceId: senderDeviceId, dskKeyId: 'test-sender-dsk' },
    recipient: { deviceId: recipientDeviceId, dskKeyId: 'test-recipient-dsk' },
  };
}

function authorize(familyId, senderDeviceId, recipientDeviceId) {
  return async () => authoritySnapshot(familyId, senderDeviceId, recipientDeviceId);
}

test('a recipient in the caller\'s own family is queued', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId })], authorize(familyId, senderDeviceId, recipientDeviceId));
  assert.equal(result.results[0].outcome, 'QUEUED');
});

test('same-family outbound enqueue fails closed without an exact sender+recipient authority snapshot', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const messageId = `missing-authority-${randomUUID()}`;

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId, messageId })]);

  assert.deepEqual(result.results, [{ messageId, outcome: 'INVALID' }]);
  assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
});

test('outbound enqueue rejects a legacy boolean allow instead of treating it as authority', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const messageId = `boolean-authority-${randomUUID()}`;

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId, messageId })], async () => true);

  assert.deepEqual(result.results, [{ messageId, outcome: 'INVALID' }]);
  assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
});

test('a same-family directory device absent from accepted Trust Set is not queued', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const unacceptedRecipientId = await registerDevice(deviceRepository, familyId);

  const result = await outboundService.submitBatch(
    senderDeviceId,
    familyId,
    [item({ recipientDeviceId: unacceptedRecipientId, messageId: 'recipient-not-in-trust-set' })],
    async () => false,
  );
  assert.deepEqual(result.results, [{ messageId: 'recipient-not-in-trust-set', outcome: 'INVALID' }]);
  assert.deepEqual(await relayService.listQueuedForRecipient(unacceptedRecipientId), []);
});

test('IDOR: a recipient device that belongs to a DIFFERENT family is rejected, not queued', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyA = `family-${randomUUID()}`;
  const familyB = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyA);
  const victimDeviceInOtherFamily = await registerDevice(deviceRepository, familyB);
  let membershipCheckCalled = false;

  const result = await outboundService.submitBatch(senderDeviceId, familyA, [
    item({ recipientDeviceId: victimDeviceInOtherFamily }),
  ], async () => { membershipCheckCalled = true; return authoritySnapshot(familyA, senderDeviceId, victimDeviceInOtherFamily); });
  assert.equal(result.results[0].outcome, 'CROSS_FAMILY_RECIPIENT');
  assert.equal(membershipCheckCalled, false, 'directory family scope must reject before accepted-membership lookup');

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

test('a BROWSER endpoint without a DEK is rejected as an E2EE recipient before relay storage', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const browserDeviceId = await registerDevice(deviceRepository, familyId, 'BROWSER');

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId: browserDeviceId, messageId: 'browser-recipient' }),
  ]);

  assert.deepEqual(result.results, [{ messageId: 'browser-recipient', outcome: 'INVALID' }]);
  assert.equal((await relayService.listQueuedForRecipient(browserDeviceId)).length, 0);
});

test('a REVOKED same-family recipient is rejected before new relay ciphertext is stored', async () => {
  const { deviceRepository, outboundService, relayService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const revokedRecipientId = await registerDevice(deviceRepository, familyId);
  const revocation = await deviceRepository.revokeDeviceAndKeysAtomically(familyId, revokedRecipientId, new Date());
  assert.equal(revocation.outcome, 'REVOKED');

  const messageId = `revoked-${randomUUID()}`;
  const result = await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId: revokedRecipientId, messageId }),
  ]);

  assert.deepEqual(result.results, [{ messageId, outcome: 'INVALID' }]);
  assert.equal((await relayService.listQueuedForRecipient(revokedRecipientId)).length, 0);
});

test('a batch larger than MAX_OUTBOUND_BATCH_SIZE only attempts the bound, reporting the rest as explicitly dropped', async () => {
  const { deviceRepository, outboundService } = buildHarness();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);

  const items = Array.from({ length: MAX_OUTBOUND_BATCH_SIZE + 5 }, (_, i) =>
    item({ recipientDeviceId, messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: i }),
  );
  let recipientAuthorizationCalls = 0;
  const result = await outboundService.submitBatch(senderDeviceId, familyId, items, async (candidate) => {
    recipientAuthorizationCalls += 1;
    return authoritySnapshot(familyId, senderDeviceId, candidate);
  });
  assert.equal(result.results.length, MAX_OUTBOUND_BATCH_SIZE);
  assert.equal(result.droppedForBatchBound.length, 5);
  assert.equal(recipientAuthorizationCalls, MAX_OUTBOUND_BATCH_SIZE, 'only the bounded attempted slice reaches recipient authorization');
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

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [...lowPriority, highPriority], authorize(familyId, senderDeviceId, recipientDeviceId));
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

  const first = await outboundService.submitBatch(senderDeviceId, familyId, [dup], authorize(familyId, senderDeviceId, recipientDeviceId));
  const second = await outboundService.submitBatch(senderDeviceId, familyId, [dup], authorize(familyId, senderDeviceId, recipientDeviceId));
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
  ], authorize(familyId, senderDeviceId, recipientDeviceId));
  const second = await outboundService.submitBatch(senderDeviceId, familyId, [
    item({ recipientDeviceId, messageId: 'conflict-1', ciphertext: Buffer.from('version-b') }),
  ], authorize(familyId, senderDeviceId, recipientDeviceId));
  assert.equal(second.results[0].outcome, 'CONFLICT');
});

test('a final transactional authority race is surfaced as AUTHORITY_CHANGED, not a recipient error', async () => {
  const deviceRepository = createInMemoryDeviceRepository();
  const familyId = `family-${randomUUID()}`;
  const senderDeviceId = await registerDevice(deviceRepository, familyId);
  const recipientDeviceId = await registerDevice(deviceRepository, familyId);
  const relayService = {
    async queueEnvelope() {
      throw new RelayAuthorityChangedError();
    },
  };
  const outboundService = new OutboundRelayService(relayService, deviceRepository);
  const messageId = `authority-race-${randomUUID()}`;

  const result = await outboundService.submitBatch(senderDeviceId, familyId, [item({ recipientDeviceId, messageId })], async () => ({
    familyId,
    trustSetEpoch: 4,
    keyEpoch: 2,
    sender: { deviceId: senderDeviceId, dskKeyId: 'sender-dsk' },
    recipient: { deviceId: recipientDeviceId, dskKeyId: 'recipient-dsk' },
  }));

  assert.deepEqual(result.results, [{ messageId, outcome: 'AUTHORITY_CHANGED' }]);
});
