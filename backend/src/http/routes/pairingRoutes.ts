import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PairingError, type PairingService } from '../../pairing/PairingService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { toPairingRequestDto } from '../dto.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

export interface PairingRoutesDeps {
  pairingService: PairingService;
  authService: AuthService;
  authzService: AuthzService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every route below -- bounds session-validation DB load per IP regardless of token validity. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

/**
 * Both routes require an authenticated service session AND family
 * authorization (VIEW_PAIRING_REQUEST / CONFIRM_PAIRING_REQUEST) before
 * PairingService is ever called -- PairingService itself performs no
 * authorization, it trusts the family scope it's given.
 *
 * Confirmation only ever reaches PAIRED (see PairingService/DeviceRepository
 * doc comments) -- it never creates Family Trust Set authority, issues
 * policy, or makes a device ACTIVE.
 */
export function registerPairingRoutes(app: FastifyInstance, deps: PairingRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);

  app.get(
    '/v1/families/:familyId/pairing-requests/:deviceId',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'view-pairing-request' }),
        createRequireFamilyAuthorization(deps.authzService, 'VIEW_PAIRING_REQUEST'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, deviceId } = request.params as { familyId: string; deviceId: string };
      try {
        const view = await deps.pairingService.getPairingRequest(familyId, deviceId);
        return reply.send(toPairingRequestDto(view));
      } catch (error) {
        if (error instanceof PairingError) return reply.code(404).send({ error: 'not_found' });
        throw error;
      }
    },
  );

  app.post(
    '/v1/families/:familyId/pairing-requests/:deviceId/confirm',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'confirm-pairing-request' }),
        createRequireFamilyAuthorization(deps.authzService, 'CONFIRM_PAIRING_REQUEST'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, deviceId } = request.params as { familyId: string; deviceId: string };
      try {
        const view = await deps.pairingService.confirmPairing(familyId, deviceId, request.accountId as string);
        return reply.send(toPairingRequestDto(view));
      } catch (error) {
        if (error instanceof PairingError) {
          if (error.code === 'NOT_FOUND') return reply.code(404).send({ error: 'not_found' });
          return reply.code(409).send({ error: 'conflict' });
        }
        throw error;
      }
    },
  );
}
