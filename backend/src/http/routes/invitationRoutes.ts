import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvitationError, type InvitationService } from '../../invitation/InvitationService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { toInvitationCreatedDto, toInvitationDto } from '../dto.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

const MAX_BODY_BYTES = 4 * 1024;
const VALID_PLATFORMS = new Set(['ANDROID', 'IOS']);
const VALID_PROTECTION_MODES = new Set(['ANDROID_STANDARD', 'ANDROID_PROTECTED', 'IOS_STANDARD']);

export interface InvitationRoutesDeps {
  invitationService: InvitationService;
  authService: AuthService;
  authzService: AuthzService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every route below -- bounds session-validation DB load per IP regardless of token validity. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerInvitationRoutes(app: FastifyInstance, deps: InvitationRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);

  app.post(
    '/v1/families/:familyId/invitations',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'create-invitation' }),
        createRequireFamilyAuthorization(deps.authzService, 'CREATE_INVITATION'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { platform, requestedProtectionMode, ttlMs } = body;
      if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof requestedProtectionMode !== 'string' || !VALID_PROTECTION_MODES.has(requestedProtectionMode)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (ttlMs !== undefined && typeof ttlMs !== 'number') {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const { record, rawToken } = await deps.invitationService.createInvitation({
          familyId,
          platform: platform as 'ANDROID' | 'IOS',
          requestedProtectionMode: requestedProtectionMode as 'ANDROID_STANDARD' | 'ANDROID_PROTECTED' | 'IOS_STANDARD',
          ttlMs: ttlMs as number | undefined,
        });
        return reply.code(201).send(toInvitationCreatedDto(record, rawToken));
      } catch (error) {
        if (error instanceof RangeError) return reply.code(400).send({ error: 'invalid_request' });
        throw error;
      }
    },
  );

  app.get(
    '/v1/families/:familyId/invitations/:invitationId',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        createRequireFamilyAuthorization(deps.authzService, 'VIEW_INVITATION_STATUS'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, invitationId } = request.params as { familyId: string; invitationId: string };
      try {
        const record = await deps.invitationService.getInvitationForFamily(familyId, invitationId);
        return reply.send(toInvitationDto(record));
      } catch (error) {
        if (error instanceof InvitationError) return reply.code(404).send({ error: 'not_found' });
        throw error;
      }
    },
  );

  app.get(
    '/v1/families/:familyId/invitations',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        createRequireFamilyAuthorization(deps.authzService, 'LIST_OWN_INVITATIONS'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const records = await deps.invitationService.listInvitationsForFamily(familyId);
      return reply.send(records.map(toInvitationDto));
    },
  );

  app.post(
    '/v1/families/:familyId/invitations/:invitationId/revoke',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        createRequireFamilyAuthorization(deps.authzService, 'REVOKE_INVITATION'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, invitationId } = request.params as { familyId: string; invitationId: string };
      try {
        const record = await deps.invitationService.revokeInvitationForFamily(familyId, invitationId);
        return reply.send(toInvitationDto(record));
      } catch (error) {
        if (error instanceof InvitationError) return reply.code(404).send({ error: 'not_found' });
        throw error;
      }
    },
  );
}
