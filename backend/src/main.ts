import { buildServer } from './http/buildServer.js';
import { AuthService } from './auth/AuthService.js';
import { MySqlAuthRepository } from './auth/MySqlAuthRepository.js';
import { AuthzService } from './authz/AuthzService.js';
import { MySqlAuthzRepository } from './authz/MySqlAuthzRepository.js';
import { InvitationService } from './invitation/InvitationService.js';
import { MySqlInvitationRepository } from './invitation/MySqlInvitationRepository.js';
import { EnrollmentCoordinator } from './enrollment/EnrollmentCoordinator.js';
import { MySqlEnrollmentCoordinatorRepository } from './enrollment/MySqlEnrollmentCoordinatorRepository.js';
import { PairingService } from './pairing/PairingService.js';
import { MySqlDeviceRepository } from './device/MySqlDeviceRepository.js';
import { DeviceAuthService } from './deviceauth/DeviceAuthService.js';
import { MySqlDeviceChallengeRepository } from './deviceauth/MySqlDeviceChallengeRepository.js';
import { MySqlRelayRepository } from './relay/MySqlRelayRepository.js';
import { RelayService } from './relay/RelayService.js';
import { InMemoryPendingQueueStore } from './familysync/InMemoryPendingQueueStore.js';
import { MySqlSequenceProgressLedger } from './familysync/MySqlSequenceProgressLedger.js';
import { MySqlReplayLedger } from './familyenvelope/MySqlReplayLedger.js';
import { MySqlDataVersionLedger } from './familyenvelope/MySqlDataVersionLedger.js';
import { MySqlMessageIdempotencyLedger } from './familyenvelope/MySqlMessageIdempotencyLedger.js';
import { MySqlEnvelopeAcceptanceTransaction } from './familyenvelope/MySqlEnvelopeAcceptanceTransaction.js';
import { SyncCoordinator } from './familysync/SyncCoordinator.js';
import {
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  OutboundRelayService,
  InboundReconnectService,
  DeviceSyncStatusTracker,
  RejectingDeviceSignatureVerifier,
  RejectingEnvelopeSignatureVerifier,
} from './runtime-sync/index.js';
import { InMemoryDeleteNowLedger } from './retention/InMemoryDeleteNowLedger.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from './familyrbac/FamilyAuditStore.js';
import { InMemoryActionIdempotencyLedger } from './familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from './familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from './familyrbac/types.js';
import { UnavailableTrustSetRoleResolver } from './familyrbac/UnavailableTrustSetRoleResolver.js';
// PCA-ADD-ENR-012/016/017/018/020: consolidated removal/disable decision
// authority -- see RemovalDecisionAuthority.ts's own header for the full
// design note. Three of its dependencies genuinely have no production
// implementation yet (signed-remote-parent signing-key resolution,
// authorized-recovery verification, and the device-authority binding that
// gates request creation); each gets an honestly-named fail-closed stub
// below, exactly like UnavailableTrustSetRoleResolver above, rather than an
// invented "always allow".
import { RemovalDecisionAuthority } from './familyrbac/RemovalDecisionAuthority.js';
import { MySqlRemovalDecisionRepository } from './familyrbac/MySqlRemovalDecisionRepository.js';
import { UnavailableRemovalDecisionSigningKeyResolver } from './familyrbac/UnavailableRemovalDecisionSigningKeyResolver.js';
import { UnavailableAuthorizedRecoveryAuthority } from './familyrbac/UnavailableAuthorizedRecoveryAuthority.js';
import { RealProtectiveAuthorityResolver } from './familyrbac/RealProtectiveAuthorityResolver.js';
import { MySqlDeviceProtectionStatusRepository } from './device/DeviceProtectionStatusRepository.js';
import { DeviceDirectoryService } from './device/DeviceDirectoryService.js';
import { registerRemovalDecisionRoutes } from './http/routes/removalDecisionRoutes.js';
import { AdministrationPinService } from './enrollment/AdministrationPinService.js';
import { MySqlAdministrationPinRepository } from './enrollment/MySqlAdministrationPinRepository.js';
import { PlatformAdminAuthService } from './platformadmin/auth/PlatformAdminAuthService.js';
import { MySqlPlatformAdminAuthRepository } from './platformadmin/auth/MySqlAuthRepository.js';
import { MySqlPlatformAdminAlertAdapter } from './platformadmin/auth/MySqlPlatformAdminAlertAdapter.js';
import { PlatformAdminAuditService } from './platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from './platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
// PCA-BILL-2A: payment orchestration wiring. Every service below is real,
// durable, MySQL-backed -- the only thing NOT wired to a real
// implementation is a production PaymentProvider (PAYMENT_PROVIDER_SELECTION
// is this codebase's external commercial gate, Section 19.2): in
// production (NODE_ENV neither 'test' nor 'development'),
// createDefaultProviderRegistry() returns an EMPTY registry, so every
// checkout/webhook/refund call fails closed with UnknownProviderError
// rather than silently using the TEST_SANDBOX adapter or any other
// default.
import { PriceBookRepository, PriceBookService } from './billing/priceBook.js';
import { QuoteRepository, QuoteService } from './billing/quote.js';
import { PaymentRepository, PaymentService } from './billing/payment.js';
import { RefundRepository, RefundService } from './billing/refund.js';
import { ProviderEventRepository, ProviderEventService } from './billing/providerEvent.js';
import { createDefaultProviderRegistry } from './billing/provider/providerRegistry.js';
import { CheckoutService } from './billing/checkout/CheckoutService.js';
import { WebhookService } from './billing/webhook/WebhookService.js';
// PCA-BILL-2A-R1 correction: FIX 2/3 durable+concurrency-safe refund
// orchestration, and FIX 4's fail-closed family-owner-authority default --
// see each module's own header for the full rationale.
import { RefundOperationRepository, RefundOrchestrationService } from './billing/refundOrchestration/RefundOrchestrationService.js';
import { MySqlEntitlementRepository } from './entitlements/MySqlEntitlementRepository.js';
import { MySqlChangeRequestRepository } from './entitlements/requests/MySqlChangeRequestRepository.js';
import { EntitlementService } from './entitlements/EntitlementService.js';
import { ChangeRequestService } from './entitlements/requests/ChangeRequestService.js';
import { PaymentConfirmationService } from './entitlements/payment/PaymentConfirmationService.js';
// PCA-COMMERCIAL-NOTIFY-1: durable commercial-notification event/read
// model. No production PAYMENT_PROVIDER_SELECTION-style external gate
// exists here -- CommercialNotificationService/Publisher are fully
// functional MySQL-backed wiring from the moment this lane merges. See
// this lane's final report's SHARED_INTEGRATION_REQUIRED list for the
// Quote/Payment/Entitlement/Request call sites a future integration pass
// should add `commercialNotificationPublisher.publish(...)` calls at --
// this lane deliberately does not edit those domains' accepted source
// files to wire itself in.
import { CommercialNotificationRepository } from './commercialnotifications/CommercialNotificationRepository.js';
import { CommercialNotificationService, CommercialNotificationSupportService } from './commercialnotifications/CommercialNotificationService.js';
import { MySqlCommercialNotificationPublisher } from './commercialnotifications/CommercialNotificationPublisher.js';
// PCA-PA-3B: Platform Administration operational/commercial API wiring.
import { PlatformAdminAccountService } from './platformadmin/auth/PlatformAdminAccountService.js';
import { PlatformAdminEntitlementService } from './platformadmin/entitlements/PlatformAdminEntitlementService.js';
import { SlotReservationService } from './entitlements/slots/SlotReservationService.js';
import { MySqlSlotReservationRepository } from './entitlements/slots/MySqlSlotReservationRepository.js';
import { PlanRepository, PlanService } from './billing/plan.js';
// PCA-MYKIDS-BILL-2: family commercial API + the real PriceBook-backed
// QuotePort adapter, replacing NoPriceBookQuotePort.
import { FamilyCommercialService } from './familycommercial/FamilyCommercialService.js';
import { SubscriptionRepository } from './billing/subscription.js';
import { PaymentMethodRepository } from './billing/paymentMethod.js';
import { PriceBookQuotePort } from './entitlements/quote/PriceBookQuotePort.js';
// PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, OWNER_APPROVED_OPTION_A): the real,
// genesis-anchored Owner-attestation chain resolver, replacing the
// fail-closed UnavailableFamilyCommercialAuthorityResolver placeholder.
// Signature verification still runs through the SAME
// RejectingDeviceSignatureVerifier used everywhere else in this file
// (deviceAuthService/syncCoordinator above) -- CRYPTO_SUITE remains
// PENDING_HUMAN_SECURITY_REVIEW, so this wiring is real and structurally
// correct but every signature check still fails closed today, exactly
// like every other crypto-gated surface in this file. This is a deliberate
// continuation of that existing posture, not a new gap.
import { AttestationChainFamilyCommercialAuthorityResolver } from './billing/authority/FamilyCommercialAuthorityResolver.js';
import { FamilyOwnerAttestationChainEngine } from './familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { MySqlFamilyAuthorityGenesisStore } from './familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from './familycommercial/authority/MySqlAttestationChainStore.js';
// PCA-AUTH-SESSION-1 (PCA-DEC-026): browser-reachable parent identity +
// FAMILY_SERVICE_SESSION_V1 session issuance wiring. Reuses the SAME
// AuthService instance buildServer's Bearer-header requireServiceSession
// already validates against -- see ParentAccountService.ts's own
// SESSION BACKING STORE doc comment for why this is one token format, not
// two. `familyGenesisEngine` reuses the SAME familyAuthorityChainEngine
// constructed above for PCA-FAMILY-AUTH-1-R1, so a self-registered
// parent's genesis ceremony and every subsequent Owner-authority check run
// through the identical, unmodified verification path.
import { ParentAccountService } from './parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from './parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentPreferenceRepository } from './parentaccount/MySqlParentPreferenceRepository.js';
import { MySqlSafeZoneRepository } from './location/MySqlSafeZoneRepository.js';
import { ParentActionSafeZonePolicyAuthorizer } from './location/SafeZonePolicyAuthorization.js';
import { createTestSandboxEmailSender } from './parentaccount/TestSandboxEmailSender.js';
import type { EmailSenderPort } from './parentaccount/EmailSenderPort.js';
// PCA-COMPLIMENTARY-ENTITLEMENTS-1 (Round5 Owner decision, Addendum 004):
// durable, audited complimentary entitlement grants. Reuses the SAME
// platformAdminAuthService instance every other Platform Administration
// surface already shares.
import { ComplimentaryEntitlementService } from './entitlements/complimentary/ComplimentaryEntitlementService.js';
import { MySqlComplimentaryGrantRepository } from './entitlements/complimentary/MySqlComplimentaryGrantRepository.js';
import { PlatformAdminComplimentaryGrantService } from './platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
// PCA-COMMERCIAL-RUNTIME-1: closes the two Round4-deferred
// SOURCE_RUNTIME_GAPs (QUOTE_EXPIRED_NOTIFICATION,
// COMMERCIAL_NOTIFICATION_RETENTION_SCHEDULER). Reuses the SAME
// quoteRepository/changeRequestRepository/commercialNotificationPublisher/
// commercialNotificationRepository instances already constructed above for
// PCA-BILL-1/PCA-MYKIDS-BILL-2/PCA-COMMERCIAL-NOTIFY-1 -- this lane never
// modifies backend/src/billing/quote.ts, only calls its existing
// expireDueQuotes conditional transition. Interval timer + graceful
// shutdown hook are this lane's own explicitly Coordinator-owned wiring
// (see commercialmaintenance/index.ts's header).
import { MySqlCommercialMaintenanceRunner, loadCommercialMaintenanceConfig } from './commercialmaintenance/index.js';
// PCA-FREE-ACCESS-1 (Round6): real backend enforcement/admin surface for
// the Round5 FreeAccessSnapshot.
import { MySqlFreeAccessAccountRepository } from './parentaccount/freeaccess/MySqlFreeAccessAccountRepository.js';
import { FreeAccessAdminService } from './parentaccount/freeaccess/FreeAccessAdminService.js';
import { FreeAccessAcquisitionPolicy } from './parentaccount/freeaccess/FreeAccessAcquisitionPolicy.js';
// PCA-BILL-3 (Round6): Settlement/Reconciliation domain.
import { MySqlSettlementRepository } from './billing/settlement/MySqlSettlementRepository.js';
import { SettlementService } from './billing/settlement/SettlementService.js';
import { PlatformAdminSettlementService } from './platformadmin/settlement/PlatformAdminSettlementService.js';

