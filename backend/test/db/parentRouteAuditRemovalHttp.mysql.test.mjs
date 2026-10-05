// TODO-14 Wave 3: DATABASE-BACKED INTEGRATED Parent route evidence for the
// SIX removal-decision + administration-PIN declarations (list/detail/create/
// decide-local-pin and PIN status/configure). This suite boots REAL Fastify
// routes (registerParentAccountRoutes for the MFA + session surface,
// registerRemovalDecisionRoutes for the subject declarations) over REAL
// MySQL repositories and the REAL RemovalDecisionAuthority /
// RemovalTargetResolver / AdministrationPinService, so the authority path
// exercised here is the same session + active-family-role + real-target-
// resolver + operation-scoped step-up + durable decision/PIN-verifier path
// the production composition uses (backend/src/main.ts).
//
// Documented test-only collaborators (nothing else is faked):
//   - RecordingEmailSender / createTestClock: as in the sibling membership
//     suite (no real email delivery exists in tests; deterministic TOTP).
//   - authority.authorization is an explicit DENY double: unreachable on the
//     local-PIN paths under test (the coordinator wiring test already proves
//     it is consulted only by the signed-remote-parent mode), so a real
//     ALLOW could not change any observed outcome.
//   - authority.deviceRevocation is a recording double: Production wires the
//     real directory service; here the double records the (familyId,
//     deviceId) pair so the test can prove the ALLOW_REMOVAL decision asked
//     for exactly the resolved target's device revocation, without faking
//     any crypto or device state.
//   - alerting is omitted (its supported default): no alert producer stack
//     exists in this lane, and alerting is documented best-effort.
//   - Unavailable/Rejecting collaborators (signing key resolver, authorized
//     recovery, trust-set role resolver, device signature verifier) are the
//     SAME honest fail-closed implementations main.ts wires today; no
//     signed/recovery success is exercised or claimed.
//   - The durable enrollment chain feeding RemovalTargetResolver is seeded
//     through real SQL rows (devices -> enrollment_bootstrap_attempts ->
//     enrollment_invitations -> family_child_memberships ->
//     device_protection_status); no route that WRITES that chain is part of
//     this suite's declarations.
// Every ALLOW scenario proves a durable readback (decision state row, PIN
// verifier row) rather than trusting the HTTP status alone. The raw PIN is
// asserted absent from every response body and from the stored verifier
// columns.
//
// No production credential, host, or database is used; the database name is
// the run-owned disposable pca_test_codex_<uuid> created by
// scripts/with-disposable-db.mjs (enforced by require-owned-disposable-db).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { MySqlFamilyMembershipRepository } from '../../dist/familymembers/MySqlFamilyMembershipRepository.js';
import { MySqlParentPreferenceRepository } from '../../dist/parentaccount/MySqlParentPreferenceRepository.js';
import { MySqlSafeZoneRepository } from '../../dist/location/MySqlSafeZoneRepository.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { MySqlFreeAccessAccountRepository } from '../../dist/parentaccount/freeaccess/MySqlFreeAccessAccountRepository.js';
import { RemovalDecisionAuthority } from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import { MySqlRemovalDecisionRepository } from '../../dist/familyrbac/MySqlRemovalDecisionRepository.js';
import { RemovalTargetResolver } from '../../dist/familyrbac/RemovalTargetResolver.js';
import { UnavailableRemovalDecisionSigningKeyResolver } from '../../dist/familyrbac/UnavailableRemovalDecisionSigningKeyResolver.js';
import { UnavailableAuthorizedRecoveryAuthority } from '../../dist/familyrbac/UnavailableAuthorizedRecoveryAuthority.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { RejectingDeviceSignatureVerifier } from '../../dist/runtime-sync/RejectingCryptoVerifiers.js';
import { AdministrationPinService } from '../../dist/enrollment/AdministrationPinService.js';
import { MySqlAdministrationPinRepository } from '../../dist/enrollment/MySqlAdministrationPinRepository.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { MySqlDeviceChildBindingRepository } from '../../dist/device/DeviceChildBindingRepository.js';
import { MySqlChildProfileRegistryRepository } from '../../dist/childprofiles/MySqlChildProfileRegistryRepository.js';
import { MySqlDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { registerRemovalDecisionRoutes } from '../../dist/http/routes/removalDecisionRoutes.js';
import { sessionCookieName, csrfCookieName } from '../../dist/parentaccount/cookies.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const REGISTER_ROUTE = '/api/parent/register';
const VERIFY_ROUTE = '/api/parent/verify-email';
const LOGIN_ROUTE = '/api/parent/login';
const MFA_START_ROUTE = '/api/parent/mfa/enrollment/start';
const MFA_CONFIRM_ROUTE = '/api/parent/mfa/enrollment/confirm';
const MFA_STEP_UP_ROUTE = '/api/parent/mfa/step-up';

const REMOVAL_LIST_ROUTE = '/api/parent/families/:familyId/removal-decisions';
const REMOVAL_DETAIL_ROUTE = '/api/parent/families/:familyId/removal-decisions/:requestId';
const LOCAL_PIN_ROUTE = '/api/parent/families/:familyId/removal-decisions/:requestId/decide/local-pin';
const AUTHORIZED_RECOVERY_ROUTE = '/api/parent/families/:familyId/removal-decisions/:requestId/decide/authorized-recovery';
const SIGNED_DECISION_ROUTE = '/api/parent/families/:familyId/removal-decisions/:requestId/decide/signed';
const ADMIN_PIN_ROUTE = '/api/parent/families/:familyId/administration-pin';

const STEP_MS = 30 * 1000;
const PASSWORD = 'a genuinely long password';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code, kind: 'VERIFICATION' });
  }
  async sendLoginStepUpCode(email, code) {
    this.sent.push({ email, code, kind: 'LOGIN_STEP_UP' });
  }
  async sendPasswordResetCode(email, code) {
    this.sent.push({ email, code, kind: 'PASSWORD_RESET' });
  }
  async sendMfaRecoveryCode(email, code) {
    this.sent.push({ email, code, kind: 'MFA_RECOVERY' });
  }
  async sendSecurityNotice(email, notice) {
    this.sent.push({ email, code: null, kind: notice });
  }
  lastCodeFor(email, kind = 'VERIFICATION') {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].kind === kind && this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

