import type { EmailOutboxRepository } from './EmailOutboxRepository.js';
import type { EmailProviderAdapter } from './EmailProviderAdapter.js';
import { EmailDeliveryError } from './EmailProviderAdapter.js';
import { decryptOutboxContent } from './emailOutboxEncryption.js';
import { renderEmailTemplate, type EmailTemplateKind } from './emailTemplates.js';
import { computeEmailBackoff } from './emailBackoff.js';
import { logRedactedEmailAuditEvent, type EmailAuditSink } from './emailAudit.js';

export interface OutboxMessagePayload {
  readonly toEmail: string;
  readonly kind: EmailTemplateKind;
  readonly code: string;
}

export interface EmailOutboxProcessorDeps {
  readonly repository: EmailOutboxRepository;
  readonly providerAdapter: EmailProviderAdapter;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly randomFraction?: () => number;
  readonly auditSink?: EmailAuditSink;
}

export interface ProcessOutboxSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
}

const DEFAULT_CLAIM_LIMIT = 20;
// Comfortably longer than any single send attempt (SMTP/Graph calls are
// bounded by their own client timeouts, well under a minute) -- this is a
// reservation against a concurrent claim, not a real retry decision.
const DEFAULT_LEASE_MS = 60_000;

export type DeliveryOutcome = 'SENT' | 'RETRY_SCHEDULED' | 'DEAD_LETTER';

/**
 * Attempts ONE delivery of an already-decrypted payload and records
 * whatever happens (sent / rescheduled with backoff / dead-lettered) via
 * `deps.repository`. Shared by processOutboxOnce's claimed-row loop
 * (payload just decrypted) and EmailService's own immediate-send-on-enqueue
 * path (payload still in hand, plaintext, from before it was ever
 * encrypted -- never decrypted twice for the same attempt).
 */
export async function attemptDeliveryAndRecordOutcome(
  deps: EmailOutboxProcessorDeps,
  row: { outboxId: string; attemptCount: number; expiresAt: Date },
  payload: OutboxMessagePayload,
  now: Date,
): Promise<DeliveryOutcome> {
  const auditSink = deps.auditSink ?? logRedactedEmailAuditEvent;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await deps.repository.markDeadLetter(row.outboxId, 'expired before a successful send', row.attemptCount);
    return 'DEAD_LETTER';
  }

  const rendered = renderEmailTemplate(payload.kind, payload.code);
  try {
    const result = await deps.providerAdapter.send({ toEmail: payload.toEmail, ...rendered });
    await deps.repository.markSent(row.outboxId, result.providerMessageId, now);
    auditSink({ kind: payload.kind, providerName: deps.providerAdapter.providerName, outcome: 'SENT', attemptCount: row.attemptCount + 1 });
    return 'SENT';
  } catch (error) {
    const deliveryError = error instanceof EmailDeliveryError ? error : new EmailDeliveryError(String(error), true, { cause: error });
    const attemptCount = row.attemptCount + 1;
    const backoff = deliveryError.retryable
      ? computeEmailBackoff(attemptCount, now.getTime(), deps.randomFraction)
      : { shouldRetry: false, nextAttemptAtEpochMillis: now.getTime() };
    if (backoff.shouldRetry) {
      await deps.repository.recordFailureAndReschedule(row.outboxId, deliveryError.message, new Date(backoff.nextAttemptAtEpochMillis), attemptCount);
      auditSink({ kind: payload.kind, providerName: deps.providerAdapter.providerName, outcome: 'RETRY_SCHEDULED', attemptCount });
      return 'RETRY_SCHEDULED';
    }
    await deps.repository.markDeadLetter(row.outboxId, deliveryError.message, attemptCount);
    auditSink({ kind: payload.kind, providerName: deps.providerAdapter.providerName, outcome: 'DEAD_LETTER', attemptCount });
    return 'DEAD_LETTER';
  }
}

/**
 * PCA-DW-W2-15F -- claims and attempts delivery for every currently-due
 * outbox row, once. Callable directly (deterministic, no fake timers
 * needed) by tests; EmailOutboxWorker below wraps this in an interval for
 * the production background loop. (EmailService's own immediate-send-on-
 * enqueue path calls attemptDeliveryAndRecordOutcome directly instead of
 * this function -- see that module.)
 */
export async function processOutboxOnce(
  deps: EmailOutboxProcessorDeps,
  limit: number = DEFAULT_CLAIM_LIMIT,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<ProcessOutboxSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const claimedRows = await deps.repository.claimDueRows(now, limit, leaseMs);

  let sent = 0;
  let retryScheduled = 0;
  let deadLettered = 0;

  for (const row of claimedRows) {
    let payload: OutboxMessagePayload;
    try {
      payload = JSON.parse(decryptOutboxContent(row.encryptedPayload, deps.env)) as OutboxMessagePayload;
    } catch {
      // Undecryptable (wrong/rotated key, corrupt row) can never succeed on retry -- dead-letter immediately rather than burn the whole backoff budget on something that will never change.
      await deps.repository.markDeadLetter(row.outboxId, 'failed to decrypt outbox payload', row.attemptCount);
      deadLettered++;
      continue;
    }

    const outcome = await attemptDeliveryAndRecordOutcome(deps, row, payload, now);
    if (outcome === 'SENT') sent++;
    else if (outcome === 'RETRY_SCHEDULED') retryScheduled++;
    else deadLettered++;
  }

  return { claimed: claimedRows.length, sent, retryScheduled, deadLettered };
}

export interface EmailOutboxWorkerHandle {
  stop(): void;
}

/**
 * Wraps processOutboxOnce in a `setInterval` for the production background
 * loop. A run that's still in flight when the next tick fires is skipped
 * (never overlapped) -- a slow provider must not pile up concurrent
 * claim/send cycles against the same outbox.
 */
export function startEmailOutboxWorker(deps: EmailOutboxProcessorDeps, intervalMs: number): EmailOutboxWorkerHandle {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processOutboxOnce(deps)
      .catch((error) => {
        // eslint-disable-next-line no-console -- last-resort visibility for a worker-loop crash; never includes message content (processOutboxOnce's own catches handle those).
        console.error('[EmailOutboxWorker] processOutboxOnce failed', error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
  };
}
