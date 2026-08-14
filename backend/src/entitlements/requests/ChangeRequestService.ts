import { randomUUID } from 'node:crypto';
import { runInTransaction } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { EntitlementService } from '../EntitlementService.js';
import type { EntitlementRepository } from '../EntitlementRepository.js';
import type { ChangeRequestRepository } from './ChangeRequestRepository.js';
import type { QuotePort, ResolveStandardQuoteInput } from '../quote/QuotePort.js';
import { assertValidPriceBookVersion } from '../types.js';
import type { EntitlementChangeRequestRecord, EntitlementChangeRequestState, LimitType, OpaqueFamilyId, QuoteSnapshot } from '../types.js';
// PCA-COMMERCIAL-NOTIFY-1 composition (Wave 3A correction R1) -- see
// billing/webhook/WebhookService.ts's identical header note on the
// post-commit, idempotent (dedupeKey) publish pattern used throughout this
// composition pass. dedupeKey is always the change-request identity here:
// QUOTE_READY/REQUEST_DENIED are each attainable exactly once per request
// (createRequest/issueCustomQuote/deny all guard the request's OWN prior
// state before transitioning), so requestId alone is a sufficient,
// stable, retry-safe dedupe identity for every hook in this file.
import type { CommercialNotificationPublisher } from '../../commercialnotifications/CommercialNotificationPublisher.js';

export type ChangeRequestErrorCode =
  | 'INVALID_TARGET'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'PARENT_MEMBER_NEVER_BILLABLE'
  | 'WRONG_LIMIT_TYPE';

export class ChangeRequestError extends Error {
  readonly code: ChangeRequestErrorCode;
  constructor(code: ChangeRequestErrorCode) {
    super(`Entitlement change request error: ${code}`);
    this.name = 'ChangeRequestError';
    this.code = code;
  }
}

const OPEN_STATES: EntitlementChangeRequestState[] = ['PENDING', 'QUOTED', 'PAYMENT_PENDING'];
/** PCA-ADD-BILL-043's custom-quote validity window before it must be re-quoted. */
const CUSTOM_QUOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssueCustomQuoteInput {
  amountMinor: bigint;
  currencyCode: string;
  actorAdminId: string;
}

/**
 * PCA-ADD-PA-030/032/054: the increase-request lifecycle service. Every
 * state-changing method here composes ChangeRequestRepository (the
 * request's own state) with EntitlementRepository (the raised limit) in
 * ONE transaction where both must move together (PCA-ADD-PA-032:
 * "an approved-but-not-applied request is a defect state the
 * implementation must not be able to represent").
 */
export class ChangeRequestService {
  private readonly changeRequestRepository: ChangeRequestRepository;
  private readonly entitlementRepository: EntitlementRepository;
  private readonly entitlementService: EntitlementService;
  private readonly quotePort: QuotePort;
  private readonly notificationPublisher: CommercialNotificationPublisher;
  private readonly now: () => Date;

  constructor(
    changeRequestRepository: ChangeRequestRepository,
    entitlementRepository: EntitlementRepository,
    entitlementService: EntitlementService,
    quotePort: QuotePort,
    notificationPublisher: CommercialNotificationPublisher,
    now: () => Date = () => new Date(),
  ) {
    this.changeRequestRepository = changeRequestRepository;
    this.entitlementRepository = entitlementRepository;
    this.entitlementService = entitlementService;
    this.quotePort = quotePort;
    this.notificationPublisher = notificationPublisher;
    this.now = now;
  }

  private async publishQuoteReady(request: EntitlementChangeRequestRecord, now: Date): Promise<void> {
    await this.notificationPublisher.publish(
      {
        accountRef: request.familyId,
        eventType: 'QUOTE_READY',
        dedupeKey: `QUOTE_READY:${request.requestId}`,
        resourceRef: request.requestId,
        messageKey: 'commercial_notification.quote_ready',
        params: request.quote ? { amountMinor: request.quote.amountMinor.toString(10), currencyCode: request.quote.currencyCode } : null,
      },
      now,
    );
  }

