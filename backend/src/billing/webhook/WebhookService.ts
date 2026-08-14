/**
 * PCA-BILL-2A -- webhook intake pipeline (Section 13 of this mission). The
 * single, authoritative place a provider's server-to-server payment
 * notification is verified, deduplicated, cross-checked against Billing
 * Core's own snapshotted price, and -- ONLY once every check has passed --
 * turned into a PaymentService.confirmPaymentAttempt call and (if the
 * attempt carries an increaseRequestRef) a
 * PaymentConfirmationPort.confirmPayment call.
 *
 * TRUST BOUNDARY (Section 13/14): the raw webhook payload's own claimed
 * status/amount/currency is NEVER treated as authoritative. Once the
 * signature is verified and the event is durably claimed (ProviderEvent
 * idempotency), this pipeline calls the provider's OWN `queryPayment` to
 * obtain authoritative status, and separately cross-checks that against
 * the PaymentAttempt's own immutable snapshotted price -- two independent
 * sources, neither of which is "whatever the webhook body said".
 *
 * NEVER LOGS RAW PAYLOAD/SECRETS: audit metadata below is limited to
 * opaque identifiers (provider, providerEventId, providerPaymentRef,
 * paymentAttemptId) -- never the raw payload bytes, never a signature or
 * secret value.
 */
import type { PaymentProvider } from '../providerContract.js';
import type { PaymentProviderRegistry } from '../provider/providerRegistry.js';
import type { ProviderEventRepository, ProviderEventRow, ProviderEventService } from '../providerEvent.js';
import type { PaymentService } from '../payment.js';
import { findPaymentAttemptByProviderReference } from '../shared/paymentAttemptLookup.js';
import { buildBillingAuditEvent } from '../audit.js';
import type { BillingAuditActor } from '../audit.js';
import type { PlatformAdminAuditService } from '../../platformadmin/audit/PlatformAdminAuditService.js';
import type { PaymentConfirmationPort } from '../../entitlements/payment/PaymentConfirmationPort.js';

/**
 * Freshness/replay window: a webhook payload whose own `timestamp` field
 * (when the provider's envelope carries one) is more than this far from
 * "now" (past OR future) is rejected before the idempotency claim.
 * 5 minutes -- generous enough to absorb ordinary delivery/clock skew,
 * tight enough to bound a captured-and-replayed-later payload's window of
 * validity.
 */
export const WEBHOOK_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export type WebhookOutcome = 'ACK' | 'REJECTED';

export interface WebhookProcessResult {
  readonly outcome: WebhookOutcome;
  readonly httpStatus: number;
}

/**
 * Reused, already-reserved platformadmin audit event type
 * (`PAYMENT_ROLLED_BACK`, backend/src/platformadmin/audit/types.ts) for
 * every anomaly this pipeline detects (amount/currency mismatch, unknown
 * payment reference, stale replay, provider-query failure, entitlement
 * activation anomaly). That file is platformadmin-owned and this lane
 * deliberately does not add a new event type to its closed vocabulary --
 * see this lane's final report for why PAYMENT_ROLLED_BACK's existing
 * semantics ("something about this payment's settlement had to be walked
 * back/flagged, not applied as claimed") fit every anomaly case here
 * without requiring an edit to that file.
 */
const ANOMALY_EVENT_TYPE = 'PAYMENT_ROLLED_BACK' as const;

/** A fixed, non-human system actor id for audit events this pipeline writes with no platform-admin operator behind them. */
const SYSTEM_WEBHOOK_ACTOR: BillingAuditActor = { adminId: 'SYSTEM_WEBHOOK_PIPELINE', role: null };

