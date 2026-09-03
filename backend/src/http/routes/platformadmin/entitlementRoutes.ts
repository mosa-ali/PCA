/**
 * PCA-PA-3B -- Entitlement + Entitlement-Request HTTP surface (mission
 * Sections 10-11). Composes `PlatformAdminEntitlementService` (PCA-PA-2)
 * verbatim for every per-family read/mutation -- this file adds ZERO new
 * entitlement business logic, only the HTTP adapter layer plus the
 * cross-family LIST views that service doesn't provide (everything on it
 * is scoped to one `familyId` at a time).
 *
 * RBAC/step-up/audit are exactly as PlatformAdminEntitlementService
 * already enforces internally (VIEW_SUPPORT_ACCOUNT_METADATA for reads,
 * ADMINISTER_ENTITLEMENT_QUANTITY for quantity mutation,
 * ADMINISTER_BILLING for custom-quote issuance, ENTITLEMENT_LIMIT_OVERRIDE
 * step-up for the no-charge override) -- this route layer never duplicates
 * or re-derives those checks, it only maps the service's typed errors to
 * HTTP status codes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminEntitlementError } from '../../../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import type { PlatformAdminEntitlementService } from '../../../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { authorizeBillingOperation } from '../../../billing/rbac.js';
import type { ChangeRequestRepository } from '../../../entitlements/requests/ChangeRequestRepository.js';
import { EntitlementRequestsReadModel } from '../../../platformadmin/readmodels/EntitlementRequestsReadModel.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson, bigintAmountToJson } from '../../../platformadmin/api/dto.js';
import type { LimitType } from '../../../entitlements/types.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminEntitlementRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminEntitlementService: PlatformAdminEntitlementService;
  changeRequestRepository: ChangeRequestRepository;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 4 * 1024;
const FAMILY_ID_MAX_LENGTH = 128;
const REASON_MAX_LENGTH = 255;
const DECIMAL_INTEGER_STRING = /^\d+$/;
const LIMIT_TYPES: LimitType[] = ['PARENT_MEMBER_LIMIT', 'MANAGED_DEVICE_LIMIT'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * PCA-BILLING-READ-SPLIT-1 (security fix): every read route in this file is
 * gated on VIEW_SUPPORT_ACCOUNT_METADATA, ALLOW for all five roles
 * (rbacPolicy.ts) -- but the `quote` block carries the negotiated money
 * amount and currency for a family's limit increase. VIEW_BILLING_RECORDS
 * is DENY for PLATFORM_ADMIN and SUPPORT_ADMIN (billing/rbac.ts), so those
 * roles must not receive it. `canViewBilling` omits `amountMinor` /
 * `currencyCode` (the monetary payload) for them while keeping the
 * non-monetary quote facts -- kind, opaque ref, price-book version, and
 * timing -- that support triage legitimately needs, exactly the split
 * GET /platform-admin/quotes/pending already established (same gate, quote
 * amount deliberately omitted from its items).
 */
function requestToDto(record: {
  requestId: string;
  familyId: string;
  limitType: string;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: string;
  awaitingAdminQuote: boolean;
  noChargeOverride: boolean;
  quote: { quoteKind: string; quoteRef: string; amountMinor: bigint; currencyCode: string; priceBookVersion: number | null; quotedAt: Date; expiresAt: Date } | null;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}, canViewBilling: boolean) {
  return {
    requestId: record.requestId,
    familyId: record.familyId,
    limitType: record.limitType,
    currentLimitAtRequest: record.currentLimitAtRequest,
    targetLimit: record.targetLimit,
    state: record.state,
    awaitingAdminQuote: record.awaitingAdminQuote,
    noChargeOverride: record.noChargeOverride,
    quote: record.quote
      ? {
          quoteKind: record.quote.quoteKind,
          quoteRef: record.quote.quoteRef,
          ...(canViewBilling
            ? { amountMinor: bigintAmountToJson(record.quote.amountMinor), currencyCode: record.quote.currencyCode }
            : {}),
          priceBookVersion: record.quote.priceBookVersion,
          quotedAt: dateToJson(record.quote.quotedAt),
          expiresAt: dateToJson(record.quote.expiresAt),
        }
      : null,
    decidedByAdminId: record.decidedByAdminId,
    decisionReason: record.decisionReason,
    createdAt: dateToJson(record.createdAt),
    updatedAt: dateToJson(record.updatedAt),
  };
}

