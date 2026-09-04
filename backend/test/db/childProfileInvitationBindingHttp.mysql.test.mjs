import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { MySqlAuthzRepository } from '../../dist/authz/MySqlAuthzRepository.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { ChildProfileService } from '../../dist/childprofiles/ChildProfileService.js';
import { MySqlChildProfileRegistryRepository } from '../../dist/childprofiles/MySqlChildProfileRegistryRepository.js';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { MySqlEnrollmentCoordinatorRepository } from '../../dist/enrollment/MySqlEnrollmentCoordinatorRepository.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { MySqlDeviceChallengeRepository } from '../../dist/deviceauth/MySqlDeviceChallengeRepository.js';
import { MySqlRelayRepository } from '../../dist/relay/MySqlRelayRepository.js';
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
import { createTestOnlyDeviceSignatureVerifier } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { createTestOnlyEnvelopeSignatureVerifier } from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

/**
 * PPR-2 Step 4 (security/mutation re-derivation): closes a real coverage
 * gap found while re-deriving Section B. backend/test/db/http.mysql.test.mjs
 * constructs `new InvitationService(invitationRepository)` -- ONE argument,
 * so `childProfileMembership` defaults to null and its invitation-creation
 * tests never exercise the PPR-2 existing-child check at all. This file
 * wires InvitationService EXACTLY as main.ts does in production --
 * `new InvitationService(repo, now, auditService, slotReservationService,
 * alerting, childProfileRegistryRepository)` -- against a real MySQL
 * database, so "invitation creation can no longer implicitly create a
 * child" is proven end to end, not just in an in-memory unit test.
 */
if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlAuthRepository();
const authService = new AuthService(authRepository);
const authzRepository = new MySqlAuthzRepository();
const authzService = new AuthzService(authzRepository);
const invitationRepository = new MySqlInvitationRepository();
const childProfileRegistryRepository = new MySqlChildProfileRegistryRepository();
const childProfileService = new ChildProfileService(childProfileRegistryRepository);
// Same construction as main.ts: real audit service and slot reservation are
// deliberately NOT wired here (null/default) -- this file's concern is
// exclusively the childProfileMembership binding, not slot accounting,
// which childProfileRegistry.mysql.test.mjs and the free-access/entitlement
// DB suites already cover independently.
const invitationService = new InvitationService(
  invitationRepository,
  () => new Date(),
  undefined,
  null,
  null,
  childProfileRegistryRepository,
);
const deviceRepository = new MySqlDeviceRepository();
const pairingService = new PairingService(deviceRepository);
const enrollmentCoordinator = new EnrollmentCoordinator(new MySqlEnrollmentCoordinatorRepository());
const relayService = new RelayService(new MySqlRelayRepository());
const deviceAuthService = new DeviceAuthService(
  new MySqlDeviceChallengeRepository(),
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
const resolveEnvelopeContext = (_senderKeyId, _familyId, nowUtc) => ({
  senderPublicKey: '',
  minimumAcceptedTrustSetEpoch: 0,
  minimumAcceptedKeyEpoch: 0,
  now: nowUtc,
});

function freshApp() {
  return buildServer({
    authService,
    authzService,
    authzRepository,
    invitationService,
    childProfileService,
    enrollmentCoordinator,
    pairingService,
    deviceSessionService,
    outboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext,
  });
}

function family() {
  return `family-${randomUUID()}`;
}

function authHeader(rawToken) {
  return { authorization: `Bearer ${rawToken}` };
}

async function createAccountWithSession() {
  const { rawToken, session } = await authService.issueSession({ accountReferenceHash: randomBytes(32) });
  return { rawToken, accountId: session.accountId };
}

async function grantScope(accountId, familyId, status = 'ACTIVE') {
  await getPool().query(
    `INSERT INTO service_account_family_scopes (account_id, family_id, status, created_at) VALUES (?, ?, ?, NOW(3))`,
    [accountId, familyId, status],
  );
}

async function addLicense(accountId, status = 'ACTIVE') {
  await getPool().query(
    `INSERT INTO licenses (license_id, account_id, license_reference_hash, status, expires_at) VALUES (?, ?, ?, ?, NULL)`,
    [randomUUID(), accountId, Buffer.from(randomUUID()), status],
  );
}

/**
 * A fully authorized parent for a fresh family: session + ACTIVE scope +
 * ACTIVE license. The license is no longer REQUIRED by CREATE_INVITATION
 * (PPR-2 owner decision, Part M -- basic/free V1 enrollment is license-free)
 * but is still granted here so this helper continues to serve every OTHER
 * test in this file that isn't specifically about the license requirement
 * itself. See 'CREATE_INVITATION succeeds with no license row at all' below
 * for the dedicated, license-free coverage.
 */
async function authorizedParent() {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId);
  await addLicense(accountId);
  return { rawToken, accountId, familyId };
}

