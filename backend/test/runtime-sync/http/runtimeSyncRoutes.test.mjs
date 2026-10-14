import { canonicalizeEnvelope } from '../../../dist/familyenvelope/canonicalize.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildServer, GLOBAL_BODY_LIMIT_BYTES } from '../../../dist/http/buildServer.js';
import { MAX_OUTBOUND_BODY_BYTES } from '../../../dist/http/routes/runtimeSyncRoutes.js';
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
  envelopeToRelayCiphertext,
  envelopeToRawFamilyEnvelope,
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  OutboundRelayService,
  InboundReconnectService,
  DeviceSyncStatusTracker,
} from '../../../dist/runtime-sync/index.js';
import { createInMemoryAuthRepository } from '../../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../../support/inMemoryAuthzRepository.mjs';
import { createInMemoryInvitationRepository } from '../../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../../support/testOnlyDeviceSignatureVerifier.mjs';
import { createTestOnlyEnvelopeSignatureVerifier, signTestOnlyEnvelope } from '../../support/testOnlyEnvelopeSignatureVerifier.mjs';
import {
  InMemoryDeviceProtectionStatusRepository,
  ProtectionStatusAuthorityChangedError,
  ProtectionStatusDeviceUnavailableError,
  ProtectionStatusStaleReportError,
} from '../../../dist/device/DeviceProtectionStatusRepository.js';
import { RealProtectiveAuthorityResolver } from '../../../dist/familyrbac/RealProtectiveAuthorityResolver.js';
import { MAX_RELAY_TTL_MS } from '../../../dist/relay/policy.js';
import { MAX_FAMILY_EPOCH } from '../../../dist/familyepoch/bounds.js';
import { RelayAuthorityChangedError } from '../../../dist/relay/RelayRepository.js';
import { ProtectionAlertProducer } from '../../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../../dist/alerts/ProtectionAlertLedger.js';

// Server-ciphertext TTL (migration 0034): the alert ledger now expires rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so fixtures dated in the past
// would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant these fixtures use.
const LEDGER_NOW = new Date('2026-08-21T00:00:00.000Z');

function buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting, alertComposeFailureLogger, envelopePublicKey = '', trustSetRoleResolver, relayNow } = {}) {
  const deviceRepository = createInMemoryDeviceRepository();
  const effectiveTrustSetRoleResolver = trustSetRoleResolver === undefined
    ? {
      async resolveActor(familyId, deviceId, dskKeyId) {
        const keys = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
        const activeDsks = keys.filter((key) => key.keyPurpose === 'DSK' && key.status === 'ACTIVE');
        if (activeDsks.length !== 1 ||
            (dskKeyId !== undefined && activeDsks[0].keyId !== dskKeyId)) {
          return 'DEVICE_NOT_ACTIVE';
        }
        return { familyId, deviceId, dskKeyId: activeDsks[0].keyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      },
    }
    : trustSetRoleResolver;
  const relayService = new RelayService(createInMemoryRelayRepository(), relayNow);
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const sessionRepository = new InMemoryDeviceSessionRepository();
  const deviceSessionService = new DeviceSessionService(deviceAuthService, sessionRepository);
  const outboundRelayService = new OutboundRelayService(relayService, deviceRepository);
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
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
      senderPublicKey: envelopePublicKey,
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      familyId,
      now: nowUtc,
    }),
    deviceProtectionStatusRepository,
    protectionStatusAlerting,
    alertComposeFailureLogger,
    trustSetRoleResolver: effectiveTrustSetRoleResolver,
  });
  return { app, deviceRepository, relayService, sessionRepository, deviceSessionService };
}

function makeAlerting({ enabled = true } = {}) {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const producer = new ProtectionAlertProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' }),
    () => new Date('2026-08-21T00:00:00.000Z'),
  );
  return {
    alerting: {
      producer,
      alertsEnabled: enabled,
      async resolveParentDevices() {
        return [{ deviceId: 'parent-device-1', keyEpoch: 3 }];
      },
    },
    ledger,
  };
}

async function registerDevice(deviceRepository, familyId, status = 'ACTIVE') {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  const dskKeyId = `key-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    { deviceId, familyId, platform: 'ANDROID', status, createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null },
    { deviceId, keyId: dskKeyId, keyPurpose: 'DSK', publicKey, status: 'ACTIVE', createdAt: new Date(), revokedAt: null },
  );
  return { deviceId, publicKey, dskKeyId };
}

async function authenticateDevice(app, deviceId, publicKey) {
  const challengeResponse = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
  assert.equal(challengeResponse.statusCode, 200);
  const { challengeId, nonce } = challengeResponse.json();
  const signature = signTestOnlyChallenge(publicKey, nonce);
  const sessionResponse = await app.inject({
    method: 'POST',
    url: `/v1/runtime-sync/devices/${deviceId}/session`,
    payload: { challengeId, signature },
  });
  assert.equal(sessionResponse.statusCode, 200);
  return sessionResponse.json().sessionToken;
}

function buildInboundStatusEnvelope(familyId, senderDeviceId, recipientDeviceId, publicKey) {
  const now = new Date();
  const unsigned = {
    protocolMajor: 1, protocolMinor: 0, messageId: randomUUID(), familyId, senderDeviceId,
    recipient: { kind: 'DEVICE', recipientDeviceId }, senderKeyId: 'wire-test-key',
    messageType: 'STATUS_SNAPSHOT', trustSetEpoch: 1, keyEpoch: 1, sequenceOrNonce: randomUUID(),
    issuedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60_000),
    semanticVersion: '1.0.0', correlationId: null, payload: Buffer.from('stale-response-sentinel'),
  };
  return { ...unsigned, signature: signTestOnlyEnvelope(publicKey, canonicalizeEnvelope(unsigned)) };
}

test('outbound submission without a session token is rejected with 401, never processed', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      payload: { items: [{ messageId: 'm1', recipientDeviceId: 'r1', ciphertext: Buffer.from('x').toString('base64'), messageType: 'STATUS_SNAPSHOT' }] },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('runtime-sync challenge, bearer issuance, authenticated data, and auth denials are private no-store', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const challenge = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
    assert.equal(challenge.statusCode, 200);
    assert.equal(challenge.headers['cache-control'], 'private, no-store');

    const { challengeId, nonce } = challenge.json();
    const session = await app.inject({
      method: 'POST',
      url: `/v1/runtime-sync/devices/${deviceId}/session`,
      payload: { challengeId, signature: signTestOnlyChallenge(publicKey, nonce) },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.headers['cache-control'], 'private, no-store');

    const headers = { authorization: `Bearer ${session.json().sessionToken}` };
    const status = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(status.statusCode, 200);
    assert.equal(status.headers['cache-control'], 'private, no-store');

    const unauthorized = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status' });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.headers['cache-control'], 'private, no-store');

    const oversizedOutbound = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify('x'.repeat(MAX_OUTBOUND_BODY_BYTES)),
    });
    assert.equal(oversizedOutbound.statusCode, 413);
    assert.equal(oversizedOutbound.headers['cache-control'], 'private, no-store');
  } finally {
    await app.close();
  }
});

test('runtime-sync challenge and session reject oversized bodies before reaching their handlers', async () => {
  const { app, sessionRepository, deviceSessionService } = buildApp();
  let challengeCalls = 0;
  let sessionCalls = 0;
  let repositoryCreateCalls = 0;
  const issueChallengeSafely = deviceSessionService.issueChallengeSafely.bind(deviceSessionService);
  const completeChallenge = deviceSessionService.completeChallenge.bind(deviceSessionService);
  const createSession = sessionRepository.create.bind(sessionRepository);
  deviceSessionService.issueChallengeSafely = async (...args) => {
    challengeCalls += 1;
    return issueChallengeSafely(...args);
  };
  deviceSessionService.completeChallenge = async (...args) => {
    sessionCalls += 1;
    return completeChallenge(...args);
  };
  sessionRepository.create = async (...args) => {
    repositoryCreateCalls += 1;
    return createSession(...args);
  };

  try {
    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/devices/nonexistent-device/challenge',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify('x'.repeat(1025)),
    });
    assert.equal(challengeResponse.statusCode, 413);
    assert.equal(challengeCalls, 0, 'challenge handler is not invoked for an oversized body');

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/devices/nonexistent-device/session',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ challengeId: 'c'.repeat(128), signature: 's'.repeat(4096), ignored: 'x'.repeat(26 * 1024) }),
    });
    assert.equal(sessionResponse.statusCode, 413);
    assert.equal(sessionCalls, 0, 'proof verification/session handler is not invoked for an oversized body');
    assert.equal(repositoryCreateCalls, 0, 'the session repository is never reached');
    assert.equal(GLOBAL_BODY_LIMIT_BYTES, 256 * 1024, 'route bounds do not change the global request ceiling');
  } finally {
    await app.close();
  }
});

test('full device auth flow: challenge -> session -> authenticated outbound submit', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: senderId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: recipientId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, senderId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [{ messageId: 'm1', recipientDeviceId: recipientId, ciphertext: Buffer.from('hello').toString('base64'), messageType: 'STATUS_SNAPSHOT' }],
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().results[0].outcome, 'QUEUED');
  } finally {
    await app.close();
  }
});

test('device session endpoint rejects a valid challenge issued for a different path device without minting a session', async () => {
  const { app, deviceRepository, sessionRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const signer = await registerDevice(deviceRepository, familyId);
    const pathDevice = await registerDevice(deviceRepository, familyId);
    const challengeResponse = await app.inject({
      method: 'POST',
      url: `/v1/runtime-sync/devices/${signer.deviceId}/challenge`,
    });
    assert.equal(challengeResponse.statusCode, 200);
    const { challengeId, nonce } = challengeResponse.json();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/runtime-sync/devices/${pathDevice.deviceId}/session`,
      payload: { challengeId, signature: signTestOnlyChallenge(signer.publicKey, nonce) },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'unauthorized' });
    assert.equal(sessionRepository.byTokenHash.size, 0, 'a path/challenge device mismatch must not create any bearer session');
  } finally {
    await app.close();
  }
});

