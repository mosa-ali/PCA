// TODO-14 Wave 3: DATABASE-BACKED INTEGRATED Parent route evidence for the
// SIX family member/invitation declarations (list/create/revoke/role/remove/
// accept). This suite boots REAL Fastify routes (registerParentAccountRoutes
// for the MFA + session surface, registerFamilyMemberRoutes for the subject
// declarations) over REAL MySQL repositories and the REAL
// FamilyMemberInvitationService + MySqlFamilyMemberAccountBinder, so the
// authority path exercised here is the same session + active-family-role +
// operation-scoped step-up + durable-invitation path the production
// composition uses (backend/src/main.ts).
//
// Documented test-only collaborators (nothing else is faked):
//   - RecordingEmailSender: captures verification/step-up codes in process;
//     no real email delivery exists in tests by design.
//   - createTestClock: drives TOTP counter steps deterministically; anchored
//     at the real wall clock so DB NOW(3) timestamps stay aligned.
//   - The service's ParentActionAuthorizationService is an explicit DENY
//     double BECAUSE the routes under test pass the 'SERVICE_SESSION' audit
//     actor: createInvitation/revoke/changeRole/removeMember all short-
//     circuit before authorize() on this path (see
//     FamilyMemberInvitationService.authorizeFamilyOperation), so the double
//     is unreachable-by-construction rather than a bypass -- a real ALLOW
//     would prove nothing additional here.
//   - newCapacityAcquisitionPolicy is omitted (its supported null default),
//     so the FREE_ACCESS acquisition gate is not exercised by THIS suite;
//     that gate has its own dedicated coverage. Capacity/seat accounting IS
//     exercised through the real MySqlEntitlementRepository.
// FamilyMemberAccountBinder is the REAL MySqlFamilyMemberAccountBinder, and
// every ALLOW scenario proves a durable readback (invitation status, role,
// family_id, seat count) rather than trusting the HTTP status alone.
//
// No production credential, host, or database is used; the database name is
// the run-owned disposable pca_test_codex_<uuid> created by
// scripts/with-disposable-db.mjs (enforced by require-owned-disposable-db).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { MySqlFamilyMembershipRepository } from '../../dist/familymembers/MySqlFamilyMembershipRepository.js';
import { MySqlParentPreferenceRepository } from '../../dist/parentaccount/MySqlParentPreferenceRepository.js';
import { MySqlSafeZoneRepository } from '../../dist/location/MySqlSafeZoneRepository.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { MySqlFreeAccessAccountRepository } from '../../dist/parentaccount/freeaccess/MySqlFreeAccessAccountRepository.js';
import { MySqlFamilyMemberInvitationRepository } from '../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js';
import { FamilyMemberInvitationService } from '../../dist/familymembers/FamilyMemberInvitationService.js';
import { MySqlFamilyMemberAccountBinder } from '../../dist/familymembers/MySqlFamilyMemberAccountBinder.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { registerFamilyMemberRoutes } from '../../dist/http/routes/familyMemberRoutes.js';
import { sessionCookieName, csrfCookieName } from '../../dist/parentaccount/cookies.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const REGISTER_ROUTE = '/api/parent/register';
const VERIFY_ROUTE = '/api/parent/verify-email';
const LOGIN_ROUTE = '/api/parent/login';
const MFA_START_ROUTE = '/api/parent/mfa/enrollment/start';
const MFA_CONFIRM_ROUTE = '/api/parent/mfa/enrollment/confirm';
const MFA_STEP_UP_ROUTE = '/api/parent/mfa/step-up';

const INVITATIONS_ROUTE = '/api/parent/families/:familyId/members/invitations';
const REVOKE_ROUTE = '/api/parent/families/:familyId/members/invitations/:invitationId/revoke';
const ROLE_ROUTE = '/api/parent/families/:familyId/members/invitations/:invitationId/role';
const REMOVE_ROUTE = '/api/parent/families/:familyId/members/:accountId/remove';
const ACCEPT_ROUTE = '/api/parent/member-invitations/:invitationId/accept';

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
const entitlementRepository = new MySqlEntitlementRepository();
const clock = createTestClock(new Date(Date.now() - 1000).toISOString());