const authService = new AuthService(new MySqlAuthRepository());
const parentAccountRepository = new MySqlParentAccountRepository();
const clock = createTestClock(new Date(Date.now() - 1000).toISOString());

let emailSender;
let removalDecisionAuthority;
let administrationPinService;
let revocationRecorder;

function buildApp() {
  emailSender = new RecordingEmailSender();
  const { service } = createParentAccountTestKit({
    repository: parentAccountRepository,
    authService,
    emailSender,
    familyMembershipRepository: new MySqlFamilyMembershipRepository(),
    mfaRepository: new MySqlParentMfaRepository(),
    now: clock.now,
  });
  administrationPinService = new AdministrationPinService({
    repository: new MySqlAdministrationPinRepository(),
    now: clock.now,
    // Failure-delay behavior is injected away; the PIN verifier itself is real.
    sleep: async () => {},
  });
  revocationRecorder = {
    revocations: [],
    async revokeDevice(familyId, deviceId) {
      this.revocations.push({ familyId, deviceId });
    },
  };
  removalDecisionAuthority = new RemovalDecisionAuthority({
    repository: new MySqlRemovalDecisionRepository(),
    // Unreachable on the local-PIN paths under test (see file header).
    authorization: { authorize: async () => ({ verdict: 'DENY', reason: 'NOT_CONFIGURED' }) },
    signingKeyResolver: new UnavailableRemovalDecisionSigningKeyResolver(),
    signatureVerifier: new RejectingDeviceSignatureVerifier(),
    targetDeviceRoleResolver: new UnavailableTrustSetRoleResolver(),
    pinService: administrationPinService,
    recoveryAuthority: new UnavailableAuthorizedRecoveryAuthority(),
    // main.ts's production familyAuditService is also backed by the
    // in-memory reference repository today.
    auditService: new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    deviceRevocation: revocationRecorder,
    now: clock.now,
  });
  const removalTargetResolver = new RemovalTargetResolver({
    bindings: new MySqlDeviceChildBindingRepository(),
    memberships: new MySqlChildProfileRegistryRepository(),
    protectionStatuses: new MySqlDeviceProtectionStatusRepository(),
  });
  const app = Fastify({ logger: false });
  registerParentAccountRoutes(app, {
    parentAccountService: service,
    parentPreferenceRepository: new MySqlParentPreferenceRepository(),
    safeZoneRepository: new MySqlSafeZoneRepository(),
    deviceRepository: new MySqlDeviceRepository(),
    freeAccessAccountRepository: new MySqlFreeAccessAccountRepository(),
  });
  registerRemovalDecisionRoutes(app, {
    parentAccountService: service,
    removalDecisionAuthority,
    removalTargetResolver,
    administrationPinService,
  });
  return app;
}