test('outbound rejects pairing-pending, paired, or otherwise unaccepted same-family recipients without queueing', async () => {
  for (const directoryStatus of ['PAIRING_PENDING', 'PAIRED', 'ACTIVE']) {
    let senderDeviceId;
    let senderKeyId;
    let recipientDeviceId;
    const trustSetRoleResolver = {
      async resolveActor(familyId, deviceId, dskKeyId) {
        if (deviceId === senderDeviceId && dskKeyId === senderKeyId) {
          return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 3, keyEpoch: 2 };
        }
        if (deviceId === recipientDeviceId && dskKeyId === undefined) {
          return 'DEVICE_NOT_IN_TRUST_SET';
        }
        return 'DEVICE_NOT_ACTIVE';
      },
    };
    const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
    try {
      const familyId = `family-${randomUUID()}`;
      const sender = await registerDevice(deviceRepository, familyId);
      senderDeviceId = sender.deviceId;
      const [{ keyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, senderDeviceId);
      senderKeyId = keyId;
      recipientDeviceId = (await registerDevice(deviceRepository, familyId, directoryStatus)).deviceId;
      const token = await authenticateDevice(app, sender.deviceId, sender.publicKey);

      const response = await app.inject({
        method: 'POST', url: '/v1/runtime-sync/outbound',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{
          messageId: `unaccepted-${directoryStatus}`,
          recipientDeviceId,
          ciphertext: Buffer.from('opaque').toString('base64'),
          messageType: 'POLICY_UPDATE',
        }] },
      });
      assert.equal(response.statusCode, 200, directoryStatus);
      assert.deepEqual(response.json().results, [{ messageId: `unaccepted-${directoryStatus}`, outcome: 'INVALID' }]);
      assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
    } finally {
      await app.close();
    }
  }
});

test('outbound returns authority_unavailable and queues nothing when recipient Trust Set lookup throws', async () => {
  let senderDeviceId;
  let senderKeyId;
  let recipientDeviceId;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (deviceId === senderDeviceId && dskKeyId === senderKeyId) {
        return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 3, keyEpoch: 2 };
      }
      if (deviceId === recipientDeviceId && dskKeyId === undefined) throw new Error('resolver unavailable');
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const sender = await registerDevice(deviceRepository, familyId);
    senderDeviceId = sender.deviceId;
    const [{ keyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, senderDeviceId);
    senderKeyId = keyId;
    recipientDeviceId = (await registerDevice(deviceRepository, familyId, 'ACTIVE')).deviceId;
    const token = await authenticateDevice(app, sender.deviceId, sender.publicKey);

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{
        messageId: 'recipient-authority-unavailable', recipientDeviceId,
        ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'POLICY_UPDATE',
      }] },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
  } finally {
    await app.close();
  }
});

test('outbound rejects a recipient actor projected from a different family before relay insertion', async () => {
  let senderDeviceId;
  let senderDskKeyId;
  let recipientDeviceId;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (deviceId === senderDeviceId && dskKeyId === senderDskKeyId) {
        return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 };
      }
      if (deviceId === recipientDeviceId && dskKeyId === undefined) {
        return { familyId: `${familyId}-other`, deviceId, dskKeyId: 'recipient-dsk', role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      }
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const sender = await registerDevice(deviceRepository, familyId);
    const recipient = await registerDevice(deviceRepository, familyId);
    senderDeviceId = sender.deviceId;
    recipientDeviceId = recipient.deviceId;
    senderDskKeyId = (await deviceRepository.findKeysByDeviceForFamily(familyId, senderDeviceId))[0].keyId;
    const token = await authenticateDevice(app, senderDeviceId, sender.publicKey);
    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{
        messageId: 'cross-family-recipient-projection', recipientDeviceId,
        ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'POLICY_UPDATE',
      }] },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
  } finally {
    await app.close();
  }
});

test('outbound re-resolves the sender after the lazy recipient lookup before creating a relay item', async () => {
  let senderDeviceId;
  let recipientDeviceId;
  let senderKeyId;
  let recipientKeyId;
  let senderResolutionCount = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (deviceId === senderDeviceId && dskKeyId === senderKeyId) {
        senderResolutionCount += 1;
        if (senderResolutionCount === 1) {
          return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 };
        }
        return 'DEVICE_NOT_IN_TRUST_SET';
      }
      if (deviceId === recipientDeviceId && dskKeyId === undefined) {
        return { familyId, deviceId, dskKeyId: recipientKeyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      }
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const sender = await registerDevice(deviceRepository, familyId);
    const recipient = await registerDevice(deviceRepository, familyId);
    senderDeviceId = sender.deviceId;
    recipientDeviceId = recipient.deviceId;
    senderKeyId = (await deviceRepository.findKeysByDeviceForFamily(familyId, senderDeviceId))[0].keyId;
    recipientKeyId = (await deviceRepository.findKeysByDeviceForFamily(familyId, recipientDeviceId))[0].keyId;
    const token = await authenticateDevice(app, senderDeviceId, sender.publicKey);

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{
        messageId: 'sender-removed-before-enqueue', recipientDeviceId,
        ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().results, [{ messageId: 'sender-removed-before-enqueue', outcome: 'INVALID' }]);
    assert.equal(senderResolutionCount, 2);
    assert.deepEqual(await relayService.listQueuedForRecipient(recipientDeviceId), []);
  } finally {
    await app.close();
  }
});

