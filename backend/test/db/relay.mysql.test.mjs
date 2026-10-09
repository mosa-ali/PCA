import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { MySqlRelayRepository } from '../../dist/relay/MySqlRelayRepository.js';
import { closePool } from '../../dist/db/pool.js';
import { relayQueuePosition, compareRelayQueuePositions } from '../../dist/relay/queuePage.js';
import { encodeRelayContinuation, decodeRelayContinuation } from '../../dist/runtime-sync/relayContinuation.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlRelayRepository();

function buildService(now = () => new Date()) {
  return new RelayService(repository, now);
}

function envelope(overrides = {}) {
  return {
    messageId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    senderDeviceId: `sender-${randomUUID()}`,
    recipientDeviceId: `recipient-${randomUUID()}`,
    ciphertext: Buffer.from('opaque-bytes-' + randomUUID()),
    ...overrides,
  };
}

test('MySQL: queue + retrieve by correct recipient, ciphertext stored as opaque blob', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.equals(input.ciphertext), true);
});

test('MySQL: messageId uniqueness -- duplicate identical submission is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  const first = await service.queueEnvelope(input);
  const second = await service.queueEnvelope({ ...input });
  assert.equal(first.messageId, second.messageId);
});

test('MySQL: conflicting reuse of messageId with different ciphertext is rejected', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(
    () => service.queueEnvelope({ ...input, ciphertext: Buffer.from('different') }),
    { code: 'CONFLICT' },
  );
});

test('MySQL: recipient-scoped retrieval -- wrong recipient cannot read the envelope', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(() => service.fetchEnvelope('someone-else', input.messageId), { code: 'NOT_FOUND' });
});

test('MySQL: trailing-space aliases cannot fetch, acknowledge, list, or idempotently reuse an exact relay identity', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const input = envelope({ messageId: `message-${randomUUID()}`, recipientDeviceId: `recipient-${randomUUID()}` });
  await service.queueEnvelope(input);
  const aliasedMessageId = `${input.messageId} `;
  const aliasedRecipient = `${input.recipientDeviceId} `;
  const aliasedFamily = `${input.familyId} `;

  // The deployed utf8mb4_bin collation is PAD SPACE. A primary-key collision
  // on an alias is a conflict, never proof of an exact idempotent retry.
  await assert.rejects(() => service.queueEnvelope({ ...input, messageId: aliasedMessageId }), { code: 'CONFLICT' });
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, aliasedMessageId), { code: 'NOT_FOUND' });
  await assert.rejects(() => service.acknowledgeEnvelope(input.recipientDeviceId, aliasedMessageId), { code: 'NOT_FOUND' });

  assert.deepEqual(await service.listQueuedForRecipient(aliasedRecipient), []);
  assert.deepEqual(await repository.listQueuedPageForRecipient(aliasedRecipient, input.familyId, now,
    { after: null, highWater: null, limit: 10 }), { records: [], highWater: null, hasMore: false });
  assert.deepEqual(await repository.listQueuedPageForRecipient(input.recipientDeviceId, aliasedFamily, now,
    { after: null, highWater: null, limit: 10 }), { records: [], highWater: null, hasMore: false });
  assert.deepEqual(await repository.findQueuedForRecipient(input.recipientDeviceId, aliasedFamily,
    [input.messageId], now), []);

  const original = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(original.state, 'QUEUED', 'an alias ACK must leave the exact original message queued');
  assert.equal(original.ciphertext.equals(input.ciphertext), true);
});

test('MySQL: TTL expiry makes an envelope unavailable', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const input = envelope({ ttlMs: 60_000 });
  await service.queueEnvelope(input);
  now = new Date(now.getTime() + 60_001);
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, input.messageId), { code: 'EXPIRED' });
});

test('MySQL: acknowledgement is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const first = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  const second = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(first.acknowledgedAt.getTime(), second.acknowledgedAt.getTime());
});

test('MySQL CONCURRENCY: duplicate submission race -- many concurrent identical creates resolve consistently', async () => {
  const service = buildService();
  const input = envelope();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.queueEnvelope({ ...input })),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'identical resubmissions must never fail');
  for (const outcome of attempts) assert.equal(outcome.value.ciphertext.equals(input.ciphertext), true);
});

