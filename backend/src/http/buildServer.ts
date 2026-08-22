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
import { registerParentWebCors } from './parentWebCors.js';
import { registerInvitationRoutes } from './routes/invitationRoutes.js';
import { registerBootstrapRoutes } from './routes/bootstrapRoutes.js';
import { registerPairingRoutes } from './routes/pairingRoutes.js';
import { registerBrowserEndpointRoutes } from './routes/browserEndpointRoutes.js';
import type { BrowserEndpointService } from '../device/BrowserEndpointService.js';
import { registerRuntimeSyncRoutes, type ResolveEnvelopeContext, type ProtectionStatusAlerting } from './routes/runtimeSyncRoutes.js';
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
// PCA-PA-3B: Platform Administration operational/commercial API -- a fifth
// structurally independent surface exposing existing PCA-PA-2/PCA-BILL-1/
// PCA-PA-1 domains through Platform-Admin-authenticated read models and
// routes. This lane does not self-register (see its own index.ts header);
// wired here exactly like every other domain's registerXRoutes call.
import { registerPlatformAdminOperationalRoutes } from './routes/platformadmin/index.js';
import type { PlatformAdminAccountService } from '../platformadmin/auth/PlatformAdminAccountService.js';
import type { PlatformAdminEntitlementService } from '../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import type { ChangeRequestRepository } from '../entitlements/requests/ChangeRequestRepository.js';
import type { EntitlementRepository } from '../entitlements/EntitlementRepository.js';
import type { PriceBookService } from '../billing/priceBook.js';
import type { PlanService } from '../billing/plan.js';
// PCA-MYKIDS-BILL-2: family-facing commercial read/request-workflow API --
// composes PCA-PA-2/PCA-BILL-1 exactly like billingCheckoutRoutes.ts
// already does; reuses the SAME FamilyCommercialAuthorityResolver.
import { registerFamilyCommercialRoutes } from './routes/familyCommercialRoutes.js';
import type { FamilyCommercialService } from '../familycommercial/FamilyCommercialService.js';
import type { ComplimentaryEntitlementService } from '../entitlements/complimentary/ComplimentaryEntitlementService.js';
// PCA-AUTH-SESSION-1 (PCA-DEC-026): browser-reachable parent/family
// identity + FAMILY_SERVICE_SESSION_V1 cookie-session issuance. A sixth
// structurally independent surface, registered exactly like every other
// domain's registerXRoutes call -- see parentAccountRoutes.ts's own header
// for why its session token is compatible with, not a replacement for,
// the existing Bearer-header requireServiceSession (fastifyAuthPlugin.ts).
import { registerParentAccountRoutes } from './routes/parentAccountRoutes.js';
import type { ParentAccountService } from '../parentaccount/ParentAccountService.js';
// PCA-ADD-ENR-012/016/017/018/020: consolidated removal/disable decision
// authority HTTP surface -- a seventh structurally independent surface,
// registered exactly like every other domain's registerXRoutes call. See
// removalDecisionRoutes.ts's own header for why it was not previously wired.
import { registerRemovalDecisionRoutes, type ProtectiveAuthorityResolver } from './routes/removalDecisionRoutes.js';
import type { RemovalDecisionAuthority } from '../familyrbac/RemovalDecisionAuthority.js';
import type { DeviceProtectionStatusRepository } from '../device/DeviceProtectionStatusRepository.js';
import type { AdministrationPinService } from '../enrollment/AdministrationPinService.js';
// PCA-COMPLIMENTARY-ENTITLEMENTS-1: durable, audited complimentary
// entitlement grants (Round5 Owner decision, Addendum 004). Registered
// here exactly like every other domain's registerXRoutes call; never
// creates Invoice/PaymentAttempt/PaymentTransaction/ProviderEvent, never
// touches PriceBook.
import { registerComplimentaryGrantRoutes } from './routes/platformadmin/complimentaryGrantRoutes.js';
import type { PlatformAdminComplimentaryGrantService } from '../platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
// PCA-FREE-ACCESS-1 (Round6): real backend enforcement/admin surface for
// FreeAccessSnapshot. Registered here exactly like every other domain's
// registerXRoutes call.
import { registerFreeAccessAdminRoutes } from './routes/platformadmin/freeAccessAdminRoutes.js';
import type { FreeAccessAccountRepository } from '../parentaccount/freeaccess/FreeAccessAccountRepository.js';
import type { FreeAccessAdminService } from '../parentaccount/freeaccess/FreeAccessAdminService.js';
// PCA-BILL-3 (Round6): Settlement / Reconciliation. Registered here
// exactly like every other domain's registerXRoutes call.
import { registerSettlementRoutes } from './routes/platformadmin/settlementRoutes.js';
import { registerSdkDisclosureRoutes } from './routes/sdkDisclosureRoutes.js';
import type { PlatformAdminSettlementService } from '../platformadmin/settlement/PlatformAdminSettlementService.js';
import type { ParentPreferenceRepository } from '../parentaccount/ParentPreferenceRepository.js';
import type { SafeZoneRepository } from '../location/SafeZoneRepository.js';
import type { SafeZonePolicyAuthorizer } from '../location/SafeZonePolicyAuthorization.js';
// PCA-FR-130 (Bonus Time): an eighth structurally independent surface,
// registered exactly like every other domain's registerXRoutes call --
// reuses the SAME deviceSessionService instance already wired above (never
// a second, independently-constructed copy) for its actor-device binding.
import { registerChildRequestRoutes } from './routes/childRequestRoutes.js';
import type { ChildRequestService } from '../childrequests/ChildRequestService.js';
import type { BonusGrantLedger } from '../childrequests/BonusGrantLedger.js';
import type { ChildProfileMembershipResolver } from '../childprofiles/ChildProfileMembershipResolver.js';

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
  /** PCA-PA-3B: Platform Administration operational/commercial API -- see registerPlatformAdminOperationalRoutes below. */
  platformAdminAccountService: PlatformAdminAccountService;
  platformAdminEntitlementService: PlatformAdminEntitlementService;
  changeRequestRepository: ChangeRequestRepository;
  entitlementRepository: EntitlementRepository;
  priceBookService: PriceBookService;
  planService: PlanService;
  /** PCA-MYKIDS-BILL-2: family-facing commercial API -- see registerFamilyCommercialRoutes below. */
  familyCommercialService: FamilyCommercialService;
  /** PCA-AUTH-SESSION-1: browser-reachable parent identity + session issuance -- see registerParentAccountRoutes below. */
  parentAccountService: ParentAccountService;
  parentPreferenceRepository?: ParentPreferenceRepository;
  safeZoneRepository?: SafeZoneRepository;
  safeZonePolicyAuthorizer?: SafeZonePolicyAuthorizer;
  /** PCA-COMPLIMENTARY-ENTITLEMENTS-1: complimentary entitlement grants -- see registerComplimentaryGrantRoutes below. */
  platformAdminComplimentaryGrantService: PlatformAdminComplimentaryGrantService;
  /** PCA-COMPLIMENTARY-CONSUMPTION-1 (Round6): plain domain service composed into familyCommercialRoutes.ts's additive entitlement fields -- optional, see that route's own doc comment. */
  complimentaryEntitlementService?: ComplimentaryEntitlementService;
  /** PCA-FREE-ACCESS-1: real backend enforcement/admin surface -- see registerParentAccountRoutes/registerFreeAccessAdminRoutes below. */
  freeAccessAccountRepository: FreeAccessAccountRepository;
  freeAccessAdminService: FreeAccessAdminService;
  /** PCA-BILL-3: Settlement / Reconciliation -- see registerSettlementRoutes below. */
  platformAdminSettlementService: PlatformAdminSettlementService;
  /** PCA-ADD-ENR-012/016/017/018/020: consolidated removal/disable decision authority -- see registerRemovalDecisionRoutes below. */
  removalDecisionAuthority: RemovalDecisionAuthority;
  protectiveAuthorityResolver?: ProtectiveAuthorityResolver;
  /** PCA-ADD-ENR-012: family-scoped offline Administration PIN status/configuration -- see registerRemovalDecisionRoutes below. */
  administrationPinService?: AdministrationPinService;
  /** PCA-ADD-ENR-016/PCA-FR-145: see registerRuntimeSyncRoutes' own doc comment and RealProtectiveAuthorityResolver.ts. */
  deviceProtectionStatusRepository?: DeviceProtectionStatusRepository;
  /** PCA-ADD-ENR-020: see registerRuntimeSyncRoutes' own ProtectionStatusAlerting doc comment. */
  protectionStatusAlerting?: ProtectionStatusAlerting;
  /** PCA-FR-063: optional -- when supplied, POST /v1/families/:familyId/browser-endpoints is registered. See browserEndpointRoutes.ts's own doc comment. */
  browserEndpointService?: BrowserEndpointService;
  /** PCA-FR-130 (Bonus Time): see registerChildRequestRoutes below. */
  childRequestService: ChildRequestService;
  bonusGrantLedger: BonusGrantLedger;
  /**
   * PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION: passed straight through to
   * registerChildRequestRoutes' own `childProfileMembership` dep -- see that file's doc comment.
   * Optional here purely so existing test callers of buildServer that don't exercise the
   * bonus-time ledger routes need no change; registerChildRequestRoutes itself still defaults to
   * the SAME fail-closed UnavailableChildProfileMembershipResolver when this is omitted.
   */
  childProfileMembership?: ChildProfileMembershipResolver;
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
  registerParentWebCors(app);
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
  registerBrowserEndpointRoutes(app, {
    browserEndpointService: deps.browserEndpointService,
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
    deviceProtectionStatusRepository: deps.deviceProtectionStatusRepository,
    protectionStatusAlerting: deps.protectionStatusAlerting,
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
  registerPlatformAdminOperationalRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminAccountService: deps.platformAdminAccountService,
    platformAdminEntitlementService: deps.platformAdminEntitlementService,
    changeRequestRepository: deps.changeRequestRepository,
    entitlementRepository: deps.entitlementRepository,
    priceBookService: deps.priceBookService,
    planService: deps.planService,
    rateLimiter,
  });
  registerFamilyCommercialRoutes(app, {
    familyCommercialService: deps.familyCommercialService,
    authService: deps.authService,
    authzRepository: deps.authzRepository,
    familyCommercialAuthorityResolver: deps.billingFamilyCommercialAuthorityResolver,
    rateLimiter,
    authAttemptLimiter,
    complimentaryEntitlementService: deps.complimentaryEntitlementService,
  });
  registerParentAccountRoutes(app, {
    parentAccountService: deps.parentAccountService,
    parentPreferenceRepository: deps.parentPreferenceRepository,
    safeZoneRepository: deps.safeZoneRepository,
    safeZonePolicyAuthorizer: deps.safeZonePolicyAuthorizer,
    // PCA-234C026: without this, Safe Zone routes' actor-identity binding
    // (authorizeSafeZoneRequest) fails closed with 503
    // family_authority_unavailable rather than trusting the spoofable
    // x-pca-actor-device-id header -- see DeviceSessionService.
    // requireActorDeviceInFamily's doc comment and this dependency's own
    // doc comment in parentAccountRoutes.ts.
    deviceSessionService: deps.deviceSessionService,
    freeAccessAccountRepository: deps.freeAccessAccountRepository,
  });
  registerRemovalDecisionRoutes(app, {
    parentAccountService: deps.parentAccountService,
    removalDecisionAuthority: deps.removalDecisionAuthority,
    protectiveAuthorityResolver: deps.protectiveAuthorityResolver,
    administrationPinService: deps.administrationPinService,
  });
  registerComplimentaryGrantRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminComplimentaryGrantService: deps.platformAdminComplimentaryGrantService,
    rateLimiter,
  });
  registerFreeAccessAdminRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    freeAccessAdminService: deps.freeAccessAdminService,
    rateLimiter,
  });
  registerSettlementRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminSettlementService: deps.platformAdminSettlementService,
    rateLimiter,
  });
  registerSdkDisclosureRoutes(app, { rateLimiter });
  registerChildRequestRoutes(app, {
    parentAccountService: deps.parentAccountService,
    childRequestService: deps.childRequestService,
    bonusGrantLedger: deps.bonusGrantLedger,
    deviceSessionService: deps.deviceSessionService,
    childProfileMembership: deps.childProfileMembership,
  });

  return app;
}
