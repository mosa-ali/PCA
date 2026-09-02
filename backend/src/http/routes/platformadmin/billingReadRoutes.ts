/**
 * PCA-PA-3B -- Platform Administration safe billing READ views (mission
 * Section 15): plans, subscriptions, invoices, payment attempts/transactions,
 * refunds, disputes, plus the pending-custom-quote review queue (mission
 * Section 14's "list pending custom-quote requests"). Every list is bounded
 * and stably ordered (`platformadmin/api/pagination.ts`). RBAC reuses
 * `billing/rbac.ts`'s `VIEW_BILLING_RECORDS` (APP_OWNER/FINANCE_ADMIN/
 * AUDITOR_READ_ONLY -- PLATFORM_ADMIN and SUPPORT_ADMIN get no billing-record
 * read visibility per Section 3.7/`billing/rbac.ts`'s matrix) except the
 * pending-custom-quote queue, which is entitlement-request metadata (not a
 * Billing Core record) and so is gated by the entitlement plane's own
 * `VIEW_SUPPORT_ACCOUNT_METADATA`/`ADMINISTER_BILLING` operations instead,
 * matching `PlatformAdminEntitlementService.issueCustomQuote`'s own gate.
 *
 * Never exposes a raw provider payload -- only the opaque
 * `providerReference`/`providerTransactionRef` fields `billing/*`'s own
 * domain types already carry.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { requireBillingOperation, BillingAuthorizationError } from '../../../billing/rbac.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { BillingReadModel } from '../../../platformadmin/readmodels/BillingReadModel.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson, moneyOrNullToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminBillingReadRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

/** Mirrors auditRoutes.ts's own local parseDate exactly -- this codebase does not share one helper across route files. */
function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function registerPlatformAdminBillingReadRoutes(app: FastifyInstance, deps: PlatformAdminBillingReadRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-billing-read' });
  const readModel = new BillingReadModel();

  function requireBillingRead(request: FastifyRequest, reply: FastifyReply): boolean {
    const roles = request.platformAdminRoles ?? [];
    try {
      requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
      return true;
    } catch (error) {
      if (error instanceof BillingAuthorizationError) {
        reply.code(403).send({ error: 'forbidden' });
        return false;
      }
      throw error;
    }
  }

  app.get('/platform-admin/billing/plans', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listPlans(page, {
      planCode: typeof query.planCode === 'string' ? query.planCode : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      billingCadence: typeof query.billingCadence === 'string' ? query.billingCadence : undefined,
    });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        planId: r.planId,
        planCode: r.planCode,
        planVersion: r.planVersion,
        status: r.status,
        billingCadence: r.billingCadence,
        defaultParentMemberLimit: r.defaultParentMemberLimit,
        defaultManagedDeviceLimit: r.defaultManagedDeviceLimit,
        priceBookId: r.priceBookId,
        createdAt: dateToJson(r.createdAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/subscriptions', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listSubscriptions(page, {
      accountRef: typeof query.accountRef === 'string' ? query.accountRef : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        subscriptionId: r.subscriptionId,
        accountRef: r.accountRef,
        planId: r.planId,
        status: r.status,
        currentPeriodStart: dateToJson(r.currentPeriodStart),
        currentPeriodEnd: dateToJson(r.currentPeriodEnd),
        createdAt: dateToJson(r.createdAt),
        canceledAt: dateToJson(r.canceledAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/invoices', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listInvoices(page, {
      accountRef: typeof query.accountRef === 'string' ? query.accountRef : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        invoiceId: r.invoiceId,
        accountRef: r.accountRef,
        subscriptionId: r.subscriptionId,
        status: r.status,
        total: moneyOrNullToJson(r.total),
        createdAt: dateToJson(r.createdAt),
        dueAt: dateToJson(r.dueAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/payment-attempts', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listPaymentAttempts(page, {
      accountRef: typeof query.accountRef === 'string' ? query.accountRef : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        paymentAttemptId: r.paymentAttemptId,
        accountRef: r.accountRef,
        invoiceId: r.invoiceId,
        increaseRequestRef: r.increaseRequestRef,
        amount: moneyOrNullToJson(r.amount),
        status: r.status,
        provider: r.provider,
        providerReference: r.providerReference,
        createdAt: dateToJson(r.createdAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/payment-transactions', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listPaymentTransactions(page, { accountRef: typeof query.accountRef === 'string' ? query.accountRef : undefined });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        paymentTransactionId: r.paymentTransactionId,
        paymentAttemptId: r.paymentAttemptId,
        accountRef: r.accountRef,
        amount: moneyOrNullToJson(r.amount),
        provider: r.provider,
        providerTransactionRef: r.providerTransactionRef,
        confirmedAt: dateToJson(r.confirmedAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/refunds', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listRefunds(page, { paymentTransactionId: typeof query.paymentTransactionId === 'string' ? query.paymentTransactionId : undefined });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        refundId: r.refundId,
        paymentTransactionId: r.paymentTransactionId,
        amount: moneyOrNullToJson(r.amount),
        reasonCode: r.reasonCode,
        status: r.status,
        entitlementTreatment: r.entitlementTreatment,
        initiatedByAdminId: r.initiatedByAdminId,
        createdAt: dateToJson(r.createdAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/billing/disputes', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireBillingRead(request, reply)) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listDisputes(page, { status: typeof query.status === 'string' ? query.status : undefined });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        disputeId: r.disputeId,
        paymentTransactionId: r.paymentTransactionId,
        status: r.status,
        evidenceDueAt: dateToJson(r.evidenceDueAt),
        createdAt: dateToJson(r.createdAt),
        updatedAt: dateToJson(r.updatedAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/quotes/pending', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const result = await readModel.listPendingCustomQuoteRequests(page, {
      familyId: typeof query.familyId === 'string' && query.familyId.length > 0 ? query.familyId : undefined,
      sinceCreatedAt: parseDate(query.since),
      untilCreatedAt: parseDate(query.until),
    });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        requestId: r.requestId,
        familyId: r.familyId,
        limitType: r.limitType,
        targetLimit: r.targetLimit,
        currentLimitAtRequest: r.currentLimitAtRequest,
        createdAt: dateToJson(r.createdAt),
        updatedAt: dateToJson(r.updatedAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });
}