test('MySQL CONCURRENCY: ack race -- many concurrent acks on one envelope all resolve to the same acknowledgedAt', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  const timestamps = new Set(attempts.map((a) => a.value.acknowledgedAt.getTime()));
  assert.equal(timestamps.size, 1, 'all concurrent acks must agree on a single winning acknowledgedAt');
});

test('MySQL: keyset ties use exact binary order and survive ACK between pages', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  const prefix = randomUUID();
  const ids = ['A ', 'A!', 'Z', '\uE000', '\u{10000}'].map((suffix) => `${prefix}-${suffix}`);
  for (const messageId of ids) await service.queueEnvelope({ ...shared, messageId });
  const expected = [...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 2 });
  assert.deepEqual(first.records.map((record) => record.messageId), expected.slice(0, 2));
  assert.equal(first.hasMore, true);
  for (const record of first.records) await service.acknowledgeEnvelope(shared.recipientDeviceId, record.messageId);
  const second = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: relayQueuePosition(first.records.at(-1)), highWater: first.highWater, limit: 100 });
  assert.deepEqual(second.records.map((record) => record.messageId), expected.slice(2));
  assert.equal(second.hasMore, false);
  assert.ok(compareRelayQueuePositions(relayQueuePosition(first.records.at(-1)), relayQueuePosition(second.records[0])) < 0);
});

test('MySQL: finite highwater excludes later arrivals and a fresh sweep sees them', async () => {
  let now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  for (let i = 0; i < 4; i += 1) await service.queueEnvelope({ ...shared, messageId: `${randomUUID()}-${i}` });
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 2 });
  now = new Date(now.getTime() + 10);
  const late = `${randomUUID()}-late`;
  await service.queueEnvelope({ ...shared, messageId: late });
  const tail = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: relayQueuePosition(first.records.at(-1)), highWater: first.highWater, limit: 100 });
  assert.equal(tail.records.length, 2);
  assert.equal(tail.records.some((record) => record.messageId === late), false);
  assert.equal(tail.hasMore, false);
  const fresh = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 100 });
  assert.equal(fresh.records.length, 5); // no navigation operation acknowledges retained ciphertext
  assert.equal(fresh.records.some((record) => record.messageId === late), true);
});

test('MySQL: base pages and exact supplements cannot cross recipient or family', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const own = envelope();
  const foreign = { ...own, messageId: randomUUID(), familyId: `foreign-${randomUUID()}` };
  await service.queueEnvelope(own);
  await service.queueEnvelope(foreign);
  const page = await repository.listQueuedPageForRecipient(own.recipientDeviceId, own.familyId, now,
    { after: null, highWater: null, limit: 100 });
  assert.deepEqual(page.records.map((record) => record.messageId), [own.messageId]);
  const found = await repository.findQueuedForRecipient(own.recipientDeviceId, own.familyId, [own.messageId, foreign.messageId], now);
  assert.deepEqual(found.map((record) => record.messageId), [own.messageId]);
  assert.deepEqual(await repository.findQueuedForRecipient(`wrong-${randomUUID()}`, own.familyId, [own.messageId], now), []);
});

test('MySQL: supported escaped message IDs retain exact positions and bounded cursors', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  const prefix = randomUUID().slice(0, 8);
  const ids = ['a', 'm', 'z'].map((lead) => lead + prefix + '\u0001'.repeat(119));
  for (const messageId of ids) await service.queueEnvelope({ ...shared, messageId });
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 1 });
  assert.equal(first.records[0].messageId, ids[0]);
  const scope = { familyId: shared.familyId, recipientDeviceId: shared.recipientDeviceId, sessionIncarnation: 'a'.repeat(64) };
  const cursor = encodeRelayContinuation({ version: 1, scope, after: relayQueuePosition(first.records[0]),
    highWater: first.highWater, startedAtMs: now.getTime() });
  assert.ok(cursor.length > 2048);
  const navigation = decodeRelayContinuation(cursor, scope, now);
  const tail = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: navigation.after, highWater: navigation.highWater, limit: 100 });
  assert.deepEqual(tail.records.map((record) => record.messageId), ids.slice(1));
});

test.after(async () => {
  await closePool();
});
