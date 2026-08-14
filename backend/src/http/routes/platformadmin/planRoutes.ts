/**
 * PCA-PA-3B -- Plan administration HTTP surface (mission Section 13).
 * Thin adapter over `billing/plan.ts`'s `PlanService` -- exposes only the
 * read/admin operations Billing Core already supports (per-planCode
 * version history + new-version creation); no invented financial
 * semantics beyond what that service already models.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { BillingAuthorizationError } from '../../../billing/rbac.js';
import type { PlanService, PlanRow, PlanStatus, BillingCadence } from '../../../billing/plan.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminPlanRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  planService: PlanService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 2 * 1024;
const PLAN_CODE_MAX_LENGTH = 64;
const PLAN_STATUSES: PlanStatus[] = ['DRAFT', 'ACTIVE', 'RETIRED'];
const BILLING_CADENCES: BillingCadence[] = ['MONTHLY', 'ANNUAL', 'ONE_TIME', 'FREE'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function planToDto(row: PlanRow) {
  return {
    planId: row.planId,
    planCode: row.planCode,
    planVersion: row.planVersion,
    status: row.status,
    billingCadence: row.billingCadence,
    defaultParentMemberLimit: row.defaultParentMemberLimit,
    defaultManagedDeviceLimit: row.defaultManagedDeviceLimit,
    priceBookId: row.priceBookId,
    createdAt: dateToJson(row.createdAt),
  };
}

export function registerPlatformAdminPlanRoutes(app: FastifyInstance, deps: PlatformAdminPlanRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-plan-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-plan-mutate' });

  app.get(
    '/platform-admin/billing/plans/:planCode',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { planCode } = request.params as { planCode?: string };
      if (typeof planCode !== 'string' || planCode.length === 0 || planCode.length > PLAN_CODE_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        const rows = await deps.planService.listVersions(planCode, roles);
        return reply.code(200).send({ items: rows.map(planToDto) });
      } catch (error) {
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/billing/plans',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { planCode, status, billingCadence, defaultParentMemberLimit, defaultManagedDeviceLimit, priceBookId } = body;
      if (typeof planCode !== 'string' || planCode.length === 0 || planCode.length > PLAN_CODE_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof status !== 'string' || !PLAN_STATUSES.includes(status as PlanStatus)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof billingCadence !== 'string' || !BILLING_CADENCES.includes(billingCadence as BillingCadence)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof defaultParentMemberLimit !== 'number' || !Number.isInteger(defaultParentMemberLimit) || defaultParentMemberLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof defaultManagedDeviceLimit !== 'number' || !Number.isInteger(defaultManagedDeviceLimit) || defaultManagedDeviceLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      if (priceBookId !== undefined && priceBookId !== null && typeof priceBookId !== 'string') return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        const created = await deps.planService.createNewVersion(
          {
            planCode,
            status: status as PlanStatus,
            billingCadence: billingCadence as BillingCadence,
            defaultParentMemberLimit,
            defaultManagedDeviceLimit,
            priceBookId: (priceBookId as string | null | undefined) ?? null,
          },
          roles,
        );
        return reply.code(201).send(planToDto(created));
      } catch (error) {
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );
}