test('runtime-sync transport binds the exact session DSK to current accepted membership before send, drain, acknowledgement, or status', async () => {
  const acceptedDskByDevice = new Map();
  const revokedDevices = new Set();
  const resolverCalls = [];
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls.push([familyId, deviceId, dskKeyId]);
      const acceptedDskKeyId = acceptedDskByDevice.get(deviceId);
      if (revokedDevices.has(deviceId) || !acceptedDskKeyId ||
          (dskKeyId !== undefined && acceptedDskKeyId !== dskKeyId)) return 'DEVICE_NOT_ACTIVE';
      return { familyId, deviceId, dskKeyId: acceptedDskKeyId, role: 'CHILD', trustSetEpoch: 3, keyEpoch: 2 };
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: senderId, publicKey: senderPublicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: recipientId, publicKey: recipientPublicKey } = await registerDevice(deviceRepository, familyId);
    const [{ keyId: senderDskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, senderId);
    const [{ keyId: recipientDskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, recipientId);
    acceptedDskByDevice.set(senderId, senderDskKeyId);
    acceptedDskByDevice.set(recipientId, recipientDskKeyId);
    const senderToken = await authenticateDevice(app, senderId, senderPublicKey);
    const recipientToken = await authenticateDevice(app, recipientId, recipientPublicKey);

    const outbound = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { items: [{
        messageId: 'accepted-runtime-sync-message', recipientDeviceId: recipientId,
        ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(outbound.statusCode, 200);
    assert.equal(outbound.json().results[0].outcome, 'QUEUED');
    assert.ok(resolverCalls.some(([family, device, key]) => family === familyId && device === senderId && key === senderDskKeyId));

    acceptedDskByDevice.set(recipientId, 'rotated-recipient-dsk');
    const staleRecipientDrain = await app.inject({
      method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${recipientToken}` },
    });
    assert.equal(staleRecipientDrain.statusCode, 403);
    assert.deepEqual(staleRecipientDrain.json(), { error: 'device_not_authorized' });
    assert.ok(resolverCalls.some(([family, device, key]) => family === familyId && device === recipientId && key === recipientDskKeyId),
      'membership resolution must receive the old key bound to the still-live session');
    assert.equal((await relayService.listQueuedForRecipient(recipientId)).length, 1,
      'a still-live directory session cannot drain ciphertext after accepted membership is revoked');

    const staleRecipientAck = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/inbound/accepted-runtime-sync-message/ack',
      headers: { authorization: `Bearer ${recipientToken}` },
    });
    assert.equal(staleRecipientAck.statusCode, 403);
    assert.deepEqual(staleRecipientAck.json(), { error: 'device_not_authorized' });
    assert.equal((await relayService.listQueuedForRecipient(recipientId)).length, 1,
      'a revoked recipient cannot acknowledge and discard a queued envelope');

    const staleRecipientStatus = await app.inject({
      method: 'GET', url: '/v1/runtime-sync/status',
      headers: { authorization: `Bearer ${recipientToken}` },
    });
    assert.equal(staleRecipientStatus.statusCode, 403);
    assert.deepEqual(staleRecipientStatus.json(), { error: 'device_not_authorized' });

    revokedDevices.add(senderId);
    const staleSenderSubmit = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { items: [{
        messageId: 'revoked-runtime-sync-message', recipientDeviceId: recipientId,
        ciphertext: Buffer.from('opaque').toString('base64'), messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(staleSenderSubmit.statusCode, 403);
    assert.deepEqual(staleSenderSubmit.json(), { error: 'device_not_authorized' });
    assert.equal((await relayService.listQueuedForRecipient(recipientId)).length, 1,
      'a revoked sender cannot enqueue another relay row');
  } finally {
    await app.close();
  }
});

test('device revocation invalidates its issued bearer before runtime-sync read, acknowledgement, status, or send', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const sender = await registerDevice(deviceRepository, familyId);
    const recipient = await registerDevice(deviceRepository, familyId);
    const senderToken = await authenticateDevice(app, sender.deviceId, sender.publicKey);
    const recipientToken = await authenticateDevice(app, recipient.deviceId, recipient.publicKey);
    const messageId = `revocation-${randomUUID()}`;

    const outbound = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { items: [{
        messageId,
        recipientDeviceId: recipient.deviceId,
        ciphertext: Buffer.from('opaque-revocation-proof').toString('base64'),
        messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(outbound.statusCode, 200);
    assert.equal(outbound.json().results[0].outcome, 'QUEUED');
    assert.equal((await relayService.listQueuedForRecipient(recipient.deviceId)).length, 1);

    await deviceRepository.revokeDeviceAndKeysAtomically(familyId, recipient.deviceId, new Date());
    for (const request of [
      { method: 'GET', url: '/v1/runtime-sync/inbound', token: recipientToken },
      { method: 'POST', url: `/v1/runtime-sync/inbound/${messageId}/ack`, token: recipientToken },
      { method: 'GET', url: '/v1/runtime-sync/status', token: recipientToken },
    ]) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${request.token}` },
      });
      assert.equal(response.statusCode, 401, `${request.method} ${request.url}`);
      assert.deepEqual(response.json(), { error: 'unauthorized' });
    }
    assert.equal((await relayService.listQueuedForRecipient(recipient.deviceId)).length, 1,
      'revoked recipient cannot read or acknowledge away previously queued ciphertext');

    await deviceRepository.revokeDeviceAndKeysAtomically(familyId, sender.deviceId, new Date());
    const staleSend = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { items: [{
        messageId: `after-revoke-${randomUUID()}`,
        recipientDeviceId: recipient.deviceId,
        ciphertext: Buffer.from('must-not-queue').toString('base64'),
        messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(staleSend.statusCode, 401);
    assert.deepEqual(staleSend.json(), { error: 'unauthorized' });
    assert.equal((await relayService.listQueuedForRecipient(recipient.deviceId)).length, 1,
      'revoked sender cannot enqueue new relay ciphertext');
  } finally {
    await app.close();
  }
});

test('runtime-sync transport fails closed with 503 when accepted Trust Set authority is not configured', async () => {
  const { app, deviceRepository } = buildApp({ trustSetRoleResolver: null });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const [{ keyId: dskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const response = await app.inject({
      method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
  } finally {
    await app.close();
  }
});

test('outbound accepts both valid relay TTL boundaries', async () => {
  // A 1 ms valid TTL must not expire while asynchronous authentication and
  // relay cleanup run. Keep the relay clock fixed so this test exercises
  // boundary validation, not wall-clock scheduling.
  const relayNow = () => new Date('2026-08-21T00:00:00.000Z');
  const { app, deviceRepository } = buildApp({ relayNow });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: senderId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: recipientId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, senderId, publicKey);
    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [1, MAX_RELAY_TTL_MS].map((ttlMs) => ({
        messageId: `ttl-${ttlMs}-${randomUUID()}`,
        recipientDeviceId: recipientId,
        ciphertext: Buffer.from('bounded test').toString('base64'),
        messageType: 'STATUS_SNAPSHOT',
        ttlMs,
      })) },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().results.map((result) => result.outcome), ['QUEUED', 'QUEUED']);
  } finally {
    await app.close();
  }
});

test('outbound rejects invalid, non-integer, non-finite, and out-of-range relay TTLs before queueing', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: senderId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: recipientId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, senderId, publicKey);
    const invalidTtls = [0, -1, 1.5, MAX_RELAY_TTL_MS + 1, '1000', null];
    for (const ttlMs of invalidTtls) {
      const response = await app.inject({
        method: 'POST', url: '/v1/runtime-sync/outbound',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{
          messageId: `invalid-ttl-${randomUUID()}`,
          recipientDeviceId: recipientId,
          ciphertext: Buffer.from('bounded test').toString('base64'),
          messageType: 'STATUS_SNAPSHOT',
          ttlMs,
        }] },
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_request' });
    }

    const nonFinite = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ items: [{
        messageId: `invalid-ttl-${randomUUID()}`,
        recipientDeviceId: recipientId,
        ciphertext: Buffer.from('bounded test').toString('base64'),
        messageType: 'STATUS_SNAPSHOT',
        ttlMs: 'NON_FINITE_SENTINEL',
      }] }).replace('"NON_FINITE_SENTINEL"', '1e400'),
    });
    assert.equal(nonFinite.statusCode, 400);
    assert.deepEqual(nonFinite.json(), { error: 'invalid_request' });
    assert.deepEqual(await relayService.listQueuedForRecipient(recipientId), []);
  } finally {
    await app.close();
  }
});

