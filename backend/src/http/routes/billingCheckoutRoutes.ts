/**
 * PCA-BILL-2A -- family-facing checkout HTTP surface.
 *
 * KNOWN GAP (disclosed, not silently papered over -- see this lane's final
 * report): `createRequireFamilyAuthorization` is this codebase's ONLY
 * reachable family-plane HTTP authorization primitive, and it answers
 * exactly one question -- "does this service account hold an ACTIVE
 * family-scope row for this family" -- with no Family-Owner-vs-
 * Administrator-vs-Viewer distinction available at this layer (that
 * distinction is device-plane/E2EE-envelope-signed only today,
 * backend/src/familyrbac/TrustSetRoleResolver.ts, and parent-web's
 * Subscription.tsx is a static placeholder with no auth wiring at all).
 * A family-scoped service account belonging to an Administrator (not an
 * Owner) can therefore initiate a paid checkout today. True
 * Family-Owner-only enforcement per PCA-ADD-BILL-040 is PCA-MYKIDS-BILL-1's
 * scope, not this lane's.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { CheckoutError, type CheckoutService } from '../../billing/checkout/CheckoutService.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_PROVIDER_NAME_LENGTH = 32;
const MAX_RETURN_URL_LENGTH = 2048;
const MAX_PAYMENT_ATTEMPT_ID_LENGTH = 64;

export interface BillingCheckoutRoutesDeps {
  checkoutService: CheckoutService;
  authService: AuthService;
  authzService: AuthzService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkoutErrorToHttpStatus(code: CheckoutError['code']): number {
  switch (code) {
    case 'REQUEST_NOT_FOUND':
      return 404;
    case 'NOT_QUOTED':
      return 409;
    case 'UNSUPPORTED_CURRENCY':
      return 422;
    case 'UNKNOWN_PROVIDER':
      return 400;
    case 'PROVIDER_CHECKOUT_FAILED':
      return 502;
    case 'LIFECYCLE_TRANSITION_FAILED':
      return 409;
  }
}

export function registerBillingCheckoutRoutes(app: FastifyInstance, deps: BillingCheckoutRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);

  app.post(
    '/v1/families/:familyId/billing/checkout',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'billing-checkout' }),
        createRequireFamilyAuthorization(deps.authzService, 'INITIATE_CHECKOUT'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { requestId, provider, returnUrl } = body;
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (provider !== undefined && (typeof provider !== 'string' || provider.length === 0 || provider.length > MAX_PROVIDER_NAME_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (returnUrl !== undefined && (typeof returnUrl !== 'string' || returnUrl.length === 0 || returnUrl.length > MAX_RETURN_URL_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const result = await deps.checkoutService.createCheckoutSession({
          familyId,
          requestId,
          provider: provider as string | undefined,
          returnUrl: returnUrl as string | undefined,
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof CheckoutError) return reply.code(checkoutErrorToHttpStatus(error.code)).send({ error: 'checkout_failed', code: error.code });
        throw error;
      }
    },
  );

  app.get(
    '/v1/families/:familyId/billing/checkout/:paymentAttemptId',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        createRequireFamilyAuthorization(deps.authzService, 'VIEW_OWN_BILLING_STATUS'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, paymentAttemptId } = request.params as { familyId: string; paymentAttemptId: string };
      if (typeof paymentAttemptId !== 'string' || paymentAttemptId.length === 0 || paymentAttemptId.length > MAX_PAYMENT_ATTEMPT_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const status = await deps.checkoutService.getCheckoutStatus(familyId, paymentAttemptId);
        return reply.send(status);
      } catch (error) {
        if (error instanceof CheckoutError) return reply.code(checkoutErrorToHttpStatus(error.code)).send({ error: 'not_found' });
        throw error;
      }
    },
  );
}