after(async () => {
  await writeParentRouteScenarioReport();
});

function setCookieJar(response) {
  const raw = response.headers['set-cookie'];
  const headers = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const jar = new Map();
  for (const header of headers) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  return jar;
}

function registrationPayload(email, password = PASSWORD) {
  return { email, password, passwordConfirmation: password, firstName: 'Route', lastName: 'Audit' };
}

async function registerVerifyLogin(app, email, password = PASSWORD) {
  const registered = await app.inject({ method: 'POST', url: REGISTER_ROUTE, payload: registrationPayload(email, password) });
  assert.equal(registered.statusCode, 202, JSON.stringify(registered.json()));
  const code = emailSender.lastCodeFor(email);
  assert.ok(code, 'registration must have issued a verification code');
  const verified = await app.inject({ method: 'POST', url: VERIFY_ROUTE, payload: { email, code } });
  assert.equal(verified.statusCode, 200, JSON.stringify(verified.json()));
  return loginFor(app, email, password);
}

async function loginFor(app, email, password = PASSWORD) {
  const login = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email, password } });
  assert.equal(login.statusCode, 200, JSON.stringify(login.json()));
  const body = login.json();
  assert.equal(body.sessionEstablished, true);
  const jar = setCookieJar(login);
  const sessionToken = jar.get(sessionCookieName());
  const csrfToken = jar.get(csrfCookieName());
  assert.ok(sessionToken, 'login must set the session cookie');
  assert.ok(csrfToken, 'login must set the CSRF cookie');
  return { sessionToken, csrfToken, familyId: body.familyId, accountId: body.accountId, email, password };
}

function sessionHeaders(session) {
  return { cookie: `${sessionCookieName()}=${session.sessionToken}` };
}

function mutationHeaders(session) {
  return {
    cookie: `${sessionCookieName()}=${session.sessionToken}; ${csrfCookieName()}=${session.csrfToken}`,
    'x-pca-csrf-token': session.csrfToken,
  };
}

/**
 * A REAL service-issued session bound to a REAL parent_accounts row in
 * `familyId` with the given family role (used for the Viewer contrast).
 */
async function createBoundMemberSession({ familyId, role, email }) {
  const { rawToken, session } = await authService.issueSession({ accountReferenceHash: randomBytes(32) });
  const accountId = randomUUID();
  await getPool().query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'route-audit-placeholder-credential', 'VERIFIED', ?, ?, 'PERPETUAL', NOW(3), NOW(3))`,
    [accountId, randomBytes(32), familyId, session.accountId],
  );
  await getPool().query(
    `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', NOW(3), NOW(3))`,
    [randomUUID(), familyId, accountId, session.accountId, role],
  );
  const graceStarted = clock.now();
  const graceExpires = new Date(graceStarted.getTime() + PARENT_MFA_GRACE_MS);
  await getPool().query(
    `INSERT INTO parent_mfa_state (account_id, status, grace_started_at, grace_expires_at, created_at, updated_at)
     VALUES (?, 'NOT_ENROLLED', ?, ?, ?, ?)`,
    [accountId, graceStarted, graceExpires, graceStarted, graceStarted],
  );
  return { sessionToken: rawToken, csrfToken: `audit-csrf-${randomBytes(8).toString('hex')}`, familyId, accountId, email };
}

