/**
 * PCA-PA-3B -- GET /platform-admin/audit (mission Section 17). Read-only.
 * No UPDATE/DELETE endpoint exists in this file or anywhere in this lane --
 * `AuditReadModel` (see its header) only ever SELECTs from
 * `platform_admin_audit_events`, preserving PCA-PA-1's DB-level
 * append-only grant (migration 0005's table-level-grant-only design)
 * completely untouched.
 *
 * `VIEW_AUDIT_LOG_OWN` (ALLOW for every role per Section 3.7) gates the
 * route itself -- the finer "full vs. own-actions-only" scoping is enforced
 * INSIDE `AuditReadModel.query` (mirroring `PlatformAdminAuditService
 * .queryForRole`'s existing rule), so a SUPPORT_ADMIN caller genuinely
 * cannot widen their own query past their own actorAdminId no matter what
 * filter they pass.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { AuditReadModel } from '../../../platformadmin/readmodels/AuditReadModel.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminAuditRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const RESULTS = ['SUCCESS', 'FAILURE', 'DENIED'] as const;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function registerPlatformAdminAuditRoutes(app: FastifyInstance, deps: PlatformAdminAuditRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'platform-admin-audit-read' });
  const readModel = new AuditReadModel();

  app.get(
    '/platform-admin/audit',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_AUDIT_LOG_OWN') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
      const query = (request.query ?? {}) as Record<string, unknown>;
      const page = parsePageRequest(query);
      const result = typeof query.result === 'string' && (RESULTS as readonly string[]).includes(query.result) ? (query.result as (typeof RESULTS)[number]) : undefined;
      const adminId = request.platformAdminId as string;

      const events = await readModel.query(
        roles,
        adminId,
        {
          eventType: typeof query.eventType === 'string' ? query.eventType : undefined,
          actorAdminId: typeof query.actorAdminId === 'string' ? query.actorAdminId : undefined,
          targetRef: typeof query.targetRef === 'string' ? query.targetRef : undefined,
          result,
          sinceOccurredAt: parseDate(query.since),
          untilOccurredAt: parseDate(query.until),
        },
        page,
      );

      return reply.code(200).send({
        items: events.items.map((e) => ({
          eventId: e.eventId,
          eventType: e.eventType,
          actorAdminId: e.actorAdminId,
          actorRole: e.actorRole,
          targetRef: e.targetRef,
          result: e.result,
          occurredAt: dateToJson(e.occurredAt),
          correlationId: e.correlationId,
          metadata: e.metadata,
        })),
        total: events.total,
        limit: events.limit,
        offset: events.offset,
      });
    },
  );
}
