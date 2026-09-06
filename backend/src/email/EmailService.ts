import { randomUUID } from 'node:crypto';
import type { EmailSenderPort } from '../parentaccount/EmailSenderPort.js';
import type { EmailOutboxRepository } from './EmailOutboxRepository.js';
import type { EmailProviderAdapter } from './EmailProviderAdapter.js';
import { attemptDeliveryAndRecordOutcome, type EmailOutboxProcessorDeps, type OutboxMessagePayload } from './EmailOutboxProcessor.js';
import { encryptOutboxContent } from './emailOutboxEncryption.js';
import { computeEmailIdempotencyKey } from './emailIdempotencyKey.js';
import { EMAIL_OUTBOX_CLAIM_LEASE_MS } from './emailTimingPolicy.js';
import type { EmailAuditSink } from './emailAudit.js';
import type { EmailTemplateKind } from './emailTemplates.js';

export interface EmailServiceDeps {
  readonly repository: EmailOutboxRepository;
  readonly providerAdapter: EmailProviderAdapter;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly randomFraction?: () => number;
  readonly auditSink?: EmailAuditSink;
  readonly idGenerator?: () => string;
}

// Independent of, and deliberately longer than, VERIFICATION_CODE_TTL_MS/
// PASSWORD_RESET_CODE_TTL_MS (parentaccount/policy.ts) -- EmailService has
// no dependency on that module (email/ stays a self-contained
// infrastructure domain, per this mission's "centralized EmailService,
// no direct provider calls from business modules" architecture). A code's
// own TTL is always the tighter bound in practice; this only guards
// against an outbox row surviving indefinitely if something upstream is
// badly wrong.
const OUTBOX_MESSAGE_TTL_MS = 30 * 60_000;

/**
 * PCA-DW-W2-15F -- the SOLE centralized entry point for sending PCA email.
 * Implements the existing EmailSenderPort interface
 * (parentaccount/ParentAccountService.ts's only dependency), so no business
 * module gains, or needs, any direct knowledge of a provider adapter, the
 * outbox, retries, or encryption -- exactly the "no direct provider calls
 * from business modules" requirement.
 *
 * Every send: (1) durably enqueues an encrypted outbox row FIRST (so a
 * process crash immediately after never loses the send), (2) attempts
 * immediate delivery once, (3) on success or on a RETRYABLE failure,
 * resolves normally -- the outbox worker (EmailOutboxProcessor.ts) will
 * keep retrying a still-pending row in the background. Mirrors
 * ParentAccountService's own existing "best-effort, deliberately swallowed"
 * contract (see issueAndSendVerificationCode's doc comment) at the
 * INFRASTRUCTURE layer instead of the caller having to do it: the code is
 * already durably stored by ParentAccountRepository before this is ever
 * called, so a transient email failure was never a reason to fail the
 * whole registration/reset request, and still isn't.
 *
 * PCA-DW-W2-R1-5: the row is inserted with next_attempt_at deferred to
 * now + EMAIL_OUTBOX_CLAIM_LEASE_MS (never "due immediately") -- this is
 * this process's OWN exclusivity lease on the row it just created, so
 * EmailOutboxWorker.claimDueRows cannot hand the SAME row to a concurrent
 * process while THIS immediate attempt below is still in flight (closing a
 * real double-send race: without this, another backend instance's worker
 * tick landing in the same instant as this call could independently claim
 * and deliver the identical message). If this process crashes before
 * recording an outcome, the row simply becomes claimable once that lease
 * elapses -- exactly the same self-healing behaviour claimDueRows' own
 * per-claim lease already has, applied once here at insert time too.
 *
 * Only an ENQUEUE failure (a genuine outbox-persistence error, not a
 * delivery failure) rejects -- ParentAccountService's existing try/catch
 * around this call already handles that identically to any other failure.
 */
export class EmailService implements EmailSenderPort {
  constructor(private readonly deps: EmailServiceDeps) {}

  async sendVerificationCode(email: string, code: string): Promise<void> {
    await this.enqueueAndAttempt('VERIFICATION', email, code);
  }

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    await this.enqueueAndAttempt('PASSWORD_RESET', email, code);
  }

  private async enqueueAndAttempt(kind: EmailTemplateKind, email: string, code: string): Promise<void> {
    const now = (this.deps.now ?? (() => new Date()))();
    const normalizedEmail = email.trim().toLowerCase();
    // Deterministic (not random) so a genuine duplicate call for the SAME
    // kind/email/code (e.g. an upstream request retried after a lost
    // response) enqueues only once -- see migration 0038's idempotency_key
    // column. KEYED (HMAC via a key derived from the outbox encryption
    // key), NOT a plain digest: an unkeyed hash of kind+email+code would
    // let a DB reader who already knows/guesses the recipient email
    // brute-force all 1,000,000 six-digit candidates offline and recover
    // the exact code from this column alone -- see emailIdempotencyKey.ts's
    // own doc comment for the full reasoning.
    const idempotencyKey = computeEmailIdempotencyKey(kind, normalizedEmail, code, this.deps.env);
    const outboxId = (this.deps.idGenerator ?? randomUUID)();
    const payload: OutboxMessagePayload = { toEmail: normalizedEmail, kind, code };
    const encryptedPayload = encryptOutboxContent(JSON.stringify(payload), this.deps.env);

    const outcome = await this.deps.repository.insert({
      outboxId,
      idempotencyKey,
      encryptedPayload,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OUTBOX_MESSAGE_TTL_MS),
      // See this class's own doc comment: reserves exclusive delivery
      // rights for the immediate attempt below until this lease elapses.
      initialClaimableAt: new Date(now.getTime() + EMAIL_OUTBOX_CLAIM_LEASE_MS),
    });
    if (outcome === 'DUPLICATE_IDEMPOTENCY_KEY') return;

    const processorDeps: EmailOutboxProcessorDeps = {
      repository: this.deps.repository,
      providerAdapter: this.deps.providerAdapter,
      env: this.deps.env,
      now: this.deps.now,
      randomFraction: this.deps.randomFraction,
      auditSink: this.deps.auditSink,
    };
    // Never propagated: a failed immediate attempt just leaves the row
    // PENDING (or rescheduled) for the background worker -- see this
    // class's own doc comment.
    await attemptDeliveryAndRecordOutcome(processorDeps, { outboxId, attemptCount: 0, expiresAt: new Date(now.getTime() + OUTBOX_MESSAGE_TTL_MS) }, payload, now);
  }
}