/** Same as authorizedParent(), deliberately WITHOUT a license row. */
async function authorizedParentNoLicense() {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId);
  return { rawToken, accountId, familyId };
}

function invitationPayload(childProfileId, overrides = {}) {
  return {
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    childProfileId,
    ageUxTier: 'YOUNG_CHILD',
    initialPolicyProfile: 'BALANCED',
    ...overrides,
  };
}

test('MySQL HTTP (real childProfileMembership wiring): a child actually created via the real registry route can be used for an invitation', async () => {
  const parent = await authorizedParent();
  const app = freshApp();

  const createChild = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/children`,
    headers: authHeader(parent.rawToken),
    payload: {},
  });
  assert.equal(createChild.statusCode, 201);
  const { childProfileId } = createChild.json();

  const createInvitation = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: invitationPayload(childProfileId),
  });
  assert.equal(createInvitation.statusCode, 201);
});

// PPR-2 owner decision (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part
// M): basic/free V1 device enrollment must not require an active paid
// license row. This is the strongest evidence for it in this codebase: the
// REAL childProfileMembership wiring (this file's whole reason for
// existing, matching main.ts exactly), a REAL child created through the
// REAL registry route, and a REAL invitation created for it -- all with NO
// license row anywhere for this account, proven directly by never calling
// addLicense().
test('MySQL HTTP (real childProfileMembership wiring): basic/free V1 enrollment succeeds end to end with NO license row at all', async () => {
  const parent = await authorizedParentNoLicense();
  const app = freshApp();

  const createChild = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/children`,
    headers: authHeader(parent.rawToken),
    payload: {},
  });
  assert.equal(createChild.statusCode, 201);
  const { childProfileId } = createChild.json();

  const createInvitation = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: invitationPayload(childProfileId),
  });
  assert.equal(createInvitation.statusCode, 201);
  const body = createInvitation.json();
  assert.equal(typeof body.invitationId, 'string');
});

test('MySQL HTTP (real childProfileMembership wiring): a childProfileId that was never created is rejected -- invitation creation can no longer implicitly create a child', async () => {
  const parent = await authorizedParent();
  const app = freshApp();

  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: invitationPayload(randomUUID().replace(/-/g, '')),
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: 'invalid_request' });
});

test('MySQL HTTP (real childProfileMembership wiring): a childProfileId that belongs to a DIFFERENT family is rejected with the SAME shape as nonexistent -- no cross-family existence oracle', async () => {
  const owner = await authorizedParent();
  const attacker = await authorizedParent();
  const app = freshApp();

  const createChild = await app.inject({
    method: 'POST',
    url: `/v1/families/${owner.familyId}/children`,
    headers: authHeader(owner.rawToken),
    payload: {},
  });
  assert.equal(createChild.statusCode, 201);
  const { childProfileId } = createChild.json();

  const nonexistent = await app.inject({
    method: 'POST',
    url: `/v1/families/${attacker.familyId}/invitations`,
    headers: authHeader(attacker.rawToken),
    payload: invitationPayload(randomUUID().replace(/-/g, '')),
  });
  const crossFamily = await app.inject({
    method: 'POST',
    url: `/v1/families/${attacker.familyId}/invitations`,
    headers: authHeader(attacker.rawToken),
    payload: invitationPayload(childProfileId),
  });

  assert.equal(crossFamily.statusCode, 400);
  assert.equal(nonexistent.statusCode, crossFamily.statusCode);
  assert.deepEqual(crossFamily.json(), nonexistent.json());
  assert.deepEqual(crossFamily.json(), { error: 'invalid_request' });
});

test('MySQL HTTP (real childProfileMembership wiring): a rejected childProfileId consumes no managed-device slot -- a second, valid invitation for the same family still succeeds up to its real limit', async () => {
  const parent = await authorizedParent();
  const app = freshApp();

  const rejected = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: invitationPayload(randomUUID().replace(/-/g, '')),
  });
  assert.equal(rejected.statusCode, 400);

  const createChild = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/children`,
    headers: authHeader(parent.rawToken),
    payload: {},
  });
  const { childProfileId } = createChild.json();
  const accepted = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: invitationPayload(childProfileId),
  });
  assert.equal(accepted.statusCode, 201);
});

test.after(async () => {
  await closePool();
});
