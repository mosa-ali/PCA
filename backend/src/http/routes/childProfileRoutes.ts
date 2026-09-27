import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ChildProfileError, type ChildProfileService } from '../../childprofiles/ChildProfileService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from '../../familymembers/FamilyMembershipRepository.js';
import type { OpaqueFamilyId } from '../../familymembers/types.js';

const MAX_BODY_BYTES = 1 * 1024; // the body carries at most one short idempotency key -- see below
const MAX_IDEMPOTENCY_KEY_LENGTH = 191;

/**
 * Opaque central child-profile membership registry (doc 00 Section 9
 * change CHG-2026-09-04-01, doc 10 Section 7.1). Same preHandler shape and
 * error-mapping discipline as invitationRoutes.ts: service-session
 * authentication, then family authorization BEFORE any data access, on
 * the service-session + family-scope plane, followed by an ACTIVE Parent
 * membership-role check. CREATE_CHILD_PROFILE is a normal Parent
 * Administrator action: the active same-family role must be ADMINISTRATOR.
 * Listing opaque child-profile ids is available to an active Administrator
 * or Viewer. This uses the Parent membership repository, not the retired
 * Parent browser / trust-set authority path.
 *
 * NEVER accepts a readable child field. `POST` accepts exactly one
 * optional body field -- `idempotencyKey`, an operational retry-safety
 * value, never child-profile content -- and REJECTS the request outright
 * (400, not a silent ignore) if any other field is present. A silent
 * ignore would mean a client that thinks it sent a display name
 * "successfully" while the server dropped it -- worse than an explicit
 * failure the client can react to.
 */
export interface ChildProfileRoutesDeps {
  childProfileService: ChildProfileService;
  authService: AuthService;
  authzService: AuthzService;
  familyMembershipRepository: Pick<FamilyMembershipRepository, 'findActiveRoleByServiceAccountId'>;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every route below -- bounds session-validation DB load per IP regardless of token validity, matching invitationRoutes.ts. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireParentMembershipRole(
  familyMembershipRepository: Pick<FamilyMembershipRepository, 'findActiveRoleByServiceAccountId'>,
  allowedRoles: ReadonlySet<FamilyMembershipRole>,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { familyId } = request.params as { familyId?: unknown };
    const accountId = request.accountId;
    if (typeof familyId !== 'string' || typeof accountId !== 'string') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    const role = await familyMembershipRepository.findActiveRoleByServiceAccountId(accountId, familyId as OpaqueFamilyId);
    if (role === null || !allowedRoles.has(role)) {
      // Keep absent, inactive, and insufficient roles indistinguishable.
      await reply.code(403).send({ error: 'forbidden' });
    }
  };
}

const PARENT_PROFILE_READ_ROLES: ReadonlySet<FamilyMembershipRole> = new Set(['ADMINISTRATOR', 'VIEWER']);
const PARENT_PROFILE_CREATE_ROLES: ReadonlySet<FamilyMembershipRole> = new Set(['ADMINISTRATOR']);

export function toChildProfileDto(row: { childProfileId: string; createdAtUtc: string }) {
  return { childProfileId: row.childProfileId, createdAt: row.createdAtUtc };
}

export function registerChildProfileRoutes(app: FastifyInstance, deps: ChildProfileRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);

  app.post(
    '/v1/families/:familyId/children',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'create-child-profile' }),
        createRequireFamilyAuthorization(deps.authzService, 'CREATE_CHILD_PROFILE'),
        requireParentMembershipRole(deps.familyMembershipRepository, PARENT_PROFILE_CREATE_ROLES),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body ?? {};
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });

      const allowedKeys = new Set(['idempotencyKey']);
      const bodyKeys = Object.keys(body);
      if (bodyKeys.some((key) => !allowedKeys.has(key))) {
        // Any field beyond idempotencyKey -- displayName, name, childName,
        // nickname, dateOfBirth, or anything else -- is refused, never
        // silently dropped. See this file's own header comment.
        return reply.code(400).send({ error: 'invalid_request', code: 'READABLE_CHILD_FIELD_NOT_ALLOWED' });
      }

      const { idempotencyKey } = body as { idempotencyKey?: unknown };
      if (idempotencyKey !== undefined) {
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
      }

      try {
        const result = await deps.childProfileService.createChildProfile(familyId, (idempotencyKey as string) ?? null);
        return reply.code(201).send(toChildProfileDto(result));
      } catch (error) {
        if (error instanceof ChildProfileError) return reply.code(400).send({ error: 'invalid_request' });
        throw error;
      }
    },
  );

  app.get(
    '/v1/families/:familyId/children',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        createRequireFamilyAuthorization(deps.authzService, 'LIST_CHILD_PROFILES'),
        requireParentMembershipRole(deps.familyMembershipRepository, PARENT_PROFILE_READ_ROLES),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const rows = await deps.childProfileService.listChildProfiles(familyId);
      return reply.send({ items: rows.map(toChildProfileDto) });
    },
  );
}