  /**
   * PCA-ADD-PA-050: for MANAGED_DEVICE_LIMIT, resolves a standard quote
   * automatically (PENDING -> QUOTED, no admin step) or marks the request
   * PENDING_ADMIN_QUOTE (awaitingAdminQuote=true) when no PriceBook row
   * exists. PARENT_MEMBER_LIMIT requests never resolve a quote
   * (PCA-ADD-PA-054) and stay PENDING for direct admin approval/denial.
   */
  async createRequest(familyId: OpaqueFamilyId, limitType: LimitType, targetLimit: number, market: ResolveStandardQuoteInput['commercialMarket'], currencyCode: string): Promise<EntitlementChangeRequestRecord> {
    if (!Number.isInteger(targetLimit) || targetLimit < 0) throw new ChangeRequestError('INVALID_TARGET');
    const now = this.now();
    const entitlement = await this.entitlementService.getOrCreateForFamily(familyId, now);
    const currentLimit = limitType === 'MANAGED_DEVICE_LIMIT' ? entitlement.managedDeviceLimit : entitlement.parentMemberLimit;
    if (targetLimit <= currentLimit) throw new ChangeRequestError('INVALID_TARGET');

    const requestId = randomUUID();
    const created = await runInTransaction((conn) =>
      this.changeRequestRepository.create(conn, { requestId, familyId, limitType, currentLimitAtRequest: currentLimit, targetLimit, now }),
    );

    if (limitType !== 'MANAGED_DEVICE_LIMIT') return created;

    const resolution = await this.quotePort.resolveStandardQuote({ commercialMarket: market, currencyCode, targetDeviceLimit: targetLimit });
    if (resolution.kind === 'REQUIRES_CUSTOM_QUOTE') {
      const marked = await runInTransaction((conn) => this.changeRequestRepository.markAwaitingAdminQuote(conn, requestId, this.now()));
      return marked ?? created;
    }
    assertValidPriceBookVersion(resolution.priceBookVersion);
    const quote: QuoteSnapshot = {
      quoteKind: 'STANDARD',
      quoteRef: resolution.quoteId,
      amountMinor: resolution.amountMinor,
      currencyCode: resolution.currencyCode,
      priceBookVersion: resolution.priceBookVersion,
      quotedAt: this.now(),
      expiresAt: resolution.expiresAt,
    };
    const quoted = await runInTransaction((conn) => this.changeRequestRepository.attachQuote(conn, requestId, quote, this.now()));
    const result = quoted ?? created;
    if (quoted) await this.publishQuoteReady(result, this.now());
    return result;
  }

