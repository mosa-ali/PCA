import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PairingError, type PairingService } from '../../pairing/PairingService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization, createRequireFamilyMembershipRole } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { toPairingRequestDto } from '../dto.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from '../../familymembers/FamilyMembershipRepository.js';
import type { ParentAccountService } from '../../parentaccount/ParentAccountService.js';

const PAIRING_READ_ROLES: ReadonlySet<FamilyMembershipRole> = new Set(['ADMINISTRATOR', 'VIEWER']);
const PAIRING_CONFIRM_ROLES: ReadonlySet<FamilyMembershipRole> = new Set(['ADMINISTRATOR']);

export interface PairingRoutesDeps {
  pairingService: PairingService;
  authService: AuthService;
  authzService: AuthzService;
  parentAccountService: Pick<ParentAccountService, 'consumeSensitiveStepUp'>;
  familyMembershipRepository: Pick<FamilyMembershipRepository, 'findActiveRoleByServiceAccountId'>;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every route below -- bounds session-validation DB load per IP regardless of token validity. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

/**
 * Both routes require an authenticated service session, active family
 * membership, and family scope before PairingService is called. Viewing is
 * allowed to Administrators and Viewers; confirmation requires an active
 * Administrator. PairingService itself performs no authorization.
 *
 * Confirmation requires the current Administrator's fresh, family-scoped
 * TOTP step-up grant and only ever reaches PAIRED (see
 * PairingService/DeviceRepository doc comments) -- it never creates Family
 * Trust Set authority, issues policy, or makes a device ACTIVE.
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
        createRequireFamilyMembershipRole(deps.familyMembershipRepository, PAIRING_READ_ROLES),
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
        createRequireFamilyMembershipRole(deps.familyMembershipRepository, PAIRING_CONFIRM_ROLES),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, deviceId } = request.params as { familyId: string; deviceId: string };
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};
      const stepUpToken = body.stepUpToken;
      if (
        typeof stepUpToken !== 'string' ||
        !(await deps.parentAccountService.consumeSensitiveStepUp(
          request.accountId as string,
          familyId,
          'family.security.settings.change',
          stepUpToken,
        ))
      ) {
        return reply.code(403).send({ error: 'step_up_required' });
      }
      try {
        const view = await deps.pairingService.confirmPairing(familyId, deviceId, request.accountId as string);
        return reply.send(toPairingRequestDto(view));
      } catch (error) {
        if (error instanceof PairingError) {
          if (error.code === 'NOT_FOUND') return reply.code(404).send({ error: 'not_found' });
          if (error.code === 'SELF_APPROVAL_DENIED') return reply.code(403).send({ error: 'self_approval_denied' });
          return reply.code(409).send({ error: 'conflict' });
        }
        throw error;
      }
    },
  );
}
