import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import type { AuthService } from '../auth/AuthService.js';
import type { AuthzService } from '../authz/AuthzService.js';
import type { InvitationService } from '../invitation/InvitationService.js';
import type { EnrollmentCoordinator } from '../enrollment/EnrollmentCoordinator.js';
import type { PairingService } from '../pairing/PairingService.js';
import type { DeviceSessionService } from '../runtime-sync/DeviceSessionService.js';
import type { OutboundRelayService } from '../runtime-sync/OutboundRelayService.js';
import type { InboundReconnectService } from '../runtime-sync/InboundReconnectService.js';
import type { DeviceSyncStatusTracker } from '../runtime-sync/StatusService.js';
import { createRateLimiter } from './rateLimit.js';
import { registerInvitationRoutes } from './routes/invitationRoutes.js';
import { registerBootstrapRoutes } from './routes/bootstrapRoutes.js';
import { registerPairingRoutes } from './routes/pairingRoutes.js';
import { registerRuntimeSyncRoutes, type ResolveEnvelopeContext } from './routes/runtimeSyncRoutes.js';
import { registerRetentionRoutes } from './routes/retentionRoutes.js';
import type { AuthzRepository } from '../authz/AuthzRepository.js';
import type { DeleteNowLedger } from '../retention/DeleteNowLedger.js';
import type { FamilyAuditService } from '../familyrbac/FamilyAuditStore.js';
// PCA-PA-1: PCA Platform Administration -- a structurally independent
// third plane (see backend/src/platformadmin/'s own module comments and
// migrations/0005_platform_admin_identity_rbac_audit.sql). Registered here
// only as a route-registration call, exactly like every other domain's
// registerXRoutes below -- no other part of this file is touched.
import { registerPlatformAdminAuthRoutes } from './routes/platformAdminAuthRoutes.js';
import type { PlatformAdminAuthService } from '../platformadmin/auth/PlatformAdminAuthService.js';
// PCA-BILL-2A: payment orchestration (checkout/webhook/refund) -- a fourth
// structurally independent surface layered ON TOP OF PCA-PA-1 (identity/
// RBAC/audit), PCA-PA-2 (entitlements), and PCA-BILL-1 (billing core
// domain entities), never modifying any of their accepted source files.
// Registered here exactly like every other domain's registerXRoutes call.
import { registerBillingCheckoutRoutes } from './routes/billingCheckoutRoutes.js';
import { registerBillingWebhookRoutes } from './routes/billingWebhookRoutes.js';
import { registerBillingRefundRoutes } from './routes/billingRefundRoutes.js';
import type { CheckoutService } from '../billing/checkout/CheckoutService.js';
import type { WebhookService } from '../billing/webhook/WebhookService.js';
import type { RefundOrchestrationService } from '../billing/refundOrchestration/RefundOrchestrationService.js';
import type { PaymentRepository } from '../billing/payment.js';
import type { PaymentProviderRegistry } from '../billing/provider/providerRegistry.js';
import type { PlatformAdminAuditService } from '../platformadmin/audit/PlatformAdminAuditService.js';
// PCA-BILL-2A-R1 correction FIX 4: family owner authority gate for
// checkout-CREATE -- see billingCheckoutRoutes.ts/FamilyCommercialAuthorityResolver.ts.
import type { FamilyCommercialAuthorityResolver } from '../billing/authority/FamilyCommercialAuthorityResolver.js';
// PCA-COMMERCIAL-NOTIFY-1: durable commercial-notification event/read model
// -- a structurally independent surface layered on top of the family
// service-session/AuthzService plane and Platform Administration (for its
// Section 7 support view), never modifying any of their accepted source
// files beyond this registration call and the additive
// VIEW_OWN_NOTIFICATIONS/ACKNOWLEDGE_OWN_NOTIFICATION ServiceOperation
// members (authz/types.ts, authz/policy.ts). Registered here exactly like
// every other domain's registerXRoutes call.
import { registerCommercialNotificationRoutes } from './routes/commercialNotificationRoutes.js';
import type { CommercialNotificationService, CommercialNotificationSupportService } from '../commercialnotifications/CommercialNotificationService.js';

export interface ServerDependencies {
  authService: AuthService;
  authzService: AuthzService;
  authzRepository: AuthzRepository;
  invitationService: InvitationService;
  enrollmentCoordinator: EnrollmentCoordinator;
  pairingService: PairingService;
  deviceSessionService: DeviceSessionService;
  outboundRelayService: OutboundRelayService;
  inboundReconnectService: InboundReconnectService;
  statusTracker: DeviceSyncStatusTracker;
  resolveEnvelopeContext: ResolveEnvelopeContext;
  deleteNowLedger: DeleteNowLedger;
  familyAuditService: FamilyAuditService;
  /** PCA-PA-1: independent Platform Administration auth plane -- see registerPlatformAdminAuthRoutes below. */
  platformAdminAuthService: PlatformAdminAuthService;
  /** PCA-BILL-2A: payment orchestration -- see registerBillingCheckoutRoutes/registerBillingWebhookRoutes/registerBillingRefundRoutes below. */
  billingCheckoutService: CheckoutService;
  billingWebhookService: WebhookService;
  billingProviderRegistry: PaymentProviderRegistry;
  billingRefundOrchestrationService: RefundOrchestrationService;
  billingPaymentRepository: PaymentRepository;
  billingAuditService: PlatformAdminAuditService;
  /** FIX 4 (see FamilyCommercialAuthorityResolver.ts): production wiring (main.ts) is UnavailableFamilyCommercialAuthorityResolver -- fail-closed until a genuine server-side trust-set source exists. */
  billingFamilyCommercialAuthorityResolver: FamilyCommercialAuthorityResolver;
  /** PCA-COMMERCIAL-NOTIFY-1: durable commercial notifications -- see registerCommercialNotificationRoutes below. */
  commercialNotificationService: CommercialNotificationService;
  commercialNotificationSupportService: CommercialNotificationSupportService;
}