function safeParseJson(rawPayload: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawPayload.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class WebhookService {
  constructor(
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly providerEventService: ProviderEventService,
    private readonly providerEventRepository: ProviderEventRepository,
    private readonly paymentService: PaymentService,
    private readonly paymentConfirmationPort: PaymentConfirmationPort,
    private readonly auditService: PlatformAdminAuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processWebhook(providerName: string, rawPayload: Buffer, signatureHeader: string | undefined): Promise<WebhookProcessResult> {
    let provider: PaymentProvider;
    try {
      provider = this.providerRegistry.resolve(providerName);
    } catch {
      return { outcome: 'REJECTED', httpStatus: 400 };
    }

    if (!signatureHeader) return { outcome: 'REJECTED', httpStatus: 401 };

    let verification;
    try {
      verification = await provider.verifyWebhook({ rawPayload, signatureHeader });
    } catch {
      return { outcome: 'REJECTED', httpStatus: 401 };
    }
    if (!verification.verified || !verification.providerEventId) {
      return { outcome: 'REJECTED', httpStatus: 401 };
    }
    const providerEventId = verification.providerEventId;

    const parsed = safeParseJson(rawPayload);
    if (!parsed) return { outcome: 'REJECTED', httpStatus: 400 };

    const providerPaymentRef = typeof parsed.providerPaymentRef === 'string' ? parsed.providerPaymentRef : null;

    // Freshness/replay check -- BEFORE the idempotency claim (Section 13
    // step 4: rejecting a stale replay must never even attempt to claim
    // the event id, so a genuinely fresh redelivery of the same event id
    // later is not itself blocked by a stale attempt's claim).
    const timestampRaw = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
    if (timestampRaw !== null) {
      const timestamp = new Date(timestampRaw);
      if (Number.isNaN(timestamp.getTime())) return { outcome: 'REJECTED', httpStatus: 400 };
      const ageMs = Math.abs(this.now().getTime() - timestamp.getTime());
      if (ageMs > WEBHOOK_FRESHNESS_WINDOW_MS) {
        await this.auditAnomaly('STALE_REPLAY', providerName, providerEventId, providerPaymentRef, null);
        return { outcome: 'REJECTED', httpStatus: 401 };
      }
    }

    const recordOutcome = await this.providerEventService.record(providerName, providerEventId, providerPaymentRef, this.now());
    if (recordOutcome.outcome === 'DUPLICATE') {
      // Idempotent, stable response -- NEVER re-run any business logic for
      // a duplicate/out-of-order-redelivered event id.
      return { outcome: 'ACK', httpStatus: 200 };
    }

    const eventRow = recordOutcome.row;
    const processingStatus = await this.processRecordedEvent(providerName, provider, providerEventId, providerPaymentRef, eventRow);
    await this.providerEventRepository.updateProcessingStatus(eventRow.providerEventRowId, processingStatus);
    return { outcome: 'ACK', httpStatus: 200 };
  }

  private async processRecordedEvent(
    providerName: string,
    provider: PaymentProvider,
    providerEventId: string,
    providerPaymentRef: string | null,
    _eventRow: ProviderEventRow,
  ): Promise<'PROCESSED' | 'IGNORED' | 'FAILED'> {
    if (!providerPaymentRef) {
      await this.auditAnomaly('MALFORMED_PAYLOAD', providerName, providerEventId, null, null);
      return 'IGNORED';
    }

    let queryResult;
    try {
      queryResult = await provider.queryPayment(providerPaymentRef);
    } catch {
      await this.auditAnomaly('PROVIDER_QUERY_FAILED', providerName, providerEventId, providerPaymentRef, null);
      return 'FAILED';
    }

    const attempt = await findPaymentAttemptByProviderReference(providerName, providerPaymentRef);
    if (!attempt) {
      await this.auditAnomaly('UNKNOWN_PAYMENT_REFERENCE', providerName, providerEventId, providerPaymentRef, null);
      return 'IGNORED';
    }

    // Cross-check the PROVIDER'S OWN authoritative query result against
    // Billing Core's own immutable snapshotted price -- never the webhook
    // payload's own claims (which were only used, above, to route to a
    // providerPaymentRef, nothing more).
    if (queryResult.amountMinor !== attempt.price.amountMinor) {
      await this.auditAnomaly('AMOUNT_MISMATCH', providerName, providerEventId, providerPaymentRef, attempt.paymentAttemptId);
      return 'IGNORED';
    }
    if (queryResult.currencyCode !== attempt.price.currencyCode) {
      await this.auditAnomaly('CURRENCY_MISMATCH', providerName, providerEventId, providerPaymentRef, attempt.paymentAttemptId);
      return 'IGNORED';
    }

    if (queryResult.status === 'CONFIRMED') {
      const now = this.now();
      const transaction = await this.paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, providerName, providerPaymentRef, SYSTEM_WEBHOOK_ACTOR, now);

      if (attempt.increaseRequestRef) {
        const signal = await this.paymentService.toEntitlementSignal(attempt.paymentAttemptId);
        const idempotencyKey = `${providerName}:${providerEventId}`;
        const confirmation = await this.paymentConfirmationPort.confirmPayment({
          requestId: attempt.increaseRequestRef,
          idempotencyKey,
          targetDeviceLimit: signal.targetDeviceLimit ?? 0,
          amountMinor: signal.amountMinor,
          currencyCode: signal.currencyCode,
          quoteRef: signal.quoteId ?? signal.priceBookId,
          priceBookVersion: signal.priceBookVersion,
          paymentTransactionId: transaction.paymentTransactionId,
        });
        if (confirmation.outcome !== 'ACTIVATED' && confirmation.outcome !== 'ALREADY_ACTIVATED') {
          // AMOUNT_MISMATCH / REQUEST_NOT_PAYMENT_PENDING / REQUEST_NOT_FOUND:
          // the PAYMENT itself is genuinely confirmed and stays confirmed
          // (never rolled back here) -- this is an entitlement-side
          // anomaly, audited separately, with no entitlement change. The
          // webhook still returns a stable 200 ACK so the provider does
          // not retry forever over what is now a business-logic anomaly,
          // not a delivery failure (Section 13's explicit instruction).
          await this.auditAnomaly(`ENTITLEMENT_${confirmation.outcome}`, providerName, providerEventId, providerPaymentRef, attempt.paymentAttemptId);
        }
      }
      return 'PROCESSED';
    }

    if (queryResult.status === 'FAILED') {
      await this.paymentService.markFailed(attempt.paymentAttemptId, this.now());
      return 'PROCESSED';
    }

    // PENDING or CANCELLED at the provider: no PaymentAttempt/entitlement
    // mutation -- this event is simply not yet (or no longer) actionable.
    return 'IGNORED';
  }

  private async auditAnomaly(reason: string, provider: string, providerEventId: string, providerPaymentRef: string | null, paymentAttemptId: string | null): Promise<void> {
    await this.auditService.record(
      buildBillingAuditEvent({
        eventType: ANOMALY_EVENT_TYPE,
        actor: SYSTEM_WEBHOOK_ACTOR,
        targetRef: `payment_attempt:${paymentAttemptId ?? 'unknown'}`,
        result: 'FAILURE',
        occurredAt: this.now(),
        metadata: { reason, provider, providerEventId, providerPaymentRef },
      }),
    );
  }
}
