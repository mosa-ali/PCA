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
    { isNumericSequenceSender: () => false },
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
    resolveEnvelopeContext: (_senderKeyId, _familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      now: nowUtc,
    }),
  });
  await app.listen({ host, port });
}

void start();
