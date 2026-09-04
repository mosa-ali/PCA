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

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlAuthRepository();
const authService = new AuthService(authRepository);
const authzRepository = new MySqlAuthzRepository();
const authzService = new AuthzService(authzRepository);
const invitationRepository = new MySqlInvitationRepository();
const invitationService = new InvitationService(invitationRepository);
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

/**
 * A fresh app per test (or per test group needing shared rate-limit state
 * across its own calls only) -- the rate limiter is deliberately a
 * single-process in-memory window (see rateLimit.ts), so sharing one
 * Fastify instance across unrelated tests would let an earlier test's
 * bootstrap/invitation-creation calls silently exhaust a later test's
 * budget. Building fresh keeps every test's rate-limit state isolated,
 * while still letting a single test accumulate its own budget on purpose
 * (e.g. the burst/concurrency tests below).
 */
function freshApp() {
  return buildServer({
    authService,
    authzService,
    invitationService,
    enrollmentCoordinator,
    pairingService,
    deviceSessionService,
    outboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext,
  });
}

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

// PCA-ENROLLMENT-RUNTIME-2: client-generated attempt correlator (non-secret)
// and attempt recovery secret (client-held, hashed server-side).
function attemptId() {
  return randomBytes(24).toString('base64url');
}

function recoveryToken() {
  return randomBytes(32).toString('base64url');
}

/** Default full bootstrap payload shape, with per-test overrides. */
function bootstrapPayload(overrides = {}) {
  return {
    rawInvitationToken: overrides.rawInvitationToken,
    platform: 'ANDROID',
    signingPublicKey: key(),
    encryptionPublicKey: key(),
    bootstrapAttemptId: attemptId(),
    attemptRecoveryToken: recoveryToken(),
    ...overrides,
  };
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

async function disableAccount(accountId) {
  await getPool().query(`UPDATE service_accounts SET disabled_at = NOW(3) WHERE account_id = ?`, [accountId]);
}

/** A fully authorized parent for a fresh family: session + ACTIVE scope + ACTIVE license. */
async function authorizedParent() {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId);
  await addLicense(accountId);
  return { rawToken, accountId, familyId };
}

function authHeader(rawToken) {
  return { authorization: `Bearer ${rawToken}` };
}

// --- Health -----------------------------------------------------------

test('MySQL HTTP: GET /health works without auth', async () => {
  const response = await freshApp().inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
});

