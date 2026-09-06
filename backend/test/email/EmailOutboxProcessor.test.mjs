import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { InMemoryEmailOutboxRepository } from '../../dist/email/InMemoryEmailOutboxRepository.js';
import { encryptOutboxContent } from '../../dist/email/emailOutboxEncryption.js';
import { EmailDeliveryError } from '../../dist/email/EmailProviderAdapter.js';
import { EMAIL_MAX_ATTEMPTS } from '../../dist/email/emailBackoff.js';
import { attemptDeliveryAndRecordOutcome, processOutboxOnce, startEmailOutboxWorker } from '../../dist/email/EmailOutboxProcessor.js';

const ENV = { NODE_ENV: 'test' };

class ScriptedProviderAdapter {
  constructor(script) {
    this.providerName = 'SCRIPTED_TEST_PROVIDER';
    this.script = script;
    this.calls = [];
  }
  async send(message) {
    this.calls.push(message);
    const next = this.script.shift();
    if (!next) throw new Error('ScriptedProviderAdapter: no more scripted outcomes');
    if (next.throw) throw next.throw;
    return next.result;
  }
}

async function insertRow(repo, { toEmail = 'parent@example.com', kind = 'VERIFICATION', code = '123456', createdAt = new Date('2026-01-01T00:00:00.000Z'), expiresAt = new Date('2026-01-01T01:00:00.000Z'), outboxId = randomUUID(), idempotencyKey = randomUUID() } = {}) {
  const encryptedPayload = encryptOutboxContent(JSON.stringify({ toEmail, kind, code }), ENV);
  await repo.insert({ outboxId, idempotencyKey, encryptedPayload, createdAt, expiresAt });
  return outboxId;
}

test('a due row that decrypts and sends successfully is marked SENT', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const outboxId = await insertRow(repo);
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }]);
  const audits = [];
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => new Date('2026-01-01T00:00:01.000Z'), auditSink: (e) => audits.push(e) });
  assert.deepEqual(summary, { claimed: 1, sent: 1, retryScheduled: 0, deadLettered: 0 });
  assert.equal(repo.getRowForTest(outboxId).status, 'SENT');
  assert.deepEqual(provider.calls[0], { toEmail: 'parent@example.com', subject: 'Your PCA verification code', text: provider.calls[0].text, html: provider.calls[0].html });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'SENT');
  // Audit must never carry the recipient or code.
  assert.equal(JSON.stringify(audits[0]).includes('parent@example.com'), false);
  assert.equal(JSON.stringify(audits[0]).includes('123456'), false);
});

test('a retryable provider failure reschedules the row with a later next-attempt time, never dead-lettering on the first failure', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const outboxId = await insertRow(repo);
  const provider = new ScriptedProviderAdapter([{ throw: new EmailDeliveryError('temporary', true) }]);
  const now = new Date('2026-01-01T00:00:01.000Z');
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => now, randomFraction: () => 0 });
  assert.deepEqual(summary, { claimed: 1, sent: 0, retryScheduled: 1, deadLettered: 0 });
  const row = repo.getRowForTest(outboxId);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attemptCount, 1);
  assert.ok(row.nextAttemptAt.getTime() > now.getTime());
});

test('a NON-retryable provider failure dead-letters immediately, even on the very first attempt', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const outboxId = await insertRow(repo);
  const provider = new ScriptedProviderAdapter([{ throw: new EmailDeliveryError('invalid recipient', false) }]);
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => new Date('2026-01-01T00:00:01.000Z') });
  assert.deepEqual(summary, { claimed: 1, sent: 0, retryScheduled: 0, deadLettered: 1 });
  const row = repo.getRowForTest(outboxId);
  assert.equal(row.status, 'DEAD_LETTER');
  assert.equal(row.encryptedPayload, null);
});

test('repeated retryable failures eventually dead-letter once EMAIL_MAX_ATTEMPTS is reached', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const outboxId = await insertRow(repo);
  let now = new Date('2026-01-01T00:00:01.000Z');
  for (let attempt = 0; attempt < EMAIL_MAX_ATTEMPTS; attempt++) {
    const provider = new ScriptedProviderAdapter([{ throw: new EmailDeliveryError('still down', true) }]);
    // eslint-disable-next-line no-await-in-loop -- sequential by construction: each attempt's outcome determines the next claim time.
    await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => now, randomFraction: () => 0 });
    const row = repo.getRowForTest(outboxId);
    if (row.status === 'DEAD_LETTER') break;
    now = row.nextAttemptAt;
  }
  const finalRow = repo.getRowForTest(outboxId);
  assert.equal(finalRow.status, 'DEAD_LETTER');
  assert.equal(finalRow.attemptCount, EMAIL_MAX_ATTEMPTS);
});

