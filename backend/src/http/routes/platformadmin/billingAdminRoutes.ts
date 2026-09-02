/**
 * Platform Administration HTTP surface for the billing admin WRITE
 * operations that had zero HTTP wiring despite being fully built and
 * tested (`backend/test/db/billingCore.mysql.test.mjs`,
 * `backend/test/db/dispute.mysql.test.mjs`): `PaymentMethodService`
 * (`billing/paymentMethod.ts`), `SubscriptionService`
 * (`billing/subscription.ts`), `DisputeService` (`billing/dispute.ts`).
 * Before this file, a platform admin could only READ billing/subscription/
 * dispute records (`billingReadRoutes.ts`) -- there was no route to
 * actually add a payment method, create/cancel a subscription record, or
 * open/resolve a dispute, even though the RBAC-gated domain logic to do so
 * already existed.
 *
 * Does NOT duplicate PCA-BILL-1's already-wired subscription mutation:
 * the family-owner-authorized auto-renew cancel/resume mutation
 * (migrations/0031_billing_subscription_auto_renew.sql,
 * `FamilyCommercialService.updateAutoRenew`, `familyCommercialRoutes.ts`)
 * is a SEPARATE, already-wired surface for a family's own subscription.
 * This file wires `SubscriptionService`'s own two operator-facing
 * mutations (`createSubscription`/`cancelSubscription`), which had no
 * route at all.
 *
 * RBAC: every one of these service methods already calls
 * `billing/rbac.ts`'s `requireBillingOperation` internally
 * (`VIEW_PAYMENT_INSTRUMENTS`/`ADMINISTER_BILLING_RECORDS`/
 * `ADMINISTER_DISPUTE`/`VIEW_BILLING_RECORDS` -- all four rows already
 * exist in `BILLING_OPERATION_MATRIX` with full role coverage: APP_OWNER/
 * FINANCE_ADMIN allowed on every mutation, AUDITOR_READ_ONLY allowed on
 * view-only operations, PLATFORM_ADMIN/SUPPORT_ADMIN denied throughout).
 * This route layer therefore does NOT introduce a second, possibly-
 * diverging authorization check -- it lets the service throw
 * `BillingAuthorizationError` and maps that to a fixed 403 here, exactly
 * like `billingRefundRoutes.ts`/`priceBookRoutes.ts` already do. This
 * intentionally adds NO new operation to
 * `platformadmin/auth/rbacPolicy.ts`'s `PlatformAdminOperation` matrix --
 * `billing/rbac.ts`'s own header comment establishes that Billing owns its
 * own, separate, already-complete RBAC vocabulary for this exact surface,
 * and that accepted file must not be edited to grow it.
 *
 * No new payment-provider integration or charging logic is added: these
 * services only persist provider-safe metadata a caller already obtained
 * from a provider elsewhere (see `paymentMethod.ts`'s own header on the
 * schema-privacy proof that no PAN/CVV/raw-credential column exists) or
 * manage subscription/dispute state rows. No caller-supplied field is ever
 * echoed back inside an error response -- every error path returns a
 * fixed, non-leaking body.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { BillingAuthorizationError } from '../../../billing/rbac.js';
import type { PaymentMethodService, PaymentMethodRow } from '../../../billing/paymentMethod.js';
import type { SubscriptionService, SubscriptionRow, SubscriptionStatus } from '../../../billing/subscription.js';
import { DuplicateActiveSubscriptionError } from '../../../billing/subscription.js';
import type { DisputeService, DisputeRow } from '../../../billing/dispute.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminBillingAdminRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  paymentMethodService: PaymentMethodService;
  subscriptionService: SubscriptionService;
  disputeService: DisputeService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 4 * 1024;
const MAX_STRING_LENGTH = 255;
const MAX_ID_LENGTH = 128;
const LAST4_PATTERN = /^\d{4}$/;
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'];
const DISPUTE_RESOLUTIONS: Array<'WON' | 'LOST'> = ['WON', 'LOST'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors billingReadRoutes.ts's own local parseDate exactly -- this codebase does not share one helper across route files. */
function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function paymentMethodToDto(row: PaymentMethodRow) {
  return {
    paymentMethodId: row.paymentMethodId,
    accountRef: row.accountRef,
    provider: row.provider,
    providerPaymentMethodRef: row.providerPaymentMethodRef,
    brand: row.brand,
    displayLabel: row.displayLabel,
    last4: row.last4,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    status: row.status,
    createdAt: dateToJson(row.createdAt),
  };
}

