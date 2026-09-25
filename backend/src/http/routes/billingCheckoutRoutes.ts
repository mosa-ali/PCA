/**
 * PCA-BILL-2A -- family-facing checkout HTTP surface.
 *
 * OWNER AUTHORITY (PCA-DEC-030, replacing PCA-BILL-2A-R1 FIX 4's
 * Genesis/device-signature attestation gate): checkout-CREATE requires
 * COMMERCIAL_OWNER_AUTHORITY = FAMILY ADMINISTRATOR + FRESH TOTP STEP-UP.
 * The caller sends `stepUpToken`, minted by POST /api/parent/mfa/step-up for
 * BILLING_CHECKOUT_CREATE in this family; it is single-use and short-lived.
 * The read-only status route keeps its VIEW_OWN_BILLING_STATUS scope check
 * only -- viewing an already-created checkout is not a new commitment.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { CheckoutError, type CheckoutService } from '../../billing/checkout/CheckoutService.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { ParentCommercialStepUpAuthority } from '../../parentaccount/mfa/ParentCommercialStepUpAuthority.js';

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
  /** PCA-DEC-030 ADMINISTRATOR + fresh-TOTP owner gate. */
  commercialOwnerAuthority: Pick<ParentCommercialStepUpAuthority, 'authorize'>;
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
      const { requestId, provider, returnUrl, stepUpToken } = body;
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (provider !== undefined && (typeof provider !== 'string' || provider.length === 0 || provider.length > MAX_PROVIDER_NAME_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (returnUrl !== undefined && (typeof returnUrl !== 'string' || returnUrl.length === 0 || returnUrl.length > MAX_RETURN_URL_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      // Owner gate, resolved BEFORE any checkout orchestration: a Viewer,
      // Child, wrong-family or step-up-less caller never reaches
      // CheckoutService at all.
      const authority = await deps.commercialOwnerAuthority.authorize(request.accountId as string, familyId, 'BILLING_CHECKOUT_CREATE', stepUpToken);
      if (authority === 'ROLE_DENIED') {
        // One generic reason: never leak which role the caller holds.
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (authority === 'STEP_UP_REQUIRED') {
        return reply.code(403).send({ error: 'forbidden', code: 'STEP_UP_REQUIRED' });
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
