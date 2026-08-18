import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from './AuthService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../parentaccount/cookies.js';

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
 * Accepts EITHER `Authorization: Bearer <opaque-token>` (the original
 * service-to-service transport -- bootstrapRoutes/invitationRoutes/
 * pairingRoutes/retentionRoutes keep using this unchanged) OR the
 * FAMILY_SERVICE_SESSION_V1 `pca_family_session` HttpOnly cookie
 * (PCA-AUTH-SESSION-1, Round5 Coordinator glue) -- both carry the exact
 * same opaque token format and are validated through the SAME
 * `authService.validateSession`, since parentaccount/ParentAccountService.ts
 * deliberately reuses this backing store rather than inventing a second one
 * (see PCA_IMPL_DECISION_003). The Bearer header takes priority when both
 * are present. Every failure mode (missing header/cookie, malformed,
 * oversized, unknown token, expired token, revoked token, disabled account)
 * replies with the SAME generic 401 -- this must never leak which failure
 * occurred, whether an account/family exists, or any token-validity detail.
 *
 * A successful result only proves "this is a recognized service account."
 * It is not, and must never be treated as, family E2EE authority or Family
 * Owner commercial authority (that remains exclusively
 * FamilyCommercialAuthorityResolver's attestation-chain check).
 */
export function createRequireServiceSession(authService: AuthService) {
  return async function requireServiceSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const cookies = parseCookies(request.headers.cookie);
    let rawToken: string | undefined;
    let cookieTransport = false;

    if (
      typeof header === 'string' &&
      header.length > 0 &&
      header.length <= MAX_AUTHORIZATION_HEADER_LENGTH &&
      header.startsWith(BEARER_PREFIX)
    ) {
      rawToken = header.slice(BEARER_PREFIX.length);
    } else {
      rawToken = cookies.get(SESSION_COOKIE_NAME);
      cookieTransport = Boolean(rawToken);
    }

    if (cookieTransport && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrfCookie = cookies.get(CSRF_COOKIE_NAME);
      const csrfHeader = request.headers[CSRF_HEADER_NAME];
      if (!csrfCookie || typeof csrfHeader !== 'string' || csrfHeader !== csrfCookie) {
        await reply.code(403).send({ error: 'csrf_mismatch' });
        return;
      }
    }

    if (!rawToken) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

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
