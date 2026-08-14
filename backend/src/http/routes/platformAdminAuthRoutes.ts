import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import { PlatformAdminAuthError, type PlatformAdminAuthService } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import { PLATFORM_ADMIN_STEP_UP_SCOPES } from '../../platformadmin/auth/types.js';
import type { PlatformAdminStepUpScope } from '../../platformadmin/auth/types.js';
import { createRateLimiter } from '../rateLimit.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_EMAIL_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 256;
const TOTP_CODE_SHAPE = /^[0-9]{6}$/;

export interface PlatformAdminAuthRoutesDeps {
  authService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LENGTH;
}

function isPlausiblePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD_LENGTH;
}

function isPlausibleTotpCode(value: unknown): value is string {
  return typeof value === 'string' && TOTP_CODE_SHAPE.test(value);
}

function isStepUpScope(value: unknown): value is PlatformAdminStepUpScope {
  return typeof value === 'string' && (PLATFORM_ADMIN_STEP_UP_SCOPES as readonly string[]).includes(value);
}

/**
 * Registers the five Platform Administration auth HTTP endpoints
 * (Section 15 of the addendum scopes this lane's HTTP surface to exactly
 * these -- no admin-account-management CRUD endpoints exist here; see this
 * lane's final report for that intentional scope boundary).
 *
 * Every route applies the platform-admin-specific rate limiter as a
 * preHandler BEFORE any session/credential check (mirroring
 * backend/src/http/buildServer.ts's authAttemptLimiter ordering), caps
 * request body size, and relies on buildServer.ts's shared global error
 * handler to never leak error.message on a 5xx.
 */
export function registerPlatformAdminAuthRoutes(app: FastifyInstance, deps: PlatformAdminAuthRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.authService);
  // Distinct bucket name from the family-plane 'auth-attempt' bucket --
  // exhausting one plane's budget must never affect the other's.
  const platformAdminAuthAttemptLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'platform-admin-auth-attempt' });

  app.post(
    '/platform-admin/auth/login',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [platformAdminAuthAttemptLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { email, password, totpCode } = body;
      if (!isPlausibleEmail(email) || !isPlausiblePassword(password) || !isPlausibleTotpCode(totpCode)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      try {
        const result = await deps.authService.login(email, password, totpCode);
        return reply.code(200).send({ sessionToken: result.rawToken, expiresAt: result.expiresAt.toISOString() });
      } catch (error) {
        if (error instanceof PlatformAdminAuthError) return reply.code(401).send({ error: 'unauthorized' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/auth/logout',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [platformAdminAuthAttemptLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const header = request.headers.authorization as string;
      const rawToken = header.slice('Bearer '.length);
      await deps.authService.logout(rawToken);
      return reply.code(204).send();
    },
  );

  app.post(
    '/platform-admin/auth/sessions/revoke-all',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [platformAdminAuthAttemptLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminId = request.platformAdminId as string;
      const roles = request.platformAdminRoles ?? [];
      await deps.authService.revokeAllSessions(adminId, { adminId, roles });
      return reply.code(204).send();
    },
  );

  app.post(
    '/platform-admin/auth/step-up',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [platformAdminAuthAttemptLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { totpCode, scope } = body;
      if (!isPlausibleTotpCode(totpCode) || !isStepUpScope(scope)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const adminId = request.platformAdminId as string;
      const sessionId = request.platformAdminSessionId as string;
      const roles = request.platformAdminRoles ?? [];
      try {
        const result = await deps.authService.assertStepUp(adminId, sessionId, scope, totpCode, roles[0] ?? null);
        return reply.code(200).send({ stepUpId: result.stepUpId, expiresAt: result.expiresAt.toISOString() });
      } catch (error) {
        if (error instanceof PlatformAdminAuthError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/auth/whoami',
    { preHandler: [platformAdminAuthAttemptLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest) => {
      return {
        adminId: request.platformAdminId,
        roles: request.platformAdminRoles ?? [],
        sessionExpiresAt: request.platformAdminSessionExpiresAt?.toISOString(),
      };
    },
  );
}