function subscriptionToDto(row: SubscriptionRow) {
  return {
    subscriptionId: row.subscriptionId,
    accountRef: row.accountRef,
    planId: row.planId,
    status: row.status,
    currentPeriodStart: dateToJson(row.currentPeriodStart),
    currentPeriodEnd: dateToJson(row.currentPeriodEnd),
    paymentMethodId: row.paymentMethodId,
    createdAt: dateToJson(row.createdAt),
    canceledAt: dateToJson(row.canceledAt),
    autoRenew: row.autoRenew,
  };
}

function disputeToDto(row: DisputeRow) {
  return {
    disputeId: row.disputeId,
    paymentTransactionId: row.paymentTransactionId,
    status: row.status,
    evidenceSubmittedAt: dateToJson(row.evidenceSubmittedAt),
    evidenceDueAt: dateToJson(row.evidenceDueAt),
    createdAt: dateToJson(row.createdAt),
    updatedAt: dateToJson(row.updatedAt),
  };
}

/** Fixed, non-leaking error mapping -- never echoes the operation name, roles, or any caller-supplied field back. Returns true if handled. */
function mapBillingError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof BillingAuthorizationError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof DuplicateActiveSubscriptionError) {
    reply.code(409).send({ error: 'conflict' });
    return true;
  }
  return false;
}

