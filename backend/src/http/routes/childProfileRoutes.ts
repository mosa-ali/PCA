import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ChildProfileError, type ChildProfileService } from '../../childprofiles/ChildProfileService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

const MAX_BODY_BYTES = 1 * 1024; // the body carries at most one short idempotency key -- see below
const MAX_IDEMPOTENCY_KEY_LENGTH = 191;

/**
 * Opaque central child-profile membership registry (doc 00 Section 9
 * change CHG-2026-09-04-01, doc 10 Section 7.1). Same preHandler shape and
 * error-mapping discipline as invitationRoutes.ts: service-session
 * authentication, then family authorization BEFORE any data access, on
 * the SAME plane CREATE_INVITATION already uses (the only plane that
 * authorizes a family-scoped mutation in production today -- see
 * ParentActionAuthorizationService's own header on why it cannot be used
 * here, unchanged by this file).
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
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every route below -- bounds session-validation DB load per IP regardless of token validity, matching invitationRoutes.ts. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const rows = await deps.childProfileService.listChildProfiles(familyId);
      return reply.send({ items: rows.map(toChildProfileDto) });
    },
  );
}