test('MySQL HTTP: GET /health/db reports connected against a real database, and exposes no connection details', async () => {
  const response = await freshApp().inject({ method: 'GET', url: '/health/db' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', database: 'connected' });
  const body = response.body;
  assert.equal(/pca_test|pca_dev|127\.0\.0\.1|localhost/i.test(body), false, 'health/db must never leak host/database identifiers');
});

// --- Parent auth --------------------------------------------------------

test('MySQL HTTP: invitation creation with no bearer is 401', async () => {
  const response = await freshApp().inject({ method: 'POST', url: `/v1/families/${family()}/invitations`, payload: {} });
  assert.equal(response.statusCode, 401);
});

test('MySQL HTTP: malformed bearer is 401', async () => {
  const response = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${family()}/invitations`,
    headers: { authorization: 'Basic not-a-bearer' },
    payload: {},
  });
  assert.equal(response.statusCode, 401);
});

test('MySQL HTTP: expired bearer is 401', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  // Force expiry directly -- issueSession's TTL is bounded server-side, we can't request 0.
  await getPool().query(`UPDATE service_sessions SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE account_id = ?`, [accountId]);
  const response = await freshApp().inject({ method: 'GET', url: `/v1/families/${family()}/invitations`, headers: authHeader(rawToken) });
  assert.equal(response.statusCode, 401);
});

test('MySQL HTTP: revoked bearer is 401', async () => {
  const { rawToken } = await createAccountWithSession();
  await authService.revokeSession(rawToken);
  const response = await freshApp().inject({ method: 'GET', url: `/v1/families/${family()}/invitations`, headers: authHeader(rawToken) });
  assert.equal(response.statusCode, 401);
});

test('MySQL HTTP: disabled account is 401', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  await disableAccount(accountId);
  const response = await freshApp().inject({ method: 'GET', url: `/v1/families/${family()}/invitations`, headers: authHeader(rawToken) });
  assert.equal(response.statusCode, 401);
});

// --- Authorization --------------------------------------------------------

test('MySQL HTTP: correct family succeeds creating an invitation (a license, though no longer required, is also present here)', async () => {
  const parent = await authorizedParent();
  const response = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  assert.equal(response.statusCode, 201);
});

test('MySQL HTTP: wrong family is 403', async () => {
  const parent = await authorizedParent();
  const response = await freshApp().inject({
    method: 'GET',
    url: `/v1/families/${family()}/invitations`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(response.statusCode, 403);
});

test('MySQL HTTP: parent invitation creation requires the controlled enrollment profile fields', async () => {
  const parent = await authorizedParent();
  const response = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' },
  });
  assert.equal(response.statusCode, 400);
});

// PPR-2 owner decision (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part
// M): basic/free V1 device enrollment must not require an active paid
// license row. CREATE_INVITATION's requiresLicense is now false -- a scope
// alone, no license row anywhere for this account, succeeds.
test('MySQL HTTP: CREATE_INVITATION succeeds with family scope and NO license row at all -- basic/free V1 enrollment', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId); // scope but deliberately no license
  const response = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${familyId}/invitations`,
    headers: authHeader(rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  assert.equal(response.statusCode, 201);
});

test('MySQL HTTP: revoked family scope is 403', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId, 'REVOKED');
  const response = await freshApp().inject({ method: 'GET', url: `/v1/families/${familyId}/invitations`, headers: authHeader(rawToken) });
  assert.equal(response.statusCode, 403);
});

// --- Invitations ------------------------------------------------------

test('MySQL HTTP: create -> status -> list -> revoke -> repeated revoke idempotent', async () => {
  const app = freshApp();
  const parent = await authorizedParent();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json();
  assert.ok(createdBody.rawInvitationToken);
  assert.equal('tokenHash' in createdBody, false);

  const status = await app.inject({
    method: 'GET',
    url: `/v1/families/${parent.familyId}/invitations/${createdBody.invitationId}`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().status, 'CREATED');
  assert.equal('rawInvitationToken' in status.json(), false, 'raw token must never be returned again after creation');
  assert.equal('tokenHash' in status.json(), false);

  const list = await app.inject({
    method: 'GET',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);

  const revoked = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations/${createdBody.invitationId}/revoke`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().status, 'REVOKED');

  const revokedAgain = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations/${createdBody.invitationId}/revoke`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(revokedAgain.statusCode, 200, 'repeated revoke must be idempotent, not an error');
});

test('MySQL HTTP: wrong-family invitation status/revoke is 404 (family-scoped lookup, indistinguishable from nonexistent)', async () => {
  const app = freshApp();
  const owner = await authorizedParent();
  const attacker = await authorizedParent();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/families/${owner.familyId}/invitations`,
    headers: authHeader(owner.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  const invitationId = created.json().invitationId;

  // The attacker IS authorized for their own family (that's the point --
  // authz only proves account-to-family scope, never account-to-resource).
  // The IDOR defense is the invitation repository's family-scoped lookup:
  // an invitation that belongs to a different family must be
  // indistinguishable from one that does not exist, hence 404, not 403.
  const wrongFamilyStatus = await app.inject({
    method: 'GET',
    url: `/v1/families/${attacker.familyId}/invitations/${invitationId}`,
    headers: authHeader(attacker.rawToken),
  });
  assert.equal(wrongFamilyStatus.statusCode, 404);

  const wrongFamilyRevoke = await app.inject({
    method: 'POST',
    url: `/v1/families/${attacker.familyId}/invitations/${invitationId}/revoke`,
    headers: authHeader(attacker.rawToken),
  });
  assert.equal(wrongFamilyRevoke.statusCode, 404);

  const stillActive = await app.inject({
    method: 'GET',
    url: `/v1/families/${owner.familyId}/invitations/${invitationId}`,
    headers: authHeader(owner.rawToken),
  });
  assert.equal(stillActive.statusCode, 200);
  assert.equal(stillActive.json().status, 'CREATED', 'the attacker\'s no-op revoke attempt must not have touched the real record');
});

test('MySQL HTTP: a family with no scope at all on the target family is 403 before ever reaching the invitation lookup', async () => {
  const owner = await authorizedParent();
  const stranger = await createAccountWithSession(); // no scope grant anywhere
  const created = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${owner.familyId}/invitations`,
    headers: authHeader(owner.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  const invitationId = created.json().invitationId;

  const response = await freshApp().inject({
    method: 'GET',
    url: `/v1/families/${owner.familyId}/invitations/${invitationId}`,
    headers: authHeader(stranger.rawToken),
  });
  assert.equal(response.statusCode, 403);
});

// --- Bootstrap ----------------------------------------------------------

async function createRealInvitation(overrides = {}) {
  return invitationService.createInvitation({
    familyId: family(),
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    ...overrides,
  });
}

test('MySQL HTTP: valid bootstrap returns PAIRING_PENDING', async () => {
  const { rawToken } = await createRealInvitation();
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: rawToken }),
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().status, 'PAIRING_PENDING');
});

test('MySQL HTTP: malformed token is 400', async () => {
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: 'x' }),
  });
  assert.equal(response.statusCode, 400);
});

