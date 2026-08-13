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
} from '../../../dist/runtime-sync/index.js';
import { createInMemoryAuthRepository } from '../../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../../support/inMemoryAuthzRepository.mjs';
import { createInMemoryInvitationRepository } from '../../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../../support/testOnlyDeviceSignatureVerifier.mjs';
import { createTestOnlyEnvelopeSignatureVerifier } from '../../support/testOnlyEnvelopeSignatureVerifier.mjs';

function buildApp() {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
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