test('HTTP IDOR: an authenticated device cannot queue an envelope for a recipient in a different family', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyA = `family-${randomUUID()}`;
    const familyB = `family-${randomUUID()}`;
    const { deviceId: senderId, publicKey } = await registerDevice(deviceRepository, familyA);
    const { deviceId: victimId } = await registerDevice(deviceRepository, familyB);
    const token = await authenticateDevice(app, senderId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [{ messageId: 'm1', recipientDeviceId: victimId, ciphertext: Buffer.from('hello').toString('base64'), messageType: 'STATUS_SNAPSHOT' }],
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().results[0].outcome, 'CROSS_FAMILY_RECIPIENT');
  } finally {
    await app.close();
  }
});

test('a nonexistent device challenge never reveals device existence -- same response shape as a real device', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: realDeviceId } = await registerDevice(deviceRepository, familyId);

    const real = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${realDeviceId}/challenge` });
    const fake = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/nonexistent-device/challenge` });
    assert.equal(real.statusCode, 200);
    assert.equal(fake.statusCode, 200);
    assert.deepEqual(Object.keys(real.json()).sort(), Object.keys(fake.json()).sort());
  } finally {
    await app.close();
  }
});

test('GET /v1/runtime-sync/inbound requires a device session and returns an empty list for a device with nothing queued', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound' });
    assert.equal(unauthenticated.statusCode, 401);

    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().applied, []);
  } finally {
    await app.close();
  }
});

test('HTTP continuation crosses empty malformed pages and retains every queued record', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    for (let i = 0; i < 105; i += 1) await relayService.queueEnvelope({
      messageId: `${randomUUID()}-malformed-${i}`, familyId, senderDeviceId: deviceId, recipientDeviceId: deviceId,
      ciphertext: Buffer.from('malformed'),
    });
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers });
    assert.equal(first.statusCode, 200);
    const page = first.json();
    assert.deepEqual(page.applied, []);
    assert.equal(page.unparseableMessageIds.length, 100);
    assert.equal(page.hasMore, true);
    assert.equal(page.hasUnresolved, true);
    assert.match(page.sessionIncarnation, /^[0-9a-f]{64}$/);
    assert.notEqual(page.sessionIncarnation, token);
    const statusAfterFirstPage = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(statusAfterFirstPage.json().connectionState, 'STALE');
    const tail = await app.inject({ method: 'GET', url: `/v1/runtime-sync/inbound?cursor=${page.nextCursor}`, headers });
    assert.equal(tail.statusCode, 200);
    assert.equal(tail.json().unparseableMessageIds.length, 5);
    assert.equal(tail.json().hasMore, false);
    assert.equal(tail.json().nextCursor, null);
    assert.equal(tail.json().hasUnresolved, true);
    const statusAfterUnresolvedTail = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(statusAfterUnresolvedTail.json().connectionState, 'STALE');
    assert.equal((await relayService.listQueuedForRecipient(deviceId)).length, 105);
  } finally { await app.close(); }
});

test('inbound marks sync successful only after a fully resolved final page', async () => {
  const envelopePublicKey = 'wire-test-public-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60_000);

    for (let i = 0; i < 101; i += 1) {
      const unsigned = {
        protocolMajor: 1, protocolMinor: 0, messageId: randomUUID(), familyId, senderDeviceId,
        recipient: { kind: 'DEVICE', recipientDeviceId }, senderKeyId: 'wire-test-key',
        messageType: 'STATUS_SNAPSHOT', trustSetEpoch: 1, keyEpoch: 1, sequenceOrNonce: randomUUID(),
        issuedAt, expiresAt, semanticVersion: '1.0.0', correlationId: null, payload: Buffer.from('opaque-ciphertext'),
      };
      const envelope = { ...unsigned, signature: signTestOnlyEnvelope(envelopePublicKey, canonicalizeEnvelope(unsigned)) };
      await relayService.queueEnvelope({
        messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
        ciphertext: envelopeToRelayCiphertext(envelope),
      });
    }

    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().applied.length, 100);
    assert.equal(first.json().hasMore, true);
    assert.equal(first.json().hasUnresolved, false);
    const statusAfterIncompletePage = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(statusAfterIncompletePage.json().connectionState, 'STALE');

    const final = await app.inject({
      method: 'GET', url: `/v1/runtime-sync/inbound?cursor=${first.json().nextCursor}`, headers,
    });
    assert.equal(final.statusCode, 200);
    assert.equal(final.json().applied.length, 1);
    assert.equal(final.json().hasMore, false);
    assert.equal(final.json().hasUnresolved, false);
    const statusAfterResolvedFinalPage = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(statusAfterResolvedFinalPage.json().connectionState, 'LIVE');
  } finally { await app.close(); }
});

test('rejected inbound envelopes do not advance successful-sync status', async () => {
  const envelopePublicKey = 'wire-test-public-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const issuedAt = new Date();
    const unsigned = {
      protocolMajor: 1, protocolMinor: 0, messageId: randomUUID(), familyId, senderDeviceId,
      recipient: { kind: 'DEVICE', recipientDeviceId }, senderKeyId: 'wire-test-key',
      messageType: 'STATUS_SNAPSHOT', trustSetEpoch: 1, keyEpoch: 1, sequenceOrNonce: randomUUID(),
      issuedAt, expiresAt: new Date(issuedAt.getTime() + 60_000),
      semanticVersion: '1.0.0', correlationId: null, payload: Buffer.from('opaque-ciphertext'),
    };
    const envelope = { ...unsigned, signature: signTestOnlyEnvelope('different-public-key', canonicalizeEnvelope(unsigned)) };
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });

    const headers = { authorization: `Bearer ${token}` };
    const inbound = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers });
    assert.equal(inbound.statusCode, 200);
    assert.equal(inbound.json().hasUnresolved, true);
    assert.equal(inbound.json().receipts.length, 1);
    assert.equal(inbound.json().receipts[0].outcome, 'REJECTED');
    assert.equal(inbound.json().receipts[0].reason, 'INVALID_SIGNATURE');
    const status = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers });
    assert.equal(status.json().connectionState, 'STALE');
  } finally { await app.close(); }
});