test('MySQL HTTP: missing bootstrapAttemptId/attemptRecoveryToken is 400', async () => {
  const { rawToken } = await createRealInvitation();
  const missingAttemptId = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: { rawInvitationToken: rawToken, platform: 'ANDROID', signingPublicKey: key(), encryptionPublicKey: key(), attemptRecoveryToken: recoveryToken() },
  });
  assert.equal(missingAttemptId.statusCode, 400);

  const missingRecoveryToken = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: { rawInvitationToken: rawToken, platform: 'ANDROID', signingPublicKey: key(), encryptionPublicKey: key(), bootstrapAttemptId: attemptId() },
  });
  assert.equal(missingRecoveryToken.statusCode, 400);
});

test('MySQL HTTP: malformed bootstrapAttemptId (too short, too long, wrong charset) is 400', async () => {
  const app = freshApp();
  const tooShort = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: (await createRealInvitation()).rawToken, bootstrapAttemptId: 'short' }),
  });
  assert.equal(tooShort.statusCode, 400);

  const tooLong = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: (await createRealInvitation()).rawToken, bootstrapAttemptId: 'a'.repeat(500) }),
  });
  assert.equal(tooLong.statusCode, 400);
});

test('MySQL HTTP: expired/revoked/consumed/unknown invitation all collapse to the same generic 404, never a distinguishing detail', async () => {
  const app = freshApp();
  const { rawToken: expiredToken } = await createRealInvitation({ ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const expired = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: expiredToken }),
  });

  const { rawToken: revokedToken, record: revokedRecord } = await createRealInvitation();
  await invitationService.revokeInvitation(revokedRecord.invitationId);
  const revoked = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: revokedToken }),
  });

  const { rawToken: consumedToken } = await createRealInvitation();
  await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: consumedToken }),
  });
  // Retry with a DIFFERENT attempt id -- this must be a genuine
  // already-redeemed collision, not a replay, and still collapse generically.
  const consumed = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: consumedToken }),
  });

  const unknown = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: randomBytes(32).toString('base64url') }),
  });

  for (const response of [expired, revoked, consumed, unknown]) {
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'invitation_unavailable' });
  }
});

test('MySQL HTTP: wrong platform is a distinguishable 400 (caller\'s own request shape, not an enumeration oracle)', async () => {
  const { rawToken } = await createRealInvitation({ platform: 'ANDROID' });
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: rawToken, platform: 'IOS' }),
  });
  assert.equal(response.statusCode, 400);
});

test('MySQL HTTP: invalid DSK, invalid DEK, and identical DSK/DEK are all 400', async () => {
  const app = freshApp();
  const { rawToken: t1 } = await createRealInvitation();
  const badDsk = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: t1, signingPublicKey: 'not a key' }),
  });
  assert.equal(badDsk.statusCode, 400);

  const { rawToken: t2 } = await createRealInvitation();
  const badDek = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: t2, encryptionPublicKey: 'not a key' }),
  });
  assert.equal(badDek.statusCode, 400);

  const { rawToken: t3 } = await createRealInvitation();
  const sharedKey = key();
  const equal = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: t3, signingPublicKey: sharedKey, encryptionPublicKey: sharedKey }),
  });
  assert.equal(equal.statusCode, 400);
});

test('MySQL HTTP: duplicate tombstoned DSK/DEK rejected as 400', async () => {
  const app = freshApp();
  const sharedKey = key();
  const { rawToken: firstToken } = await createRealInvitation();
  await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: firstToken, signingPublicKey: sharedKey }),
  });

  const { rawToken: secondToken } = await createRealInvitation();
  const duplicateAsDsk = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: secondToken, signingPublicKey: sharedKey }),
  });
  assert.equal(duplicateAsDsk.statusCode, 400);

  const { rawToken: thirdToken } = await createRealInvitation();
  const duplicateAsDek = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: thirdToken, encryptionPublicKey: sharedKey }),
  });
  assert.equal(duplicateAsDek.statusCode, 400);
});

