/**
 * PCA-DW-W2-R1-5/6 -- the one shared source of truth tying together the
 * outbox's claim-exclusivity lease and every provider transport's own
 * network timeout. Both MUST be derived from here, never re-declared
 * independently in EmailService.ts/EmailOutboxProcessor.ts/the provider
 * adapters -- the whole safety property ("a provider call can never still
 * be in flight when a concurrent worker's claim lease on the same row
 * expires") depends on one number always being smaller than the other by a
 * real margin, not on two independently-maintained constants happening to
 * agree.
 *
 * EMAIL_OUTBOX_CLAIM_LEASE_MS is the exclusivity window a claim (by
 * EmailOutboxRepository.claimDueRows, OR by EmailService's own initial
 * insert -- see EmailService.ts's own doc comment) reserves a row for:
 * nothing else may attempt delivery of that row again before this elapses.
 *
 * EMAIL_PROVIDER_TIMEOUT_MS bounds every network call a provider adapter
 * makes (SMTP connect/greeting/socket, Graph token/sendMail fetch) via
 * AbortController/nodemailer's own timeout options -- never the bare OS
 * TCP default, which can run far longer than any lease. The margin below
 * (3x) is deliberately generous: a provider call that legitimately needs
 * close to the full lease to complete is itself a sign something is
 * unhealthy, and this bound exists specifically so a hung/slow network
 * call can never outlive the exclusivity guarantee it must stay inside of.
 */
export const EMAIL_OUTBOX_CLAIM_LEASE_MS = 60_000;
export const EMAIL_PROVIDER_TIMEOUT_MS = 20_000;

if (EMAIL_PROVIDER_TIMEOUT_MS * 3 > EMAIL_OUTBOX_CLAIM_LEASE_MS) {
  // Defence in depth against a future edit accidentally narrowing the
  // margin below what the concurrency guarantee actually needs -- fails at
  // module load (import time), not silently at runtime under real load.
  throw new Error('EMAIL_PROVIDER_TIMEOUT_MS must leave at least a 3x safety margin under EMAIL_OUTBOX_CLAIM_LEASE_MS.');
}