test('HTTP cursor cannot cross a recipient, family or freshly authenticated session incarnation', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const own = await registerDevice(deviceRepository, familyId);
    const firstToken = await authenticateDevice(app, own.deviceId, own.publicKey);
    for (let i = 0; i < 101; i += 1) await relayService.queueEnvelope({
      messageId: randomUUID(), familyId, senderDeviceId: own.deviceId, recipientDeviceId: own.deviceId, ciphertext: Buffer.from('malformed'),
    });
    const first = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers: { authorization: `Bearer ${firstToken}` } });
    assert.equal(first.statusCode, 200);
    const cursor = first.json().nextCursor;
    const replacement = await authenticateDevice(app, own.deviceId, own.publicKey);
    const sibling = await registerDevice(deviceRepository, familyId);
    const siblingToken = await authenticateDevice(app, sibling.deviceId, sibling.publicKey);
    const foreign = await registerDevice(deviceRepository, `other-${randomUUID()}`);
    const foreignToken = await authenticateDevice(app, foreign.deviceId, foreign.publicKey);
    for (const token of [replacement, siblingToken, foreignToken]) {
      const response = await app.inject({ method: 'GET', url: `/v1/runtime-sync/inbound?cursor=${cursor}`,
        headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_cursor' });
    }
    assert.equal((await relayService.listQueuedForRecipient(own.deviceId)).length, 101);
  } finally { await app.close(); }
});

test('HTTP cursor rejects malformed, expired, inverted and excessive navigation without changing custody', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const own = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, own.deviceId, own.publicKey);
    for (let i = 0; i < 101; i += 1) await relayService.queueEnvelope({
      messageId: randomUUID(), familyId, senderDeviceId: own.deviceId, recipientDeviceId: own.deviceId, ciphertext: Buffer.from('malformed'),
    });
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers });
    const claim = JSON.parse(Buffer.from(first.json().nextCursor, 'base64url').toString());
    const wire = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of ['!', 'a'.repeat(6145), wire({ ...claim, version: 2 }),
      wire({ ...claim, startedAtMs: Date.now() - 16 * 60 * 1000 }), wire({ ...claim, after: claim.highWater })]) {
      const response = await app.inject({ method: 'GET', url: `/v1/runtime-sync/inbound?cursor=${encodeURIComponent(cursor)}`, headers });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_cursor' });
    }
    const repeated = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound?cursor=a&cursor=b', headers });
    assert.equal(repeated.statusCode, 400);
    assert.equal((await relayService.listQueuedForRecipient(own.deviceId)).length, 101);
  } finally { await app.close(); }
});

test('POST /v1/runtime-sync/inbound/:messageId/ack returns 404 for an unknown/not-this-recipient messageId', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/inbound/nonexistent-message-id/ack',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'not_found' });
  } finally {
    await app.close();
  }
});

test('expired relay acknowledgement returns the exact terminal not_found contract for device retry', async () => {
  let nowMs = Date.now();
  const { app, deviceRepository, relayService } = buildApp({ relayNow: () => new Date(nowMs) });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const messageId = randomUUID();
    await relayService.queueEnvelope({
      messageId, familyId, senderDeviceId: `sender-${randomUUID()}`,
      recipientDeviceId: deviceId, ciphertext: Buffer.from('opaque'), ttlMs: 1000,
    });
    nowMs += 1001;

    const response = await app.inject({
      method: 'POST', url: `/v1/runtime-sync/inbound/${messageId}/ack`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, '{"error":"not_found"}');
  } finally { await app.close(); }
});

test('POST /v1/runtime-sync/inbound/:messageId/ack rechecks current device authority before relay mutation', async () => {
  let resolveCount = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCount += 1;
      // The first check is the session preHandler. Membership is revoked
      // before the route's final check; the relay must not see an ACK call.
      if (resolveCount === 1) return { familyId, deviceId, dskKeyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const message = {
      messageId: randomUUID(), familyId, senderDeviceId: `sender-${randomUUID()}`,
      recipientDeviceId: deviceId, ciphertext: Buffer.from('opaque'),
    };
    await relayService.queueEnvelope(message);

    const response = await app.inject({
      method: 'POST', url: `/v1/runtime-sync/inbound/${message.messageId}/ack`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.equal(resolveCount, 2);
    assert.equal((await relayService.fetchEnvelope(deviceId, message.messageId)).state, 'QUEUED');
  } finally {
    await app.close();
  }
});

test('POST /v1/runtime-sync/inbound/:messageId/ack surfaces a genuine (non-RelayError) failure as a 5xx, never swallows it into a 404', async () => {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
  // A stand-in whose acknowledgeAsRecipient throws a plain infrastructure-style
  // error (e.g. what a genuine DB outage would surface as) rather than a
  // domain-level RelayError -- proves the route no longer collapses this to
  // a client-facing 404 (the bug the diff under test fixes).
  const failingOutboundRelayService = {
    acknowledgeAsRecipient: async () => {
      throw new Error('simulated DB outage');
    },
  };
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
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
    outboundRelayService: failingOutboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext: (_senderKeyId, familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      familyId,
      now: nowUtc,
    }),
    // This test isolates the relay's infrastructure-error response after a
    // valid authenticated sender has passed the current-membership preHandler.
    // The production authority is replaced with a test resolver that accepts
    // only the exact active DSK registered for this device and family.
    trustSetRoleResolver: {
      async resolveActor(acceptedFamilyId, acceptedDeviceId, dskKeyId) {
        const keys = await deviceRepository.findKeysByDeviceForFamily(acceptedFamilyId, acceptedDeviceId);
        if (!keys.some((key) => key.keyPurpose === 'DSK' && key.keyId === dskKeyId && key.status === 'ACTIVE')) {
          return 'DEVICE_NOT_ACTIVE';
        }
        return { familyId: acceptedFamilyId, deviceId: acceptedDeviceId, dskKeyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      },
    },
  });

  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/inbound/some-message-id/ack',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_error' });
  } finally {
    await app.close();
  }
});

test('GET /v1/runtime-sync/status reports LIVE only after a successful sync, never from reachability alone', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const beforeSync = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers: { authorization: `Bearer ${token}` } });
    assert.equal(beforeSync.json().connectionState, 'STALE');

    await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound', headers: { authorization: `Bearer ${token}` } });
    const afterSync = await app.inject({ method: 'GET', url: '/v1/runtime-sync/status', headers: { authorization: `Bearer ${token}` } });
    assert.equal(afterSync.json().connectionState, 'LIVE');
  } finally {
    await app.close();
  }
});

// --- PCA-ADD-ENR-016/PCA-FR-145: device-reported protection status ---

test('protection-status route is not registered at all when no repository is configured (404, not merely 401)', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/runtime-sync/protection-status', payload: { protectionLevel: 'PROTECTED' } });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('reporting protection status without a session token is rejected with 401, never recorded', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { app } = buildApp({ deviceProtectionStatusRepository });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/runtime-sync/protection-status', payload: { protectionLevel: 'PROTECTED' } });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('protection-status binds and rechecks the live session DSK against the exact accepted Trust Set actor before writing', async () => {
  const calls = [];
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const trustSetRoleResolver = {
    async resolveActor(...args) {
      calls.push(args);
      return { familyId: args[0], deviceId: args[1], dskKeyId: args[2], role: 'OWNER', trustSetEpoch: 4, keyEpoch: 1 };
    },
  };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const [{ keyId: dskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });
    assert.equal(response.statusCode, 204);
    assert.deepEqual(calls, [[familyId, deviceId, dskKeyId], [familyId, deviceId, dskKeyId]]);
    assert.equal((await deviceProtectionStatusRepository.findForDevice(familyId, deviceId))?.protectionLevel, 'PROTECTED');
  } finally {
    await app.close();
  }
});