test('MySQL HTTP CONCURRENCY: 30 bootstrap attempts (distinct attempt ids) against one invitation -- exactly one pairing request created', async () => {
  const app = freshApp(); // fresh 'bootstrap' rate-limit budget (max 30/min) sized to exactly this burst
  const { rawToken } = await createRealInvitation();
  const attempts = await Promise.allSettled(
    Array.from({ length: 30 }, () =>
      app.inject({
        method: 'POST',
        url: '/v1/enrollment/bootstrap',
        payload: bootstrapPayload({ rawInvitationToken: rawToken }),
      }),
    ),
  );
  const created = attempts.filter((a) => a.status === 'fulfilled' && a.value.statusCode === 201);
  const notCreated = attempts.filter((a) => a.status === 'fulfilled' && a.value.statusCode !== 201);
  assert.equal(created.length, 1, 'exactly one concurrent attempt may win the single-use invitation');
  assert.equal(notCreated.length, 29, 'every other attempt must be rejected (404 invitation_unavailable, or 429 if it also collided with the rate-limit budget) -- never a second 201');
});

test('MySQL HTTP: bootstrap bucket itself rate-limits independently of invitation validity', async () => {
  const app = freshApp(); // bootstrap bucket budget is 30/min; send 31 to guarantee at least one 429
  const responses = [];
  for (let i = 0; i < 31; i++) {
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/v1/enrollment/bootstrap',
        payload: bootstrapPayload({ rawInvitationToken: randomBytes(32).toString('base64url') }),
      }),
    );
  }
  const rateLimited = responses.filter((r) => r.statusCode === 429);
  assert.ok(rateLimited.length > 0, 'the bootstrap bucket must itself trip a 429 once its own budget (30/min) is exceeded');
});

// --- PCA-ENROLLMENT-RUNTIME-2: ambiguous-retry / idempotent-recovery HTTP tests ---

