import type { FastifyReply, FastifyRequest } from 'fastify';
import { PlatformAdminAuthError, type PlatformAdminAuthService } from './PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId } from './types.js';

const BEARER_PREFIX = 'Bearer ';
// Bounded well above any real pa_-prefixed session token (46 chars) to
// reject abuse input cheaply, before it ever reaches token parsing/hashing
// -- mirrors backend/src/auth/fastifyAuthPlugin.ts's discipline exactly.
const MAX_AUTHORIZATION_HEADER_LENGTH = 4096;

/**
 * PCA-ADD-PA-002/010: a NEW, distinct module augmentation --
 * request.platformAdminId/request.platformAdminRoles/
 * request.platformAdminSessionId -- deliberately never reusing
 * request.accountId (backend/src/auth/fastifyAuthPlugin.ts's family/
 * service-plane field). A route handler that accidentally reads
 * request.accountId on a Platform Administration route gets `undefined`,
 * not another plane's identity -- the two fields can never be confused for
 * one another.
 */
declare module 'fastify' {
  interface FastifyRequest {
    platformAdminId?: PlatformAdminId;
    platformAdminRoles?: PlatformAdminRole[];
    platformAdminSessionId?: PlatformAdminSessionId;
    platformAdminSessionExpiresAt?: Date;
  }
}

/**
 * Fastify preHandler enforcing the Platform Administration auth boundary.
 * Parses ONLY `Authorization: Bearer <pa_-prefixed opaque token>`. Every
 * failure mode (missing header, malformed header, oversized header,
 * wrong-realm/family-plane token, unknown token, expired token, revoked
 * token, disabled account) replies with the SAME generic 401 -- mirrors
 * backend/src/auth/fastifyAuthPlugin.ts's createRequireServiceSession
 * exactly, applied to the independent Platform Administration realm.
 */
export function createRequirePlatformAdminSession(authService: PlatformAdminAuthService) {
  return async function requirePlatformAdminSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (
      typeof header !== 'string' ||
      header.length === 0 ||
      header.length > MAX_AUTHORIZATION_HEADER_LENGTH ||
      !header.startsWith(BEARER_PREFIX)
    ) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const rawToken = header.slice(BEARER_PREFIX.length);
    try {
      const identity = await authService.validateSession(rawToken);
      request.platformAdminId = identity.adminId;
      request.platformAdminRoles = identity.roles;
      request.platformAdminSessionId = identity.sessionId;
      request.platformAdminSessionExpiresAt = identity.sessionExpiresAt;
    } catch (error) {
      if (error instanceof PlatformAdminAuthError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
  };
}
