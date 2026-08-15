/**
 * PCA-COMPLIMENTARY-ENTITLEMENTS-1 -- Platform Administration HTTP surface
 * for complimentary entitlement grants (COMPLIMENTARY_ENTITLEMENT_GRANT_V1,
 * ROUND5_INTERFACE_CONTRACTS.md). Composes (never duplicates)
 * `PlatformAdminComplimentaryGrantService` verbatim for every RBAC/step-up/
 * business-rule decision -- this file is the HTTP adapter layer only,
 * mapping typed service errors to HTTP status codes exactly like
 * `entitlementRoutes.ts` already does for the sibling entitlement surface.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import {
  PlatformAdminComplimentaryError,
} from '../../../platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
import type {
  ComplimentaryGrantView,
  PlatformAdminComplimentaryGrantService,
} from '../../../platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
import { ComplimentaryGrantError } from '../../../entitlements/complimentary/ComplimentaryEntitlementService.js';
import { COMPLIMENTARY_ENTITLEMENT_TYPES, COMPLIMENTARY_GRANT_CATEGORIES } from '../../../entitlements/complimentary/types.js';
import type { ComplimentaryEntitlementType, ComplimentaryGrantCategory } from '../../../entitlements/complimentary/types.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface ComplimentaryGrantRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminComplimentaryGrantService: PlatformAdminComplimentaryGrantService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 4 * 1024;
const FAMILY_ID_MAX_LENGTH = 128;
const REASON_CODE_MAX_LENGTH = 64;
const INTERNAL_NOTE_MAX_LENGTH = 2000;
const MAX_AMOUNT = 1_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function grantToDto(view: ComplimentaryGrantView) {
  return {
    grantId: view.grantId,
    familyId: view.familyId,
    entitlementType: view.entitlementType,
    category: view.category,
    amountOrAllowance: view.amountOrAllowance,
    effectiveFrom: dateToJson(view.effectiveFrom),
    expiresAt: dateToJson(view.expiresAt),
    status: view.status,
    reasonCode: view.reasonCode,
    internalNote: view.internalNote,
    grantedByAdminId: view.grantedByAdminId,
    createdAt: dateToJson(view.createdAt),
    revokedAt: dateToJson(view.revokedAt),
    revokedByAdminId: view.revokedByAdminId,
    revision: view.revision,
  };
}

/** Both FORBIDDEN and STEP_UP_REQUIRED collapse to a generic 403 -- same anti-oracle discipline entitlementRoutes.ts's mapEntitlementError already documents (never reveal which specific check failed to an unauthorized caller). */
function mapKnownError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof PlatformAdminComplimentaryError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof PlatformAdminAuthError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof ComplimentaryGrantError) {
    if (error.code === 'NOT_FOUND') {
      reply.code(404).send({ error: 'not_found' });
      return true;
    }
    if (error.code === 'ALREADY_TERMINAL') {
      reply.code(409).send({ error: 'already_terminal' });
      return true;
    }
    reply.code(400).send({ error: 'invalid_request' });
    return true;
  }
  return false;
}

export function registerComplimentaryGrantRoutes(app: FastifyInstance, deps: ComplimentaryGrantRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-complimentary-grant-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'platform-admin-complimentary-grant-mutate' });

  function actor(request: FastifyRequest) {
    return {
      adminId: request.platformAdminId as string,
      roles: request.platformAdminRoles ?? [],
      sessionId: request.platformAdminSessionId as string,
    };
  }

  app.get(
    '/platform-admin/families/:familyId/complimentary-grants',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const items = await deps.platformAdminComplimentaryGrantService.listForFamily(actor(request), familyId);
        return reply.code(200).send({ items: items.map(grantToDto) });
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/families/:familyId/complimentary-grants',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId?: string };
      if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > FAMILY_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { entitlementType, category, amountOrAllowance, effectiveFrom, expiresAt, reasonCode, internalNote, stepUpId } = body;
      if (typeof entitlementType !== 'string' || !(COMPLIMENTARY_ENTITLEMENT_TYPES as readonly string[]).includes(entitlementType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof category !== 'string' || !(COMPLIMENTARY_GRANT_CATEGORIES as readonly string[]).includes(category)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof amountOrAllowance !== 'number' || !Number.isInteger(amountOrAllowance) || amountOrAllowance < 0 || amountOrAllowance > MAX_AMOUNT) return reply.code(400).send({ error: 'invalid_request' });
      if (!isIsoDateString(effectiveFrom)) return reply.code(400).send({ error: 'invalid_request' });
      if (expiresAt !== null && expiresAt !== undefined && !isIsoDateString(expiresAt)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > REASON_CODE_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (internalNote !== null && internalNote !== undefined && (typeof internalNote !== 'string' || internalNote.length > INTERNAL_NOTE_MAX_LENGTH)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const view = await deps.platformAdminComplimentaryGrantService.createGrant(actor(request), {
          familyId,
          entitlementType: entitlementType as ComplimentaryEntitlementType,
          category: category as ComplimentaryGrantCategory,
          amountOrAllowance,
          effectiveFrom: new Date(effectiveFrom),
          expiresAt: expiresAt === null || expiresAt === undefined ? null : new Date(expiresAt as string),
          reasonCode,
          internalNote: (internalNote as string | null | undefined) ?? null,
          stepUpId,
        });
        return reply.code(201).send(grantToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/complimentary-grants/:grantId/revoke',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { grantId } = request.params as { grantId?: string };
      if (typeof grantId !== 'string' || grantId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { reasonCode, stepUpId } = body;
      if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > REASON_CODE_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const view = await deps.platformAdminComplimentaryGrantService.revokeGrant(actor(request), grantId, reasonCode, stepUpId);
        return reply.code(200).send(grantToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/complimentary-grants/:grantId/renew',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { grantId } = request.params as { grantId?: string };
      if (typeof grantId !== 'string' || grantId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { newExpiresAt, stepUpId } = body;
      if (newExpiresAt !== null && !isIsoDateString(newExpiresAt)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });
      try {
        const view = await deps.platformAdminComplimentaryGrantService.renewGrant(actor(request), grantId, newExpiresAt === null ? null : new Date(newExpiresAt as string), stepUpId);
        return reply.code(200).send(grantToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );
}