function mapEntitlementError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof PlatformAdminEntitlementError) {
    // Both FORBIDDEN and STEP_UP_REQUIRED map to the same generic 403 --
    // mirrors the anti-oracle discipline every other Platform Administration
    // error mapping in this codebase already follows (never reveal which
    // specific check failed to an unauthorized caller).
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof PlatformAdminAuthError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  return false;
}

export function registerPlatformAdminEntitlementRoutes(app: FastifyInstance, deps: PlatformAdminEntitlementRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-entitlement-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'platform-admin-entitlement-mutate' });
  const requestsReadModel = new EntitlementRequestsReadModel();

  function actor(request: FastifyRequest) {
    return {
      adminId: request.platformAdminId as string,
      roles: request.platformAdminRoles ?? [],
      sessionId: request.platformAdminSessionId as string,
    };
  }

  /** PCA-BILLING-READ-SPLIT-1: single source of the billing-read verdict for every response shaped in this file. */
  function canViewBilling(request: FastifyRequest): boolean {
    return authorizeBillingOperation(request.platformAdminRoles ?? [], 'VIEW_BILLING_RECORDS') === 'ALLOW';
  }

  // ---- Per-family reads ----
  app.get(
    '/platform-admin/families/:familyId/entitlement',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const model = await deps.platformAdminEntitlementService.readEntitlement(actor(request), familyId);
        return reply.code(200).send({
          familyId: model.familyId,
          planRef: model.planRef,
          parentMemberLimit: model.parentMemberLimit,
          parentMemberUsed: model.parentMemberUsed,
          managedDeviceLimit: model.managedDeviceLimit,
          managedDeviceActive: model.managedDeviceActive,
          managedDeviceReserved: model.managedDeviceReserved,
          availableDeviceSlots: model.availableDeviceSlots,
          overLimitParentMember: model.overLimitParentMember,
          overLimitManagedDevice: model.overLimitManagedDevice,
          pendingRequestSummary: model.pendingRequestSummary,
        });
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/families/:familyId/entitlement/usage',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const usage = await deps.platformAdminEntitlementService.readUsage(actor(request), familyId);
        return reply.code(200).send({
          familyId: usage.familyId,
          planRef: usage.planRef,
          parentMemberLimit: usage.parentMemberLimit,
          managedDeviceLimit: usage.managedDeviceLimit,
          parentMemberUsedCount: usage.parentMemberUsedCount,
          managedDeviceActiveCount: usage.managedDeviceActiveCount,
          managedDeviceReservedCount: usage.managedDeviceReservedCount,
          overLimitParentMember: usage.overLimitParentMember,
          overLimitManagedDevice: usage.overLimitManagedDevice,
          revision: usage.revision,
          createdAt: dateToJson(usage.createdAt),
          updatedAt: dateToJson(usage.updatedAt),
        });
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/families/:familyId/entitlement/requests',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const requests = await deps.platformAdminEntitlementService.readRequests(actor(request), familyId);
        const billingVisible = canViewBilling(request);
        return reply.code(200).send({ items: requests.map((r) => requestToDto(r, billingVisible)) });
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/families/:familyId/entitlement/reservations',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const reservations = await deps.platformAdminEntitlementService.viewReservations(actor(request), familyId);
        return reply.code(200).send({
          items: reservations.map((r) => ({
            reservationId: r.reservationId,
            familyId: r.familyId,
            invitationId: r.invitationId,
            status: r.status,
            createdAt: dateToJson(r.createdAt),
            expiresAt: dateToJson(r.expiresAt),
            consumedAt: dateToJson(r.consumedAt),
            releasedAt: dateToJson(r.releasedAt),
            releaseReason: r.releaseReason,
          })),
        });
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Cross-family entitlement-request review queue ----
  app.get(
    '/platform-admin/entitlement-requests',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
      const query = (request.query ?? {}) as Record<string, unknown>;
      const page = parsePageRequest(query);
      const state = typeof query.state === 'string' ? query.state : undefined;
      const familyId = typeof query.familyId === 'string' ? query.familyId : undefined;
      // PCA-BILLING-READ-SPLIT-1: quoteAmountMinor/quoteCurrencyCode are
      // billing records; this route's VIEW_SUPPORT_ACCOUNT_METADATA gate is
      // ALLOW for all five roles, so they are omitted for the roles
      // VIEW_BILLING_RECORDS denies (PLATFORM_ADMIN, SUPPORT_ADMIN).
      // quoteExpiresAt stays: a date, not a money value, and the same
      // non-monetary quote timing GET /platform-admin/quotes/pending
      // already exposes under this identical gate.
      const billingVisible = authorizeBillingOperation(roles, 'VIEW_BILLING_RECORDS') === 'ALLOW';
      const result = await requestsReadModel.list(page, { state, familyId });
      return reply.code(200).send({
        items: result.items.map((r) => ({
          requestId: r.requestId,
          familyId: r.familyId,
          limitType: r.limitType,
          currentLimitAtRequest: r.currentLimitAtRequest,
          targetLimit: r.targetLimit,
          state: r.state,
          awaitingAdminQuote: r.awaitingAdminQuote,
          noChargeOverride: r.noChargeOverride,
          ...(billingVisible ? { quoteAmountMinor: r.quoteAmountMinor, quoteCurrencyCode: r.quoteCurrencyCode } : {}),
          quoteExpiresAt: dateToJson(r.quoteExpiresAt),
          createdAt: dateToJson(r.createdAt),
          updatedAt: dateToJson(r.updatedAt),
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    },
  );

  app.get(
    '/platform-admin/entitlement-requests/:requestId',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
      const { requestId } = request.params as { requestId?: string };
      if (typeof requestId !== 'string' || requestId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const record = await deps.changeRequestRepository.getById(requestId);
      if (!record) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send(requestToDto(record, canViewBilling(request)));
    },
  );

  // ---- Mutations ----
  app.post(
    '/platform-admin/entitlement-requests/:requestId/approve-parent-member',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { requestId } = request.params as { requestId?: string };
      if (typeof requestId !== 'string' || requestId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const updated = await deps.platformAdminEntitlementService.approveParentMemberRequest(actor(request), requestId);
        return reply.code(200).send(requestToDto(updated, canViewBilling(request)));
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/entitlement-requests/:requestId/deny',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { requestId } = request.params as { requestId?: string };
      if (typeof requestId !== 'string' || requestId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { reason } = body;
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const updated = await deps.platformAdminEntitlementService.denyRequest(actor(request), requestId, reason);
        return reply.code(200).send(requestToDto(updated, canViewBilling(request)));
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/entitlement-requests/:requestId/quote',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { requestId } = request.params as { requestId?: string };
      if (typeof requestId !== 'string' || requestId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { amountMinor, currencyCode } = body;
      if (typeof amountMinor !== 'string' || !DECIMAL_INTEGER_STRING.test(amountMinor)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof currencyCode !== 'string' || currencyCode.length !== 3) return reply.code(400).send({ error: 'invalid_request' });
      let amount: bigint;
      try {
        amount = BigInt(amountMinor);
      } catch {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const updated = await deps.platformAdminEntitlementService.issueCustomQuote(actor(request), requestId, amount, currencyCode);
        return reply.code(200).send(requestToDto(updated, canViewBilling(request)));
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/families/:familyId/entitlement/device-override',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { targetLimit, reason, stepUpId } = body;
      if (typeof targetLimit !== 'number' || !Number.isInteger(targetLimit) || targetLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const updated = await deps.platformAdminEntitlementService.noChargeDeviceOverride(actor(request), familyId, targetLimit, reason, stepUpId);
        return reply.code(200).send(requestToDto(updated, canViewBilling(request)));
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/families/:familyId/entitlement/limit',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { limitType, targetLimit } = body;
      if (typeof limitType !== 'string' || !LIMIT_TYPES.includes(limitType as LimitType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof targetLimit !== 'number' || !Number.isInteger(targetLimit) || targetLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const updated = await deps.platformAdminEntitlementService.setEntitlementLimit(actor(request), familyId, limitType as LimitType, targetLimit);
        return reply.code(200).send({
          familyId: updated.familyId,
          planRef: updated.planRef,
          parentMemberLimit: updated.parentMemberLimit,
          managedDeviceLimit: updated.managedDeviceLimit,
          parentMemberUsedCount: updated.parentMemberUsedCount,
          managedDeviceActiveCount: updated.managedDeviceActiveCount,
          managedDeviceReservedCount: updated.managedDeviceReservedCount,
          overLimitParentMember: updated.overLimitParentMember,
          overLimitManagedDevice: updated.overLimitManagedDevice,
          revision: updated.revision,
          updatedAt: dateToJson(updated.updatedAt),
        });
      } catch (error) {
        if (mapEntitlementError(error, reply)) return;
        if (error instanceof Error && error.message.includes('targetLimit')) return reply.code(400).send({ error: 'invalid_request' });
        throw error;
      }
    },
  );
}