export function registerPlatformAdminBillingAdminRoutes(app: FastifyInstance, deps: PlatformAdminBillingAdminRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-billing-admin-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-billing-admin-mutate' });

  // ---- Payment methods (PaymentMethodService) ----

  app.post(
    '/platform-admin/billing/payment-methods',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const accountRef = boundedString(body.accountRef, MAX_ID_LENGTH);
      const provider = boundedString(body.provider, MAX_STRING_LENGTH);
      const providerPaymentMethodRef = boundedString(body.providerPaymentMethodRef, MAX_STRING_LENGTH);
      const displayLabel = boundedString(body.displayLabel, MAX_STRING_LENGTH);
      if (!accountRef || !provider || !providerPaymentMethodRef || !displayLabel) return reply.code(400).send({ error: 'invalid_request' });
      const { brand, last4, expiryMonth, expiryYear } = body;
      if (brand !== undefined && brand !== null && (typeof brand !== 'string' || brand.length > MAX_STRING_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (last4 !== undefined && last4 !== null && (typeof last4 !== 'string' || !LAST4_PATTERN.test(last4))) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (expiryMonth !== undefined && expiryMonth !== null && (typeof expiryMonth !== 'number' || !Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (expiryYear !== undefined && expiryYear !== null && (typeof expiryYear !== 'number' || !Number.isInteger(expiryYear) || expiryYear < 2000 || expiryYear > 2100)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const roles = request.platformAdminRoles ?? [];
      try {
        const created = await deps.paymentMethodService.addPaymentMethod(
          {
            accountRef,
            provider,
            providerPaymentMethodRef,
            brand: (brand as string | null | undefined) ?? null,
            displayLabel,
            last4: (last4 as string | null | undefined) ?? null,
            expiryMonth: (expiryMonth as number | null | undefined) ?? null,
            expiryYear: (expiryYear as number | null | undefined) ?? null,
          },
          roles,
        );
        return reply.code(201).send(paymentMethodToDto(created));
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/billing/payment-methods',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const accountRef = boundedString(query.accountRef, MAX_ID_LENGTH);
      if (!accountRef) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        const rows = await deps.paymentMethodService.listForAccount(accountRef, roles);
        return reply.code(200).send({ items: rows.map(paymentMethodToDto) });
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Subscriptions (SubscriptionService) ----

  app.post(
    '/platform-admin/billing/subscriptions',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const accountRef = boundedString(body.accountRef, MAX_ID_LENGTH);
      const planId = boundedString(body.planId, MAX_ID_LENGTH);
      const { status } = body;
      if (!accountRef || !planId || typeof status !== 'string' || !SUBSCRIPTION_STATUSES.includes(status as SubscriptionStatus)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const currentPeriodStart = parseDate(body.currentPeriodStart);
      const currentPeriodEnd = parseDate(body.currentPeriodEnd);
      if (!currentPeriodStart || !currentPeriodEnd) return reply.code(400).send({ error: 'invalid_request' });
      const { paymentMethodId } = body;
      if (paymentMethodId !== undefined && paymentMethodId !== null && typeof paymentMethodId !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const roles = request.platformAdminRoles ?? [];
      try {
        const created = await deps.subscriptionService.createSubscription(
          {
            accountRef,
            planId,
            status: status as SubscriptionStatus,
            currentPeriodStart,
            currentPeriodEnd,
            paymentMethodId: (paymentMethodId as string | null | undefined) ?? null,
          },
          roles,
        );
        return reply.code(201).send(subscriptionToDto(created));
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/billing/subscriptions/:subscriptionId/cancel',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { subscriptionId } = request.params as { subscriptionId?: string };
      if (typeof subscriptionId !== 'string' || subscriptionId.length === 0 || subscriptionId.length > MAX_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const roles = request.platformAdminRoles ?? [];
      try {
        await deps.subscriptionService.cancelSubscription(subscriptionId, roles);
        return reply.code(204).send();
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Disputes (DisputeService) ----

  app.post(
    '/platform-admin/billing/disputes',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const paymentTransactionId = boundedString(body.paymentTransactionId, MAX_ID_LENGTH);
      if (!paymentTransactionId) return reply.code(400).send({ error: 'invalid_request' });
      const rawEvidenceDueAt = body.evidenceDueAt;
      let evidenceDueAt: Date | null = null;
      if (rawEvidenceDueAt !== undefined && rawEvidenceDueAt !== null) {
        const parsed = parseDate(rawEvidenceDueAt);
        if (!parsed) return reply.code(400).send({ error: 'invalid_request' });
        evidenceDueAt = parsed;
      }
      const roles = request.platformAdminRoles ?? [];
      try {
        const opened = await deps.disputeService.openDispute(paymentTransactionId, evidenceDueAt, roles);
        return reply.code(201).send(disputeToDto(opened));
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/billing/disputes/:disputeId',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { disputeId } = request.params as { disputeId?: string };
      if (typeof disputeId !== 'string' || disputeId.length === 0 || disputeId.length > MAX_ID_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        const dispute = await deps.disputeService.getDispute(disputeId, roles);
        if (!dispute) return reply.code(404).send({ error: 'not_found' });
        return reply.code(200).send(disputeToDto(dispute));
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/billing/disputes/:disputeId/evidence',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { disputeId } = request.params as { disputeId?: string };
      if (typeof disputeId !== 'string' || disputeId.length === 0 || disputeId.length > MAX_ID_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        await deps.disputeService.submitEvidence(disputeId, roles);
        return reply.code(204).send();
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/billing/disputes/:disputeId/resolve',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { disputeId } = request.params as { disputeId?: string };
      if (typeof disputeId !== 'string' || disputeId.length === 0 || disputeId.length > MAX_ID_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { status } = body;
      if (typeof status !== 'string' || !DISPUTE_RESOLUTIONS.includes(status as 'WON' | 'LOST')) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        await deps.disputeService.resolve(disputeId, status as 'WON' | 'LOST', roles);
        return reply.code(204).send();
      } catch (error) {
        if (mapBillingError(error, reply)) return;
        throw error;
      }
    },
  );
}