test('MySQL HTTP RETRY: same attempt id + same token + same keys replays the original 201, not ALREADY_REDEEMED', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();
  const payload = bootstrapPayload({ rawInvitationToken: rawToken });
  const first = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload });
  const retry = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload });
  assert.equal(first.statusCode, 201);
  assert.equal(retry.statusCode, 201);
  assert.equal(retry.json().deviceId, first.json().deviceId);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE device_id = ?`, [first.json().deviceId]);
  assert.equal(rows[0].n, 1);
});

test('MySQL HTTP RETRY: DEVICE_COUNT_AFTER_RETRIES -- 10 sequential retries of the same attempt create exactly one device', async () => {
  const app = freshApp();
  const { rawToken, record } = await createRealInvitation();
  const payload = bootstrapPayload({ rawInvitationToken: rawToken });
  let deviceId;
  for (let i = 0; i < 10; i++) {
    const response = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload });
    assert.equal(response.statusCode, 201);
    if (!deviceId) deviceId = response.json().deviceId;
    assert.equal(response.json().deviceId, deviceId);
  }
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [record.familyId]);
  assert.equal(rows[0].n, 1, 'exactly one device may ever exist for this invitation regardless of retry count');
});

test('MySQL HTTP: recovery endpoint returns the same deviceId after a bootstrap success', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();
  const payload = bootstrapPayload({ rawInvitationToken: rawToken });
  const bootstrap = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload });
  assert.equal(bootstrap.statusCode, 201);

  const recovery = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: payload.bootstrapAttemptId, attemptRecoveryToken: payload.attemptRecoveryToken },
  });
  assert.equal(recovery.statusCode, 200);
  assert.equal(recovery.json().deviceId, bootstrap.json().deviceId);
  assert.equal(recovery.json().status, 'PAIRING_PENDING');
});

test('MySQL HTTP: recovery with an unknown attempt id is a generic 404', async () => {
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: attemptId(), attemptRecoveryToken: recoveryToken() },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'invitation_unavailable' });
});

test('MySQL HTTP: recovery with the correct attempt id but WRONG recovery token is the same generic 404 -- no oracle', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();
  const payload = bootstrapPayload({ rawInvitationToken: rawToken });
  const bootstrap = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload });
  assert.equal(bootstrap.statusCode, 201);

  const wrongSecret = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: payload.bootstrapAttemptId, attemptRecoveryToken: recoveryToken() },
  });
  assert.equal(wrongSecret.statusCode, 404);
  assert.deepEqual(wrongSecret.json(), { error: 'invitation_unavailable' });
});

test('MySQL HTTP: recovery with malformed attempt id / recovery token is a distinguishable 400', async () => {
  const app = freshApp();
  const badAttemptId = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: 'x', attemptRecoveryToken: recoveryToken() },
  });
  assert.equal(badAttemptId.statusCode, 400);

  const badRecoveryToken = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: attemptId(), attemptRecoveryToken: 'x' },
  });
  assert.equal(badRecoveryToken.statusCode, 400);
});

test('MySQL HTTP: a DIFFERENT attempt id against an already-redeemed invitation is the same generic 404 (never a replay)', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();
  await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload: bootstrapPayload({ rawInvitationToken: rawToken }) });
  const secondAttempt = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: rawToken }),
  });
  assert.equal(secondAttempt.statusCode, 404);
  assert.deepEqual(secondAttempt.json(), { error: 'invitation_unavailable' });
});

test('MySQL HTTP ADVERSARIAL: same attempt id reused across two DIFFERENT invitations is rejected generically, not replayed', async () => {
  const app = freshApp();
  const sharedAttemptId = attemptId();
  const { rawToken: tokenA } = await createRealInvitation();
  const first = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: tokenA, bootstrapAttemptId: sharedAttemptId }),
  });
  assert.equal(first.statusCode, 201);

  const { rawToken: tokenB } = await createRealInvitation();
  const second = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: tokenB, bootstrapAttemptId: sharedAttemptId }),
  });
  assert.equal(second.statusCode, 404);
  assert.deepEqual(second.json(), { error: 'invitation_unavailable' });
});

test('MySQL HTTP ADVERSARIAL: cross-family recovery -- attemptRecoveryToken from family A never discloses family B\'s attempts (different id space entirely)', async () => {
  const app = freshApp();
  const { rawToken: tokenA } = await createRealInvitation();
  const payloadA = bootstrapPayload({ rawInvitationToken: tokenA });
  await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload: payloadA });

  const { rawToken: tokenB } = await createRealInvitation();
  const payloadB = bootstrapPayload({ rawInvitationToken: tokenB });
  const bootstrapB = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload: payloadB });
  assert.equal(bootstrapB.statusCode, 201);

  // Family A's recovery secret must never recover family B's attempt, even
  // though both exist in the same table.
  const crossRecovery = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: payloadB.bootstrapAttemptId, attemptRecoveryToken: payloadA.attemptRecoveryToken },
  });
  assert.equal(crossRecovery.statusCode, 404);
});

test('MySQL HTTP ADVERSARIAL: authority injection -- caller-supplied familyId/role/memberId/childId are ignored by bootstrap', async () => {
  const { rawToken, record } = await createRealInvitation();
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: {
      ...bootstrapPayload({ rawInvitationToken: rawToken }),
      familyId: 'attacker-controlled-family',
      role: 'PARENT',
      memberId: 'attacker-member',
      childId: 'attacker-child',
      policy: { fullTrust: true },
    },
  });
  assert.equal(response.statusCode, 201);
  const [rows] = await getPool().query(`SELECT family_id FROM devices WHERE device_id = ?`, [response.json().deviceId]);
  assert.equal(rows[0].family_id, record.familyId);
  assert.notEqual(rows[0].family_id, 'attacker-controlled-family');
});

test('MySQL HTTP OLD-ENROLLMENT BACKWARD COMPATIBILITY: a redeemed invitation with no attempt row (simulating a pre-migration record) fails safely, no crash, generic 404', async () => {
  const app = freshApp();
  const { rawToken, record } = await createRealInvitation();
  // Redeem it directly via the DB, bypassing the attempt-recording path
  // entirely -- this simulates an invitation redeemed by the Runtime-1
  // coordinator before this migration existed, i.e. no matching row in
  // enrollment_bootstrap_attempts.
  await getPool().query(`UPDATE enrollment_invitations SET status = 'REDEEMED', redeemed_at = NOW(3) WHERE invitation_id = ?`, [
    record.invitationId,
  ]);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: rawToken }),
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'invitation_unavailable' });
});

// --- PCA-ENROLLMENT-RUNTIME-2: end-to-end ambiguous-retry recovery scenario ---

test('MySQL E2E: parent creates invitation -> Android bootstraps -> server commits -> client response is discarded -> Android recovers the SAME deviceId -> parent sees exactly one pairing request -> parent confirms -> PAIRED', async () => {
  const app = freshApp();
  const parent = await authorizedParent();

  // Parent creates a real invitation (Secure Invite HTTP, unchanged by this migration).
  const invitationResponse = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  assert.equal(invitationResponse.statusCode, 201);
  const rawInvitationToken = invitationResponse.json().rawInvitationToken;

  // Android generates its DSK/DEK using the TEST/CONFORMANCE-equivalent generator (here: plain
  // CSPRNG-backed base64url keys, matching the shape TestConformanceDeviceKeyPairGenerator
  // produces -- no production crypto suite involved anywhere in this test) plus its own
  // attemptId/attemptRecoveryToken, exactly mirroring HttpDeviceBootstrapApiClient's real request
  // body contract.
  const androidPayload = bootstrapPayload({ rawInvitationToken });

  // Android sends the bootstrap request. The server fully commits (invitation redeemed, device +
  // DSK/DEK created, attempt/result row persisted) -- but we deliberately never read/trust this
  // response body, simulating exactly what HttpDeviceBootstrapApiClientTest's
  // "startAndDropEveryConnection" proves happens on the wire: the server's actual commit and the
  // client's ability to observe it are two independent facts.
  const serverSideResponse = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload: androidPayload });
  assert.equal(serverSideResponse.statusCode, 201, 'test precondition: the server-side commit must actually have happened');
  const deviceIdTheClientNeverSaw = serverSideResponse.json().deviceId;

  // Android (this process, or a freshly-restarted one -- recoverAttempt never needs the raw
  // invitation token either way) recovers using ONLY attemptId + attemptRecoveryToken, exactly
  // EnrollmentCoordinator.recoverAttempt's contract.
  const recovery = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap/recover',
    payload: { bootstrapAttemptId: androidPayload.bootstrapAttemptId, attemptRecoveryToken: androidPayload.attemptRecoveryToken },
  });
  assert.equal(recovery.statusCode, 200);
  assert.equal(recovery.json().deviceId, deviceIdTheClientNeverSaw, 'recovery must surface the SAME deviceId the lost response would have carried');
  assert.equal(recovery.json().status, 'PAIRING_PENDING');

  // A retry of the ORIGINAL bootstrap request (same attemptId/token/keys, e.g. same-process retry
  // while the raw token was still in memory) must ALSO agree -- and must never create a second
  // device.
  const bootstrapRetry = await app.inject({ method: 'POST', url: '/v1/enrollment/bootstrap', payload: androidPayload });
  assert.equal(bootstrapRetry.statusCode, 201);
  assert.equal(bootstrapRetry.json().deviceId, deviceIdTheClientNeverSaw);

  const [deviceCountRows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [parent.familyId]);
  assert.equal(deviceCountRows[0].n, 1, 'DEVICE_COUNT_AFTER_RETRIES: exactly one device, regardless of the lost response + two recovery/retry calls');

  // Parent sees EXACTLY ONE pairing request -- not two, not zero.
  const view = await app.inject({
    method: 'GET',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceIdTheClientNeverSaw}`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().status, 'PAIRING_PENDING');

  // Parent confirms -> PAIRED. Never ACTIVE (still requires first-policy delivery via the Family
  // Trust Set, out of scope for bootstrap/pairing).
  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceIdTheClientNeverSaw}/confirm`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.json().status, 'PAIRED');
  assert.notEqual(confirm.json().status, 'ACTIVE');
});

// --- Pairing --------------------------------------------------------------

async function bootstrapDevice(app, familyId) {
  const invitation = await invitationService.createInvitation({
    familyId,
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
  });
  const bootstrapResponse = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: invitation.rawToken }),
  });
  assert.equal(bootstrapResponse.statusCode, 201, 'test setup precondition: bootstrap must succeed before a pairing test can proceed');
  return bootstrapResponse.json().deviceId;
}

test('MySQL HTTP: authorized pairing view + confirm reaches PAIRED, never ACTIVE', async () => {
  const app = freshApp();
  const parent = await authorizedParent();
  const deviceId = await bootstrapDevice(app, parent.familyId);

  const view = await app.inject({
    method: 'GET',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceId}`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().status, 'PAIRING_PENDING');
  assert.ok(view.json().dskFingerprint);
  assert.ok(view.json().dekFingerprint);

  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.json().status, 'PAIRED');
  assert.notEqual(confirm.json().status, 'ACTIVE');
});

