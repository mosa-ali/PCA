// PCA-DW-W2-R1-5 -- closes the immediate-send/worker duplicate race:
// EmailService's own immediate delivery attempt (on enqueue) and
// EmailOutboxWorker's background claimDueRows loop could otherwise both
// act on the same row across multiple backend instances. The fix (see
// EmailService.ts/EmailOutboxProcessor.ts doc comments) reuses the row's
// own next_attempt_at as an initial exclusivity lease, owned by the
// enqueuing instance, that a concurrent claimDueRows call cannot see past
// until it elapses.
//
// Required invariant under test here: while ONE logical message's provider
// call is still in flight (blocked), a concurrent claim attempt against the
// SAME repository must claim nothing, and PROVIDER_CALL_COUNT must remain
// exactly 1 throughout.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEmailOutboxRepository } from '../../dist/email/InMemoryEmailOutboxRepository.js';
import { EmailService } from '../../dist/email/EmailService.js';
import { processOutboxOnce } from '../../dist/email/EmailOutboxProcessor.js';
import { EMAIL_OUTBOX_CLAIM_LEASE_MS } from '../../dist/email/emailTimingPolicy.js';

const ENV = { NODE_ENV: 'test' };

test('CONCURRENCY: PROVIDER_CALL_COUNT stays exactly 1 when a concurrent worker claim attempt runs while the immediate send is still blocked in-flight', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  let providerCallCount = 0;
  let releaseSend;
  const blockedUntilReleased = new Promise((resolve) => {
    releaseSend = resolve;
  });
  const provider = {
    providerName: 'BLOCKING_TEST_PROVIDER',
    async send() {
      providerCallCount += 1;
      await blockedUntilReleased;
      return { providerMessageId: 'msg-1' };
    },
  };
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });

  const pending = service.sendVerificationCode('parent@example.com', '123456');
  // Let the enqueue (repository.insert) and the immediate send call land --
  // both happen synchronously relative to the never-yet-resolved `send()`.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerCallCount, 1, 'the immediate attempt itself must have reached the provider exactly once by now');

  // Simulate a concurrent worker tick -- a DIFFERENT backend instance's
  // EmailOutboxWorker -- racing against the still-in-flight immediate
  // attempt above, against the SAME repository/database.
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV }, 20, EMAIL_OUTBOX_CLAIM_LEASE_MS);
  assert.equal(summary.claimed, 0, 'the row is still inside its own initial claim lease -- the concurrent worker must not be able to claim it yet');
  assert.equal(providerCallCount, 1, 'the concurrent claim attempt must not itself have triggered a second provider call');

  releaseSend();
  await pending;
  assert.equal(providerCallCount, 1, 'exactly one provider call total for one logical message, start to finish');
});

test('CONCURRENCY: once the immediate attempt fails (retryable) and the initial lease elapses, the worker -- and only the worker -- picks the row up next', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  let providerCallCount = 0;
  const provider = {
    providerName: 'FAIL_ONCE_THEN_SUCCEED_PROVIDER',
    async send() {
      providerCallCount += 1;
      if (providerCallCount === 1) {
        const { EmailDeliveryError } = await import('../../dist/email/EmailProviderAdapter.js');
        throw new EmailDeliveryError('transient', true, 'EMAIL_PROVIDER_NETWORK');
      }
      return { providerMessageId: 'msg-1' };
    },
  };
  const fixedNow = new Date('2026-01-01T00:00:00.000Z');
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV, now: () => fixedNow });

  await service.sendVerificationCode('parent@example.com', '123456');
  assert.equal(providerCallCount, 1, 'the immediate attempt failed once (retryable) -- no second call yet');

  // recordFailureAndReschedule already moved next_attempt_at to its own
  // backoff-computed time -- still in the future relative to fixedNow -- so
  // a worker tick at the SAME instant must claim nothing yet.
  const tooSoon = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => fixedNow }, 20, EMAIL_OUTBOX_CLAIM_LEASE_MS);
  assert.equal(tooSoon.claimed, 0, 'the failed row must not be claimable before its own retry backoff has elapsed');
  assert.equal(providerCallCount, 1);

  // Advance well past the retry backoff (capped at 5 minutes) but still
  // comfortably inside the message's own 30-minute outbox TTL -- the
  // worker's own claim/retry authority takes over exactly once.
  const later = new Date(fixedNow.getTime() + 10 * 60_000);
  const summary = await processOutboxOnce({ repository: repo, providerAdapter: provider, env: ENV, now: () => later }, 20, EMAIL_OUTBOX_CLAIM_LEASE_MS);
  assert.equal(summary.claimed, 1);
  assert.equal(summary.sent, 1);
  assert.equal(providerCallCount, 2, 'the retry is the SECOND and only additional provider call for this one logical message');
});