  /** PCA-ADD-BILL-044/045: custom quantity path, FINANCE_ADMIN/APP_OWNER only -- caller enforces RBAC before invoking this. */
  async issueCustomQuote(requestId: string, input: IssueCustomQuoteInput): Promise<EntitlementChangeRequestRecord> {
    const now = this.now();
    const request = await this.changeRequestRepository.getById(requestId);
    if (!request) throw new ChangeRequestError('NOT_FOUND');
    if (request.limitType !== 'MANAGED_DEVICE_LIMIT') throw new ChangeRequestError('PARENT_MEMBER_NEVER_BILLABLE');
    if (request.state !== 'PENDING') throw new ChangeRequestError('INVALID_STATE');

    const quote: QuoteSnapshot = {
      quoteKind: 'CUSTOM',
      quoteRef: `custom-quote:${randomUUID()}`,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      priceBookVersion: null,
      quotedAt: now,
      expiresAt: new Date(now.getTime() + CUSTOM_QUOTE_TTL_MS),
    };
    const updated = await runInTransaction(async (conn) => {
      const quoted = await this.changeRequestRepository.attachQuote(conn, requestId, quote, now);
      if (!quoted) return null;
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'QUOTE_ISSUED',
        actorAdminId: input.actorAdminId,
        actorRole: null,
        targetRef: `request:${requestId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: requestId,
        metadata: { targetDeviceLimit: request.targetLimit, amountMinor: input.amountMinor.toString(), currencyCode: input.currencyCode },
      });
      return quoted;
    });
    if (!updated) throw new ChangeRequestError('INVALID_STATE');
    await this.publishQuoteReady(updated, now);
    return updated;
  }

  async moveToPaymentPending(requestId: string): Promise<EntitlementChangeRequestRecord> {
    const updated = await runInTransaction((conn) => this.changeRequestRepository.moveToPaymentPending(conn, requestId, this.now()));
    if (!updated) throw new ChangeRequestError('INVALID_STATE');
    return updated;
  }

  /** PCA-ADD-PA-054: never priced, never invokes PriceBook/payment. PENDING -> APPROVED only. */
  async approveParentMemberRequest(requestId: string, actorAdminId: string): Promise<EntitlementChangeRequestRecord> {
    const now = this.now();
    const request = await this.changeRequestRepository.getById(requestId);
    if (!request) throw new ChangeRequestError('NOT_FOUND');
    if (request.limitType !== 'PARENT_MEMBER_LIMIT') throw new ChangeRequestError('WRONG_LIMIT_TYPE');
    if (request.state !== 'PENDING') throw new ChangeRequestError('INVALID_STATE');

    const result = await runInTransaction(async (conn) => {
      await this.entitlementRepository.lockForFamily(conn, request.familyId);
      const approved = await this.changeRequestRepository.markApproved(conn, requestId, ['PENDING'], actorAdminId, false, now);
      if (!approved) return null;
      await this.entitlementRepository.raiseLimit(conn, request.familyId, 'PARENT_MEMBER_LIMIT', request.targetLimit, now);
      await this.writeApprovalAudit(conn, request, actorAdminId, false, now);
      return approved;
    });
    if (!result) throw new ChangeRequestError('INVALID_STATE');
    return result;
  }

  /** PCA-ADD-PA-054's admin no-charge exception for a device increase. Caller MUST have already enforced RBAC + step-up (ENTITLEMENT_LIMIT_OVERRIDE) before calling. */
  async approveDeviceRequestNoCharge(requestId: string, actorAdminId: string, reason: string): Promise<EntitlementChangeRequestRecord> {
    const now = this.now();
    const request = await this.changeRequestRepository.getById(requestId);
    if (!request) throw new ChangeRequestError('NOT_FOUND');
    if (request.limitType !== 'MANAGED_DEVICE_LIMIT') throw new ChangeRequestError('WRONG_LIMIT_TYPE');
    if (!OPEN_STATES.includes(request.state)) throw new ChangeRequestError('INVALID_STATE');

    const result = await runInTransaction(async (conn) => {
      await this.entitlementRepository.lockForFamily(conn, request.familyId);
      const approved = await this.changeRequestRepository.markApproved(conn, requestId, OPEN_STATES, actorAdminId, true, now);
      if (!approved) return null;
      await this.entitlementRepository.raiseLimit(conn, request.familyId, 'MANAGED_DEVICE_LIMIT', request.targetLimit, now);
      await this.writeApprovalAudit(conn, request, actorAdminId, true, now, reason);
      return approved;
    });
    if (!result) throw new ChangeRequestError('INVALID_STATE');
    return result;
  }

  /** Creates a PENDING request and immediately approves it at no charge -- the primary admin no-charge-override entrypoint (no pre-existing parent request required). */
  async createAndApproveNoChargeDeviceIncrease(familyId: OpaqueFamilyId, targetLimit: number, actorAdminId: string, reason: string): Promise<EntitlementChangeRequestRecord> {
    if (!Number.isInteger(targetLimit) || targetLimit < 0) throw new ChangeRequestError('INVALID_TARGET');
    const now = this.now();
    const entitlement = await this.entitlementService.getOrCreateForFamily(familyId, now);
    if (targetLimit <= entitlement.managedDeviceLimit) throw new ChangeRequestError('INVALID_TARGET');
    const requestId = randomUUID();
    await runInTransaction((conn) =>
      this.changeRequestRepository.create(conn, { requestId, familyId, limitType: 'MANAGED_DEVICE_LIMIT', currentLimitAtRequest: entitlement.managedDeviceLimit, targetLimit, now }),
    );
    return this.approveDeviceRequestNoCharge(requestId, actorAdminId, reason);
  }

  async deny(requestId: string, actorAdminId: string | null, reason: string): Promise<EntitlementChangeRequestRecord> {
    const now = this.now();
    const request = await this.changeRequestRepository.getById(requestId);
    if (!request) throw new ChangeRequestError('NOT_FOUND');
    if (!OPEN_STATES.includes(request.state)) throw new ChangeRequestError('INVALID_STATE');

    const result = await runInTransaction(async (conn) => {
      const denied = await this.changeRequestRepository.markDenied(conn, requestId, OPEN_STATES, actorAdminId, reason, now);
      if (!denied) return null;
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'LIMIT_REQUEST_DENIED',
        actorAdminId,
        actorRole: null,
        targetRef: `request:${requestId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: requestId,
        metadata: { reason },
      });
      return denied;
    });
    if (!result) throw new ChangeRequestError('INVALID_STATE');
    await this.notificationPublisher.publish(
      {
        accountRef: result.familyId,
        eventType: 'REQUEST_DENIED',
        dedupeKey: `REQUEST_DENIED:${requestId}`,
        resourceRef: requestId,
        messageKey: 'commercial_notification.request_denied',
        params: { reason },
      },
      now,
    );
    return result;
  }

  /** Parent-initiated withdrawal, valid from PENDING or QUOTED only (PAYMENT_PENDING cancellation requires coordinating the in-flight payment, out of this lane's scope -- see final report). */
  async cancel(requestId: string): Promise<EntitlementChangeRequestRecord> {
    const result = await runInTransaction((conn) => this.changeRequestRepository.markCancelled(conn, requestId, ['PENDING', 'QUOTED'], this.now()));
    if (!result) throw new ChangeRequestError('INVALID_STATE');
    return result;
  }

  private async writeApprovalAudit(conn: Parameters<typeof insertPlatformAdminAuditEventRow>[0], request: EntitlementChangeRequestRecord, actorAdminId: string, noCharge: boolean, now: Date, reason?: string): Promise<void> {
    await insertPlatformAdminAuditEventRow(conn, {
      eventId: randomUUID(),
      eventType: 'ENTITLEMENT_INCREASED',
      actorAdminId,
      actorRole: null,
      targetRef: `family:${request.familyId}`,
      result: 'SUCCESS',
      occurredAt: now,
      correlationId: request.requestId,
      metadata: { requestId: request.requestId, limitType: request.limitType, targetLimit: request.targetLimit, noCharge, reason: reason ?? null },
    });
    await insertPlatformAdminAuditEventRow(conn, {
      eventId: randomUUID(),
      eventType: 'LIMIT_REQUEST_APPROVED',
      actorAdminId,
      actorRole: null,
      targetRef: `request:${request.requestId}`,
      result: 'SUCCESS',
      occurredAt: now,
      correlationId: request.requestId,
      metadata: { noCharge },
    });
  }
}
