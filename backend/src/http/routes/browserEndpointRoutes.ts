import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BrowserEndpointError, type BrowserEndpointService } from '../../device/BrowserEndpointService.js';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

const MAX_BODY_BYTES = 4 * 1024;

export interface BrowserEndpointRoutesDeps {
  /** Optional -- when omitted, no route in this file is registered at all (404, not merely 401), mirroring runtimeSyncRoutes.ts's deviceProtectionStatusRepository precedent. */
  browserEndpointService?: BrowserEndpointService;
  authService: AuthService;
  authzService: AuthzService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession -- bounds session-validation DB load per IP regardless of token validity. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * PCA-FR-063 / doc 08 Section 8-style trusted-browser registration step.
 * Registration alone is never trust: the resulting device is
 * PAIRING_PENDING (see BrowserEndpointService's own doc comment) and still
 * requires the EXISTING, unchanged pairing-requests/:deviceId/confirm route
 * (CONFIRM_PAIRING_REQUEST) -- a separate authorized-parent action -- before
 * it is PAIRED, and confirmPairing itself rejects that SAME account
 * confirming its own registration (SELF_APPROVAL_DENIED).
 */
export function registerBrowserEndpointRoutes(app: FastifyInstance, deps: BrowserEndpointRoutesDeps): void {
  if (!deps.browserEndpointService) return;
  const browserEndpointService = deps.browserEndpointService;
  const requireServiceSession = createRequireServiceSession(deps.authService);

  app.post(
    '/v1/families/:familyId/browser-endpoints',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'register-browser-endpoint' }),
        createRequireFamilyAuthorization(deps.authzService, 'REGISTER_BROWSER_ENDPOINT'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.dskPublicKey !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const result = await browserEndpointService.registerEndpoint(familyId, request.accountId as string, body.dskPublicKey);
        return reply.code(201).send({ deviceId: result.deviceId, status: result.status });
      } catch (error) {
        if (error instanceof BrowserEndpointError) {
          if (error.code === 'INVALID_PUBLIC_KEY') return reply.code(400).send({ error: 'invalid_request' });
          return reply.code(409).send({ error: 'conflict' });
        }
        throw error;
      }
    },
  );
}
