/**
 * PCA-MYKIDS-BILL-2 -- family-facing commercial read + request-workflow HTTP
 * surface. Composes (never duplicates):
 *   - PCA-PA-2's EntitlementService/ChangeRequestService (entitlement +
 *     increase-request lifecycle),
 *   - PCA-BILL-1's SubscriptionRepository/PaymentMethodRepository +
 *     this lane's own FamilyInvoiceReadRepository (subscription/invoice/
 *     payment-method reads),
 *   - the ALREADY-EXISTING, ALREADY-family-scoped
 *     billingCheckoutRoutes.ts (checkout create/status) and
 *     entitlements/quote/PriceBookQuotePort.ts (standard-quote resolution,
 *     wired into ChangeRequestService by the composition root, not here).
 *
 * Checkout itself is deliberately NOT re-implemented or wrapped here:
 * billingCheckoutRoutes.ts's `POST /v1/families/:familyId/billing/checkout`
 * and `GET /v1/families/:familyId/billing/checkout/:paymentAttemptId`
 * already enforce family scope + (for CREATE) Family-Owner authority via
 * the identical `FamilyCommercialAuthorityResolver` this file also uses --
 * a thin wrapper here would add nothing but a second URL for the same
 * logic. See this lane's final report's CHECKOUT_REUSED field.
 *
 * AUTHORIZATION LAYERING:
 *   1. requireServiceSession -- a recognized service account. NEVER a
 *      Platform Admin token: platform-admin auth is validated by an
 *      entirely separate PlatformAdminAuthService/token namespace/plugin
 *      and is therefore structurally unable to pass this check.
 *   2. createRequireFamilyCommercialAuthorization(authzRepository, operation)
 *      (familycommercial/authorization.ts) -- this account holds an ACTIVE
 *      family-scope row for :familyId. See that file's own header for why
 *      this is a NEW, small, closed operation vocabulary evaluated
 *      directly against the same AuthzRepository port
 *      `createRequireFamilyAuthorization` (http/requireFamilyAuthorization.ts)
 *      itself reads from, rather than an edit to that helper's own closed
 *      `ServiceOperation` union (authz/types.ts) / `OPERATION_MATRIX`
 *      (authz/policy.ts) -- both outside this lane's ownership boundary.
 *   3. FOR MUTATIONS ONLY (create/cancel a request): the SAME
 *      FamilyCommercialAuthorityResolver OWNER gate billingCheckoutRoutes.ts
 *      established (FIX 4) -- resolved BEFORE any service call.
 *      ROLE_DENIED and AUTHORITY_UNAVAILABLE both 403 (distinguishably),
 *      and NEITHER is ever treated as "is Owner." Reads (entitlement/
 *      requests list+detail/subscription/invoices/payment methods) do NOT
 *      require the OWNER gate -- viewing one's own family's already-
 *      existing commercial state is not itself a new commercial
 *      commitment, mirroring billingCheckoutRoutes.ts's own
 *      VIEW_OWN_BILLING_STATUS judgment call.
 *   4. A device-limit (billable) increase request additionally requires an
 *      active license -- both limit types share ONE create route
 *      (matching Agent46's own single `requestLimitIncrease(limitType,
 *      targetLimit)` client method), so this is an inline check against
 *      `AuthzRepository.hasActiveLicense`, performed only for
 *      `MANAGED_DEVICE_LIMIT`, mirroring INITIATE_CHECKOUT's license
 *      requirement shape (authz/policy.ts) for the identical underlying
 *      reason.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzRepository } from '../../authz/AuthzRepository.js';
import { createRateLimiter } from '../rateLimit.js';
import { checkOwnerAuthority, createRequireFamilyCommercialAuthorization, isValidActorDeviceId } from '../../familycommercial/authorization.js';
import type { FamilyCommercialAuthorityResolver } from '../../billing/authority/FamilyCommercialAuthorityResolver.js';
import { FamilyCommercialError, FamilyCommercialService } from '../../familycommercial/FamilyCommercialService.js';
import type { LimitType } from '../../entitlements/types.js';
import {
  changeRequestToJson,
  entitlementReadModelToJson,
  invoiceToJson,
  paymentMethodToJson,
  subscriptionToJson,
} from '../../familycommercial/dto.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_INVOICE_ID_LENGTH = 128;
const MAX_MARKET_LENGTH = 32;
const MAX_CURRENCY_LENGTH = 8;
/** Hard upper bound on a client-requested target -- a sanity ceiling, never the source of "what targets are allowed" (that is ChangeRequestService's own > current-limit check + whatever PriceBook/custom-quote coverage exists). Prevents a pathological integer from reaching the DB layer. */
const MAX_TARGET_LIMIT = 100_000;