test('protection-status rechecks exact session authority at the write boundary after Trust Set removal', async () => {
  const calls = [];
  const deviceProtectionStatusRepository = {
    writeCalls: 0,
    async upsert() { this.writeCalls += 1; },
    async recordAndReadPrevious() { this.writeCalls += 1; return null; },
  };
  const trustSetRoleResolver = {
    async resolveActor(...args) {
      calls.push(args);
      return calls.length === 1
        ? { familyId: args[0], deviceId: args[1], dskKeyId: args[2], role: 'OWNER', trustSetEpoch: 4, keyEpoch: 1 }
        : 'DEVICE_NOT_ACTIVE';
    },
  };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const [{ keyId: dskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.deepEqual(calls, [[familyId, deviceId, dskKeyId], [familyId, deviceId, dskKeyId]]);
    assert.equal(deviceProtectionStatusRepository.writeCalls, 0, 'authority removed after preHandler must not reach durable write');
  } finally {
    await app.close();
  }
});

test('protection-status rejects an out-of-range accepted head at the final write boundary', async () => {
  let resolveCalls = 0;
  const deviceProtectionStatusRepository = {
    writeCalls: 0,
    async upsert() { this.writeCalls += 1; },
    async recordAndReadPrevious() { this.writeCalls += 1; return null; },
  };
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCalls += 1;
      return {
        familyId,
        deviceId,
        dskKeyId,
        role: 'OWNER',
        trustSetEpoch: resolveCalls === 1 ? 4 : MAX_FAMILY_EPOCH + 1,
        keyEpoch: 1,
      };
    },
  };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(resolveCalls, 2, 'the accepted head is re-resolved immediately before persistence');
    assert.equal(deviceProtectionStatusRepository.writeCalls, 0, 'invalid final authority cannot reach durable write');
  } finally {
    await app.close();
  }
});

test('protection-status passes the resolved head to persistence and suppresses alert side effects when the locked floor changed', async () => {
  let persistedAuthority;
  let alertCalls = 0;
  const deviceProtectionStatusRepository = {
    async upsert(_record, authority) {
      persistedAuthority = authority;
      throw new ProtectionStatusAuthorityChangedError();
    },
    async recordAndReadPrevious(_record, authority) {
      persistedAuthority = authority;
      throw new ProtectionStatusAuthorityChangedError();
    },
  };
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 7, keyEpoch: 3 };
    },
  };
  const protectionStatusAlerting = {
    producer: { async produce() { alertCalls += 1; } },
    alertsEnabled: true,
    async resolveParentDevices() { return [{ deviceId: 'parent-device', keyEpoch: 3 }]; },
  };
  const { app, deviceRepository } = buildApp({
    deviceProtectionStatusRepository,
    protectionStatusAlerting,
    trustSetRoleResolver,
  });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const [{ keyId: dskKeyId }] = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { protectionLevel: 'DEGRADED' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.deepEqual(persistedAuthority, { dskKeyId, trustSetEpoch: 7, keyEpoch: 3 });
    assert.equal(alertCalls, 0, 'a rejected stale snapshot cannot trigger protection alerts');
  } finally {
    await app.close();
  }
});

test('protection-status fails closed when accepted Trust Set authority is unavailable, stale, mismatched, or malformed', async () => {
  const deviceProtectionStatusRepository = {
    findCalls: 0,
    writeCalls: 0,
    async findForDevice() { this.findCalls += 1; return null; },
    async upsert() { this.writeCalls += 1; },
  };
  const alerting = {
    producer: { async produce() { throw new Error('must not alert'); } },
    alertsEnabled: true,
    async resolveParentDevices() { throw new Error('must not resolve recipients'); },
  };
  const failureResolvers = [
    null,
    { async resolveActor() { throw new Error('resolver unavailable'); } },
    { async resolveActor() { return 'DEVICE_NOT_ACTIVE'; } },
    { async resolveActor(familyId, deviceId) { return { familyId: `${familyId}-other`, deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 }; } },
    { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 0, keyEpoch: 1 }; } },
    { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 0 }; } },
    { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: -1 }; } },
    { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: MAX_FAMILY_EPOCH + 1, keyEpoch: 1 }; } },
    { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: MAX_FAMILY_EPOCH + 1 }; } },
  ];
  for (const trustSetRoleResolver of failureResolvers) {
    const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting, trustSetRoleResolver });
    try {
      const familyId = `family-${randomUUID()}`;
      const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
      const token = await authenticateDevice(app, deviceId, publicKey);
      const response = await app.inject({
        method: 'POST', url: '/v1/runtime-sync/protection-status',
        headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
      });
      assert.ok([403, 503].includes(response.statusCode), `unexpected status ${response.statusCode}`);
      assert.deepEqual(response.json(), { error: response.statusCode === 403 ? 'device_not_authorized' : 'authority_unavailable' });
    } finally {
      await app.close();
    }
  }
  assert.equal(deviceProtectionStatusRepository.findCalls, 0);
  assert.equal(deviceProtectionStatusRepository.writeCalls, 0);
});

test('protection-status maps a device/family deactivation at the persistence boundary to authorization failure', async () => {
  const deviceProtectionStatusRepository = {
    async upsert() { throw new ProtectionStatusDeviceUnavailableError(); },
    async recordAndReadPrevious() { throw new ProtectionStatusDeviceUnavailableError(); },
  };
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.deepEqual(await ledger.listForFamily(familyId), []);
  } finally {
    await app.close();
  }
});

test('an invalid protectionLevel value is rejected with 400', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { protectionLevel: 'SOMETHING_MADE_UP' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('malformed protection-status bodies are rejected with 400 and never reach the repository', async () => {
  let writes = 0;
  const deviceProtectionStatusRepository = {
    async findForDevice() { return null; },
    async upsert() { writes += 1; },
  };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    for (const payload of [null, [], 'PROTECTED', 7]) {
      const response = await app.inject({
        method: 'POST', url: '/v1/runtime-sync/protection-status',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_request' });
    }
    assert.equal(writes, 0);
  } finally {
    await app.close();
  }
});

test('protection-status server receipt time is captured before the alert lookup can delay the write', async () => {
  let resolveLookupStarted;
  const lookupStarted = new Promise((resolve) => { resolveLookupStarted = resolve; });
  let releaseLookup;
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  let stored = null;
  const deviceProtectionStatusRepository = {
    async recordAndReadPrevious(record) {
      resolveLookupStarted();
      await lookupGate;
      stored = record;
      return null;
    },
    async upsert(record) { stored = record; },
  };
  const protectionStatusAlerting = {
    producer: { async produce() {} },
    alertsEnabled: true,
    async resolveParentDevices() { return []; },
  };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const responsePromise = app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        protectionLevel: 'PROTECTED',
        familyId: `forged-${randomUUID()}`,
        deviceId: `forged-${randomUUID()}`,
        updatedAt: '1999-01-01T00:00:00.000Z',
      },
    });
    await lookupStarted;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const beforeLookupRelease = Date.now();
    releaseLookup();
    const response = await responsePromise;

    assert.equal(response.statusCode, 204);
    assert.equal(stored.deviceId, deviceId);
    assert.equal(stored.familyId, familyId);
    assert.equal(stored.protectionLevel, 'PROTECTED');
    assert.ok(stored.updatedAt instanceof Date);
    assert.ok(stored.updatedAt.getTime() < beforeLookupRelease,
      'the server receipt timestamp must be captured before awaiting the prior-status lookup');
    assert.ok(stored.updatedAt.getTime() > Date.parse('1999-01-01T00:00:00.000Z'),
      'the timestamp must come from the server, not the request body');
  } finally {
    releaseLookup();
    await app.close();
  }
});

test('concurrent DEGRADED reports emit only one transition alert', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    await deviceProtectionStatusRepository.upsert({
      deviceId,
      familyId,
      protectionLevel: 'PROTECTED',
      updatedAt: new Date(),
    });
    const report = () => app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
    });

    const responses = await Promise.all([report(), report()]);
    assert.deepEqual(responses.map((response) => response.statusCode), [204, 204]);
    assert.deepEqual((await ledger.listForFamily(familyId)).map((event) => event.trigger), ['PROTECTION_DEGRADED']);
    assert.equal((await deviceProtectionStatusRepository.findForDevice(familyId, deviceId))?.protectionLevel, 'DEGRADED');
  } finally {
    await app.close();
  }
});