/** Enrolls the account's real MFA authenticator (start + TOTP confirm). */
async function enrollMfa(app, session) {
  const start = await app.inject({
    method: 'POST',
    url: MFA_START_ROUTE,
    headers: mutationHeaders(session),
    payload: { email: session.email, password: session.password },
  });
  assert.equal(start.statusCode, 200, JSON.stringify(start.json()));
  const { secret } = start.json();
  const confirm = await app.inject({
    method: 'POST',
    url: MFA_CONFIRM_ROUTE,
    headers: mutationHeaders(session),
    payload: { email: session.email, code: totpFor(secret, clock.ms()) },
  });
  assert.equal(confirm.statusCode, 200, JSON.stringify(confirm.json()));
  return secret;
}

/** Mints a REAL one-use, operation-scoped step-up grant through the real route. */
async function mintStepUp(app, session, secret, operation) {
  clock.advance(STEP_MS);
  const granted = await app.inject({
    method: 'POST',
    url: MFA_STEP_UP_ROUTE,
    headers: mutationHeaders(session),
    payload: { operation, code: totpFor(secret, clock.ms()) },
  });
  assert.equal(granted.statusCode, 201, JSON.stringify(granted.json()));
  return granted.json().stepUpToken;
}

/**
 * Seeds the durable enrollment chain RemovalTargetResolver resolves
 * (devices -> enrollment_bootstrap_attempts -> enrollment_invitations ->
 * family_child_memberships -> device_protection_status) for `familyId`.
 */
async function seedRemovalTarget(familyId) {
  const deviceId = randomUUID();
  const childProfileId = `child-audit-${randomBytes(6).toString('hex')}`;
  const invitationId = randomUUID();
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, child_profile_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, 'ANDROID', 'ANDROID_PROTECTED', 'REDEEMED', NOW(3), DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [invitationId, familyId, childProfileId, randomBytes(32).toString('hex')],
  );
  await getPool().query(
    `INSERT INTO enrollment_bootstrap_attempts
       (attempt_id, token_hash, recovery_token_hash, platform, signing_public_key, encryption_public_key,
        device_id, signing_key_id, encryption_key_id, invitation_id, family_id, status, created_at)
     VALUES (?, ?, ?, 'ANDROID', ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', NOW(3))`,
    [
      randomBytes(16).toString('hex'),
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
      `sign-${randomBytes(8).toString('hex')}`,
      `enc-${randomBytes(8).toString('hex')}`,
      deviceId,
      randomUUID(),
      randomUUID(),
      invitationId,
      familyId,
    ],
  );
  await getPool().query(
    `INSERT INTO family_child_memberships (child_profile_id, family_id, created_at) VALUES (?, ?, NOW(3))`,
    [childProfileId, familyId],
  );
  await getPool().query(
    `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at) VALUES (?, ?, 'PROTECTED', NOW(3))`,
    [deviceId, familyId],
  );
  return { deviceId, childProfileId };
}

/** Seeds a PENDING decision through the REAL authority (service-level seeding of the decide route's precondition). */
async function seedPendingRequest({ familyId, deviceId, operation = 'REMOVE_REVOKE_DEVICE' }) {
  const now = clock.now();
  const requestId = randomUUID();
  await removalDecisionAuthority.createRequest({
    requestId,
    familyId,
    requestedByParentAccountId: null,
    childId: `child-audit-${randomBytes(6).toString('hex')}`,
    deviceId,
    operation,
    protectionLevel: 'PROTECTED',
    requestedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    reasonCategory: 'ROUTINE_POLICY_CHANGE',
    protectiveAuthorityApplies: true,
  });
  return requestId;
}

async function readDecisionRow(requestId) {
  const [rows] = await getPool().query(
    `SELECT family_id, state, decision_method, decided_by_parent_account_id FROM enrollment_protection_approval_requests WHERE request_id = ?`,
    [requestId],
  );
  return rows[0] ?? null;
}

async function readPinRow(familyId) {
  const [rows] = await getPool().query(
    `SELECT salt_b64, verifier_b64, failed_attempts FROM enrollment_administration_verifiers WHERE family_id = ?`,
    [familyId],
  );
  return rows[0] ?? null;
}

