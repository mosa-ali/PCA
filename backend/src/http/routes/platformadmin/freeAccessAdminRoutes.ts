/**
 * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- Platform Administration
 * HTTP surface for FREE_ACCESS: read-only visibility into the global
 * registration-default config (Round5's env-var-driven
 * `resolveFreeAccessDefaults`), per-account FreeAccessStatus lookup, and
 * the explicit/audited existing-account adjustment (extend/reduce/convert)
 * mutation. Composes (never duplicates) `FreeAccessAdminService` verbatim
 * for every RBAC/step-up/business-rule decision -- this file is the HTTP
 * adapter layer only, mapping typed service errors to HTTP status codes,
 * mirroring `complimentaryGrantRoutes.ts`/`settingsRoutes.ts`'s own pattern
 * exactly.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { FreeAccessAdminError } from '../../../parentaccount/freeaccess/FreeAccessAdminService.js';
import type { FreeAccessAdminService } from '../../../parentaccount/freeaccess/FreeAccessAdminService.js';
import type { FreeAccessAdjustmentAction } from '../../../parentaccount/freeaccess/adjustment.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface FreeAccessAdminRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  freeAccessAdminService: FreeAccessAdminService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 2 * 1024;
const ACCOUNT_ID_MAX_LENGTH = 128;
const REASON_CODE_MAX_LENGTH = 200;
const MAX_ADJUSTMENT_DAYS = 3650;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveIntWithinBound(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ADJUSTMENT_DAYS;
}

/** Same anti-oracle discipline as complimentaryGrantRoutes.ts's mapKnownError: FORBIDDEN and STEP_UP_REQUIRED both collapse to a generic 403, never revealing which specific check failed. */
function mapKnownError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof FreeAccessAdminError) {
    if (error.code === 'NOT_FOUND') {
      reply.code(404).send({ error: 'not_found' });
      return true;
    }
    if (error.code === 'INVALID_REQUEST') {
      reply.code(400).send({ error: 'invalid_request' });
      return true;
    }
    reply.code(403).send({ error: 'forbidden' }); // FORBIDDEN, STEP_UP_REQUIRED
    return true;
  }
  return false;
}

function parseAdjustmentAction(body: Record<string, unknown>): { kind: string; additionalDays?: number; reduceDays?: number; durationDays?: number } | null {
  const kind = body.action;
  if (kind === 'EXTEND') {
    if (!isPositiveIntWithinBound(body.additionalDays)) return null;
    return { kind, additionalDays: body.additionalDays };
  }
  if (kind === 'REDUCE') {
    if (!isPositiveIntWithinBound(body.reduceDays)) return null;
    return { kind, reduceDays: body.reduceDays };
  }
  if (kind === 'CONVERT_TO_PERPETUAL') {
    return { kind };
  }
  if (kind === 'CONVERT_TO_TIME_LIMITED') {
    if (!isPositiveIntWithinBound(body.durationDays)) return null;
    return { kind, durationDays: body.durationDays };
  }
  return null;
}

export function registerFreeAccessAdminRoutes(app: FastifyInstance, deps: FreeAccessAdminRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-free-access-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'platform-admin-free-access-mutate' });

  function actor(request: FastifyRequest) {
    return {
      adminId: request.platformAdminId as string,
      roles: request.platformAdminRoles ?? [],
      sessionId: request.platformAdminSessionId as string,
    };
  }

  app.get('/platform-admin/settings/free-access-defaults', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    try {
      const defaults = deps.freeAccessAdminService.getGlobalDefaults(actor(request));
      return reply.code(200).send(defaults);
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.get(
    '/platform-admin/parent-accounts/:accountId/free-access',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > ACCOUNT_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const status = await deps.freeAccessAdminService.getAccountStatus(actor(request), accountId);
        return reply.code(200).send(status);
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/parent-accounts/:accountId/free-access/adjust',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > ACCOUNT_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { reasonCode, stepUpId } = body;
      const action = parseAdjustmentAction(body);
      if (action === null) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > REASON_CODE_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const status = await deps.freeAccessAdminService.adjustAccount(
          actor(request),
          accountId,
          action as FreeAccessAdjustmentAction,
          reasonCode,
          stepUpId,
        );
        return reply.code(200).send(status);
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );
}
