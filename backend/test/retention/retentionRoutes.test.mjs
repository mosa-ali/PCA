import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { RelayService } from '../../dist/relay/RelayService.js';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import {
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  OutboundRelayService,
  InboundReconnectService,
  DeviceSyncStatusTracker,
} from '../../dist/runtime-sync/index.js';
import { InMemoryDeleteNowLedger } from '../../dist/retention/InMemoryDeleteNowLedger.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { createTestOnlyEnvelopeSignatureVerifier } from '../support/testOnlyEnvelopeSignatureVerifier.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

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
  const authService = new AuthService(createInMemoryAuthRepository());
  const authzRepository = createInMemoryAuthzRepository();
  const auditRepo = new InMemoryFamilyAuditRepository();
  const familyAuditService = new FamilyAuditService(auditRepo);
  const deleteNowLedger = new InMemoryDeleteNowLedger();

  const app = buildServer({
    authService,
    authzService: new AuthzService(authzRepository),
    authzRepository,
    invitationService: new InvitationService(createInMemoryInvitationRepository()),
    enrollmentCoordinator: new EnrollmentCoordinator(createInMemoryEnrollmentRepository()),
    pairingService: new PairingService(deviceRepository),
    deviceSessionService,
    outboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext: (_senderKeyId, _familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      now: nowUtc,
    }),
    deleteNowLedger,
    familyAuditService,
  });
  return { app, authService, authzRepository, auditRepo };
}

async function authenticatedAccount(authService, authzRepository, familyId) {
  const { rawToken } = await authService.issueSession(verifyTestOnlyIdentity(randomUUID()));
  // Re-derive the accountId the same way requireServiceSession would, purely for scope-grant bookkeeping.
  const accountId = await authService.validateSession(rawToken);
  authzRepository._grantScope(accountId, familyId, 'ACTIVE');
  return { rawToken, accountId };
}

const RETENTION_POLICY_BODY = { generalWindow: '3_MONTHS', locationMode: 'CURRENT_LAST_ONLY', timezone: 'UTC' };

test('RBAC: an authenticated account WITHOUT active family scope is rejected with a generic 403 on every retention route', async () => {
  const { app, authService } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authService.issueSession(verifyTestOnlyIdentity(randomUUID())); // no scope granted
    for (const req of [
      { method: 'POST', url: `/v1/families/${familyId}/retention-policy`, payload: RETENTION_POLICY_BODY },
      { method: 'POST', url: `/v1/families/${familyId}/delete-now`, payload: { actionId: 'a1' } },
      { method: 'POST', url: `/v1/families/${familyId}/export-requests`, payload: {} },
    ]) {
      const response = await app.inject({ ...req, headers: { authorization: `Bearer ${rawToken}` } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error, 'forbidden');
    }
  } finally {
    await app.close();
  }
});

test('RBAC: an authenticated account WITH active family scope may reach retention-policy and gets 200', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/retention-policy`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: RETENTION_POLICY_BODY,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.accepted, true);
    assert.deepEqual(body.policy, RETENTION_POLICY_BODY);
  } finally {
    await app.close();
  }
});

test('no bearer token at all is rejected with 401 before any family-scope check', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/v1/families/${randomUUID()}/retention-policy`, payload: RETENTION_POLICY_BODY });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('an invalid retention policy (location window longer than general window) is rejected 422, never silently accepted', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/retention-policy`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { generalWindow: '1_MONTH', locationMode: { window: '9_MONTHS' }, timezone: 'UTC' },
    });
    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.json().violations, ['LOCATION_WINDOW_EXCEEDS_GENERAL']);
  } finally {
    await app.close();
  }
});

test('malformed retention-policy body is rejected 400', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/retention-policy`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { generalWindow: 'NOT_A_WINDOW', locationMode: 'CURRENT_LAST_ONLY', timezone: 'UTC' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('idempotency: delete-now with the SAME actionId twice returns the identical stored plan and marks the second call idempotent, even if records differ', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const first = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/delete-now`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { actionId: 'same-action-1', records: [{ entityClass: 'WEB_VISIT', id: 'rec-1', eventTimestampUtc: '2026-01-01T00:00:00.000Z' }] },
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.idempotent, false);
    assert.equal(firstBody.plan.toDelete.length, 1);

    // Second call: different (larger) records set, same actionId -- must return the FIRST plan unchanged.
    const second = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/delete-now`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {
        actionId: 'same-action-1',
        records: [
          { entityClass: 'WEB_VISIT', id: 'rec-1', eventTimestampUtc: '2026-01-01T00:00:00.000Z' },
          { entityClass: 'WEB_VISIT', id: 'rec-2-never-seen-by-first-call', eventTimestampUtc: '2026-01-01T00:00:00.000Z' },
        ],
      },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    assert.equal(secondBody.idempotent, true);
    assert.deepEqual(secondBody.plan, firstBody.plan);
  } finally {
    await app.close();
  }
});