test('claimDueRows itself already excludes rows past their expiresAt -- processOutboxOnce never even claims one', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  await insertRow(repo, { createdAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: new Date('2026-01-01T00:00:00.500Z') });
  const provider = new ScriptedProviderAdapter([]);
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => new Date('2026-01-01T00:00:01.000Z') });
  assert.deepEqual(summary, { claimed: 0, sent: 0, retryScheduled: 0, deadLettered: 0 });
});

test('DEFENSE IN DEPTH: attemptDeliveryAndRecordOutcome itself dead-letters an expired row without calling the provider, even if a caller (a future direct EmailService enqueue path) ever handed it one', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const outboxId = await insertRow(repo, { expiresAt: new Date('2026-01-01T00:00:00.500Z') });
  const provider = new ScriptedProviderAdapter([]);
  const now = new Date('2026-01-01T00:00:01.000Z');
  const outcome = await attemptDeliveryAndRecordOutcome(
    { repository: repo, providerAdapter: provider, env: ENV },
    { outboxId, attemptCount: 0, expiresAt: new Date('2026-01-01T00:00:00.500Z') },
    { toEmail: 'a@b.com', kind: 'VERIFICATION', code: '123456' },
    now,
  );
  assert.equal(outcome, 'DEAD_LETTER');
  assert.equal(provider.calls.length, 0, 'must never call the provider for an already-expired message');
  assert.equal(repo.getRowForTest(outboxId).status, 'DEAD_LETTER');
});

test('a row that cannot be decrypted (wrong key) is dead-lettered, and does not stop other rows in the same batch from processing', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const now = new Date('2026-01-01T00:00:01.000Z');
  // Encrypted under a DIFFERENT key than processOutboxOnce below will decrypt with.
  const wrongKeyEnv = { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') };
  const encryptedBad = encryptOutboxContent(JSON.stringify({ toEmail: 'x@example.com', kind: 'VERIFICATION', code: '000000' }), wrongKeyEnv);
  await repo.insert({ outboxId: 'bad-row', idempotencyKey: 'bad-key', encryptedPayload: encryptedBad, createdAt: now, expiresAt: new Date('2026-01-01T01:00:00.000Z') });
  await insertRow(repo, { outboxId: 'good-row', idempotencyKey: 'good-key' });

  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-good' } }]);
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => now });
  assert.equal(summary.claimed, 2);
  assert.equal(summary.deadLettered, 1);
  assert.equal(summary.sent, 1);
  assert.equal(repo.getRowForTest('bad-row').status, 'DEAD_LETTER');
  assert.equal(repo.getRowForTest('good-row').status, 'SENT');
});

test('startEmailOutboxWorker runs processOutboxOnce on an interval and stop() halts it', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  // startEmailOutboxWorker uses REAL wall-clock time internally (no `now`
  // override, unlike every other test above) -- this row's dates must be
  // relative to actual current time, not the fixed 2026-01-01 fixture dates
  // the rest of this file uses under an explicit `now:` override.
  const outboxId = await insertRow(repo, { createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }]);
  const handle = startEmailOutboxWorker({ repository: repo, providerAdapter: provider, env: ENV }, 10);
  try {
    // Poll rather than a single fixed sleep-then-check -- a real setInterval's
    // exact firing time under CI/test-runner load is not something a test
    // should assume a fixed short wait always covers (TEST_INFRASTRUCTURE_
    // INSTABILITY otherwise, not a product defect).
    const deadline = Date.now() + 2000;
    while (repo.getRowForTest(outboxId).status === 'PENDING' && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop -- deliberate poll loop.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    handle.stop();
  }
  assert.equal(repo.getRowForTest(outboxId).status, 'SENT');
  assert.equal(provider.calls.length, 1, 'exactly one send -- the row was SENT after the first tick that found it due, so later ticks find nothing due');
});
