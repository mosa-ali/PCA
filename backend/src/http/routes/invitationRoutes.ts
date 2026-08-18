import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvitationError, type InvitationService } from '../../invitation/InvitationService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { toInvitationCreatedDto, toInvitationDto, toInvitationTransitionDto } from '../dto.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

const MAX_BODY_BYTES = 4 * 1024;
const VALID_PLATFORMS = new Set(['ANDROID', 'IOS']);
const VALID_PROTECTION_MODES = new Set(['ANDROID_STANDARD', 'ANDROID_PROTECTED', 'IOS_STANDARD']);
const VALID_AGE_UX_TIERS = new Set(['YOUNG_CHILD', 'TEEN']);
const VALID_INITIAL_POLICY_PROFILES = new Set(['BALANCED', 'STRICT']);
const CHILD_PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TOKEN_LENGTH = 64;

/**
 * PCA-ADD-ENR-005/PCA-SEC-001: every device-facing lifecycle-transition
 * error collapses to the SAME generic 404 already used by
 * bootstrapRoutes.ts's GENERIC_UNAVAILABLE_CODES for NOT_FOUND/EXPIRED/
 * REVOKED/ALREADY_REDEEMED -- plus INVALID_STATE (an out-of-order
 * transition request), so this surface can never become a token-guessing
 * or lifecycle-state oracle either.
 */
const GENERIC_UNAVAILABLE_CODES = new Set(['NOT_FOUND', 'EXPIRED', 'REVOKED', 'ALREADY_REDEEMED', 'INVALID_STATE']);

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
      const { platform, requestedProtectionMode, childProfileId, ageUxTier, initialPolicyProfile, ttlMs } = body;
      if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof requestedProtectionMode !== 'string' || !VALID_PROTECTION_MODES.has(requestedProtectionMode)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (platform === 'IOS' && requestedProtectionMode !== 'IOS_STANDARD') return reply.code(400).send({ error: 'invalid_request' });
      if (platform === 'ANDROID' && requestedProtectionMode === 'IOS_STANDARD') return reply.code(400).send({ error: 'invalid_request' });
      // PCA-ADD-ENR-001: legacy service callers and pre-0019 rows remain
      // compatible, but every new parent-facing invitation must bind all
      // three controlled profile values before persistence.
      if (typeof childProfileId !== 'string' || !CHILD_PROFILE_ID_PATTERN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof ageUxTier !== 'string' || !VALID_AGE_UX_TIERS.has(ageUxTier)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof initialPolicyProfile !== 'string' || !VALID_INITIAL_POLICY_PROFILES.has(initialPolicyProfile)) {
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
          childProfileId: childProfileId as string | undefined,
          ageUxTier: ageUxTier as 'YOUNG_CHILD' | 'TEEN' | undefined,
          initialPolicyProfile: initialPolicyProfile as 'BALANCED' | 'STRICT' | undefined,
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

  registerDeviceLifecycleTransitionRoutes(app, deps);
}

/**
 * PCA-ADD-ENR-005/008 (Addendum 001): device-facing invitation
 * lifecycle-progress endpoints. Deliberately NOT behind
 * requireServiceSession/requireFamilyAuthorization -- like
 * bootstrapRoutes.ts's `/v1/enrollment/bootstrap`, authority here is only
 * "possession of the invitation's one-time bearer token," matching every
 * other pre-enrollment device-facing call. These exist so the Android
 * install/store/App-Link continuation flow (EnrollmentCoordinator.kt) can
 * report real forward progress -- app-not-installed, app-installed-resumed,
 * bootstrap-material-prepared-awaiting-authorization -- as persisted,
 * audited server states instead of the client silently tracking them
 * itself.
 */
function registerDeviceLifecycleTransitionRoutes(app: FastifyInstance, deps: InvitationRoutesDeps): void {
  const transitions: Array<{
    path: string;
    bucket: string;
    apply: (rawInvitationToken: string) => Promise<Awaited<ReturnType<InvitationService['markInstallRequired']>>>;
  }> = [
    {
      path: '/v1/enrollment/invitations/install-required',
      bucket: 'invitation-install-required',
      apply: (rawInvitationToken) => deps.invitationService.markInstallRequired(rawInvitationToken),
    },
    {
      path: '/v1/enrollment/invitations/app-installed',
      bucket: 'invitation-app-installed',
      apply: (rawInvitationToken) => deps.invitationService.markAppInstalled(rawInvitationToken),
    },
    {
      path: '/v1/enrollment/invitations/authorization-required',
      bucket: 'invitation-authorization-required',
      apply: (rawInvitationToken) => deps.invitationService.markAuthorizationRequired(rawInvitationToken),
    },
  ];

  for (const transition of transitions) {
    app.post(
      transition.path,
      {
        bodyLimit: MAX_BODY_BYTES,
        preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: transition.bucket })],
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body;
        if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
        const { rawInvitationToken } = body;
        if (
          typeof rawInvitationToken !== 'string' ||
          rawInvitationToken.length === 0 ||
          rawInvitationToken.length > MAX_TOKEN_LENGTH
        ) {
          return reply.code(400).send({ error: 'invalid_request' });
        }

        try {
          const record = await transition.apply(rawInvitationToken);
          return reply.code(200).send(toInvitationTransitionDto(record));
        } catch (error) {
          if (error instanceof InvitationError) {
            if (GENERIC_UNAVAILABLE_CODES.has(error.code)) {
              return reply.code(404).send({ error: 'invitation_unavailable' });
            }
            return reply.code(400).send({ error: 'invalid_request' });
          }
          throw error;
        }
      },
    );
  }
}
