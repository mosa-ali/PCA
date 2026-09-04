import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import type { AuthService } from '../auth/AuthService.js';
import type { AuthzService } from '../authz/AuthzService.js';
import type { InvitationService } from '../invitation/InvitationService.js';
import type { ChildProfileService } from '../childprofiles/ChildProfileService.js';
import type { EnrollmentCoordinator } from '../enrollment/EnrollmentCoordinator.js';
import type { PairingService } from '../pairing/PairingService.js';
import type { DeviceSessionService } from '../runtime-sync/DeviceSessionService.js';
import type { OutboundRelayService } from '../runtime-sync/OutboundRelayService.js';
import type { InboundReconnectService } from '../runtime-sync/InboundReconnectService.js';
import type { DeviceSyncStatusTracker } from '../runtime-sync/StatusService.js';
import { createRateLimiter } from './rateLimit.js';
import { registerParentWebCors } from './parentWebCors.js';
import { registerInvitationRoutes } from './routes/invitationRoutes.js';
import { registerChildProfileRoutes } from './routes/childProfileRoutes.js';
import { registerBootstrapRoutes } from './routes/bootstrapRoutes.js';
import { registerPairingRoutes } from './routes/pairingRoutes.js';
import { registerBrowserEndpointRoutes } from './routes/browserEndpointRoutes.js';
import type { BrowserEndpointService } from '../device/BrowserEndpointService.js';
import { registerRuntimeSyncRoutes, type ResolveEnvelopeContext, type ProtectionStatusAlerting } from './routes/runtimeSyncRoutes.js';
// PCA runtime-sync parent-facing read gap: PARENT-session-authenticated
// read-only counterpart to registerRuntimeSyncRoutes' DEVICE-authenticated
// status route -- see parentRuntimeSyncRoutes.ts's own header. Registered
// here exactly like every other domain's registerXRoutes call.
import { registerParentRuntimeSyncRoutes } from './routes/parentRuntimeSyncRoutes.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import type { RelayService } from '../relay/RelayService.js';
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
import type { ReleaseService } from '../release/ReleaseService.js';
import type { PaymentMethodService } from '../billing/paymentMethod.js';
import type { SubscriptionService } from '../billing/subscription.js';
import type { DisputeService } from '../billing/dispute.js';
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
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';
// PCA-FR-130 (Bonus Time): an eighth structurally independent surface,
// registered exactly like every other domain's registerXRoutes call --
// reuses the SAME deviceSessionService instance already wired above (never
// a second, independently-constructed copy) for its actor-device binding.
import { registerChildRequestRoutes } from './routes/childRequestRoutes.js';
import { registerChildPolicyRoutes } from './routes/childPolicyRoutes.js';
import type { ChildRequestService } from '../childrequests/ChildRequestService.js';
// PCA eye-protection reminders: a per-child, plaintext (never E2EE)
// enable/disable preference -- see eyeProtectionRoutes.ts's own header
// comment for why this is a reviewed exception to childPolicyRoutes.ts's
// "no new plaintext policy store" posture.
import { registerEyeProtectionRoutes } from './routes/eyeProtectionRoutes.js';
import type { EyeProtectionSettingsService } from '../eyeprotection/EyeProtectionSettingsService.js';
// WEB_RULE parent authoring: a per-family, plaintext (never E2EE) rule
// DEFINITION -- see webRuleRoutes.ts's own header comment for why this is
// the same reviewed exception eyeProtectionRoutes.ts already establishes,
// and why it never attempts the still-crypto-gated device-delivery step.
import { registerWebRuleRoutes } from './routes/webRuleRoutes.js';
import type { WebRuleService } from '../web/WebRuleStore.js';
import { registerFamilyMemberRoutes } from './routes/familyMemberRoutes.js';
import { registerFamilyAuditEventRoutes } from './routes/familyAuditEventRoutes.js';
import { registerProtectionAlertRoutes } from './routes/protectionAlertRoutes.js';
import type { FamilyMemberInvitationService } from '../familymembers/FamilyMemberInvitationService.js';
import type { FamilyAuditEventLedger } from '../familyrbac/FamilyAuditEventLedger.js';
import type { ProtectionAlertLedger } from '../alerts/ProtectionAlertLedger.js';
import type { BonusGrantLedger } from '../childrequests/BonusGrantLedger.js';
import type { ChildProfileMembershipResolver } from '../childprofiles/ChildProfileMembershipResolver.js';
// parentpanel family dashboard: a ninth structurally independent surface,
// registered exactly like every other domain's registerXRoutes call --
// see dashboardRoutes.ts's own header for why this is a plain
// parent-session read (no actor-device binding) unlike
// familyAuditEventRoutes.ts/protectionAlertRoutes.ts above.
import { registerDashboardRoutes } from './routes/dashboardRoutes.js';
import type { DashboardAggregatorService } from '../parentpanel/DashboardAggregatorService.js';