/**
 * PCA-ADD-IDENT-005: no real production email provider is selected this
 * round (EXTERNAL_GATE, unchanged -- matches PAYMENT_PROVIDER_SELECTION's
 * precedent exactly). `TestSandboxEmailSender` deliberately THROWS if
 * constructed outside NODE_ENV=test|development (see its own header), so
 * it cannot be wired unconditionally here without crashing production
 * server startup entirely -- a strictly worse failure mode than every
 * other crypto/provider gate in this file, which fails individual
 * operations closed without taking down the whole process. This adapter
 * is production's `createDefaultEmailSender` counterpart: registration/
 * verification-code-request/login remain fully reachable, but
 * `sendVerificationCode` itself always rejects, so no verification code
 * ever silently appears to have been delivered when it was not. An
 * explicit, honest gap, not a silent failure mode -- exactly the same
 * posture EmailSenderPort.ts's own header already documents.
 */
class RejectingEmailSender implements EmailSenderPort {
  async sendVerificationCode(): Promise<void> {
    throw new Error('Email sending is not configured in production (PCA-ADD-IDENT-005 EXTERNAL_GATE, provider not yet selected).');
  }
}

function createDefaultEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSenderPort {
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    return createTestSandboxEmailSender(env);
  }
  return new RejectingEmailSender();
}