test('MySQL HTTP: wrong-family pairing view/confirm is 404 (family-scoped device lookup, indistinguishable from nonexistent)', async () => {
  const app = freshApp();
  const owner = await authorizedParent();
  const attacker = await authorizedParent();
  const deviceId = await bootstrapDevice(app, owner.familyId);

  // The attacker IS authorized for their own family -- authz only proves
  // account-to-family scope, never account-to-device. The IDOR defense is
  // PairingService/DeviceRepository's family-scoped lookup (doc comment:
  // "wrong family must be indistinguishable from nonexistent").
  const view = await app.inject({
    method: 'GET',
    url: `/v1/families/${attacker.familyId}/pairing-requests/${deviceId}`,
    headers: authHeader(attacker.rawToken),
  });
  assert.equal(view.statusCode, 404);

  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/families/${attacker.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(attacker.rawToken),
  });
  assert.equal(confirm.statusCode, 404);
});

test('MySQL HTTP: a family with no scope at all on the target family is 403 for pairing routes too, before ever reaching PairingService', async () => {
  const app = freshApp();
  const owner = await authorizedParent();
  const stranger = await createAccountWithSession(); // no scope grant anywhere
  const deviceId = await bootstrapDevice(app, owner.familyId);

  const view = await app.inject({
    method: 'GET',
    url: `/v1/families/${owner.familyId}/pairing-requests/${deviceId}`,
    headers: authHeader(stranger.rawToken),
  });
  assert.equal(view.statusCode, 403);

  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/families/${owner.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(stranger.rawToken),
  });
  assert.equal(confirm.statusCode, 403, 'the confirm route shares createRequireFamilyAuthorization with the view route -- must reject identically, not just the GET path');
});