export interface ServerDependencies {
  authService: AuthService;
  authzService: AuthzService;
  authzRepository: AuthzRepository;
  invitationService: InvitationService;
  childProfileService: ChildProfileService;
  enrollmentCoordinator: EnrollmentCoordinator;
  pairingService: PairingService;
  deviceSessionService: DeviceSessionService;
  outboundRelayService: OutboundRelayService;
  inboundReconnectService: InboundReconnectService;
  statusTracker: DeviceSyncStatusTracker;
  resolveEnvelopeContext: ResolveEnvelopeContext;
  /**
   * PCA runtime-sync parent-facing read gap: see
   * registerParentRuntimeSyncRoutes below. Reuses the SAME deviceRepository/
   * relayService instances already shared by pairingService/
   * browserEndpointService/outboundRelayService above -- never a second,
   * independently-constructed copy.
   */
  deviceRepository: DeviceRepository;
  relayService: RelayService;
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
  /** Release management (app/model/rule package metadata, opaque pre-signed blobs -- no crypto verification here) -- see registerPlatformAdminOperationalRoutes/releaseRoutes.ts. */
  releaseService: ReleaseService;
  /** Billing admin write surface (add payment method, create/cancel subscription, open/resolve dispute) -- see registerPlatformAdminOperationalRoutes/billingAdminRoutes.ts. */
  paymentMethodService: PaymentMethodService;
  subscriptionService: SubscriptionService;
  disputeService: DisputeService;
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
  /**
   * PCA product-completion Writer P0-B: see registerChildPolicyRoutes' own
   * doc comment. Reuses the SAME ParentActionAuthorizationService instance
   * every other consumer in this file shares (main.ts's own
   * safeZoneParentActionAuthorization) -- never a second, independently-
   * constructed copy. Optional purely so existing buildServer() test
   * callers that don't exercise this route need no change;
   * registerChildPolicyRoutes itself fails the route closed with 503 when
   * this is omitted, never a silent allow.
   */
  childPolicyAuthorization?: Pick<ParentActionAuthorizationService, 'authorize'>;
  /**
   * PCA eye-protection reminders: see registerEyeProtectionRoutes' own doc
   * comment. Optional purely so existing buildServer() test callers that
   * don't exercise this route need no change; registerEyeProtectionRoutes
   * itself fails the route closed with 503 when this is omitted, never a
   * silent allow.
   */
  eyeProtectionSettingsService?: EyeProtectionSettingsService;
  /**
   * WEB_RULE parent authoring: see registerWebRuleRoutes' own doc comment.
   * Optional purely so existing buildServer() test callers that don't
   * exercise this route need no change; registerWebRuleRoutes itself fails
   * the route closed with 503 when this is omitted, never a silent allow.
   */
  webRuleService?: WebRuleService;
  /**
   * WEB_RULE parent authoring: reuses the SAME ParentActionAuthorizationService
   * instance every other consumer of this file shares (main.ts's own
   * safeZoneParentActionAuthorization) -- never a second, independently-
   * constructed copy. Optional purely so existing buildServer() test
   * callers that don't exercise this route need no change;
   * registerWebRuleRoutes itself fails the mutation routes closed with 503
   * when this is omitted, never a silent allow.
   */
  webRuleAuthorization?: Pick<ParentActionAuthorizationService, 'authorize'>;
  /** PCA product-completion programme, Writer P0-C (family/members): see registerFamilyMemberRoutes below. Optional so existing buildServer() test callers that don't exercise family/members routes need no change. */
  familyMemberInvitationService?: FamilyMemberInvitationService;
  /** PCA product-completion programme, Writer P0-D (/security/audit): see registerFamilyAuditEventRoutes below. Optional so existing buildServer() test callers that don't exercise the audit-events route need no change. */
  familyAuditEventLedger?: FamilyAuditEventLedger;
  /** PCA product-completion programme (/security/status): see registerProtectionAlertRoutes below. Optional so existing buildServer() test callers that don't exercise the protection-alerts route need no change. */
  protectionAlertLedger?: ProtectionAlertLedger;
  /** parentpanel family dashboard: see registerDashboardRoutes below. Optional so existing buildServer() test callers that don't exercise the dashboard route need no change; registerDashboardRoutes itself registers nothing when this is omitted, never a silent empty-card response. */
  dashboardAggregatorService?: Pick<DashboardAggregatorService, 'getDashboard'>;
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

  // The five cookie-plane endpoints that establish or recover an identity
  // BEFORE any session exists. Each already carries parentAccountRoutes.ts's
  // own strictly narrower two-dimensional budget (per-IP AND per-email-hash,
  // via createKeyedRateLimiter) sized individually per endpoint, so they are
  // deliberately left out of the sweep below rather than additionally
  // charged against -- and able to exhaust -- the shared auth-attempt
  // bucket. Keyed by route pattern, never by the concrete request URL.
  const SELF_LIMITED_PARENT_PLANE_ROUTES: ReadonlySet<string> = new Set([
    '/api/parent/register',
    '/api/parent/verify-email',
    '/api/parent/request-password-reset',
    '/api/parent/reset-password',
    '/api/parent/login',
  ]);

