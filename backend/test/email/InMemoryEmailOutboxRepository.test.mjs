import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEmailOutboxRepository } from '../../dist/email/InMemoryEmailOutboxRepository.js';

const PAYLOAD = { ivBase64: 'iv', authTagBase64: 'tag', ciphertextBase64: 'cipher' };

function insertInput(overrides = {}) {
  return {
    outboxId: 'outbox-1',
    idempotencyKey: 'key-1',
    encryptedPayload: PAYLOAD,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    ...overrides,
  };
}

test('insert then claimDueRows returns the row once it is due', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput());
  const claimed = await repo.claimDueRows(new Date('2026-01-01T00:00:01.000Z'), 10, 60_000);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].outboxId, 'outbox-1');
  assert.deepEqual(claimed[0].encryptedPayload, PAYLOAD);
});

test('a second insert with the SAME idempotencyKey returns DUPLICATE_IDEMPOTENCY_KEY and does not create a second row', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  assert.equal(await repo.insert(insertInput()), 'INSERTED');
  assert.equal(await repo.insert(insertInput({ outboxId: 'outbox-2' })), 'DUPLICATE_IDEMPOTENCY_KEY');
  const claimed = await repo.claimDueRows(new Date('2026-01-01T00:00:01.000Z'), 10, 60_000);
  assert.equal(claimed.length, 1);
});

test('claiming a row pushes its next_attempt_at forward by the lease -- a second immediate claim does not re-claim it', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput());
  const now = new Date('2026-01-01T00:00:01.000Z');
  const first = await repo.claimDueRows(now, 10, 60_000);
  assert.equal(first.length, 1);
  const second = await repo.claimDueRows(now, 10, 60_000);
  assert.equal(second.length, 0, 'still within the claim lease -- must not be claimable again yet');
});

test('a row past its expiresAt is never claimed', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput({ expiresAt: new Date('2026-01-01T00:00:00.500Z') }));
  const claimed = await repo.claimDueRows(new Date('2026-01-01T00:00:01.000Z'), 10, 60_000);
  assert.equal(claimed.length, 0);
});

test('markSent sets status=SENT and purges the ciphertext', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput());
  await repo.markSent('outbox-1', 'provider-msg-1', new Date());
  const row = repo.getRowForTest('outbox-1');
  assert.equal(row.status, 'SENT');
  assert.equal(row.providerMessageId, 'provider-msg-1');
  assert.equal(row.encryptedPayload, null);
});

test('recordFailureAndReschedule keeps the row PENDING (ciphertext retained) with an updated attempt count/next_attempt_at', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput());
  const nextAttempt = new Date('2026-01-01T00:05:00.000Z');
  await repo.recordFailureAndReschedule('outbox-1', 'transient failure', nextAttempt, 1);
  const row = repo.getRowForTest('outbox-1');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attemptCount, 1);
  assert.equal(row.lastError, 'transient failure');
  assert.notEqual(row.encryptedPayload, null);
  const claimedTooEarly = await repo.claimDueRows(new Date('2026-01-01T00:00:02.000Z'), 10, 60_000);
  assert.equal(claimedTooEarly.length, 0);
  const claimedOnTime = await repo.claimDueRows(nextAttempt, 10, 60_000);
  assert.equal(claimedOnTime.length, 1);
});

test('markDeadLetter sets status=DEAD_LETTER and purges the ciphertext -- never claimable again', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await repo.insert(insertInput());
  await repo.markDeadLetter('outbox-1', 'permanent failure', 3);
  const row = repo.getRowForTest('outbox-1');
  assert.equal(row.status, 'DEAD_LETTER');
  assert.equal(row.attemptCount, 3);
  assert.equal(row.encryptedPayload, null);
  const claimed = await repo.claimDueRows(new Date('2099-01-01T00:00:00.000Z'), 10, 60_000);
  assert.equal(claimed.length, 0);
});
