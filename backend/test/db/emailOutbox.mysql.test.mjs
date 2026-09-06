// PCA-DW-W2-15F -- real MySQL coverage for MySqlEmailOutboxRepository:
// durable insert, idempotency-key uniqueness, FOR UPDATE SKIP LOCKED claim
// semantics under real concurrency, and the encrypted-payload-purge-on-
// completion behaviour migration 0038's header documents.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';
import { MySqlEmailOutboxRepository } from '../../dist/email/MySqlEmailOutboxRepository.js';
import { encryptOutboxContent } from '../../dist/email/emailOutboxEncryption.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const ENV = { NODE_ENV: 'test' };

function insertInput(overrides = {}) {
  const now = overrides.createdAt ?? new Date();
  return {
    outboxId: randomUUID(),
    idempotencyKey: randomUUID(),
    encryptedPayload: encryptOutboxContent(JSON.stringify({ toEmail: 'parent@example.com', kind: 'VERIFICATION', code: '123456' }), ENV),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    initialClaimableAt: now,
    ...overrides,
  };
}

async function fetchRow(outboxId) {
  const { rows } = await runInTransaction((conn) => execute(conn, 'SELECT * FROM email_outbox WHERE outbox_id = ?', [outboxId]));
  return rows[0] ?? null;
}

// PCA-DW-W2-R1-5 (adversarial-review follow-up): claimDueRows orders by
// next_attempt_at with a caller-supplied LIMIT -- on a disposable database
// that is RESET but not necessarily EMPTIED between separate local
// `npm run test:db` invocations (this file is the only one that writes to
// email_outbox), leftover PENDING rows from a prior run can silently fill
// that LIMIT window ahead of a fresh test's own row, making an assertion
// about "the row I just inserted" fail for a reason that has nothing to do
// with the behaviour under test. A clean slate here, once per file run,
// removes that cross-run coupling entirely -- this table holds only
// disposable, random-UUID-keyed test fixtures, never anything meaningful
// to preserve across runs.
test.before(async () => {
  await runInTransaction((conn) => execute(conn, 'DELETE FROM email_outbox'));
});

test('insert persists a durable row readable back with the exact encrypted payload', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  assert.equal(await repo.insert(input), 'INSERTED');
  const row = await fetchRow(input.outboxId);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.encrypted_iv, input.encryptedPayload.ivBase64);
  assert.equal(row.encrypted_auth_tag, input.encryptedPayload.authTagBase64);
  assert.equal(row.encrypted_payload, input.encryptedPayload.ciphertextBase64);
});

test('a second insert with the SAME idempotency_key is rejected at the DB level, not merely in application code', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const idempotencyKey = randomUUID();
  assert.equal(await repo.insert(insertInput({ idempotencyKey })), 'INSERTED');
  assert.equal(await repo.insert(insertInput({ idempotencyKey })), 'DUPLICATE_IDEMPOTENCY_KEY');
});

test('claimDueRows returns a due row and pushes next_attempt_at forward by the lease -- a second immediate claim does not re-claim it', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repo.insert(input);
  const now = new Date();
  const first = await repo.claimDueRows(now, 10, 60_000);
  assert.ok(first.some((r) => r.outboxId === input.outboxId));
  const second = await repo.claimDueRows(now, 10, 60_000);
  assert.equal(second.some((r) => r.outboxId === input.outboxId), false, 'still within the claim lease');
});

test('CONCURRENCY: two concurrent claimDueRows calls never both claim the same row (FOR UPDATE SKIP LOCKED)', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repo.insert(input);
  const now = new Date();
  const [first, second] = await Promise.all([repo.claimDueRows(now, 10, 60_000), repo.claimDueRows(now, 10, 60_000)]);
  const claimedByFirst = first.some((r) => r.outboxId === input.outboxId);
  const claimedBySecond = second.some((r) => r.outboxId === input.outboxId);
  assert.notEqual(claimedByFirst, claimedBySecond, 'exactly one of the two concurrent claims must have won this row, never both and never neither');
});

// PCA-DW-W2-R1-5's own required test, verbatim: "test at least two
// repository instances sharing the same disposable MySQL database" --
// simulates two separate backend processes, each with their own
// MySqlEmailOutboxRepository object but the same underlying database.
test('CONCURRENCY: two separate MySqlEmailOutboxRepository instances never both claim the same row (FOR UPDATE SKIP LOCKED)', async () => {
  const repoA = new MySqlEmailOutboxRepository();
  const repoB = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repoA.insert(input);
  const now = new Date();
  const [claimedByA, claimedByB] = await Promise.all([repoA.claimDueRows(now, 10, 60_000), repoB.claimDueRows(now, 10, 60_000)]);
  const gotA = claimedByA.some((r) => r.outboxId === input.outboxId);
  const gotB = claimedByB.some((r) => r.outboxId === input.outboxId);
  assert.notEqual(gotA, gotB, 'exactly one of the two independent repository instances must win this row, never both and never neither');
});

test('CONCURRENCY: a row still inside its OWN initial claim lease (EmailService\'s immediate-send exclusivity window) cannot be claimed by a second repository instance until that lease elapses', async () => {
  const repoA = new MySqlEmailOutboxRepository(); // simulates the instance that enqueued and is attempting immediate delivery
  const repoB = new MySqlEmailOutboxRepository(); // simulates a DIFFERENT backend instance's background worker
  const now = new Date();
  const leaseMs = 60_000;
  const input = insertInput({ initialClaimableAt: new Date(now.getTime() + leaseMs) });
  await repoA.insert(input);

  const stillLeased = await repoB.claimDueRows(now, 10, leaseMs);
  assert.equal(stillLeased.some((r) => r.outboxId === input.outboxId), false, "repoB must not be able to claim while repoA's own initial lease still holds");

  const afterLeaseElapses = await repoB.claimDueRows(new Date(now.getTime() + leaseMs + 1), 10, leaseMs);
  assert.equal(afterLeaseElapses.some((r) => r.outboxId === input.outboxId), true, 'once the lease elapses, a different repository instance can claim it (crash recovery)');
});

test('markSent sets status=SENT and purges the ciphertext columns', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repo.insert(input);
  await repo.markSent(input.outboxId, 'provider-msg-1', new Date());
  const row = await fetchRow(input.outboxId);
  assert.equal(row.status, 'SENT');
  assert.equal(row.provider_message_id, 'provider-msg-1');
  assert.equal(row.encrypted_payload, null);
});

test('recordFailureAndReschedule keeps the row PENDING with the ciphertext retained and an updated attempt_count/next_attempt_at', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repo.insert(input);
  const nextAttemptAt = new Date(Date.now() + 5 * 60_000);
  await repo.recordFailureAndReschedule(input.outboxId, 'transient failure', nextAttemptAt, 1);
  const row = await fetchRow(input.outboxId);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attempt_count, 1);
  assert.equal(row.last_error, 'transient failure');
  assert.notEqual(row.encrypted_payload, null);
});

test('markDeadLetter sets status=DEAD_LETTER and purges the ciphertext columns', async () => {
  const repo = new MySqlEmailOutboxRepository();
  const input = insertInput();
  await repo.insert(input);
  await repo.markDeadLetter(input.outboxId, 'permanent failure', 5);
  const row = await fetchRow(input.outboxId);
  assert.equal(row.status, 'DEAD_LETTER');
  assert.equal(row.attempt_count, 5);
  assert.equal(row.encrypted_payload, null);
});

test.after(async () => {
  await closePool();
});
