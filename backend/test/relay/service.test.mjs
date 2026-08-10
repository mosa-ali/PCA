import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService, RelayError } from '../../dist/relay/RelayService.js';
import { MAX_CIPHERTEXT_BYTES, MAX_RELAY_TTL_MS, MAX_OPAQUE_ID_LENGTH } from '../../dist/relay/policy.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function buildService() {
  const repository = createInMemoryRelayRepository();
  let currentTime = BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
    set: (ms) => { currentTime = ms; },
  };
  const service = new RelayService(repository, clock.now);
  return { service, repository, clock };
}

function envelope(overrides = {}) {
  return {
    messageId: randomUUID(),
    familyId: 'family-opaque-1',
    senderDeviceId: 'device-sender-1',
    recipientDeviceId: 'device-recipient-1',
    ciphertext: Buffer.from('opaque-bytes'),
    ...overrides,
  };
}

test('queue valid opaque envelope', async () => {
  const { service } = buildService();
  const record = await service.queueEnvelope(envelope());
  assert.equal(record.state, 'QUEUED');
  assert.equal(record.acknowledgedAt, null);
});

test('retrieve by correct recipient', async () => {
  const { service } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.equals(input.ciphertext), true);
});

test('wrong recipient rejected identically to a nonexistent message', async () => {
  const { service } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const wrongError = await service.fetchEnvelope('someone-else-device', input.messageId).catch((e) => e);
  const missingError = await service.fetchEnvelope(input.recipientDeviceId, randomUUID()).catch((e) => e);
  assert.equal(wrongError.code, 'NOT_FOUND');
  assert.equal(missingError.code, 'NOT_FOUND');
  assert.equal(wrongError.message, missingError.message);
});

test('duplicate submission of the same messageId + identical content is idempotent', async () => {
  const { service } = buildService();
  const input = envelope();
  const first = await service.queueEnvelope(input);
  const second = await service.queueEnvelope({ ...input });
  assert.equal(first.messageId, second.messageId);
  assert.equal(first.ciphertext.equals(second.ciphertext), true);
});

test('same messageId reused with different ciphertext is rejected as a conflict, not silently replaced', async () => {
  const { service } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(
    () => service.queueEnvelope({ ...input, ciphertext: Buffer.from('different-bytes') }),
    { code: 'CONFLICT' },
  );
  const stillOriginal = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(stillOriginal.ciphertext.equals(input.ciphertext), true);
});

test('ack once succeeds', async () => {
  const { service } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const acked = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(acked.state, 'ACKNOWLEDGED');
  assert.notEqual(acked.acknowledgedAt, null);
});

test('ack twice is idempotent, not an error', async () => {
  const { service } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const first = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  const second = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(first.acknowledgedAt.getTime(), second.acknowledgedAt.getTime());
});

test('expired envelope is unavailable to fetch', async () => {
  const { service, clock } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  clock.advance(24 * 60 * 60 * 1000 + 1); // past the 1-day default TTL
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, input.messageId), { code: 'EXPIRED' });
});

test('late ack cannot resurrect an expired, never-acknowledged envelope', async () => {
  const { service, clock } = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  clock.advance(24 * 60 * 60 * 1000 + 1);
  await assert.rejects(
    () => service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId),
    { code: 'EXPIRED' },
  );
});

test('server TTL maximum is enforced even when the caller requests more', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.queueEnvelope(envelope({ ttlMs: MAX_RELAY_TTL_MS + 1 })),
    RangeError,
  );
});

test('invalid TTL (zero/negative/non-finite) rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.queueEnvelope(envelope({ ttlMs: 0 })), RangeError);
  await assert.rejects(() => service.queueEnvelope(envelope({ ttlMs: -1 })), RangeError);
  await assert.rejects(() => service.queueEnvelope(envelope({ ttlMs: Number.NaN })), RangeError);
});

test('oversized ciphertext rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.queueEnvelope(envelope({ ciphertext: Buffer.alloc(MAX_CIPHERTEXT_BYTES + 1) })),
    { code: 'INVALID_INPUT' },
  );
});

