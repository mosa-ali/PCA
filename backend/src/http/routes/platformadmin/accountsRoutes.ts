/**
 * PCA-PA-3B -- GET /platform-admin/accounts, GET /platform-admin/accounts/:accountId
 * (mission Section 8). Read-only. VIEW_SUPPORT_ACCOUNT_METADATA (ALLOW for
 * every role per Section 3.7).
 *
 * Mission Section 9's suspend/reactivate is DELIBERATELY NOT implemented
 * here: no authoritative customer/family account-status model exists
 * anywhere in this repository (see AccountsReadModel's header and this
 * lane's final report ACCOUNT_STATUS_MODEL_GAP). Building one silently
 * would mean inventing schema/authority the mission explicitly forbids
 * inventing without being named as a gap.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { AccountsReadModel } from '../../../platformadmin/readmodels/AccountsReadModel.js';
import type { AccountSummary } from '../../../platformadmin/readmodels/AccountsReadModel.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminAccountsRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const FAMILY_ID_MAX_LENGTH = 128;

function toAccountDto(account: AccountSummary) {
  return {
    familyId: account.familyId,
    createdAt: dateToJson(account.createdAt),
    deletedAt: dateToJson(account.deletedAt),
    statusCapability: account.statusCapability,
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
    latestSubscription: account.latestSubscription
      ? {
          subscriptionId: account.latestSubscription.subscriptionId,
          planId: account.latestSubscription.planId,
          status: account.latestSubscription.status,
          currentPeriodStart: dateToJson(account.latestSubscription.currentPeriodStart),
          currentPeriodEnd: dateToJson(account.latestSubscription.currentPeriodEnd),
        }
      : null,
  };
}

export function registerPlatformAdminAccountsRoutes(app: FastifyInstance, deps: PlatformAdminAccountsRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-accounts' });
  const readModel = new AccountsReadModel();

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
      const result = await readModel.list(page, includeDeleted);
      return reply.code(200).send({
        items: result.items.map(toAccountDto),
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
      return reply.code(200).send(toAccountDto(account));
    },
  );
}