test('a stale DEGRADED report is a no-op and cannot emit a transition alert', async () => {
  const familyId = randomUUID();
  const { alerting, ledger } = makeAlerting();
  const staleStatusRepository = {
    async upsert() { throw new ProtectionStatusStaleReportError(); },
    async recordAndReadPrevious() { throw new ProtectionStatusStaleReportError(); },
    async findForDevice() { return null; },
  };
  const { app, deviceRepository } = buildApp({
    deviceProtectionStatusRepository: staleStatusRepository,
    protectionStatusAlerting: alerting,
  });
  try {
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { protectionLevel: 'DEGRADED' },
    });

    assert.equal(response.statusCode, 204, response.body);
    assert.equal(response.body, '');
    assert.deepEqual(await ledger.listForFamily(familyId), []);
  } finally {
    await app.close();
  }
});

test('a real device-session-authenticated report is recorded under the SESSION identity, and RealProtectiveAuthorityResolver then resolves true for that exact family/device', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { protectionLevel: 'PROTECTED' },
    });
    assert.equal(response.statusCode, 204);

    const record = await deviceProtectionStatusRepository.findForDevice(familyId, deviceId);
    assert.ok(record, 'the report must be durably recorded');
    assert.equal(record.protectionLevel, 'PROTECTED');

    const resolver = new RealProtectiveAuthorityResolver(deviceProtectionStatusRepository);
    assert.equal(await resolver.resolve(familyId, deviceId), true);
    // A different device/family must never see this report.
    assert.equal(await resolver.resolve(familyId, `device-${randomUUID()}`), false);
    assert.equal(await resolver.resolve(`family-${randomUUID()}`, deviceId), false);
  } finally {
    await app.close();
  }
});

test('a device can never report status for a different device -- the id always comes from the verified session, never the request body', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: reportingDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: otherDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, reportingDeviceId, publicKey);

    // Even if the request body tried to claim a different deviceId, the
    // route never reads deviceId from the body at all -- there is no field
    // for it. Confirm the record lands under the AUTHENTICATED device only.
    await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` },
      payload: { protectionLevel: 'PROTECTED', deviceId: otherDeviceId },
    });

    assert.equal((await deviceProtectionStatusRepository.findForDevice(familyId, reportingDeviceId))?.protectionLevel, 'PROTECTED');
    assert.equal(await deviceProtectionStatusRepository.findForDevice(familyId, otherDeviceId), null);
  } finally {
    await app.close();
  }
});

// --- PCA-ADD-ENR-020: PROTECTION_DEGRADED alert on transition ---

test('a report that transitions a device INTO DEGRADED emits PROTECTION_DEGRADED', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });
    let events = await ledger.listForFamily(familyId);
    assert.deepEqual(events, [], 'the FIRST report is never itself a degradation transition');

    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
    });
    assert.equal(response.statusCode, 204);
    events = await ledger.listForFamily(familyId);
    assert.deepEqual(events.map((e) => e.trigger), ['PROTECTION_DEGRADED']);
    assert.equal(events[0].deviceId, deviceId);
  } finally {
    await app.close();
  }
});

test('FABLE-A013: a swallowed alert compose failure is logged once, bounded, and the report still succeeds', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const composeError = new Error('PRIVATE NOTE SECRET CIPHERTEXT RAW SQL KEY MATERIAL');
  const alerting = {
    producer: { async produce() { throw composeError; } },
    alertsEnabled: true,
    async resolveParentDevices() {
      return [{ deviceId: 'parent-device-1', keyEpoch: 3 }];
    },
  };
  const warnCalls = [];
  const alertComposeFailureLogger = { warn: (event, detail) => warnCalls.push({ event, detail }) };
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting, alertComposeFailureLogger });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });
    const response = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
    });
    assert.equal(response.statusCode, 204, 'a swallowed alert failure must never block or reverse the status write');

    assert.equal(warnCalls.length, 1);
    assert.equal(warnCalls[0].event, 'runtime_sync.protection_degraded_alert.compose_failed');
    assert.equal(warnCalls[0].detail.familyId, familyId);
    assert.equal(warnCalls[0].detail.deviceId, deviceId);
    assert.equal(warnCalls[0].detail.trigger, 'PROTECTION_DEGRADED');
    assert.equal(warnCalls[0].detail.error, 'ALERT_DELIVERY_FAILED');
    assert.doesNotMatch(JSON.stringify(warnCalls), /PRIVATE NOTE|SECRET CIPHERTEXT|RAW SQL|KEY MATERIAL/);
  } finally {
    await app.close();
  }
});

test('repeated DEGRADED reports emit PROTECTION_DEGRADED only once -- no alert on an already-degraded device', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);

    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST', url: '/v1/runtime-sync/protection-status',
        headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'DEGRADED' },
      });
    }
    const events = await ledger.listForFamily(familyId);
    assert.equal(events.length, 1);
  } finally {
    await app.close();
  }
});

test('a non-DEGRADED report never emits PROTECTION_DEGRADED', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    await app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: 'PROTECTED' },
    });
    assert.deepEqual(await ledger.listForFamily(familyId), []);
  } finally {
    await app.close();
  }
});

test('recovering FROM DEGRADED back to DEGRADED again re-emits PROTECTION_DEGRADED (a real re-transition, not a stale dedup)', async () => {
  const deviceProtectionStatusRepository = new InMemoryDeviceProtectionStatusRepository();
  const { alerting, ledger } = makeAlerting();
  const { app, deviceRepository } = buildApp({ deviceProtectionStatusRepository, protectionStatusAlerting: alerting });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, deviceId, publicKey);
    const report = (level) => app.inject({
      method: 'POST', url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${token}` }, payload: { protectionLevel: level },
    });
    await report('DEGRADED');
    await report('PROTECTED');
    await report('DEGRADED');
    const events = await ledger.listForFamily(familyId);
    assert.deepEqual(events.map((e) => e.trigger), ['PROTECTION_DEGRADED', 'PROTECTION_DEGRADED']);
  } finally {
    await app.close();
  }
});

test('inbound returns full signed envelope and verified session scope, ignoring query identity claims', async () => {
  const envelopePublicKey = 'wire-test-public-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const now = new Date();
    const unsigned = {
      protocolMajor: 1, protocolMinor: 0, messageId: randomUUID(), familyId, senderDeviceId,
      recipient: { kind: 'DEVICE', recipientDeviceId }, senderKeyId: 'wire-test-key',
      messageType: 'STATUS_SNAPSHOT', trustSetEpoch: 1, keyEpoch: 1, sequenceOrNonce: randomUUID(),
      issuedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000),
      semanticVersion: '1.0.0', correlationId: null, payload: Buffer.from('opaque-ciphertext'),
    };
    const envelope = { ...unsigned, signature: signTestOnlyEnvelope(envelopePublicKey, canonicalizeEnvelope(unsigned)) };
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });
    const response = await app.inject({ method: 'GET',
      url: '/v1/runtime-sync/inbound?familyId=forged-family&deviceId=forged-device',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().scope, { familyId, recipientDeviceId });
    assert.deepEqual(response.json().applied, [envelopeToRawFamilyEnvelope(envelope)]);
  } finally { await app.close(); }
});

