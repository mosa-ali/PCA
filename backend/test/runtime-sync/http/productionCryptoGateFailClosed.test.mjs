// PCA-SEC-010/011/012/017/020/022, PCA-FR-138/143: end-to-end proof that
// the PRODUCTION wiring (main.ts) -- DeviceAuthService constructed with
// RejectingDeviceSignatureVerifier, SyncCoordinator constructed with
// RejectingEnvelopeSignatureVerifier, exactly as main.ts wires them -- is
// airtight over real HTTP request/response cycles, not merely at the
// verifier-class unit level (see RejectingCryptoVerifiers.test.mjs for
// that layer).
//
// Because DeviceSessionService.validateSession is the single gate every
// runtime-sync route (`requireDeviceSession`) sits behind, and no session
// can ever be minted while RejectingDeviceSignatureVerifier is wired, this
// test's central claim is stronger than "signature checks fail": it proves
// the ENTIRE authenticated runtime-sync surface -- outbound submission,
// inbound envelope drain (which is also where RejectingEnvelopeSignature-
// Verifier would be exercised), acknowledgement, status -- is completely
// unreachable in production today, for every attacker strategy tried
// (a forged signature, a replayed valid-format-but-wrong signature, an
// empty/garbage signature, and a signature that a non-production TEST-ONLY
// verifier would have accepted).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildServer } from '../../../dist/http/buildServer.js';
import { AuthService } from '../../../dist/auth/AuthService.js';
import { AuthzService } from '../../../dist/authz/AuthzService.js';
import { InvitationService } from '../../../dist/invitation/InvitationService.js';
import { EnrollmentCoordinator } from '../../../dist/enrollment/EnrollmentCoordinator.js';
import { PairingService } from '../../../dist/pairing/PairingService.js';
import { DeviceAuthService } from '../../../dist/deviceauth/DeviceAuthService.js';
import { RelayService } from '../../../dist/relay/RelayService.js';
import { SyncCoordinator } from '../../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../../dist/familysync/InMemorySequenceProgressLedger.js';
import { InMemoryReplayLedger } from '../../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import {
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  OutboundRelayService,
  InboundReconnectService,
  DeviceSyncStatusTracker,
  // The REAL production classes -- not a test-only stand-in. This is
  // exactly what main.ts wires into DeviceAuthService/SyncCoordinator.
  RejectingDeviceSignatureVerifier,
  RejectingEnvelopeSignatureVerifier,
} from '../../../dist/runtime-sync/index.js';
import { createInMemoryAuthRepository } from '../../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../../support/inMemoryAuthzRepository.mjs';
import { createInMemoryInvitationRepository } from '../../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../../support/inMemoryDeviceChallengeRepository.mjs';
import { signTestOnlyChallenge } from '../../support/testOnlyDeviceSignatureVerifier.mjs';

/** Mirrors main.ts's wiring exactly, but with in-memory repositories in place of MySQL ones (no DB dependency required to prove the crypto gate). */
function buildProductionCryptoGateApp() {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    new RejectingDeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
  const outboundRelayService = new OutboundRelayService(relayService, deviceRepository);
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    new RejectingEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: () => false },
  );
  const inboundReconnectService = new InboundReconnectService(relayService, syncCoordinator);
  const statusTracker = new DeviceSyncStatusTracker();

  const app = buildServer({
    authService: new AuthService(createInMemoryAuthRepository()),
    authzService: new AuthzService(createInMemoryAuthzRepository()),
    invitationService: new InvitationService(createInMemoryInvitationRepository()),
    enrollmentCoordinator: new EnrollmentCoordinator(createInMemoryEnrollmentRepository()),
    pairingService: new PairingService(deviceRepository),
    deviceSessionService,
    outboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext: (_senderKeyId, familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      familyId,
      now: nowUtc,
    }),
  });
  return { app, deviceRepository };
}