let emailSender;

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
  const familyMemberInvitationService = new FamilyMemberInvitationService(
    new MySqlFamilyMemberInvitationRepository(),
    // Unreachable on the route paths under test -- every route in this file
    // passes actorDeviceId 'SERVICE_SESSION', which short-circuits before
    // authorize(). Explicit DENY keeps the double honest.
    { authorize: async () => ({ verdict: 'DENY', reason: 'NOT_CONFIGURED' }) },
    clock.now,
    // main.ts's production familyAuditService is ALSO backed by the
    // in-memory reference repository today (see main.ts), so this matches
    // production wiring exactly rather than weakening it.
    new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    new MySqlFamilyMemberAccountBinder(),
    entitlementRepository,
  );
  const app = Fastify({ logger: false });
  registerParentAccountRoutes(app, {
    parentAccountService: service,
    parentPreferenceRepository: new MySqlParentPreferenceRepository(),
    safeZoneRepository: new MySqlSafeZoneRepository(),
    deviceRepository: new MySqlDeviceRepository(),
    freeAccessAccountRepository: new MySqlFreeAccessAccountRepository(),
  });
  registerFamilyMemberRoutes(app, { parentAccountService: service, familyMemberInvitationService });
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
 * A REAL service-issued session bound to a REAL parent_accounts row (with its
 * invited email's hash) in `familyId` with the given family role. The MFA
 * grace row mirrors a real first sign-in (resolveUsableSession fails closed
 * with no grace record). Used for member/viewer actors whose role -- not the
 * password lifecycle -- is the property under test, and for the re-invited
 * member the accept route durably binds/role-writes.
 */
async function createBoundMemberSession({ familyId, role, email }) {
  const { rawToken, session } = await authService.issueSession({ accountReferenceHash: randomBytes(32) });
  const accountId = randomUUID();
  await getPool().query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'route-audit-placeholder-credential', 'VERIFIED', ?, ?, 'PERPETUAL', NOW(3), NOW(3))`,
    [accountId, hashParentEmail(email), familyId, session.accountId],
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

/**
 * Seeds an ACCEPTED member of `familyId` the way a real acceptance +
 * MySqlFamilyMemberAccountBinder durably produces one: bound parent_accounts
 * row, ACTIVE membership, and the ACCEPTED invitation row
 * removeMemberAtomically's own structural Owner-protection check reads.
 */
async function seedAcceptedMember(familyId, email, { consumedSeat = 1 } = {}) {
  const member = await createBoundMemberSession({ familyId, role: 'VIEWER', email });
  const now = clock.now();
  await getPool().query(
    `INSERT INTO family_member_invitations
       (invitation_id, family_id, invited_email_hash, role, status, invited_by_account_id, created_at, expires_at, accepted_at, accepted_by_account_id)
     VALUES (?, ?, ?, 'VIEWER', 'ACCEPTED', ?, ?, ?, ?, ?)`,
    [randomUUID(), familyId, hashParentEmail(email), randomUUID(), now, new Date(now.getTime() + 7 * 24 * 3600 * 1000), now, member.accountId],
  );
  if (consumedSeat > 0) {
    await runInTransaction((conn) => entitlementRepository.adjustParentMemberUsedCount(conn, familyId, consumedSeat, now));
  }
  return member;
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

async function readInvitationRow(invitationId) {
  const [rows] = await getPool().query(
    `SELECT family_id, role, status, accepted_by_account_id FROM family_member_invitations WHERE invitation_id = ?`,
    [invitationId],
  );
  return rows[0] ?? null;
}

async function readAccountFamilyId(accountId) {
  const [rows] = await getPool().query(`SELECT family_id FROM parent_accounts WHERE account_id = ?`, [accountId]);
  return rows[0]?.family_id ?? null;
}

async function readMembershipRole(accountId, familyId) {
  const [rows] = await getPool().query(
    `SELECT role, status FROM family_parent_memberships WHERE account_id = ? AND family_id = ?`,
    [accountId, familyId],
  );
  return rows[0] ?? null;
}

function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID()}@example.test`;
}

function createdInvitation(response) {
  return response.json().invitation;
}

