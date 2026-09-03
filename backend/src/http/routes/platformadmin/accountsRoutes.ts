/**
 * PCA-PA-3B -- GET /platform-admin/accounts, GET /platform-admin/accounts/:accountId
 * (mission Section 8). Read-only. VIEW_SUPPORT_ACCOUNT_METADATA (ALLOW for
 * every role per Section 3.7).
 *
 * PCA-ADD-PA-017 (Writer65): POST .../suspend and .../reactivate now exist,
 * composing FamilyAccountStatusService for every RBAC/step-up/audit
 * decision -- this file is the HTTP adapter layer only. See
 * FamilyAccountStatusService's own header for this slice's deliberate
 * scope boundary (it writes `families.status`; it does not itself enforce
 * that status at the family login boundary, which lives outside this
 * lane's owned files).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { authorizeBillingOperation } from '../../../billing/rbac.js';
import { AccountsReadModel } from '../../../platformadmin/readmodels/AccountsReadModel.js';
import type { AccountSummary } from '../../../platformadmin/readmodels/AccountsReadModel.js';
import { FamilyAccountStatusService, FamilyAccountStatusError } from '../../../platformadmin/accounts/FamilyAccountStatusService.js';
import { PlatformAdminAuthError } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminAccountsRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const FAMILY_ID_MAX_LENGTH = 128;
const MAX_BODY_BYTES = 1024;
const REASON_MAX_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapFamilyAccountStatusError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof PlatformAdminAuthError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof FamilyAccountStatusError) {
    if (error.code === 'NOT_FOUND') {
      reply.code(404).send({ error: 'not_found' });
      return true;
    }
    if (error.code === 'FORBIDDEN') {
      reply.code(403).send({ error: 'forbidden' });
      return true;
    }
    if (error.code === 'ALREADY_SUSPENDED' || error.code === 'ALREADY_ACTIVE') {
      reply.code(409).send({ error: error.code.toLowerCase() });
      return true;
    }
    reply.code(400).send({ error: 'invalid_request' });
    return true;
  }
  return false;
}

/**
 * PCA-BILLING-READ-SPLIT-1 (security fix): this route is gated on
 * VIEW_SUPPORT_ACCOUNT_METADATA, which is ALLOW for all five roles
 * (rbacPolicy.ts). `latestSubscription` however carries
 * `billing_subscriptions` fields -- subscriptionId, planId, status,
 * currentPeriodStart, currentPeriodEnd -- which are exactly what
 * GET /platform-admin/billing/subscriptions 403s a SUPPORT_ADMIN for, and
 * VIEW_BILLING_RECORDS is DENY for both PLATFORM_ADMIN and SUPPORT_ADMIN
 * (billing/rbac.ts, whose header states SUPPORT_ADMIN has "no billing read
 * of any kind"). Before this fix a SUPPORT_ADMIN token could read every
 * family's plan, status and billing period straight off
 * GET /platform-admin/accounts?limit=100.
 *
 * The response OMITS the billing-bearing field for roles that lack
 * VIEW_BILLING_RECORDS rather than 403ing the whole route -- the
 * account/entitlement metadata here is legitimately support-facing. That
 * follows the precedent GET /platform-admin/quotes/pending already sets
 * (billingReadRoutes.ts: same VIEW_SUPPORT_ACCOUNT_METADATA gate,
 * deliberately omits the quote amount from its items). The key is absent,
 * not null: `null` is already the meaningful "this family has no
 * subscription" value and must stay distinguishable from "you may not see
 * it".
 */