  /**
   * Makes authAttemptLimiter's contract above ("applied before
   * requireServiceSession on every authenticated route") true for the
   * `/api/parent/*` cookie plane and the two `/api/families/*` device
   * routes as well as for `/v1/*` and `/platform-admin/*`.
   *
   * Those two planes were the exception: registerParentAccountRoutes,
   * registerRemovalDecisionRoutes, registerChildRequestRoutes,
   * registerChildPolicyRoutes, registerEyeProtectionRoutes,
   * registerWebRuleRoutes, registerFamilyMemberRoutes,
   * registerFamilyAuditEventRoutes, registerProtectionAlertRoutes and
   * registerDashboardRoutes are all wired below WITHOUT a limiter, yet
   * every one of their authenticated routes performs at least one
   * session-validation DB round-trip (parentAccountService.readSession)
   * plus, on most, a second device-session lookup -- before any
   * authorization decision. Unbudgeted, a single IP could force those
   * round-trips at line rate against the same pool `/health/db` above is
   * careful not to starve, and could equally use them to brute-force
   * session-cookie/bearer-token guesses.
   *
   * Deliberately an instance-level hook rather than ~40 individual
   * `preHandler` entries: the defect being fixed IS that per-route
   * attachment was silently incomplete, and a route added to either plane
   * tomorrow inherits this automatically instead of re-opening the same
   * gap. Fastify runs instance-level `preHandler` hooks BEFORE a route's
   * own `preHandler` array, so the ordering the contract describes (limiter
   * first, then the session check) holds either way. `routeOptions.url` is
   * the matched route PATTERN and is `undefined` for an unmatched (404)
   * request, which needs no budget of its own.
   */
  app.addHook('preHandler', async (request, reply) => {
    const routePattern = request.routeOptions.url;
    if (typeof routePattern !== 'string') return;
    if (!routePattern.startsWith('/api/parent/') && !routePattern.startsWith('/api/families/')) return;
    if (SELF_LIMITED_PARENT_PLANE_ROUTES.has(routePattern)) return;
    await authAttemptLimiter(request, reply);
  });

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
  //
  // Unauthenticated (an orchestrator's readiness probe has no session) but
  // NOT unlimited: unlike `/health` above, every request here checks out a
  // connection from a pool capped at DB_POOL_LIMIT (db/pool.ts, default 10)
  // to run `SELECT 1`, so an unbudgeted caller can starve the same pool
  // every authenticated route depends on. Its own bucket, per this
  // codebase's "distinct budgets per route" rule (http/rateLimit.ts) --
  // deliberately NOT authAttemptLimiter's bucket, so probe traffic can never
  // consume the session-validation budget or vice versa. 60/min/IP leaves
  // ample headroom for a normal 10-30s probe interval.
  app.get('/health/db', { preHandler: rateLimiter({ windowMs: 60_000, max: 60, bucket: 'health-db' }) }, async (_request, reply) => {
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
  registerChildProfileRoutes(app, {
    childProfileService: deps.childProfileService,
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
  registerParentRuntimeSyncRoutes(app, {
    authService: deps.authService,
    authzService: deps.authzService,
    deviceRepository: deps.deviceRepository,
    statusTracker: deps.statusTracker,
    relayService: deps.relayService,
    rateLimiter,
    authAttemptLimiter,
    deviceProtectionStatusRepository: deps.deviceProtectionStatusRepository,
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
    releaseService: deps.releaseService,
    paymentMethodService: deps.paymentMethodService,
    subscriptionService: deps.subscriptionService,
    disputeService: deps.disputeService,
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
  registerChildPolicyRoutes(app, {
    parentAccountService: deps.parentAccountService,
    deviceSessionService: deps.deviceSessionService,
    parentActionAuthorization: deps.childPolicyAuthorization,
    outboundRelayService: deps.outboundRelayService,
  });
  registerEyeProtectionRoutes(app, {
    parentAccountService: deps.parentAccountService,
    deviceSessionService: deps.deviceSessionService,
    eyeProtectionSettingsService: deps.eyeProtectionSettingsService,
  });
  registerWebRuleRoutes(app, {
    parentAccountService: deps.parentAccountService,
    deviceSessionService: deps.deviceSessionService,
    parentActionAuthorization: deps.webRuleAuthorization,
    webRuleService: deps.webRuleService,
  });
  registerFamilyMemberRoutes(app, {
    parentAccountService: deps.parentAccountService,
    familyMemberInvitationService: deps.familyMemberInvitationService,
    deviceSessionService: deps.deviceSessionService,
  });
  registerFamilyAuditEventRoutes(app, {
    parentAccountService: deps.parentAccountService,
    deviceSessionService: deps.deviceSessionService,
    familyAuditEventLedger: deps.familyAuditEventLedger,
  });
  registerProtectionAlertRoutes(app, {
    parentAccountService: deps.parentAccountService,
    deviceSessionService: deps.deviceSessionService,
    protectionAlertLedger: deps.protectionAlertLedger,
  });
  registerDashboardRoutes(app, {
    parentAccountService: deps.parentAccountService,
    dashboardAggregatorService: deps.dashboardAggregatorService,
  });

  return app;
}