test('oversized identifiers rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.queueEnvelope(envelope({ recipientDeviceId: 'a'.repeat(MAX_OPAQUE_ID_LENGTH + 1) })),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    () => service.queueEnvelope(envelope({ messageId: 'a'.repeat(MAX_OPAQUE_ID_LENGTH + 1) })),
    { code: 'INVALID_INPUT' },
  );
});

test('empty ciphertext rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.queueEnvelope(envelope({ ciphertext: Buffer.alloc(0) })),
    { code: 'INVALID_INPUT' },
  );
});

test('ciphertext never appears in a thrown error', async () => {
  const { service } = buildService();
  const input = envelope({ ciphertext: Buffer.from('very-secret-looking-payload-marker') });
  await service.queueEnvelope(input);
  try {
    await service.queueEnvelope({ ...input, ciphertext: Buffer.from('different') });
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof RelayError);
    assert.equal(error.message.includes('very-secret-looking-payload-marker'), false);
  }
});

test('ciphertext that looks like JSON is stored and returned as opaque bytes, never parsed', async () => {
  const { service } = buildService();
  const jsonLooking = Buffer.from(JSON.stringify({ url: 'https://example.com', location: '1,2' }));
  const input = envelope({ ciphertext: jsonLooking });
  await service.queueEnvelope(input);
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.equals(jsonLooking), true);
  // the record itself carries no parsed/derived fields from the payload
  assert.deepEqual(
    Object.keys(fetched).sort(),
    ['messageId', 'familyId', 'senderDeviceId', 'recipientDeviceId', 'ciphertext', 'state', 'createdAt', 'expiresAt', 'acknowledgedAt'].sort(),
  );
});

test('no plaintext activity fields exist on the envelope record shape', async () => {
  const { service } = buildService();
  const record = await service.queueEnvelope(envelope());
  const forbidden = ['url', 'title', 'search', 'location', 'appUsage', 'policy', 'plaintext', 'content'];
  for (const field of forbidden) assert.equal(field in record, false);
});

test('listQueuedForRecipient only returns that recipient\'s queued, non-expired envelopes', async () => {
  const { service, clock } = buildService();
  const forRecipient = envelope({ recipientDeviceId: 'device-r1' });
  const forOther = envelope({ recipientDeviceId: 'device-r2' });
  await service.queueEnvelope(forRecipient);
  await service.queueEnvelope(forOther);
  const soonExpiring = envelope({ recipientDeviceId: 'device-r1', ttlMs: 1000 });
  await service.queueEnvelope(soonExpiring);
  clock.advance(1001);
  const listed = await service.listQueuedForRecipient('device-r1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].messageId, forRecipient.messageId);
});

// --- Privacy sentinels ----------------------------------------------------

test('privacy sentinel: synthetic family-data markers inside ciphertext are never parsed, indexed, or leaked in errors', async () => {
  const { service } = buildService();
  const sentinel = 'SENTINEL-child-browsing-history-example.com/secret-path';
  const input = envelope({ ciphertext: Buffer.from(`opaque-prefix::${sentinel}::opaque-suffix`) });
  await service.queueEnvelope(input);

  // Returned intact only to the authorized recipient.
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.toString('utf8').includes(sentinel), true);

  // Never surfaces as a distinct metadata field.
  assert.equal('url' in fetched, false);
  assert.equal('history' in fetched, false);

  // Never leaks to the wrong recipient.
  const wrongRecipientError = await service.fetchEnvelope('someone-else', input.messageId).catch((e) => e);
  assert.equal(wrongRecipientError.code, 'NOT_FOUND');
  assert.equal(JSON.stringify(wrongRecipientError).includes(sentinel), false);

  // Never leaks into a conflict error.
  const conflictError = await service
    .queueEnvelope({ ...input, ciphertext: Buffer.from('other-bytes') })
    .catch((e) => e);
  assert.equal(conflictError.code, 'CONFLICT');
  assert.equal(conflictError.message.includes(sentinel), false);
});

test('no generic remote-command semantics: the service exposes only queue/list/fetch/acknowledge, nothing execute-like', async () => {
  const { service } = buildService();
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
  for (const name of methodNames) {
    assert.doesNotMatch(name.toLowerCase(), /execute|command|invoke|run(?!time)/);
  }
});