async function registerDevice(deviceRepository, familyId) {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    { deviceId, familyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null },
    { deviceId, keyId: `key-${randomUUID()}`, keyPurpose: 'DSK', publicKey, status: 'ACTIVE', createdAt: new Date(), revokedAt: null },
  );
  return { deviceId, publicKey };
}

const ATTACK_SIGNATURES = (deviceId, publicKey, nonce) => ({
  // A single space rather than an empty string -- the HTTP layer's own
  // `isNonEmptyString` input-shape check (runtimeSyncRoutes.ts) rejects a
  // truly empty signature with 400 before it ever reaches the verifier;
  // that is a distinct, already-covered validation concern, not the
  // crypto-gate claim this test makes. A non-empty-but-meaningless
  // signature reaches the real verifier and is what this test needs.
  'whitespace-only signature': ' ',
  'garbage bytes': Buffer.from('totally-forged-garbage').toString('base64'),
  'the nonce itself, replayed as if it were a signature': nonce,
  'the public key, replayed as if it were a signature': publicKey,
  'what a TEST-ONLY (non-production) verifier would accept -- must still fail against the REAL verifier': signTestOnlyChallenge(publicKey, nonce),
  'a signature that was valid for a DIFFERENT device\'s challenge': signTestOnlyChallenge('some-other-devices-pubkey', 'some-other-nonce'),
});

test('production crypto gate: no attacker strategy can ever mint a device session while RejectingDeviceSignatureVerifier is wired', async () => {
  const { app, deviceRepository } = buildProductionCryptoGateApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);

    for (let i = 0; i < 6; i += 1) {
      // Fresh challenge per attempt -- proves the gate holds across many
      // independent attempts, not just once.
      const challengeResponse = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
      assert.equal(challengeResponse.statusCode, 200);
      const { challengeId, nonce } = challengeResponse.json();

      const attacks = ATTACK_SIGNATURES(deviceId, publicKey, nonce);
      const [label, signature] = Object.entries(attacks)[i];

      const sessionResponse = await app.inject({
        method: 'POST',
        url: `/v1/runtime-sync/devices/${deviceId}/session`,
        payload: { challengeId, signature },
      });
      assert.equal(sessionResponse.statusCode, 401, `attack "${label}" must be rejected with 401, never a session token`);
      assert.deepEqual(sessionResponse.json(), { error: 'unauthorized' });
    }
  } finally {
    await app.close();
  }
});

test('production crypto gate: every runtime-sync route behind requireDeviceSession is unreachable, because no bearer token can ever be minted', async () => {
  const { app } = buildProductionCryptoGateApp();
  try {
    const bogusToken = `Bearer ${randomUUID()}`;
    const protectedRequests = [
      { method: 'POST', url: '/v1/runtime-sync/outbound', payload: { items: [] } },
      { method: 'GET', url: '/v1/runtime-sync/inbound' },
      { method: 'POST', url: '/v1/runtime-sync/inbound/some-message-id/ack' },
      { method: 'GET', url: '/v1/runtime-sync/status' },
    ];
    for (const req of protectedRequests) {
      const response = await app.inject({ ...req, headers: { authorization: bogusToken } });
      assert.equal(response.statusCode, 401, `${req.method} ${req.url} must reject any bearer token as unauthorized -- none was ever legitimately issued`);
    }
  } finally {
    await app.close();
  }
});

test('production crypto gate: the SAME signature that a TEST-ONLY verifier would accept is rejected end-to-end via HTTP, proving this is the real production verifier, not accidentally a permissive stand-in', async () => {
  const { app, deviceRepository } = buildProductionCryptoGateApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);

    const challengeResponse = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
    const { challengeId, nonce } = challengeResponse.json();
    const wouldBeAcceptedByTestOnlyVerifier = signTestOnlyChallenge(publicKey, nonce);

    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/v1/runtime-sync/devices/${deviceId}/session`,
      payload: { challengeId, signature: wouldBeAcceptedByTestOnlyVerifier },
    });
    assert.equal(sessionResponse.statusCode, 401);
  } finally {
    await app.close();
  }
});