test('MYSQL HTTP member invitations list: anonymous 401, members-role 200 with the durably created invitation visible, cross-family 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-owner'));
    const viewer = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-mem-viewer') });
    const other = await registerVerifyLogin(app, uniqueEmail('audit-mem-other'));
    const ownerMfa = await enrollMfa(app, owner);
    const invitedEmail = uniqueEmail('audit-mem-invitee');

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/members/invitations` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitations_list_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const created = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail, role: 'VIEWER', stepUpToken: grant },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/members/invitations`, headers: sessionHeaders(owner) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitations_list_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });
    assert.ok(read.json().invitations.some((row) => row.invitationId === createdInvitation(created).invitationId), 'the durably created invitation must be listed');

    const viewerRead = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/members/invitations`, headers: sessionHeaders(viewer) });
    assert.equal(viewerRead.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitations_list_viewer_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: viewerRead, evidenceTier: 'MYSQL_HTTP' });

    const crossFamily = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/members/invitations`, headers: sessionHeaders(other) });
    assert.equal(crossFamily.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitations_list_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: crossFamily, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP member invitation create: role/CSRF/step-up boundaries, 201 with durable row, duplicate-pending 409, invalid role 400', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-create'));
    const viewer = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-mem-create-viewer') });
    const ownerMfa = await enrollMfa(app, owner);
    const invitedEmail = uniqueEmail('audit-mem-create-invitee');
    const url = `/api/parent/families/${owner.familyId}/members/invitations`;

    const anonymous = await app.inject({ method: 'POST', url, payload: { invitedEmail, role: 'VIEWER' } });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'POST', url, headers: sessionHeaders(owner), payload: { invitedEmail, role: 'VIEWER' } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const invalidRole = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { invitedEmail, role: 'OWNER', stepUpToken: 'x' } });
    assert.equal(invalidRole.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_rejects_invalid_role', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: invalidRole, evidenceTier: 'MYSQL_HTTP' });

    const viewerCreate = await app.inject({ method: 'POST', url, headers: mutationHeaders(viewer), payload: { invitedEmail, role: 'VIEWER', stepUpToken: 'x' } });
    assert.equal(viewerCreate.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerCreate, evidenceTier: 'MYSQL_HTTP' });

    const noGrant = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { invitedEmail, role: 'VIEWER' } });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const wrongOperationGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.role_change');
    const wrongOperation = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { invitedEmail, role: 'VIEWER', stepUpToken: wrongOperationGrant } });
    assert.equal(wrongOperation.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_wrong_operation_grant_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: wrongOperation, evidenceTier: 'MYSQL_HTTP' });

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const created = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { invitedEmail, role: 'VIEWER', stepUpToken: grant } });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: created, evidenceTier: 'MYSQL_HTTP' });
    const invited = createdInvitation(created);
    assert.ok(!('invitedEmail' in invited) && !('invitedEmailHash' in invited), 'the API must never re-serve the invited email or its hash');
    const stored = await readInvitationRow(invited.invitationId);
    assert.equal(stored?.status, 'PENDING', 'the invitation must be durably PENDING');
    assert.equal(stored?.role, 'VIEWER');

    const grant2 = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const duplicate = await app.inject({ method: 'POST', url, headers: mutationHeaders(owner), payload: { invitedEmail, role: 'VIEWER', stepUpToken: grant2 } });
    assert.equal(duplicate.statusCode, 409);
    recordParentRouteScenario({ method: 'POST', route: INVITATIONS_ROUTE, scenarioId: 'mysql_member_invitation_create_duplicate_pending_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 409, response: duplicate, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(duplicate.json().error, 'duplicate_pending_invitation');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP invitation revoke: CSRF/step-up boundaries, durable REVOKED readback, unknown and foreign ids collapse to 404', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-revoke'));
    const ownerMfa = await enrollMfa(app, owner);
    const invitedEmail = uniqueEmail('audit-mem-revoke-invitee');

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const created = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail, role: 'VIEWER', stepUpToken: grant },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    const invitationId = createdInvitation(created).invitationId;
    const revokeUrl = `/api/parent/families/${owner.familyId}/members/invitations/${invitationId}/revoke`;

    const noCsrf = await app.inject({ method: 'POST', url: revokeUrl, headers: sessionHeaders(owner), payload: {} });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ROUTE, scenarioId: 'mysql_member_invitation_revoke_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const noGrant = await app.inject({ method: 'POST', url: revokeUrl, headers: mutationHeaders(owner), payload: {} });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ROUTE, scenarioId: 'mysql_member_invitation_revoke_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const revokeGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.invitation.revoke');
    const revoked = await app.inject({ method: 'POST', url: revokeUrl, headers: mutationHeaders(owner), payload: { stepUpToken: revokeGrant } });
    assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.json()));
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ROUTE, scenarioId: 'mysql_member_invitation_revoke_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: revoked, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(createdInvitation(revoked).status, 'REVOKED');
    assert.equal((await readInvitationRow(invitationId))?.status, 'REVOKED', 'the revocation must be durable');

    const unknownGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.invitation.revoke');
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations/${randomUUID()}/revoke`,
      headers: mutationHeaders(owner),
      payload: { stepUpToken: unknownGrant },
    });
    assert.equal(unknown.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ROUTE, scenarioId: 'mysql_member_invitation_revoke_unknown_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: unknown, evidenceTier: 'MYSQL_HTTP' });

    // A foreign family's invitation id, revoked through a path scoped to this
    // family, is indistinguishable from an unknown id.
    const other = await registerVerifyLogin(app, uniqueEmail('audit-mem-revoke-other'));
    const now = clock.now();
    const foreignId = randomUUID();
    await getPool().query(
      `INSERT INTO family_member_invitations
         (invitation_id, family_id, invited_email_hash, role, status, invited_by_account_id, created_at, expires_at)
       VALUES (?, ?, ?, 'VIEWER', 'PENDING', ?, ?, ?)`,
      [foreignId, other.familyId, hashParentEmail(uniqueEmail('audit-mem-foreign')), other.accountId, now, new Date(now.getTime() + 7 * 24 * 3600 * 1000)],
    );
    const foreignGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.invitation.revoke');
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations/${foreignId}/revoke`,
      headers: mutationHeaders(owner),
      payload: { stepUpToken: foreignGrant },
    });
    assert.equal(foreign.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ROUTE, scenarioId: 'mysql_member_invitation_revoke_foreign_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: foreign, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await readInvitationRow(foreignId))?.status, 'PENDING', 'a failed cross-family revoke must not touch the foreign invitation');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP invitation role change: step-up grant, durable role readback, invalid role 400, not-pending 409', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-role'));
    const ownerMfa = await enrollMfa(app, owner);

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const created = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail: uniqueEmail('audit-mem-role-invitee'), role: 'VIEWER', stepUpToken: grant },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    const invitationId = createdInvitation(created).invitationId;
    const roleUrl = `/api/parent/families/${owner.familyId}/members/invitations/${invitationId}/role`;

    const invalidRole = await app.inject({ method: 'POST', url: roleUrl, headers: mutationHeaders(owner), payload: { role: 'OWNER', stepUpToken: 'x' } });
    assert.equal(invalidRole.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: ROLE_ROUTE, scenarioId: 'mysql_member_invitation_role_rejects_invalid_role', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: invalidRole, evidenceTier: 'MYSQL_HTTP' });

    const noGrant = await app.inject({ method: 'POST', url: roleUrl, headers: mutationHeaders(owner), payload: { role: 'ADMINISTRATOR' } });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: ROLE_ROUTE, scenarioId: 'mysql_member_invitation_role_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const roleGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.role_change');
    const changed = await app.inject({ method: 'POST', url: roleUrl, headers: mutationHeaders(owner), payload: { role: 'ADMINISTRATOR', stepUpToken: roleGrant } });
    assert.equal(changed.statusCode, 200, JSON.stringify(changed.json()));
    recordParentRouteScenario({ method: 'POST', route: ROLE_ROUTE, scenarioId: 'mysql_member_invitation_role_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: changed, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(createdInvitation(changed).role, 'ADMINISTRATOR');
    assert.equal((await readInvitationRow(invitationId))?.role, 'ADMINISTRATOR', 'the role revision must be durable');

    const revokeGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.invitation.revoke');
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations/${invitationId}/revoke`,
      headers: mutationHeaders(owner),
      payload: { stepUpToken: revokeGrant },
    });
    assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.json()));

    const notPendingGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.role_change');
    const notPending = await app.inject({ method: 'POST', url: roleUrl, headers: mutationHeaders(owner), payload: { role: 'VIEWER', stepUpToken: notPendingGrant } });
    assert.equal(notPending.statusCode, 409);
    recordParentRouteScenario({ method: 'POST', route: ROLE_ROUTE, scenarioId: 'mysql_member_invitation_role_not_pending_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 409, response: notPending, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(notPending.json().error, 'not_pending');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP member remove: step-up grant, durable un-binding + seat release readback, self/unknown/retry 409-or-404, viewer 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-remove'));
    const ownerMfa = await enrollMfa(app, owner);
    await entitlementRepository.getOrCreateForFamily(
      owner.familyId,
      'FREE_STARTER',
      { tier: 'FREE_STARTER', parentMemberLimit: 5, managedDeviceLimit: 5, updatedAt: clock.now(), updatedByAdminId: null },
      clock.now(),
    );
    const memberEmail = uniqueEmail('audit-mem-remove-member');
    const member = await seedAcceptedMember(owner.familyId, memberEmail);
    const viewer = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-mem-remove-viewer') });
    const removeUrl = `/api/parent/families/${owner.familyId}/members/${member.accountId}/remove`;

    const anonymous = await app.inject({ method: 'POST', url: removeUrl, payload: { stepUpToken: 'x' } });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'POST', url: removeUrl, headers: sessionHeaders(owner), payload: {} });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const viewerRemove = await app.inject({ method: 'POST', url: removeUrl, headers: mutationHeaders(viewer), payload: { stepUpToken: 'x' } });
    assert.equal(viewerRemove.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerRemove, evidenceTier: 'MYSQL_HTTP' });

    const noGrant = await app.inject({ method: 'POST', url: removeUrl, headers: mutationHeaders(owner), payload: {} });
    assert.equal(noGrant.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_requires_step_up', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noGrant, evidenceTier: 'MYSQL_HTTP' });

    const selfGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.remove');
    const selfRemove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/${owner.accountId}/remove`,
      headers: mutationHeaders(owner),
      payload: { stepUpToken: selfGrant },
    });
    assert.equal(selfRemove.statusCode, 409);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_self_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 409, response: selfRemove, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(selfRemove.json().error, 'cannot_remove_self');

    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.remove');
    const removed = await app.inject({ method: 'POST', url: removeUrl, headers: mutationHeaders(owner), payload: { stepUpToken: grant } });
    assert.equal(removed.statusCode, 200, JSON.stringify(removed.json()));
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: removed, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(removed.json().removed, true);
    assert.match(removed.json().auditEventId, /^[0-9a-f-]{36}$/);
    assert.equal(await readAccountFamilyId(member.accountId), null, 'the removed member must be durably un-bound');
    assert.equal((await entitlementRepository.getForFamily(owner.familyId))?.parentMemberUsedCount, 0, 'the seat must be durably released');

    const retryGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.remove');
    const retry = await app.inject({ method: 'POST', url: removeUrl, headers: mutationHeaders(owner), payload: { stepUpToken: retryGrant } });
    assert.equal(retry.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: REMOVE_ROUTE, scenarioId: 'mysql_member_remove_retry_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: retry, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await entitlementRepository.getForFamily(owner.familyId))?.parentMemberUsedCount, 0, 'a retried removal must never release a second seat');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP member invitation accept: non-addressee 404, wrong-family 409 family_conflict left PENDING, re-invited member 200 with durable role readback', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-mem-accept-owner'));
    const ownerMfa = await enrollMfa(app, owner);
    await entitlementRepository.getOrCreateForFamily(
      owner.familyId,
      'FREE_STARTER',
      { tier: 'FREE_STARTER', parentMemberLimit: 5, managedDeviceLimit: 5, updatedAt: clock.now(), updatedByAdminId: null },
      clock.now(),
    );

    const invitedEmail = uniqueEmail('audit-mem-accept-invitee');
    const grant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const created = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail, role: 'ADMINISTRATOR', stepUpToken: grant },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    const invitationId = createdInvitation(created).invitationId;
    const acceptUrl = `/api/parent/member-invitations/${invitationId}/accept`;

    const anonymous = await app.inject({ method: 'POST', url: acceptUrl, payload: {} });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: ACCEPT_ROUTE, scenarioId: 'mysql_member_accept_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const nonAddressee = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: uniqueEmail('audit-mem-accept-other') });
    const noCsrf = await app.inject({ method: 'POST', url: acceptUrl, headers: sessionHeaders(nonAddressee), payload: {} });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: ACCEPT_ROUTE, scenarioId: 'mysql_member_accept_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const wrongAccount = await app.inject({ method: 'POST', url: acceptUrl, headers: mutationHeaders(nonAddressee), payload: {} });
    assert.equal(wrongAccount.statusCode, 404);
    recordParentRouteScenario({ method: 'POST', route: ACCEPT_ROUTE, scenarioId: 'mysql_member_accept_non_addressee_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: wrongAccount, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await readInvitationRow(invitationId))?.status, 'PENDING', 'a non-addressee attempt must not consume the invitation');

    // A REAL second parent whose first sign-in provisioned their OWN family:
    // accepting another family's invitation is the PCA-DEC-036 conflict, and
    // it must consume nothing.
    const otherParentEmail = uniqueEmail('audit-mem-accept-other-parent');
    const otherParent = await registerVerifyLogin(app, otherParentEmail);
    assert.notEqual(otherParent.familyId, owner.familyId);
    const conflictGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const createdForConflict = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail: otherParentEmail, role: 'VIEWER', stepUpToken: conflictGrant },
    });
    assert.equal(createdForConflict.statusCode, 201, JSON.stringify(createdForConflict.json()));
    const conflictInvitationId = createdInvitation(createdForConflict).invitationId;
    const conflict = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${conflictInvitationId}/accept`,
      headers: mutationHeaders(otherParent),
      payload: {},
    });
    assert.equal(conflict.statusCode, 409, JSON.stringify(conflict.json()));
    recordParentRouteScenario({ method: 'POST', route: ACCEPT_ROUTE, scenarioId: 'mysql_member_accept_cross_family_conflict_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 409, response: conflict, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(conflict.json().error, 'family_conflict');
    assert.equal((await readInvitationRow(conflictInvitationId))?.status, 'PENDING', 'the conflict must leave the invitation PENDING');
    assert.equal(await readAccountFamilyId(otherParent.accountId), otherParent.familyId, 'the refusing account must stay bound to its own family');
    const [membershipRows] = await getPool().query(
      `SELECT COUNT(*) AS n FROM family_parent_memberships WHERE account_id = ? AND family_id = ?`,
      [otherParent.accountId, owner.familyId],
    );
    assert.equal(membershipRows[0].n, 0, 'the conflict must not create a membership in the target family');

    // The reachable ACCEPT success: the invitation's addressee is already
    // bound to THIS family (the re-invite flow MySqlFamilyMemberAccountBinder
    // itself documents as the ALREADY_BOUND_TO_THIS_FAMILY success), so the
    // real binder role-write must land durably.
    const memberEmail = uniqueEmail('audit-mem-accept-member');
    const member = await createBoundMemberSession({ familyId: owner.familyId, role: 'VIEWER', email: memberEmail });
    const acceptGrant = await mintStepUp(app, owner, ownerMfa, 'family.member.add');
    const createdForMember = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${owner.familyId}/members/invitations`,
      headers: mutationHeaders(owner),
      payload: { invitedEmail: memberEmail, role: 'ADMINISTRATOR', stepUpToken: acceptGrant },
    });
    assert.equal(createdForMember.statusCode, 201, JSON.stringify(createdForMember.json()));
    const memberInvitationId = createdInvitation(createdForMember).invitationId;

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${memberInvitationId}/accept`,
      headers: mutationHeaders(member),
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.json()));
    recordParentRouteScenario({ method: 'POST', route: ACCEPT_ROUTE, scenarioId: 'mysql_member_accept_reinvited_member_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: accepted, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(createdInvitation(accepted).status, 'ACCEPTED');
    assert.equal(createdInvitation(accepted).acceptedByAccountId, member.accountId);
    const storedInvitation = await readInvitationRow(memberInvitationId);
    assert.equal(storedInvitation?.status, 'ACCEPTED', 'the acceptance must be durable');
    assert.equal(storedInvitation?.accepted_by_account_id, member.accountId);
    const membership = await readMembershipRole(member.accountId, owner.familyId);
    assert.equal(membership?.role, 'ADMINISTRATOR', 'the real binder must apply the accepted invitation role durably');
    assert.equal((await entitlementRepository.getForFamily(owner.familyId))?.parentMemberUsedCount, 1, 'the acceptance must charge one parent-member seat');
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