test('privacy: the same client-chosen actionId in a DIFFERENT family produces an independent plan, never replays or leaks the other family\'s stored plan', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyA = `family-${randomUUID()}`;
    const familyB = `family-${randomUUID()}`;
    const { rawToken: tokenA } = await authenticatedAccount(authService, authzRepository, familyA);
    const { rawToken: tokenB } = await authenticatedAccount(authService, authzRepository, familyB);

    const responseA = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyA}/delete-now`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { actionId: 'shared-action-id', records: [{ entityClass: 'WEB_VISIT', id: 'a-only', eventTimestampUtc: '2026-01-01T00:00:00.000Z' }] },
    });
    const responseB = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyB}/delete-now`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { actionId: 'shared-action-id', records: [] },
    });
    assert.equal(responseA.statusCode, 200);
    assert.equal(responseB.statusCode, 200);
    assert.equal(responseA.json().idempotent, false);
    assert.equal(responseB.json().idempotent, false); // NOT a replay of family A's plan
    assert.equal(responseA.json().plan.toDelete.length, 1);
    assert.equal(responseB.json().plan.toDelete.length, 0);
  } finally {
    await app.close();
  }
});

test('privacy: an account with scope only in family A cannot reach family B\'s delete-now route', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyA = `family-${randomUUID()}`;
    const familyB = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyA);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyB}/delete-now`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { actionId: 'cross-family-attempt' },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('export-requests round trip: accepted (202) with a fresh exportId, never claims a completed artifact (crypto pending review)', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/export-requests`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {},
    });
    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.ok(body.exportId);
    assert.equal(body.status, 'PENDING_CRYPTO_REVIEW');
  } finally {
    await app.close();
  }
});

test('PCA-DATA-027/doc 11 Section 6: delete-now response discloses the request as DELETE_PENDING_REMOTE_DEVICE, never as completed', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/delete-now`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { actionId: 'disclosure-check-1', records: [{ entityClass: 'WEB_VISIT', id: 'r1', eventTimestampUtc: '2026-01-01T00:00:00.000Z' }] },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.deliveryStatus, 'DELETE_PENDING_REMOTE_DEVICE');
    assert.notEqual(body.deliveryStatus, 'DELETION_CONFIRMED');
  } finally {
    await app.close();
  }
});

test('PCA-DATA-029/doc 11 Section 10: export-requests response discloses the "exists outside app-managed retention once created" limitation at creation time', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/export-requests`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {},
    });
    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.ok(Array.isArray(body.disclosures) && body.disclosures.length > 0);
    assert.match(body.disclosures[0], /EXIST.*OUTSIDE.*APP.*MANAGED/i);
  } finally {
    await app.close();
  }
});

test('PCA-FR-101/PCA-DEC-003: the architecture-baseline retention default (1_MONTH) is reachable via GET /v1/retention-policy/defaults', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/retention-policy/defaults',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.generalWindow, '1_MONTH');
    assert.ok(body.availableWindows.includes('1_MONTH'));
  } finally {
    await app.close();
  }
});

test('GET /v1/retention-policy/defaults requires authentication (401 without a bearer token) but NOT family scope', async () => {
  const { app } = buildApp();
  try {
    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/retention-policy/defaults' });
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('PCA-NFR-062: a parent can complete delete-now AND request an export end-to-end purely through the API, with no manual/support-ticket step anywhere in either response', async () => {
  const { app, authService, authzRepository } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);

    const deleteNowResponse = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/delete-now`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { actionId: 'nfr-062-self-service-delete', records: [] },
    });
    assert.equal(deleteNowResponse.statusCode, 200);
    const deleteNowBody = deleteNowResponse.json();
    // Self-service: fully resolved by this one authenticated call -- no
    // "contact support"/"open a ticket" field or sentinel value anywhere.
    assert.equal(deleteNowBody.actionId, 'nfr-062-self-service-delete');
    const deleteNowSerialized = JSON.stringify(deleteNowBody).toLowerCase();
    assert.doesNotMatch(deleteNowSerialized, /support|ticket|contact us|manual review/);

    const exportResponse = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/export-requests`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {},
    });
    assert.equal(exportResponse.statusCode, 202);
    const exportBody = exportResponse.json();
    const exportSerialized = JSON.stringify(exportBody).toLowerCase();
    assert.doesNotMatch(exportSerialized, /support|ticket|contact us|manual review/);
  } finally {
    await app.close();
  }
});

test('every accepted retention/delete-now/export request is audited via the shared FamilyAuditService', async () => {
  const { app, authService, authzRepository, auditRepo } = buildApp();
  try {
    const familyId = `family-${randomUUID()}`;
    const { rawToken } = await authenticatedAccount(authService, authzRepository, familyId);
    await app.inject({ method: 'POST', url: `/v1/families/${familyId}/retention-policy`, headers: { authorization: `Bearer ${rawToken}` }, payload: RETENTION_POLICY_BODY });
    await app.inject({ method: 'POST', url: `/v1/families/${familyId}/delete-now`, headers: { authorization: `Bearer ${rawToken}` }, payload: { actionId: 'audit-check-1' } });
    await app.inject({ method: 'POST', url: `/v1/families/${familyId}/export-requests`, headers: { authorization: `Bearer ${rawToken}` }, payload: {} });

    const events = await auditRepo.listForFamily(familyId);
    const actionTypes = events.map((e) => e.actionType).sort();
    assert.deepEqual(actionTypes, ['CHANGE_RETENTION', 'DELETE_NOW', 'EXPORT_FAMILY_DATA']);
  } finally {
    await app.close();
  }
});