function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function createRequestPayload(deviceId, requestId = randomUUID(), stepUpToken) {
  return {
    requestId,
    deviceId,
    operation: 'REMOVE_REVOKE_DEVICE',
    protectionLevel: 'PROTECTED',
    requestedAt: clock.now().toISOString(),
    expiresAt: new Date(clock.now().getTime() + 5 * 60 * 1000).toISOString(),
    reasonCategory: 'ROUTINE_POLICY_CHANGE',
    ...(stepUpToken === undefined ? {} : { stepUpToken }),
  };
}

test('MYSQL HTTP removal-decisions list: anonymous 401, owner 200 with the durably created request visible, cross-family 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-list-owner'));
    const other = await registerVerifyLogin(app, uniqueEmail('audit-rem-list-other'));
    const target = await seedRemovalTarget(owner.familyId);

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_list_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const rawRequestId = randomUUID();
    await seedPendingRequest({ familyId: owner.familyId, deviceId: target.deviceId });
    void rawRequestId;

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions`, headers: sessionHeaders(owner) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_list_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });
    assert.ok(read.json().removalDecisions.length >= 1, 'the durably seeded request must be listed');

    const crossFamily = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions`, headers: sessionHeaders(other) });
    assert.equal(crossFamily.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_list_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: crossFamily, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP removal and PIN reads deny a revoked Parent membership with a still-bound family account', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-revoked-owner'));
    const member = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-rem-revoked-viewer') });
    const target = await seedRemovalTarget(owner.familyId);
    const requestId = await seedPendingRequest({ familyId: owner.familyId, deviceId: target.deviceId });
    const paths = [
      `/api/parent/families/${owner.familyId}/removal-decisions`,
      `/api/parent/families/${owner.familyId}/removal-decisions/${requestId}`,
      `/api/parent/families/${owner.familyId}/administration-pin`,
    ];

    for (const url of paths) {
      const active = await app.inject({ method: 'GET', url, headers: sessionHeaders(member) });
      assert.equal(active.statusCode, 200, url);
    }

    await getPool().query(
      `UPDATE family_parent_memberships SET status = 'REVOKED', updated_at = NOW(3) WHERE account_id = ? AND family_id = ?`,
      [member.accountId, owner.familyId],
    );
    for (const url of paths) {
      const revoked = await app.inject({ method: 'GET', url, headers: sessionHeaders(member) });
      assert.equal(revoked.statusCode, 403, url);
      assert.deepEqual(revoked.json(), { error: 'forbidden' });
    }
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP removal-decision create: session/CSRF/role boundaries, protective-authority-not-applicable 409, 201 with durable readback and detail GET', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-create-owner'));
    const ownerMfa = await enrollMfa(app, owner);
    const viewer = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-rem-create-viewer') });
    const target = await seedRemovalTarget(owner.familyId);
    const url = `/api/parent/families/${owner.familyId}/removal-decisions`;

    const anonymous = await app.inject({ method: 'POST', url, payload: createRequestPayload(target.deviceId) });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'POST', url, headers: sessionHeaders(owner), payload: createRequestPayload(target.deviceId) });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const viewerCreate = await app.inject({ method: 'POST', url, headers: mutationHeaders(viewer), payload: createRequestPayload(target.deviceId) });
    assert.equal(viewerCreate.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerCreate, evidenceTier: 'MYSQL_HTTP' });

    const invalidBody = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { requestId: 'x' } });
    assert.equal(invalidBody.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_rejects_invalid_body', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: invalidBody, evidenceTier: 'MYSQL_HTTP' });

    // A device with no durable enrollment chain cannot resolve a protective
    // target; the route refuses 409 BEFORE any step-up is involved (no grant
    // is supplied here on purpose).
    const bareDeviceId = randomUUID();
    await getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
      [bareDeviceId, owner.familyId],
    );
    const notApplicable = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: createRequestPayload(bareDeviceId) });
    assert.equal(notApplicable.statusCode, 409);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_protective_authority_not_applicable', classification: 'PROTECTIVE_AUTHORITY_NOT_APPLICABLE', expectedStatus: 409, response: notApplicable, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(notApplicable.json().error, 'protective_authority_not_applicable');

    const noGrant = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: createRequestPayload(target.deviceId) });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const requestId = randomUUID();
    const created = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: createRequestPayload(target.deviceId, requestId, grant) });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    recordParentRouteScenario({ method: 'POST', route: REMOVAL_LIST_ROUTE, scenarioId: 'mysql_removal_create_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: created, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(created.json().removalDecision.childId, target.childProfileId);
    assert.equal(created.json().removalDecision.protectionLevel, 'PROTECTED');
    assert.equal(created.json().removalDecision.requestedByParentAccountId, undefined, 'the authority-resolved target must come from the resolver, not the client');
    const stored = await readDecisionRow(requestId);
    assert.equal(stored?.state, 'PARENT_APPROVAL_REQUIRED', 'the created request must be durably PENDING');
    assert.equal(stored?.decided_by_parent_account_id, null);

    const detail = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions/${requestId}`, headers: sessionHeaders(owner) });
    assert.equal(detail.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_DETAIL_ROUTE, scenarioId: 'mysql_removal_detail_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: detail, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(detail.json().removalDecision.requestId, requestId);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP removal-decision detail: unknown 404 and cross-family 404 are indistinguishable', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-detail-owner'));
    const other = await registerVerifyLogin(app, uniqueEmail('audit-rem-detail-other'));
    const target = await seedRemovalTarget(owner.familyId);
    const requestId = await seedPendingRequest({ familyId: owner.familyId, deviceId: target.deviceId });

    const unknown = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions/${randomUUID()}`, headers: sessionHeaders(owner) });
    assert.equal(unknown.statusCode, 404);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_DETAIL_ROUTE, scenarioId: 'mysql_removal_detail_unknown_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: unknown, evidenceTier: 'MYSQL_HTTP' });

    // Same request id, but read through ANOTHER family's session: the
    // family-scoped read collapses it to the same 404.
    const otherTarget = await seedRemovalTarget(other.familyId);
    const otherRequestId = await seedPendingRequest({ familyId: other.familyId, deviceId: otherTarget.deviceId });
    const foreign = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/removal-decisions/${otherRequestId}`, headers: sessionHeaders(owner) });
    assert.equal(foreign.statusCode, 404);
    recordParentRouteScenario({ method: 'GET', route: REMOVAL_DETAIL_ROUTE, scenarioId: 'mysql_removal_detail_foreign_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: foreign, evidenceTier: 'MYSQL_HTTP' });

    // Sanity: the request is genuinely readable through its own family.
    const own = await app.inject({ method: 'GET', url: `/api/parent/families/${other.familyId}/removal-decisions/${otherRequestId}`, headers: sessionHeaders(other) });
    assert.equal(own.statusCode, 200);
    void requestId;
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP signed and authorized-recovery decisions stay gated with real Parent session and pending request rows', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-crypto-gates'));
    const target = await seedRemovalTarget(owner.familyId);
    const requestId = await seedPendingRequest({ familyId: owner.familyId, deviceId: target.deviceId });
    const pending = await removalDecisionAuthority.getRequest(owner.familyId, requestId);
    assert.ok(pending, 'the pending removal request must be persisted before exercising either gated decision path');

    const noSigningKey = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/removal-decisions/${requestId}/decide/signed`,
      headers: mutationHeaders(owner),
      payload: {
        childId: pending.childId,
        deviceId: pending.deviceId,
        operation: pending.operation,
        protectionLevel: pending.protectionLevel,
        reasonCategory: pending.reasonCategory,
        decision: 'KEEP_ACTIVE',
        temporaryDisableUntil: null,
        actorDeviceId: 'test-actor-without-signing-key',
        actionId: randomUUID(),
        idempotencyKey: randomUUID(),
        trustSetEpoch: 1,
        policyRevision: null,
        issuedAt: clock.now().toISOString(),
        expiresAt: pending.expiresAt.toISOString(),
        stepUp: { state: 'UNSUPPORTED', assertedAt: null, freshUntil: null },
        signature: 'unverified-test-signature',
      },
    });
    assert.equal(noSigningKey.statusCode, 403, JSON.stringify(noSigningKey.json()));
    assert.deepEqual(noSigningKey.json(), { error: 'not_authorized' });
    recordParentRouteScenario({ method: 'POST', route: SIGNED_DECISION_ROUTE, scenarioId: 'mysql_signed_decision_no_signing_key', classification: 'CRYPTO_DEVICE_GATED', expectedStatus: 403, response: noSigningKey, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await readDecisionRow(requestId))?.state, 'PARENT_APPROVAL_REQUIRED', 'an unavailable signing key must leave the durable decision pending');

    const unavailableRecovery = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/removal-decisions/${requestId}/decide/authorized-recovery`,
      headers: mutationHeaders(owner),
      payload: {
        decision: 'KEEP_ACTIVE',
        temporaryDisableUntil: null,
        proof: { proof: 'unverified-test-recovery-proof', recoveryTransactionId: randomUUID() },
      },
    });
    assert.equal(unavailableRecovery.statusCode, 403, JSON.stringify(unavailableRecovery.json()));
    assert.deepEqual(unavailableRecovery.json(), { error: 'not_authorized' });
    recordParentRouteScenario({ method: 'POST', route: AUTHORIZED_RECOVERY_ROUTE, scenarioId: 'mysql_recovery_decision_authority_unavailable', classification: 'CRYPTO_DEVICE_GATED', expectedStatus: 403, response: unavailableRecovery, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await readDecisionRow(requestId))?.state, 'PARENT_APPROVAL_REQUIRED', 'unavailable recovery verification must leave the durable decision pending');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP administration PIN: anonymous 401, unconfigured 200 status, malformed 400, step-up boundary, 200 configure with verifier-only storage readback', async () => {
  const app = buildApp();
  const PIN = '246810';
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-pin-owner'));
    const ownerMfa = await enrollMfa(app, owner);
    const url = `/api/parent/families/${owner.familyId}/administration-pin`;

    const anonymous = await app.inject({ method: 'GET', url });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_status_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const initial = await app.inject({ method: 'GET', url, headers: sessionHeaders(owner) });
    assert.equal(initial.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_status_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: initial, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(initial.json().pinStatus.configured, false);

    const malformed = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { pin: '123', stepUpToken: 'x' } });
    assert.equal(malformed.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_configure_rejects_malformed_pin', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: malformed, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'POST', url, headers: sessionHeaders(owner), payload: { pin: PIN } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_configure_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const noGrant = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { pin: PIN } });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_configure_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.security.settings.change');
    const configured = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { pin: PIN, stepUpToken: grant } });
    assert.equal(configured.statusCode, 200, JSON.stringify(configured.json()));
    recordParentRouteScenario({ method: 'POST', route: ADMIN_PIN_ROUTE, scenarioId: 'mysql_admin_pin_configure_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: configured, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(configured.json().pinStatus.configured, true);
    assert.ok(!JSON.stringify(configured.json()).includes(PIN), 'the raw PIN must never appear in any response body');

    const stored = await readPinRow(owner.familyId);
    assert.ok(stored, 'the verifier row must be durably stored');
    assert.ok(!stored.salt_b64.includes(PIN) && !stored.verifier_b64.includes(PIN), 'the raw PIN must never be stored (verifier-only)');
    assert.ok(stored.verifier_b64.length > 0 && stored.salt_b64.length > 0);

    const afterConfigure = await app.inject({ method: 'GET', url, headers: sessionHeaders(owner) });
    assert.equal(afterConfigure.json().pinStatus.configured, true);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP removal local-PIN decide: 404 unknown, 403 wrong pin / missing grant / not configured, 200 with durable state and device-revocation request, replay 409', async () => {
  const app = buildApp();
  const PIN = '135790';
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-decide-owner'));
    const ownerMfa = await enrollMfa(app, owner);
    const target = await seedRemovalTarget(owner.familyId);
    const requestId = await seedPendingRequest({ familyId: owner.familyId, deviceId: target.deviceId });
    const url = `/api/parent/families/${owner.familyId}/removal-decisions/${requestId}/decide/local-pin`;

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/removal-decisions/${randomUUID()}/decide/local-pin`,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN, stepUpToken: 'x' },
    });
    assert.equal(unknown.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_unknown_request_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: unknown, evidenceTier: 'MYSQL_HTTP' });

    // PIN not yet configured on this family: the decision must refuse, and
    // the (unconfigured) state must be distinguishable in the body.
    const notConfiguredGrant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const notConfigured = await app.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN, stepUpToken: notConfiguredGrant },
    });
    assert.equal(notConfigured.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_pin_not_configured_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: notConfigured, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(notConfigured.json().error, 'pin_not_configured');

    const configureGrant = await mintStepUp(app, owner, ownerMfa, 'family.security.settings.change');
    const configured = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/administration-pin`,
      headers: mutationHeaders(owner),
      payload: { pin: PIN, stepUpToken: configureGrant },
    });
    assert.equal(configured.statusCode, 200, JSON.stringify(configured.json()));

    const noGrant = await app.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN },
    });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const wrongPinGrant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const wrongPin = await app.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: '000000', stepUpToken: wrongPinGrant },
    });
    assert.equal(wrongPin.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_wrong_pin_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: wrongPin, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(wrongPin.json().error, 'pin_invalid');
    assert.equal((await readDecisionRow(requestId))?.state, 'PARENT_APPROVAL_REQUIRED', 'a failed PIN must not decide the request');

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const decided = await app.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN, stepUpToken: grant, decidedByParentAccountId: 'client-supplied-must-be-ignored' },
    });
    assert.equal(decided.statusCode, 200, JSON.stringify(decided.json()));
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_correct_pin_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: decided, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(decided.json().removalDecision.state, 'ALLOW_REMOVAL');
    assert.equal(decided.json().removalDecision.decisionMethod, 'LOCAL_ADMINISTRATION_PIN');
    assert.equal(decided.json().removalDecision.decidedByParentAccountId, undefined);
    const decidedRow = await readDecisionRow(requestId);
    assert.equal(decidedRow?.state, 'ALLOW_REMOVAL', 'the decision must be durable');
    assert.equal(decidedRow?.decision_method, 'LOCAL_ADMINISTRATION_PIN');
    assert.equal(decidedRow?.decided_by_parent_account_id, owner.accountId, 'the deciding account must be the session account, never a client-supplied id');
    const revocations = revocationRecorder.revocations;
    assert.deepEqual(revocations, [{ familyId: owner.familyId, deviceId: target.deviceId }], 'ALLOW_REMOVAL must request exactly the resolved target device revocation');

    const replayGrant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const replay = await app.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN, stepUpToken: replayGrant },
    });
    assert.equal(replay.statusCode, 409);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_replay_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 409, response: replay, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(replay.json().error, 'invalid_state');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP removal local-PIN decide: cross-family request collapses to 404 through another family session', async () => {
  const app = buildApp();
  const PIN = '975310';
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-rem-cross-owner'));
    const ownerMfa = await enrollMfa(app, owner);
    const other = await registerVerifyLogin(app, uniqueEmail('audit-rem-cross-other'));
    const otherTarget = await seedRemovalTarget(other.familyId);
    const otherRequestId = await seedPendingRequest({ familyId: other.familyId, deviceId: otherTarget.deviceId });
    const configureGrant = await mintStepUp(app, owner, ownerMfa, 'family.security.settings.change');
    const configured = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/administration-pin`,
      headers: mutationHeaders(owner),
      payload: { pin: PIN, stepUpToken: configureGrant },
    });
    assert.equal(configured.statusCode, 200, JSON.stringify(configured.json()));

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.device.enrollment.revoke');
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/removal-decisions/${otherRequestId}/decide/local-pin`,
      headers: mutationHeaders(owner),
      payload: { decision: 'ALLOW_REMOVAL', pin: PIN, stepUpToken: grant },
    });
    assert.equal(foreign.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: LOCAL_PIN_ROUTE, scenarioId: 'mysql_removal_decide_foreign_request_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: foreign, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await readDecisionRow(otherRequestId))?.state, 'PARENT_APPROVAL_REQUIRED', 'a cross-family decide must not touch the foreign request');
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
