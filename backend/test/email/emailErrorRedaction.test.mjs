// PCA-DW-W2-R1-8 -- raw provider error text must NEVER be persisted,
// audited, or logged: only EmailDeliveryError.category (a fixed, safe
// enum) may reach the outbox row's last_error column, the audit sink, or
// the console. A provider's own error message (SMTP response text, a
// Graph error body) can carry recipient/envelope/host/token detail, so it
// must stay ephemeral and in-process only.
//
// This test constructs EmailDeliveryError messages containing realistic
// sensitive content -- a recipient email, a 6-digit code, a fake bearer
// token, and SMTP envelope/response text -- and proves NONE of it survives
// past attemptDeliveryAndRecordOutcome, whether the outcome is a scheduled
// retry or a dead-letter (both via exhaustion and via an immediately
// non-retryable error).
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEmailOutboxRepository } from '../../dist/email/InMemoryEmailOutboxRepository.js';
import { attemptDeliveryAndRecordOutcome } from '../../dist/email/EmailOutboxProcessor.js';
import { EmailDeliveryError } from '../../dist/email/EmailProviderAdapter.js';
import { encryptOutboxContent } from '../../dist/email/emailOutboxEncryption.js';

const ENV = { NODE_ENV: 'test' };

const SENSITIVE_RECIPIENT = 'parent@example.com';
const SENSITIVE_CODE = '123456';
const SENSITIVE_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.fake-adversarial-payload.signature';
const SENSITIVE_ENVELOPE = 'RCPT TO:<parent@example.com> 550 5.1.1 <parent@example.com>: Recipient address rejected';
const SENSITIVE_STRINGS = [SENSITIVE_RECIPIENT, SENSITIVE_CODE, SENSITIVE_TOKEN, SENSITIVE_ENVELOPE];

function sensitiveErrorMessage() {
  return (
    `SMTP delivery failed for ${SENSITIVE_RECIPIENT} (code ${SENSITIVE_CODE}) ` +
    `using auth header "${SENSITIVE_TOKEN}" -- server said: ${SENSITIVE_ENVELOPE}`
  );
}

function assertNoSensitiveContent(haystack, label) {
  for (const needle of SENSITIVE_STRINGS) {
    assert.equal(haystack.includes(needle), false, `${label} must never contain: ${needle}`);
  }
}

test('SECURITY: a provider error message containing recipient/code/token/envelope text never reaches the outbox row, the audit sink, or the console', async (t) => {
  const repo = new InMemoryEmailOutboxRepository();
  const auditEvents = [];
  const consoleCalls = [];
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  for (const method of consoleMethods) {
    t.mock.method(console, method, (...args) => {
      consoleCalls.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }

  const payload = { toEmail: SENSITIVE_RECIPIENT, kind: 'VERIFICATION', code: SENSITIVE_CODE };
  const encryptedPayload = encryptOutboxContent(JSON.stringify(payload), ENV);
  const now = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date('2026-01-01T01:00:00.000Z');

  async function insertRow(outboxId) {
    await repo.insert({
      outboxId,
      idempotencyKey: `idem-${outboxId}`,
      encryptedPayload,
      createdAt: now,
      expiresAt,
      initialClaimableAt: now,
    });
  }

  const deps = {
    repository: repo,
    providerAdapter: { providerName: 'ADVERSARIAL_TEST_PROVIDER' },
    env: ENV,
    auditSink: (event) => auditEvents.push(event),
  };

  // 1. A retryable failure -- must schedule a retry, never dead-letter yet.
  await insertRow('outbox-retry');
  const retryableOutcome = await attemptDeliveryAndRecordOutcome(
    { ...deps, providerAdapter: { providerName: 'ADVERSARIAL_TEST_PROVIDER', send: async () => { throw new EmailDeliveryError(sensitiveErrorMessage(), true, 'EMAIL_PROVIDER_REJECTED'); } } },
    { outboxId: 'outbox-retry', attemptCount: 0, expiresAt },
    payload,
    now,
  );
  assert.equal(retryableOutcome, 'RETRY_SCHEDULED');

  // 2. The SAME retryable error, but exhausted (attemptCount already at the
  // max) -- forces DEAD_LETTER via exhaustion rather than immediate refusal.
  await insertRow('outbox-exhausted');
  const exhaustedOutcome = await attemptDeliveryAndRecordOutcome(
    { ...deps, providerAdapter: { providerName: 'ADVERSARIAL_TEST_PROVIDER', send: async () => { throw new EmailDeliveryError(sensitiveErrorMessage(), true, 'EMAIL_PROVIDER_REJECTED'); } } },
    { outboxId: 'outbox-exhausted', attemptCount: 4, expiresAt },
    payload,
    now,
  );
  assert.equal(exhaustedOutcome, 'DEAD_LETTER');

  // 3. A NON-retryable error -- immediate DEAD_LETTER on the first attempt.
  await insertRow('outbox-permanent');
  const permanentOutcome = await attemptDeliveryAndRecordOutcome(
    { ...deps, providerAdapter: { providerName: 'ADVERSARIAL_TEST_PROVIDER', send: async () => { throw new EmailDeliveryError(sensitiveErrorMessage(), false, 'EMAIL_PROVIDER_AUTH_FAILED'); } } },
    { outboxId: 'outbox-permanent', attemptCount: 0, expiresAt },
    payload,
    now,
  );
  assert.equal(permanentOutcome, 'DEAD_LETTER');

  // -- Assertions: the safe category is what's stored, and it's the ONLY
  // thing stored (never any sensitive substring).
  const retryRow = repo.getRowForTest('outbox-retry');
  assert.equal(retryRow.lastError, 'EMAIL_PROVIDER_REJECTED');
  assertNoSensitiveContent(retryRow.lastError, 'outbox row last_error (retry)');

  const exhaustedRow = repo.getRowForTest('outbox-exhausted');
  assert.equal(exhaustedRow.lastError, 'EMAIL_PROVIDER_REJECTED');
  assertNoSensitiveContent(exhaustedRow.lastError, 'outbox row last_error (exhausted dead-letter)');

  const permanentRow = repo.getRowForTest('outbox-permanent');
  assert.equal(permanentRow.lastError, 'EMAIL_PROVIDER_AUTH_FAILED');
  assertNoSensitiveContent(permanentRow.lastError, 'outbox row last_error (immediate dead-letter)');

  // -- The audit sink's events are structurally incapable of carrying the
  // error at all (EmailAuditEvent has no such field) -- assert that in
  // practice too, not just by type.
  assert.equal(auditEvents.length, 3);
  for (const event of auditEvents) {
    assertNoSensitiveContent(JSON.stringify(event), 'audit sink event');
  }

  // -- Nothing was ever routed to any console method during the whole flow.
  assert.equal(consoleCalls.length, 0, 'no console output should occur on this path at all');
  assertNoSensitiveContent(consoleCalls.join('\n'), 'console output');
});