export interface FamilyCommercialRoutesDeps {
  familyCommercialService: FamilyCommercialService;
  authService: AuthService;
  authzRepository: AuthzRepository;
  familyCommercialAuthorityResolver: FamilyCommercialAuthorityResolver;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLimitType(value: unknown): value is LimitType {
  return value === 'MANAGED_DEVICE_LIMIT' || value === 'PARENT_MEMBER_LIMIT';
}

function familyCommercialErrorToHttpStatus(code: FamilyCommercialError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'CROSS_FAMILY':
      return 404;
    case 'INVALID_TARGET':
    case 'INVALID_MARKET':
    case 'INVALID_CURRENCY':
      return 400;
    case 'INVALID_STATE':
      return 409;
  }
}

export function registerFamilyCommercialRoutes(app: FastifyInstance, deps: FamilyCommercialRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);
  const svc = deps.familyCommercialService;
  const requireViewEntitlement = createRequireFamilyCommercialAuthorization(deps.authzRepository, 'VIEW_ENTITLEMENT');
  const requireMutateRequests = createRequireFamilyCommercialAuthorization(deps.authzRepository, 'MUTATE_REQUESTS');
  const requireViewBillingRecords = createRequireFamilyCommercialAuthorization(deps.authzRepository, 'VIEW_BILLING_RECORDS');

  /** Shared inline Owner-authority gate for every mutation route -- see this file's header. */
  function resolveOwnerOrReject(reply: FastifyReply, familyId: string, actorDeviceId: unknown): boolean {
    if (!isValidActorDeviceId(actorDeviceId)) {
      reply.code(400).send({ error: 'invalid_request' });
      return false;
    }
    const outcome = checkOwnerAuthority(deps.familyCommercialAuthorityResolver, familyId, actorDeviceId);
    if (!outcome.authorized) {
      if (outcome.denialStatus === 'AUTHORITY_UNAVAILABLE') {
        reply.code(403).send({ error: 'forbidden', code: 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE' });
      } else {
        reply.code(403).send({ error: 'forbidden' });
      }
      return false;
    }
    return true;
  }

  // -- A. Entitlement read ---------------------------------------------------
  app.get(
    '/v1/families/:familyId/commercial/entitlement',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewEntitlement] },
    async (request: FastifyRequest) => {
      const { familyId } = request.params as { familyId: string };
      const model = await svc.getEntitlement(familyId);
      return entitlementReadModelToJson(model);
    },
  );

  // -- B. Request list / detail -----------------------------------------------
  app.get(
    '/v1/families/:familyId/commercial/requests',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewEntitlement] },
    async (request: FastifyRequest) => {
      const { familyId } = request.params as { familyId: string };
      const records = await svc.listRequests(familyId);
      return { requests: records.map(changeRequestToJson) };
    },
  );

  app.get(
    '/v1/families/:familyId/commercial/requests/:requestId',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewEntitlement] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, requestId } = request.params as { familyId: string; requestId: string };
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const record = await svc.getRequest(familyId, requestId);
        return changeRequestToJson(record);
      } catch (error) {
        if (error instanceof FamilyCommercialError) return reply.code(familyCommercialErrorToHttpStatus(error.code)).send({ error: 'not_found' });
        throw error;
      }
    },
  );

  // -- C/D. Create increase request (managed-device: billable; parent-member: never billable) --
  app.post(
    '/v1/families/:familyId/commercial/requests',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.authAttemptLimiter, requireServiceSession, deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'family-commercial-request-create' }), requireMutateRequests],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { limitType, targetLimit, commercialMarket, currencyCode, actorDeviceId } = body;
      if (!isLimitType(limitType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof targetLimit !== 'number' || !Number.isInteger(targetLimit) || targetLimit < 0 || targetLimit > MAX_TARGET_LIMIT) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (commercialMarket !== undefined && (typeof commercialMarket !== 'string' || commercialMarket.length === 0 || commercialMarket.length > MAX_MARKET_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (currencyCode !== undefined && (typeof currencyCode !== 'string' || currencyCode.length === 0 || currencyCode.length > MAX_CURRENCY_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!resolveOwnerOrReject(reply, familyId, actorDeviceId)) return;

      // See this file's header (item 4): only the billable managed-device
      // path requires an active license -- checked here, inline, against
      // the same AuthzRepository primitive requireMutateRequests already
      // used for the family-scope check above.
      if (limitType === 'MANAGED_DEVICE_LIMIT') {
        const accountId = request.accountId as string;
        const hasLicense = await deps.authzRepository.hasActiveLicense(accountId, new Date());
        if (!hasLicense) return reply.code(403).send({ error: 'forbidden' });
      }

      try {
        const record =
          limitType === 'MANAGED_DEVICE_LIMIT'
            ? await svc.createDeviceIncreaseRequest({ familyId, limitType, targetLimit, commercialMarket: commercialMarket as string | undefined, currencyCode: currencyCode as string | undefined })
            : await svc.createParentMemberIncreaseRequest({ familyId, limitType, targetLimit, commercialMarket: commercialMarket as string | undefined, currencyCode: currencyCode as string | undefined });
        return reply.code(201).send(changeRequestToJson(record));
      } catch (error) {
        if (error instanceof FamilyCommercialError) return reply.code(familyCommercialErrorToHttpStatus(error.code)).send({ error: 'invalid_request', code: error.code });
        throw error;
      }
    },
  );

  // -- E. Cancel eligible request -----------------------------------------------
  app.post(
    '/v1/families/:familyId/commercial/requests/:requestId/cancel',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.authAttemptLimiter, requireServiceSession, deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'family-commercial-cancel-request' }), requireMutateRequests],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, requestId } = request.params as { familyId: string; requestId: string };
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;
      const actorDeviceId = isPlainObject(body) ? body.actorDeviceId : undefined;
      if (!resolveOwnerOrReject(reply, familyId, actorDeviceId)) return;
      try {
        const record = await svc.cancelRequest(familyId, requestId);
        return changeRequestToJson(record);
      } catch (error) {
        if (error instanceof FamilyCommercialError) return reply.code(familyCommercialErrorToHttpStatus(error.code)).send({ error: 'cancel_failed', code: error.code });
        throw error;
      }
    },
  );

  // -- F. Subscription read ---------------------------------------------------
  app.get(
    '/v1/families/:familyId/commercial/subscription',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewBillingRecords] },
    async (request: FastifyRequest) => {
      const { familyId } = request.params as { familyId: string };
      const subscription = await svc.getSubscription(familyId);
      return subscriptionToJson(subscription);
    },
  );

  // -- G. Invoice read ----------------------------------------------------------
  app.get(
    '/v1/families/:familyId/commercial/invoices',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewBillingRecords] },
    async (request: FastifyRequest) => {
      const { familyId } = request.params as { familyId: string };
      // N+1 line lookups are acceptable here: a family's own invoice count
      // is small and this is a read-only, rate-limited, family-scoped
      // listing, not a hot path -- matches this lane's "compose, don't
      // over-engineer" scope.
      const withLines = await svc.listInvoicesWithLines(familyId);
      return { invoices: withLines.map(({ invoice, lines }) => invoiceToJson(invoice, lines)) };
    },
  );

  app.get(
    '/v1/families/:familyId/commercial/invoices/:invoiceId',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewBillingRecords] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, invoiceId } = request.params as { familyId: string; invoiceId: string };
      if (typeof invoiceId !== 'string' || invoiceId.length === 0 || invoiceId.length > MAX_INVOICE_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const { invoice, lines } = await svc.getInvoice(familyId, invoiceId);
        return invoiceToJson(invoice, lines);
      } catch (error) {
        if (error instanceof FamilyCommercialError) return reply.code(familyCommercialErrorToHttpStatus(error.code)).send({ error: 'not_found' });
        throw error;
      }
    },
  );

  // -- H. Payment method read (safe metadata only) -------------------------------
  app.get(
    '/v1/families/:familyId/commercial/payment-methods',
    { preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewBillingRecords] },
    async (request: FastifyRequest) => {
      const { familyId } = request.params as { familyId: string };
      const methods = await svc.listPaymentMethods(familyId);
      return { paymentMethods: methods.map(paymentMethodToJson) };
    },
  );
}
