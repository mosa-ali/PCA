/**
 * PCA-BILL-2A -- family-facing checkout HTTP surface.
 *
 * PCA-BILL-2A-R1 CORRECTION (FIX 4: family owner authority): the original
 * version of this route relied SOLELY on `createRequireFamilyAuthorization`,
 * this codebase's only reachable family-plane HTTP authorization primitive
 * -- it answers exactly "does this service account hold an ACTIVE
 * family-scope row for this family", with no Family-Owner-vs-
 * Administrator-vs-Viewer distinction. The checkout-CREATE route (not the
 * read-only status route -- a family member merely viewing their own
 * already-created checkout's status is not itself a new commercial
 * commitment, so this lane judges VIEW_OWN_BILLING_STATUS does not need
 * the same OWNER gate) now additionally requires a caller-supplied
 * `actorDeviceId` and resolves OWNER authority through an injected
 * `FamilyCommercialAuthorityResolver`
 * (billing/authority/FamilyCommercialAuthorityResolver.ts) before
 * proceeding.
 *
 * PRODUCTION POSTURE (see main.ts wiring): the resolver is now the
 * attestation-chain adapter with active-key registry checks, but production
 * still injects `RejectingDeviceSignatureVerifier`, and this legacy route
 * still supplies only actorDeviceId. The R1 engine rejects both conditions
 * fail-closed, so checkout-CREATE remains 403 until the reviewed verifier and
 * session-bound request-proof route integration are separately approved.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import { CheckoutError, type CheckoutService } from '../../billing/checkout/CheckoutService.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { FamilyCommercialAuthorityResolver } from '../../billing/authority/FamilyCommercialAuthorityResolver.js';
import type { FamilyAuthorityRequestProof } from '../../familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { digestAuthorityRequestBody } from '../../familycommercial/authority/requestProofProtocol.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_PROVIDER_NAME_LENGTH = 32;
const MAX_RETURN_URL_LENGTH = 2048;
const MAX_PAYMENT_ATTEMPT_ID_LENGTH = 64;
const MAX_ACTOR_DEVICE_ID_LENGTH = 128;

export interface BillingCheckoutRoutesDeps {
  checkoutService: CheckoutService;
  authService: AuthService;
  authzService: AuthzService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
  /** FIX 4: injected so production (see main.ts) can wire the fail-closed default while tests can wire a real resolver against a fake trust set. */
  familyCommercialAuthorityResolver: FamilyCommercialAuthorityResolver;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authorityProofForRequest(body: Record<string, unknown>, familyId: string, operation: string): FamilyAuthorityRequestProof | null {
  const raw = body.authorityProof;
  const actorDeviceId = body.actorDeviceId;
  if (!isPlainObject(raw) || typeof actorDeviceId !== 'string' || raw.deviceId !== actorDeviceId) return null;
  if (
    raw.protocolVersion !== 1 || raw.operation !== operation || raw.familyId !== familyId ||
    typeof raw.serviceAccountId !== 'string' || typeof raw.deviceId !== 'string' || typeof raw.keyId !== 'string' ||
    typeof raw.publicKey !== 'string' || typeof raw.challengeId !== 'string' || typeof raw.nonce !== 'string' ||
    typeof raw.requestDigest !== 'string' || typeof raw.signature !== 'string' ||
    typeof raw.issuedAt !== 'string' || typeof raw.expiresAt !== 'string'
  ) return null;
  const unsignedBody = { ...body };
  delete unsignedBody.authorityProof;
  if (raw.requestDigest !== digestAuthorityRequestBody(JSON.stringify(unsignedBody))) return null;
  const issuedAt = new Date(raw.issuedAt);
  const expiresAt = new Date(raw.expiresAt);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) return null;
  return { ...raw, issuedAt, expiresAt } as FamilyAuthorityRequestProof;
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
      const { requestId, provider, returnUrl, actorDeviceId } = body;
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (provider !== undefined && (typeof provider !== 'string' || provider.length === 0 || provider.length > MAX_PROVIDER_NAME_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (returnUrl !== undefined && (typeof returnUrl !== 'string' || returnUrl.length === 0 || returnUrl.length > MAX_RETURN_URL_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof actorDeviceId !== 'string' || actorDeviceId.length === 0 || actorDeviceId.length > MAX_ACTOR_DEVICE_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const authorityProof = authorityProofForRequest(body, familyId, 'BILLING_CHECKOUT_CREATE');
      if (!authorityProof) return reply.code(400).send({ error: 'invalid_request' });

      // FIX 4: Family-Owner-only gate. Resolved BEFORE any checkout
      // orchestration runs -- an Administrator/Viewer-scoped (or
      // authority-unresolvable) caller never reaches CheckoutService at
      // all.
      //
      // The production candidate performs a real DB read + live signature
      // re-verification per call. Until this route carries a session-bound,
      // single-use request proof, the resolver receives only an identifier
      // and returns INVALID_PROOF; no checkout orchestration is reached.
      const authority = await deps.familyCommercialAuthorityResolver.resolveOwnerAuthority(
        familyId,
        actorDeviceId,
        authorityProof,
        request.accountId as string,
        'BILLING_CHECKOUT_CREATE',
        authorityProof.requestDigest,
      );
      if (authority.status === 'ROLE_DENIED') {
        // Same "one generic reason" discipline as AuthzError/
        // ParentActionAuthorizationService's CROSS_FAMILY_TARGET -- never
        // leak which role the caller actually holds.
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (authority.status === 'AUTHORITY_UNAVAILABLE' || authority.status === 'STALE_OR_REVOKED' || authority.status === 'INVALID_PROOF') {
        // Distinguishable on purpose (an operational/availability signal,
        // not an identity-enumeration risk) -- see this file's header.
        // All three collapse to the SAME wire code deliberately: none of
        // them is a determined-and-wrong role, and the caller must never
        // learn which one occurred.
        return reply.code(403).send({ error: 'forbidden', code: 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE' });
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