const port = Number.parseInt(process.env.PORT ?? '4001', 10);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

async function start(): Promise<void> {
  const deviceRepository = new MySqlDeviceRepository();
  const relayService = new RelayService(new MySqlRelayRepository());
  const authzRepository = new MySqlAuthzRepository();
  // Single shared in-memory reference audit store for every family-rbac
  // event source (invitation/enrollment/pairing/device/recovery/parent
  // authorization/retention). See FamilyAuditStore.ts's doc comment: this
  // is deliberately never a durable PCA server audit log, only the
  // in-memory reference implementation the audit domain itself ships.
  const familyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository());
  const deleteNowLedger = new InMemoryDeleteNowLedger();
  const deviceAuthService = new DeviceAuthService(
    new MySqlDeviceChallengeRepository(),
    deviceRepository,
    // PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW -- see
    // runtime-sync/RejectingCryptoVerifiers.ts. Device-session issuance is
    // correctly, intentionally non-functional until a reviewed verifier
    // replaces this.
    new RejectingDeviceSignatureVerifier(),
  );
  const syncCoordinator = new SyncCoordinator(
    // PCA-SYNC-DURABILITY-1: PendingQueueStore stays in-memory -- a held,
    // dependency-gated envelope is never pre-trusted (it is always re-run
    // through the full acceptance pipeline, including every ledger below,
    // before being applied), so losing it on restart is a liveness/
    // resubmission cost only, never a security regression. See
    // backend/migrations/0002_sync_durability.sql's header and this lane's
    // final report for the full reasoning.
    new InMemoryPendingQueueStore(),
    // The four ledgers below are the actual replay/anti-downgrade/
    // idempotency SECURITY authorities -- each is now durable (MySQL-
    // backed), so a backend-process restart can no longer reopen a replay,
    // policy-rollback, or message-id-conflict hole. This durability change
    // is independent of, and does not alter, the crypto gate immediately
    // below: RejectingEnvelopeSignatureVerifier still fails every
    // signature check closed, so inbound envelope acceptance remains
    // completely non-functional in production today, exactly as before.
    new MySqlSequenceProgressLedger(),
    new MySqlReplayLedger(),
    new MySqlDataVersionLedger(),
    new MySqlMessageIdempotencyLedger(),
    // Same crypto gate as above -- inbound envelope acceptance is
    // correctly non-functional until a reviewed EnvelopeSignatureVerifier
    // replaces this.
    new RejectingEnvelopeSignatureVerifier(),
    {
      isNumericSequenceSender: () => false,
      // PCA-17F ATOMIC_ENVELOPE_ACCEPTANCE_RACE: the production acceptance
      // authority -- every accept-side-effect (message-id record, replay
      // claim, version advance/rollback) commits as ONE MySQL transaction,
      // never independently, so a message-id row is never externally
      // visible as "accepted" until the full decision has committed. See
      // EnvelopeAcceptanceTransaction.ts's doc comment.
      atomicAcceptance: new MySqlEnvelopeAcceptanceTransaction(),
    },
  );

  // PCA-PA-1: single shared Platform Administration auth-service instance
  // -- every downstream Platform Admin surface (billing refunds below,
  // PCA-PA-3B operational routes, buildServer's own auth route) reuses
  // this ONE instance rather than each constructing its own.
  const platformAdminAuthService = new PlatformAdminAuthService(new MySqlPlatformAdminAuthRepository(), new MySqlPlatformAdminAlertAdapter());

  // PCA-BILL-2A wiring -- see this block's own imports above for the
  // external-gate note on PaymentProvider selection.
  const platformAdminAuditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
  const priceBookRepository = new PriceBookRepository();
  const quoteRepository = new QuoteRepository();
  const quoteService = new QuoteService(priceBookRepository, quoteRepository, platformAdminAuditService);
  const paymentRepository = new PaymentRepository();
  const paymentService = new PaymentService(paymentRepository, quoteService, platformAdminAuditService);
  const refundRepository = new RefundRepository();
  const refundService = new RefundService(refundRepository, paymentRepository, platformAdminAuditService);
  const providerEventRepository = new ProviderEventRepository();
  const providerEventService = new ProviderEventService(providerEventRepository);
  const providerRegistry = createDefaultProviderRegistry();
  const refundOperationRepository = new RefundOperationRepository();
  const refundOrchestrationService = new RefundOrchestrationService(refundOperationRepository, refundService, paymentRepository, providerRegistry);
  // PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025/Option A): the real, server-verifiable
  // resolver -- see this block's own import comment above for why it is
  // still functionally fail-closed today (RejectingDeviceSignatureVerifier,
  // pending CRYPTO_SUITE human security review), exactly like device-session
  // issuance and envelope acceptance elsewhere in this file.
  const familyAuthorityChainEngine = new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    new MySqlFamilyAuthorityAttestationChainStore(),
    new RejectingDeviceSignatureVerifier(),
    () => new Date(),
  );
  const familyCommercialAuthorityResolver = new AttestationChainFamilyCommercialAuthorityResolver(familyAuthorityChainEngine);

  // PCA-COMMERCIAL-NOTIFY-1 wiring, constructed early so it can be threaded
  // into ChangeRequestService/WebhookService below (Wave 3A correction R1:
  // the publisher is now genuinely wired at authoritative post-commit
  // lifecycle points -- see each call site's own header note).
  const commercialNotificationRepository = new CommercialNotificationRepository();
  const commercialNotificationService = new CommercialNotificationService(commercialNotificationRepository);
  const commercialNotificationSupportService = new CommercialNotificationSupportService(commercialNotificationRepository);
  const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(commercialNotificationRepository);

  // PCA-COMPLIMENTARY-CONSUMPTION-1 (Round6): constructed here, BEFORE
  // entitlementRepository/slotReservationService below, so EFFECTIVE_ENTITLEMENT_V2
  // (base + active complimentary grants) is genuinely consulted by the real
  // consumption path -- not just the isolated Round5 MyKids read model.
  // Both consumers below treat this as an optional trailing constructor
  // argument (Writer60's own backward-compatible design); passing it here
  // is what actually activates the effective-limit behavior in production.
  const complimentaryGrantRepositoryForConsumption = new MySqlComplimentaryGrantRepository();
  const freeAccessAccountRepository = new MySqlFreeAccessAccountRepository();
  const freeAccessAcquisitionPolicy = new FreeAccessAcquisitionPolicy(freeAccessAccountRepository, complimentaryGrantRepositoryForConsumption);
  const entitlementRepository = new MySqlEntitlementRepository(complimentaryGrantRepositoryForConsumption);
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  // PCA-MYKIDS-BILL-2: the real PriceBook-backed QuotePort adapter,
  // replacing NoPriceBookQuotePort -- standard-quantity increase requests
  // now resolve against the live billing_price_books row when one exists,
  // falling through to PENDING_ADMIN_QUOTE (never invented pricing)
  // exactly as PriceBookQuotePort.ts documents.
  const changeRequestService = new ChangeRequestService(
    changeRequestRepository,
    entitlementRepository,
    entitlementService,
    new PriceBookQuotePort(priceBookRepository),
    commercialNotificationPublisher,
    undefined,
    freeAccessAcquisitionPolicy,
  );
  const paymentConfirmationService = new PaymentConfirmationService(changeRequestRepository, entitlementRepository);

  // PCA-PA-3B wiring.
  const platformAdminAccountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const slotReservationService = new SlotReservationService(
    new MySqlSlotReservationRepository(entitlementRepository, complimentaryGrantRepositoryForConsumption),
    () => new Date(),
    freeAccessAcquisitionPolicy,
  );
  const platformAdminEntitlementService = new PlatformAdminEntitlementService(
    platformAdminAuthService,
    entitlementRepository,
    changeRequestRepository,
    entitlementService,
    changeRequestService,
    slotReservationService,
  );
  const planService = new PlanService(new PlanRepository());
  const priceBookService = new PriceBookService(priceBookRepository, platformAdminAuditService);

  // PCA-MYKIDS-BILL-2 wiring -- composes the SAME entitlement/billing-core
  // repositories already constructed above; reuses (never duplicates)
  // Agent45A's checkout/webhook/refund routes.
  const familyCommercialService = new FamilyCommercialService(
    entitlementService,
    changeRequestRepository,
    changeRequestService,
    new SubscriptionRepository(),
    new PaymentMethodRepository(),
  );

  const billingCheckoutService = new CheckoutService(changeRequestRepository, changeRequestService, paymentService, paymentRepository, providerRegistry);
  const billingWebhookService = new WebhookService(
    providerRegistry,
    providerEventService,
    providerEventRepository,
    paymentService,
    paymentConfirmationService,
    platformAdminAuditService,
    commercialNotificationPublisher,
  );

  // PCA-AUTH-SESSION-1: single shared AuthService instance -- both
  // buildServer's Bearer-header requireServiceSession AND
  // ParentAccountService's cookie-issued sessions validate against this
  // SAME instance/backing store (see ParentAccountService.ts's own
  // SESSION BACKING STORE doc comment).
  const authService = new AuthService(new MySqlAuthRepository());
  const parentAccountService = new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService,
    emailSender: createDefaultEmailSender(),
    // PCA-FAMILY-AUTH-1-R1: the SAME engine instance constructed above --
    // a self-registered parent's genesis ceremony and every subsequent
    // Owner-authority check run through the identical, unmodified
    // verification path. Still fail-closed today (RejectingDeviceSignatureVerifier),
    // exactly like every other crypto-gated surface in this file.
    familyGenesisEngine: familyAuthorityChainEngine,
  });
  const parentPreferenceRepository = new MySqlParentPreferenceRepository();
  const safeZoneRepository = new MySqlSafeZoneRepository();
  // Safe Zone routes are composed through the shared family-action matrix.
  // The current production trust-set source is intentionally unavailable
  // while the reviewed crypto suite remains fail-closed, so this explicit
  // resolver returns NO_TRUST_SET rather than silently treating a session as
  // Owner. The wiring is complete and the unavailable authority is visible.
  // Shared across every consumer of the family-action authorization matrix
  // (Safe Zone below, and RemovalDecisionAuthority further down) -- one
  // resolver instance, not a second independently-constructed one, per
  // UnavailableTrustSetRoleResolver's own "one production composition
  // boundary" doc comment.
  const trustSetRoleResolver = new UnavailableTrustSetRoleResolver();
  const safeZoneParentActionAuthorization = new ParentActionAuthorizationService(
    trustSetRoleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    () => new Date(),
    undefined,
    familyAuditService,
  );
  const safeZonePolicyAuthorizer = new ParentActionSafeZonePolicyAuthorizer(safeZoneParentActionAuthorization);

  // PCA-ADD-ENR-012/016/017/018/020: consolidated removal/disable decision
  // authority. Reuses the SAME trustSetRoleResolver, safeZoneParentActionAuthorization
  // (a ParentActionAuthorizationService is generic across every ParentOperation,
  // not scoped to Safe Zone), and familyAuditService instances constructed
  // above -- never a second, independently-constructed copy of any of them.
  // signatureVerifier reuses the SAME RejectingDeviceSignatureVerifier posture
  // used everywhere else in this file (CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW):
  // signed remote-parent decisions are wired but fail every signature check
  // closed today, exactly like device-session issuance and envelope
  // acceptance above. signingKeyResolver and recoveryAuthority have no real
  // production implementation anywhere in this codebase yet -- each is an
  // honestly-named fail-closed stub (see their own files) rather than an
  // invented "always allow"; local-Administration-PIN decisions are the one
  // decision mode with a genuine, durable production implementation
  // (AdministrationPinService + MySqlAdministrationPinRepository) and are
  // therefore the only mode actually reachable end-to-end today.
  const administrationPinService = new AdministrationPinService({ repository: new MySqlAdministrationPinRepository() });
  // PCA-ADD-ENR-016/017: the real device-identity-layer effect of an
  // ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE decision -- reuses the SAME
  // deviceRepository and familyAuditService instances every other
  // consumer in this file shares, never a second independently-
  // constructed copy. Previously never instantiated anywhere in this
  // file, so an ALLOW_REMOVAL decision never actually revoked the
  // decided-on device -- confirmed by direct source inspection this
  // session, now closed.
  const deviceDirectoryService = new DeviceDirectoryService(deviceRepository, () => new Date(), familyAuditService);
  // PCA-ADD-ENR-016/PCA-FR-145: single shared instance -- both
  // registerRuntimeSyncRoutes' protection-status write endpoint and
  // RealProtectiveAuthorityResolver's read below share this SAME
  // repository instance, never a second independently-constructed copy.
  const deviceProtectionStatusRepository = new MySqlDeviceProtectionStatusRepository();
  const removalDecisionAuthority = new RemovalDecisionAuthority({
    repository: new MySqlRemovalDecisionRepository(),
    authorization: safeZoneParentActionAuthorization,
    signingKeyResolver: new UnavailableRemovalDecisionSigningKeyResolver(),
    signatureVerifier: new RejectingDeviceSignatureVerifier(),
    targetDeviceRoleResolver: trustSetRoleResolver,
    pinService: administrationPinService,
    recoveryAuthority: new UnavailableAuthorizedRecoveryAuthority(),
    auditService: familyAuditService,
    deviceRevocation: deviceDirectoryService,
    // PCA-ADD-ENR-020 alerting is deliberately NOT composed here: it needs
    // both a real opaque payload composer (blocked on the same
    // CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW gate as every signature
    // verifier in this file) and a real family-trust-set-backed
    // resolveParentDevices source, neither of which exists in this
    // codebase yet. Alerting is entirely optional/best-effort by design
    // (RemovalDecisionAuthority.emitAlert never blocks or reverses a
    // decision either way), so omitting it here is an honest gap, not a
    // silent one -- decisions still commit and audit correctly with no
    // alert emitted.
  });

  // PCA-COMPLIMENTARY-ENTITLEMENTS-1: durable, audited complimentary
  // entitlement grants. Reuses the SAME platformAdminAuthService instance
  // every other Platform Administration surface already shares, and the
  // SAME complimentaryGrantRepositoryForConsumption instance the Round6
  // consumption path above uses -- one repository instance, no divergence.
  const complimentaryEntitlementService = new ComplimentaryEntitlementService(complimentaryGrantRepositoryForConsumption);
  const platformAdminComplimentaryGrantService = new PlatformAdminComplimentaryGrantService(
    platformAdminAuthService,
    complimentaryEntitlementService,
  );

  // PCA-FREE-ACCESS-1 (Round6, Writer61): backing repository for the
  // parent-facing free-access status read and the admin adjustment
  // service. Reuses the SAME authService instance the rest of the parent
  // identity plane shares.
  const freeAccessAdminService = new FreeAccessAdminService(platformAdminAuthService, freeAccessAccountRepository);

  // PCA-BILL-3 (Round6, Writer62): Settlement/Reconciliation. Reuses the
  // SAME paymentRepository instance the rest of the billing domain shares
  // (settlement batch items associate to, but never mutate, its rows).
  const settlementService = new SettlementService(new MySqlSettlementRepository(), paymentRepository);
  const platformAdminSettlementService = new PlatformAdminSettlementService(platformAdminAuthService, settlementService);

  // Single shared instance -- reused below both as buildServer's own
  // `deviceSessionService` dependency AND (via that same dependency)
  // threaded into registerParentAccountRoutes' Safe Zone actor-identity
  // binding (see runtime-sync/DeviceSessionService.ts's
  // requireActorDeviceInFamily doc comment / buildServer.ts's
  // registerParentAccountRoutes call) -- never a second, independently-
  // constructed copy.
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository(), () => new Date(), familyAuditService);

  const app = buildServer({
    authService,
    authzService: new AuthzService(authzRepository),
    authzRepository,
    invitationService: new InvitationService(new MySqlInvitationRepository(), () => new Date(), familyAuditService, slotReservationService),
    enrollmentCoordinator: new EnrollmentCoordinator(new MySqlEnrollmentCoordinatorRepository(), () => new Date(), familyAuditService, slotReservationService),
    pairingService: new PairingService(deviceRepository, () => new Date(), familyAuditService),
    deviceSessionService,
    outboundRelayService: new OutboundRelayService(relayService, deviceRepository),
    inboundReconnectService: new InboundReconnectService(relayService, syncCoordinator),
    statusTracker: new DeviceSyncStatusTracker(),
    deleteNowLedger,
    familyAuditService,
    // FTS/key-epoch resolution is a separate workstream (src/familytrustset)
    // this lane does not own -- until it is wired in here, every envelope's
    // signature check runs against RejectingEnvelopeSignatureVerifier above
    // regardless of what senderPublicKey this returns, so the placeholder
    // value below is inert, not a real credential.
    //
    // PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: `familyId` (the caller's
    // AUTHORITATIVE, session-derived family identity -- see
    // runtimeSyncRoutes.ts's requireDeviceSession, which resolves this from
    // a verified session token, never client-supplied data) was PREVIOUSLY
    // discarded here (`_familyId`, unused) even though it was already being
    // passed in -- EnvelopeAcceptanceContext had no field to carry it, so
    // envelope acceptance never cross-checked a submitted envelope's own
    // self-declared familyId against the authoritative one at all. Now
    // threaded straight into the context; see
    // FamilyEnvelopeVerifier.EnvelopeAcceptanceContext's familyId doc
    // comment for the full acceptance-boundary reasoning.
    resolveEnvelopeContext: (_senderKeyId, familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      familyId,
      now: nowUtc,
    }),
    // PCA-PA-1: independent Platform Administration auth plane -- no
    // shared repository, session type, or RBAC with anything above.
    platformAdminAuthService,
    // PCA-BILL-2A: payment orchestration -- see the wiring block above.
    billingCheckoutService,
    billingWebhookService,
    billingProviderRegistry: providerRegistry,
    billingRefundOrchestrationService: refundOrchestrationService,
    billingPaymentRepository: paymentRepository,
    billingAuditService: platformAdminAuditService,
    billingFamilyCommercialAuthorityResolver: familyCommercialAuthorityResolver,
    commercialNotificationService,
    commercialNotificationSupportService,
    // PCA-PA-3B: Platform Administration operational/commercial API.
    platformAdminAccountService,
    platformAdminEntitlementService,
    changeRequestRepository,
    entitlementRepository,
    priceBookService,
    planService,
    // PCA-MYKIDS-BILL-2: family-facing commercial API.
    familyCommercialService,
    // PCA-AUTH-SESSION-1: browser-reachable parent identity + session issuance.
    parentAccountService,
    parentPreferenceRepository,
    safeZoneRepository,
    safeZonePolicyAuthorizer,
    // PCA-COMPLIMENTARY-ENTITLEMENTS-1: complimentary entitlement grants.
    platformAdminComplimentaryGrantService,
    // PCA-FREE-ACCESS-1: real backend enforcement/admin surface.
    freeAccessAccountRepository,
    freeAccessAdminService,
    // PCA-BILL-3: Settlement / Reconciliation.
    platformAdminSettlementService,
    // PCA-ADD-ENR-012/016/017/018/020: consolidated removal/disable decision
    // authority -- see the wiring block above for exactly which decision
    // modes are genuinely production-ready today (local Administration PIN)
    // vs. honestly fail-closed pending a real implementation (signed
    // remote-parent, authorized recovery).
    removalDecisionAuthority,
    // PCA-ADD-ENR-016/PCA-FR-145: real source, fail-closed only on the
    // SAME PCA-DEC-020 crypto-review gate as every other signed-device
    // channel in this file -- see RealProtectiveAuthorityResolver.ts's
    // own doc comment for the full chain.
    protectiveAuthorityResolver: new RealProtectiveAuthorityResolver(deviceProtectionStatusRepository),
    administrationPinService,
    deviceProtectionStatusRepository,
  });
  await app.listen({ host, port });

  // PCA-COMMERCIAL-RUNTIME-1: periodic quote-expiry reconciliation +
  // commercial-notification retention. Coordinator-owned interval timer +
  // shutdown hook, per ROUND5_INTERFACE_CONTRACTS.md -- the lane itself
  // delivers only runOnce() and its dependencies (see commercialmaintenance/
  // index.ts's header). Config is bounds-validated and fails safe (refuses
  // to start, never silently no-ops) on invalid production configuration.
  const commercialMaintenanceConfig = loadCommercialMaintenanceConfig();
  const commercialMaintenanceRunner = new MySqlCommercialMaintenanceRunner(
    quoteRepository,
    changeRequestRepository,
    commercialNotificationPublisher,
    commercialNotificationRepository,
    commercialMaintenanceConfig,
  );
  const commercialMaintenanceTimer = setInterval(() => {
    commercialMaintenanceRunner.runOnce().catch((error) => {
      // A single failed maintenance pass must never crash the whole
      // process -- the next interval tick retries. Every underlying
      // transition (quote expiry, notification publish, retention prune)
      // is independently idempotent/DB-conditional, so a partial pass is
      // always safe to repeat.
      console.error('[commercial-maintenance] runOnce failed', error);
    });
  }, commercialMaintenanceConfig.intervalMs);
  commercialMaintenanceTimer.unref();
  process.on('SIGTERM', () => clearInterval(commercialMaintenanceTimer));
  process.on('SIGINT', () => clearInterval(commercialMaintenanceTimer));
}

void start();
