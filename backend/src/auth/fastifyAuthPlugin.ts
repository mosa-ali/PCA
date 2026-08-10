import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from './AuthService.js';

const BEARER_PREFIX = 'Bearer ';
// Bounded well above any real session token (43 chars) to reject abuse
// input cheaply, before it ever reaches token parsing/hashing.
const MAX_AUTHORIZATION_HEADER_LENGTH = 4096;

declare module 'fastify' {
  interface FastifyRequest {
    accountId?: string;
  }
}

/**
 * Fastify preHandler enforcing the service control-plane auth boundary.
 * Parses ONLY `Authorization: Bearer <opaque-token>`. Every failure mode
 * (missing header, malformed header, oversized header, unknown token,
 * expired token, revoked token, disabled account) replies with the SAME
 * generic 401 -- this must never leak which failure occurred, whether an
 * account/family exists, or any token-validity detail.
 *
 * A successful result only proves "this is a recognized service account."
 * It is not, and must never be treated as, family E2EE authority.
 */
export function createRequireServiceSession(authService: AuthService) {
  return async function requireServiceSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
      request.accountId = await authService.validateSession(rawToken);
    } catch (error) {
      if (error instanceof AuthError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
  };
}
