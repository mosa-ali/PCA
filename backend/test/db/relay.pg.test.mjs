import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { PostgresRelayRepository } from '../../dist/relay/PostgresRelayRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new PostgresRelayRepository();

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

test('PG: queue + retrieve by correct recipient, ciphertext stored as opaque BYTEA', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.equals(input.ciphertext), true);
});

test('PG: messageId uniqueness -- duplicate identical submission is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  const first = await service.queueEnvelope(input);
  const second = await service.queueEnvelope({ ...input });
  assert.equal(first.messageId, second.messageId);
});

test('PG: conflicting reuse of messageId with different ciphertext is rejected', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(
    () => service.queueEnvelope({ ...input, ciphertext: Buffer.from('different') }),
    { code: 'CONFLICT' },
  );
});

test('PG: recipient-scoped retrieval -- wrong recipient cannot read the envelope', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(() => service.fetchEnvelope('someone-else', input.messageId), { code: 'NOT_FOUND' });
});

test('PG: TTL expiry makes an envelope unavailable', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const input = envelope({ ttlMs: 60_000 });
  await service.queueEnvelope(input);
  now = new Date(now.getTime() + 60_001);
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, input.messageId), { code: 'EXPIRED' });
});

test('PG: acknowledgement is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const first = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  const second = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(first.acknowledgedAt.getTime(), second.acknowledgedAt.getTime());
});

test('PG CONCURRENCY: duplicate submission race -- many concurrent identical creates resolve consistently', async () => {
  const service = buildService();
  const input = envelope();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.queueEnvelope({ ...input })),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'identical resubmissions must never fail');
  for (const outcome of attempts) assert.equal(outcome.value.ciphertext.equals(input.ciphertext), true);
});

test('PG CONCURRENCY: ack race -- many concurrent acks on one envelope all resolve to the same acknowledgedAt', async () => {
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

test.after(async () => {
  await closePool();
});