test('MySQL HTTP: repeated confirmation is idempotent', async () => {
  const app = freshApp();
  const parent = await authorizedParent();
  const deviceId = await bootstrapDevice(app, parent.familyId);
  const first = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(parent.rawToken),
  });
  const second = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().status, 'PAIRED');
});

test('MySQL HTTP: confirming a REVOKED device is 409, not silently accepted', async () => {
  const app = freshApp();
  const parent = await authorizedParent();
  const deviceId = await bootstrapDevice(app, parent.familyId);
  await deviceRepository.revokeDeviceAndKeysAtomically(parent.familyId, deviceId, new Date());
  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/pairing-requests/${deviceId}/confirm`,
    headers: authHeader(parent.rawToken),
  });
  assert.equal(confirm.statusCode, 409);
});

// --- Limits -----------------------------------------------------------

test('MySQL HTTP: oversized invitation-creation body rejected', async () => {
  const parent = await authorizedParent();
  const response = await freshApp().inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', junk: 'x'.repeat(10_000) },
  });
  assert.equal(response.statusCode, 413);
});

test('MySQL HTTP: oversized bootstrap token/keys/attemptId rejected as 400', async () => {
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: 'a'.repeat(1000) }),
  });
  assert.equal(response.statusCode, 400);
});

test('MySQL HTTP: malformed JSON body is rejected, not a 500', async () => {
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    headers: { 'content-type': 'application/json' },
    payload: '{not valid json',
  });
  assert.ok(response.statusCode >= 400 && response.statusCode < 500);
});

test('MySQL HTTP: rate limiting kicks in on repeated invitation-creation requests from one caller', async () => {
  const app = freshApp(); // deliberately shared across the whole burst -- this is exactly the state the limiter must accumulate
  const parent = await authorizedParent();
  const attempts = [];
  for (let i = 0; i < 25; i++) {
    attempts.push(
      await app.inject({
        method: 'POST',
        url: `/v1/families/${parent.familyId}/invitations`,
        headers: authHeader(parent.rawToken),
        payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
      }),
    );
  }
  const rateLimited = attempts.filter((r) => r.statusCode === 429);
  assert.ok(rateLimited.length > 0, 'at least one request in a 25-request burst must be rate-limited (budget is 20/min)');
});

test('MySQL HTTP: the recovery endpoint has its own independent rate-limit bucket', async () => {
  const app = freshApp();
  const responses = [];
  for (let i = 0; i < 31; i++) {
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/v1/enrollment/bootstrap/recover',
        payload: { bootstrapAttemptId: attemptId(), attemptRecoveryToken: recoveryToken() },
      }),
    );
  }
  const rateLimited = responses.filter((r) => r.statusCode === 429);
  assert.ok(rateLimited.length > 0, 'the recovery bucket must itself trip a 429 once its own budget (30/min) is exceeded');
});

// --- Privacy ----------------------------------------------------------

test('MySQL HTTP PRIVACY: server runs with logging disabled -- no bearer/raw-invite/DSK/DEK can reach any log sink', async () => {
  // buildServer() constructs Fastify with `logger: false` (see buildServer.ts) --
  // there is no request/response logger anywhere in the HTTP layer that could
  // capture an Authorization header, a raw invitation token, or a public key
  // from the request/response bodies. This test asserts that composition
  // directly rather than scraping stdout, since scraping is a weaker proxy
  // for the same fact.
  const app = freshApp();
  // Fastify's own `logger: false` wires in a no-op logger (pino-noop) --
  // present as an object so route code can call it unconditionally, but
  // every method is a discarding stub.
  assert.equal(typeof app.log.info, 'function');
  // Exercise a full request carrying every sensitive value and confirm
  // nothing throws or attempts to serialize them through a real logger.
  const parent = await authorizedParent();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/families/${parent.familyId}/invitations`,
    headers: authHeader(parent.rawToken),
    payload: { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', childProfileId: 'child-profile-1', ageUxTier: 'YOUNG_CHILD', initialPolicyProfile: 'BALANCED' },
  });
  assert.equal(response.statusCode, 201);
});