function toAccountDto(account: AccountSummary, canViewBilling: boolean) {
  return {
    familyId: account.familyId,
    createdAt: dateToJson(account.createdAt),
    deletedAt: dateToJson(account.deletedAt),
    statusCapability: account.statusCapability,
    status: account.status,
    suspendedAt: dateToJson(account.suspendedAt),
    suspensionReason: account.suspensionReason,
    entitlement: account.entitlement
      ? {
          planRef: account.entitlement.planRef,
          parentMemberLimit: account.entitlement.parentMemberLimit,
          managedDeviceLimit: account.entitlement.managedDeviceLimit,
          parentMemberUsedCount: account.entitlement.parentMemberUsedCount,
          managedDeviceActiveCount: account.entitlement.managedDeviceActiveCount,
          managedDeviceReservedCount: account.entitlement.managedDeviceReservedCount,
          overLimitParentMember: account.entitlement.overLimitParentMember,
          overLimitManagedDevice: account.entitlement.overLimitManagedDevice,
        }
      : null,
    ...(canViewBilling
      ? {
          latestSubscription: account.latestSubscription
            ? {
                subscriptionId: account.latestSubscription.subscriptionId,
                planId: account.latestSubscription.planId,
                status: account.latestSubscription.status,
                currentPeriodStart: dateToJson(account.latestSubscription.currentPeriodStart),
                currentPeriodEnd: dateToJson(account.latestSubscription.currentPeriodEnd),
              }
            : null,
        }
      : {}),
  };
}

export function registerPlatformAdminAccountsRoutes(app: FastifyInstance, deps: PlatformAdminAccountsRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-accounts' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-accounts-mutate' });
  const readModel = new AccountsReadModel();
  const familyStatusService = new FamilyAccountStatusService(deps.platformAdminAuthService);

  app.get(
    '/platform-admin/accounts',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const query = (request.query ?? {}) as Record<string, unknown>;
      const page = parsePageRequest(query);
      const includeDeleted = query.includeDeleted === 'true';
      // B103/B105: familyId is an exact-match search (mirrors accountRef
      // filtering on every other Platform Administration list route --
      // family_id is an opaque UUID, never a fuzzy-searched display name).
      // sortBy/sortDir are validated against AccountsReadModel's own
      // fixed allow-list (never passed through as a raw column/direction).
      const familyId = typeof query.familyId === 'string' && query.familyId.length > 0 && query.familyId.length <= FAMILY_ID_MAX_LENGTH ? query.familyId : undefined;
      const sortBy = query.sortBy === 'familyId' ? 'familyId' : 'createdAt';
      const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
      const canViewBilling = authorizeBillingOperation(roles, 'VIEW_BILLING_RECORDS') === 'ALLOW';
      const result = await readModel.list(page, includeDeleted, { familyId, sortBy, sortDir });
      return reply.code(200).send({
        items: result.items.map((account) => toAccountDto(account, canViewBilling)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    },
  );

  app.get(
    '/platform-admin/accounts/:accountId',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > FAMILY_ID_MAX_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const account = await readModel.getById(accountId);
      if (!account) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send(toAccountDto(account, authorizeBillingOperation(roles, 'VIEW_BILLING_RECORDS') === 'ALLOW'));
    },
  );

  function actor(request: FastifyRequest) {
    return {
      adminId: request.platformAdminId as string,
      roles: request.platformAdminRoles ?? [],
      sessionId: request.platformAdminSessionId as string,
    };
  }

  app.post(
    '/platform-admin/accounts/:accountId/suspend',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > FAMILY_ID_MAX_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { reason, stepUpId } = body;
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const record = await familyStatusService.suspend(actor(request), accountId, reason, stepUpId);
        return reply.code(200).send({ familyId: record.familyId, status: record.status, suspendedAt: dateToJson(record.suspendedAt), suspensionReason: record.suspensionReason });
      } catch (error) {
        if (mapFamilyAccountStatusError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/accounts/:accountId/reactivate',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > FAMILY_ID_MAX_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { stepUpId } = body;
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const record = await familyStatusService.reactivate(actor(request), accountId, stepUpId);
        return reply.code(200).send({ familyId: record.familyId, status: record.status, suspendedAt: dateToJson(record.suspendedAt), suspensionReason: record.suspensionReason });
      } catch (error) {
        if (mapFamilyAccountStatusError(error, reply)) return;
        throw error;
      }
    },
  );
}