/**
 * Explicit dependency composition -- no route module instantiates its own
 * repository, service, or database connection. Production wiring
 * constructs real MySQL-backed services and passes them here; tests
 * pass differently-backed (or in-memory) services through the same shape.
 *
 * The reviewed Secure Invite/pairing surface, and the PCA-16 runtime-sync
 * surface (its own device-session authentication -- see
 * runtime-sync/DeviceSessionService.ts), are registered here. Recovery and
 * family policy/control routes remain unexposed until their own distinct
 * authentication/authorization requirements are implemented.
 */
export function buildServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  const rateLimiter = createRateLimiter();
  // Bounds how many session-validation DB round-trips a single IP can force
  // by flooding well-formed-looking-but-invalid bearer tokens, independent
  // of whether the token is ever valid. Applied before requireServiceSession
  // on every authenticated route, in addition to (not instead of) each
  // route's own narrower abuse budget.
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 60, bucket: 'auth-attempt' });

  // Every unhandled exception (a bug, a MySQL outage, an unmapped driver
  // error) must never reach the client as a raw error.message -- that can
  // carry DB hosts/ports, constraint names, or internal invariant text.
  // Ordinary 4xx errors Fastify itself generates (oversized body, malformed
  // JSON) are safe to describe generically; every genuine 5xx collapses to
  // one fixed, non-informative body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      reply.code(500).send({ error: 'internal_error' });
      return;
    }
    reply.code(statusCode).send({ error: 'invalid_request' });
  });

  app.get('/health', async () => ({ service: 'pca-backend', status: 'ok' }));

  // Verifies DB connectivity only -- never exposes hostname, username,
  // password, connection string, or any table content in the response.
  app.get('/health/db', async (_request, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch {
      reply.code(503);
      return { status: 'error', database: 'unavailable' };
    }
  });

  registerInvitationRoutes(app, {
    invitationService: deps.invitationService,
    authService: deps.authService,
    authzService: deps.authzService,
    rateLimiter,
    authAttemptLimiter,
  });
  registerBootstrapRoutes(app, {
    enrollmentCoordinator: deps.enrollmentCoordinator,
    rateLimiter,
  });
  registerPairingRoutes(app, {
    pairingService: deps.pairingService,
    authService: deps.authService,
    authzService: deps.authzService,
    rateLimiter,
    authAttemptLimiter,
  });
  registerRuntimeSyncRoutes(app, {
    deviceSessionService: deps.deviceSessionService,
    outboundRelayService: deps.outboundRelayService,
    inboundReconnectService: deps.inboundReconnectService,
    statusTracker: deps.statusTracker,
    resolveEnvelopeContext: deps.resolveEnvelopeContext,
    rateLimiter,
    authAttemptLimiter,
  });
  registerRetentionRoutes(app, {
    authService: deps.authService,
    authzRepository: deps.authzRepository,
    deleteNowLedger: deps.deleteNowLedger,
    auditService: deps.familyAuditService,
    rateLimiter,
    authAttemptLimiter,
  });
  registerPlatformAdminAuthRoutes(app, {
    authService: deps.platformAdminAuthService,
    rateLimiter,
  });
  registerBillingCheckoutRoutes(app, {
    checkoutService: deps.billingCheckoutService,
    authService: deps.authService,
    authzService: deps.authzService,
    rateLimiter,
    authAttemptLimiter,
    familyCommercialAuthorityResolver: deps.billingFamilyCommercialAuthorityResolver,
  });
  registerBillingWebhookRoutes(app, {
    webhookService: deps.billingWebhookService,
    providerRegistry: deps.billingProviderRegistry,
    rateLimiter,
  });
  registerBillingRefundRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    providerRegistry: deps.billingProviderRegistry,
    refundOrchestrationService: deps.billingRefundOrchestrationService,
    paymentRepository: deps.billingPaymentRepository,
    auditService: deps.billingAuditService,
    rateLimiter,
  });
  registerCommercialNotificationRoutes(app, {
    commercialNotificationService: deps.commercialNotificationService,
    commercialNotificationSupportService: deps.commercialNotificationSupportService,
    authService: deps.authService,
    authzService: deps.authzService,
    platformAdminAuthService: deps.platformAdminAuthService,
    rateLimiter,
    authAttemptLimiter,
  });

  return app;
}