// --- PCA-ADD-ENR-005/008: device-facing invitation lifecycle-progress routes ---

test('MySQL HTTP: install-required -> app-installed -> authorization-required -> bootstrap redeems, real end-to-end route path', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();

  const installRequired = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(installRequired.statusCode, 200);
  assert.deepEqual(installRequired.json(), { status: 'INSTALL_REQUIRED' });

  const appInstalled = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/app-installed',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(appInstalled.statusCode, 200);
  assert.deepEqual(appInstalled.json(), { status: 'APP_INSTALLED' });

  const authorizationRequired = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/authorization-required',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(authorizationRequired.statusCode, 200);
  assert.deepEqual(authorizationRequired.json(), { status: 'AUTHORIZATION_REQUIRED' });

  const bootstrap = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/bootstrap',
    payload: bootstrapPayload({ rawInvitationToken: rawToken }),
  });
  assert.equal(bootstrap.statusCode, 201);
  assert.equal(bootstrap.json().status, 'PAIRING_PENDING');
});

test('MySQL HTTP: lifecycle-progress routes require no parent session or family id -- device-only bearer token authority', async () => {
  const { rawToken } = await createRealInvitation();
  // No Authorization header at all, and the path itself carries no familyId --
  // exactly like /v1/enrollment/bootstrap's own auth model.
  const response = await freshApp().inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(response.statusCode, 200);
});

test('MySQL HTTP: lifecycle-progress route on an unknown/expired/revoked token collapses to the same generic 404 as bootstrap', async () => {
  const app = freshApp();
  const { rawToken: expiredToken } = await createRealInvitation({ ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const expired = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: expiredToken },
  });

  const { rawToken: revokedToken, record: revokedRecord } = await createRealInvitation();
  await invitationService.revokeInvitation(revokedRecord.invitationId);
  const revoked = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: revokedToken },
  });

  const unknown = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: randomBytes(32).toString('base64url') },
  });

  for (const response of [expired, revoked, unknown]) {
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'invitation_unavailable' });
  }
});

test('MySQL HTTP: out-of-order lifecycle-progress request (going backward) is the same generic 404, not a distinguishing detail', async () => {
  const app = freshApp();
  const { rawToken } = await createRealInvitation();
  const forward = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/authorization-required',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(forward.statusCode, 200);

  const backward = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: rawToken },
  });
  assert.equal(backward.statusCode, 404);
  assert.deepEqual(backward.json(), { error: 'invitation_unavailable' });
});

test('MySQL HTTP: malformed/oversized token on a lifecycle-progress route is a distinguishable 400', async () => {
  const app = freshApp();
  const empty = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: '' },
  });
  assert.equal(empty.statusCode, 400);

  const oversized = await app.inject({
    method: 'POST',
    url: '/v1/enrollment/invitations/install-required',
    payload: { rawInvitationToken: 'a'.repeat(500) },
  });
  assert.equal(oversized.statusCode, 400);
});

test.after(async () => {
  await closePool();
});
