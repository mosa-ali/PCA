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
import { PlatformAdminAuthService } from './platformadmin/auth/PlatformAdminAuthService.js';
import { MySqlPlatformAdminAuthRepository } from './platformadmin/auth/MySqlAuthRepository.js';
import { LoggingAlertAdapter } from './platformadmin/auth/alertPort.js';
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
  const platformAdminAuthService = new PlatformAdminAuthService(new MySqlPlatformAdminAuthRepository(), new LoggingAlertAdapter());

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

  const entitlementRepository = new MySqlEntitlementRepository();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  // PCA-MYKIDS-BILL-2: the real PriceBook-backed QuotePort adapter,
  // replacing NoPriceBookQuotePort -- standard-quantity increase requests
  // now resolve against the live billing_price_books row when one exists,
  // falling through to PENDING_ADMIN_QUOTE (never invented pricing)
  // exactly as PriceBookQuotePort.ts documents.
  const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, new PriceBookQuotePort(priceBookRepository));
  const paymentConfirmationService = new PaymentConfirmationService(changeRequestRepository, entitlementRepository);

  // PCA-PA-3B wiring.
  const platformAdminAccountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const slotReservationService = new SlotReservationService(new MySqlSlotReservationRepository(entitlementRepository));
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

  // PCA-COMMERCIAL-NOTIFY-1 wiring. `commercialNotificationPublisher` is
  // constructed here and exported nowhere yet -- no accepted Quote/Payment/
  // Entitlement/Request source file calls it today (this lane does not
  // edit those files). It exists so a future integration pass can import
  // it directly instead of re-deriving the wiring.
  const commercialNotificationRepository = new CommercialNotificationRepository();
  const commercialNotificationService = new CommercialNotificationService(commercialNotificationRepository);
  const commercialNotificationSupportService = new CommercialNotificationSupportService(commercialNotificationRepository);
  const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(commercialNotificationRepository);
  void commercialNotificationPublisher;

  const billingCheckoutService = new CheckoutService(changeRequestRepository, changeRequestService, paymentService, paymentRepository, providerRegistry);
  const billingWebhookService = new WebhookService(
    providerRegistry,
    providerEventService,
    providerEventRepository,
    paymentService,
    paymentConfirmationService,
    platformAdminAuditService,
  );

  const app = buildServer({
    authService: new AuthService(new MySqlAuthRepository()),
    authzService: new AuthzService(authzRepository),
    authzRepository,
    invitationService: new InvitationService(new MySqlInvitationRepository(), () => new Date(), familyAuditService),
    enrollmentCoordinator: new EnrollmentCoordinator(new MySqlEnrollmentCoordinatorRepository(), () => new Date(), familyAuditService),
    pairingService: new PairingService(deviceRepository, () => new Date(), familyAuditService),
    deviceSessionService: new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository(), () => new Date(), familyAuditService),
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
  });
  await app.listen({ host, port });
}

void start();