test('inbound fails closed without a partial response when recipient authority changes during page read', async () => {
  const { app, deviceRepository, relayService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    let observedSnapshot;
    const original = relayService.listQueuedPageForRecipient.bind(relayService);
    relayService.listQueuedPageForRecipient = async (...args) => {
      observedSnapshot = args[4];
      throw new RelayAuthorityChangedError();
    };
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound',
        headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { error: 'device_not_authorized' });
      assert.deepEqual(Object.keys(response.json()).sort(), ['error']);
      assert.equal(observedSnapshot.familyId, familyId);
      assert.equal(observedSnapshot.dskKeyId.startsWith('key-'), true);
      assert.equal(observedSnapshot.trustSetEpoch, 1);
      assert.equal(observedSnapshot.keyEpoch, 1);
    } finally {
      relayService.listQueuedPageForRecipient = original;
    }
  } finally { await app.close(); }
});

test('inbound suppresses ciphertext when the exact session DSK is revoked during reconnect processing', async () => {
  let resolveCalls = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCalls += 1;
      return resolveCalls === 1
        ? { familyId, deviceId, dskKeyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 }
        : 'DEVICE_NOT_ACTIVE';
    },
  };
  const envelopePublicKey = 'inbound-recheck-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const envelope = buildInboundStatusEnvelope(familyId, senderDeviceId, recipientDeviceId, envelopePublicKey);
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${token}` } });

    assert.equal(resolveCalls, 2, 'second authority resolution runs after the inbound service has processed its page');
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.equal(JSON.stringify(response.json()).includes(envelope.messageId), false);
    assert.equal(JSON.stringify(response.json()).includes('stale-response-sentinel'), false);
    assert.equal((await relayService.listQueuedForRecipient(recipientDeviceId)).length, 1,
      'a response-gate rejection does not implicitly acknowledge the queued envelope');
  } finally { await app.close(); }
});

test('inbound suppresses ciphertext when the accepted Trust Set head changes during reconnect processing', async () => {
  let resolveCalls = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCalls += 1;
      return { familyId, deviceId, dskKeyId, role: 'CHILD', trustSetEpoch: resolveCalls === 1 ? 1 : 2, keyEpoch: 1 };
    },
  };
  const envelopePublicKey = 'inbound-head-recheck-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const envelope = buildInboundStatusEnvelope(familyId, senderDeviceId, recipientDeviceId, envelopePublicKey);
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${token}` } });

    assert.equal(resolveCalls, 2, 'second authority resolution runs after the inbound service has processed its page');
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.equal(JSON.stringify(response.json()).includes(envelope.messageId), false);
    assert.equal(JSON.stringify(response.json()).includes('stale-response-sentinel'), false);
    assert.equal((await relayService.listQueuedForRecipient(recipientDeviceId)).length, 1,
      'a response-gate rejection does not implicitly acknowledge the queued envelope');
  } finally { await app.close(); }
});

test('inbound suppresses ciphertext when post-read authority exceeds the shared family epoch bound', async () => {
  let resolveCalls = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCalls += 1;
      return {
        familyId, deviceId, dskKeyId, role: 'CHILD',
        trustSetEpoch: resolveCalls === 1 ? 1 : MAX_FAMILY_EPOCH + 1,
        keyEpoch: 1,
      };
    },
  };
  const envelopePublicKey = 'inbound-overflow-epoch-recheck-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const envelope = buildInboundStatusEnvelope(familyId, senderDeviceId, recipientDeviceId, envelopePublicKey);
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${token}` } });

    assert.equal(resolveCalls, 2, 'authority is re-resolved after inbound processing');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(JSON.stringify(response.json()).includes(envelope.messageId), false);
    assert.equal((await relayService.listQueuedForRecipient(recipientDeviceId)).length, 1,
      'invalid post-read authority does not implicitly acknowledge the queued envelope');
  } finally { await app.close(); }
});

test('ACK rejects an out-of-range final authority projection without acknowledging queued ciphertext', async () => {
  let rejectFinalProjection = false;
  let resolveCalls = 0;
  const dskKeyIds = new Map();
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (rejectFinalProjection) {
        resolveCalls += 1;
        return {
          familyId, deviceId, dskKeyId: dskKeyId ?? dskKeyIds.get(deviceId), role: 'CHILD',
          trustSetEpoch: resolveCalls === 2 ? MAX_FAMILY_EPOCH + 1 : 1,
          keyEpoch: 1,
        };
      }
      return { familyId, deviceId, dskKeyId: dskKeyId ?? dskKeyIds.get(deviceId), role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
    },
  };
  const { app, deviceRepository, relayService } = buildApp({ trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const sender = await registerDevice(deviceRepository, familyId);
    const recipient = await registerDevice(deviceRepository, familyId);
    dskKeyIds.set(sender.deviceId, sender.dskKeyId);
    dskKeyIds.set(recipient.deviceId, recipient.dskKeyId);
    const senderToken = await authenticateDevice(app, sender.deviceId, sender.publicKey);
    const recipientToken = await authenticateDevice(app, recipient.deviceId, recipient.publicKey);
    const messageId = `ack-overflow-${randomUUID()}`;
    const outbound = await app.inject({
      method: 'POST', url: '/v1/runtime-sync/outbound',
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { items: [{
        messageId, recipientDeviceId: recipient.deviceId,
        ciphertext: Buffer.from('opaque-ack-regression').toString('base64'), messageType: 'STATUS_SNAPSHOT',
      }] },
    });
    assert.equal(outbound.statusCode, 200);
    assert.equal(outbound.json().results[0].outcome, 'QUEUED');
    assert.equal((await relayService.listQueuedForRecipient(recipient.deviceId)).length, 1);

    rejectFinalProjection = true;
    resolveCalls = 0;
    const ack = await app.inject({
      method: 'POST', url: `/v1/runtime-sync/inbound/${messageId}/ack`,
      headers: { authorization: `Bearer ${recipientToken}` },
    });

    assert.equal(resolveCalls, 2, 'the out-of-range projection is returned by the ACK handler after session validation');
    assert.equal(ack.statusCode, 503);
    assert.deepEqual(ack.json(), { error: 'authority_unavailable' });
    assert.equal((await relayService.listQueuedForRecipient(recipient.deviceId)).length, 1,
      'invalid final authority cannot acknowledge or discard the queued envelope');
  } finally { await app.close(); }
});

test('inbound suppresses ciphertext when the post-read actor family differs from the verified session family', async () => {
  let resolveCalls = 0;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolveCalls += 1;
      return {
        familyId: resolveCalls === 1 ? familyId : `${familyId}-other`,
        deviceId, dskKeyId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1,
      };
    },
  };
  const envelopePublicKey = 'inbound-family-recheck-key';
  const { app, deviceRepository, relayService } = buildApp({ envelopePublicKey, trustSetRoleResolver });
  try {
    const familyId = `family-${randomUUID()}`;
    const { deviceId: recipientDeviceId, publicKey } = await registerDevice(deviceRepository, familyId);
    const { deviceId: senderDeviceId } = await registerDevice(deviceRepository, familyId);
    const token = await authenticateDevice(app, recipientDeviceId, publicKey);
    const envelope = buildInboundStatusEnvelope(familyId, senderDeviceId, recipientDeviceId, envelopePublicKey);
    await relayService.queueEnvelope({
      messageId: envelope.messageId, familyId, senderDeviceId, recipientDeviceId,
      ciphertext: envelopeToRelayCiphertext(envelope),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/runtime-sync/inbound',
      headers: { authorization: `Bearer ${token}` } });

    assert.equal(resolveCalls, 2);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(JSON.stringify(response.json()).includes(envelope.messageId), false);
    assert.equal((await relayService.listQueuedForRecipient(recipientDeviceId)).length, 1);
  } finally {
    await app.close();
  }
});
