// TODO-14 Wave 2: DATABASE-BACKED INTEGRATED Parent route evidence.
//
// This suite boots REAL Fastify routes (registerParentAccountRoutes,
// registerFamilyAuditEventRoutes, registerProtectionAlertRoutes) over REAL
// MySQL repositories for the Parent account/session/identity/preferences/
// safe-zone/MFA/audit/alert surfaces and emits status-only MYSQL_HTTP
// collector rows. Every account it uses is registered -> verified -> signed
// in through the real HTTP routes (or a real service-issued session bound to
// a real parent_accounts row), so the authority path exercised here is the
// same membership/role path the production composition uses.
//
// Composition notes (documented test-only collaborators):
//   - RecordingEmailSender: captures verification/step-up/reset codes in
//     process; no real email delivery exists in tests by design.
//   - createTestClock: drives TOTP counter steps deterministically; it is
//     anchored at the real wall clock so DB NOW(3) timestamps and service
//     timestamps stay aligned within seconds.
//   - Device/Trust Set cryptographic material is NOT exercised here: the
//     safe-zone routes' actor binding is session + active family role +
//     device-directory membership (no device bearer), so no device
//     signature verifier is needed for these declarations.
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
import { MySqlFamilyAuditEventLedger } from '../../dist/familyrbac/MySqlFamilyAuditEventLedger.js';
import { MySqlProtectionAlertLedger } from '../../dist/alerts/MySqlProtectionAlertLedger.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { registerFamilyAuditEventRoutes } from '../../dist/http/routes/familyAuditEventRoutes.js';
import { registerProtectionAlertRoutes } from '../../dist/http/routes/protectionAlertRoutes.js';
import { sessionCookieName, csrfCookieName, mfaEnrollmentTicketCookieName } from '../../dist/parentaccount/cookies.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const SESSION_ROUTE = '/api/parent/session';
const LOGOUT_ROUTE = '/api/parent/logout';
const REVOKE_ALL_ROUTE = '/api/parent/sessions/revoke-all';
const CSRF_ROUTE = '/api/parent/csrf';
const IDENTITY_ROUTE = '/api/parent/identity';
const PREFERENCES_ROUTE = '/api/parent/preferences';
const REGISTER_ROUTE = '/api/parent/register';
const VERIFY_ROUTE = '/api/parent/verify-email';
const LOGIN_ROUTE = '/api/parent/login';
const LOGIN_STEP_UP_ROUTE = '/api/parent/login/step-up';
const RESET_REQUEST_ROUTE = '/api/parent/request-password-reset';
const RESET_COMPLETE_ROUTE = '/api/parent/reset-password';
const MFA_START_ROUTE = '/api/parent/mfa/enrollment/start';
const MFA_CONFIRM_ROUTE = '/api/parent/mfa/enrollment/confirm';
const MFA_RECOVERY_REQUEST_ROUTE = '/api/parent/mfa/recovery/request';
const MFA_RECOVERY_COMPLETE_ROUTE = '/api/parent/mfa/recovery/complete';
const MFA_STEP_UP_ROUTE = '/api/parent/mfa/step-up';
const SAFE_ZONES_ROUTE = '/api/parent/families/:familyId/safe-zones';
const SAFE_ZONE_DETAIL_ROUTE = '/api/parent/families/:familyId/safe-zones/:zoneId';
const AUDIT_EVENTS_ROUTE = '/api/parent/families/:familyId/audit-events';
const PROTECTION_ALERTS_ROUTE = '/api/parent/families/:familyId/protection-alerts';

const STEP_MS = 30 * 1000;

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
const safeZoneRepository = new MySqlSafeZoneRepository();
const familyAuditEventLedger = new MySqlFamilyAuditEventLedger();
const protectionAlertLedger = new MySqlProtectionAlertLedger();
const clock = createTestClock(new Date(Date.now() - 1000).toISOString());

let emailSender;
let parentAccountService;

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
  parentAccountService = service;
  const app = Fastify({ logger: false });
  registerParentAccountRoutes(app, {
    parentAccountService,
    parentPreferenceRepository: new MySqlParentPreferenceRepository(),
    safeZoneRepository,
    deviceRepository: new MySqlDeviceRepository(),
    freeAccessAccountRepository: new MySqlFreeAccessAccountRepository(),
  });
  registerFamilyAuditEventRoutes(app, { parentAccountService, familyAuditEventLedger });
  registerProtectionAlertRoutes(app, { parentAccountService, protectionAlertLedger });
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

const PASSWORD = 'a genuinely long password';

function registrationPayload(email, password = PASSWORD) {
  return { email, password, passwordConfirmation: password, firstName: 'Route', lastName: 'Audit' };
}

/** Full real HTTP account lifecycle: register -> verify-email -> login. */
async function registerVerifyLogin(app, email, password = PASSWORD) {
  const registered = await app.inject({ method: 'POST', url: REGISTER_ROUTE, payload: registrationPayload(email, password) });
  assert.equal(registered.statusCode, 202, JSON.stringify(registered.json()));
  const code = emailSender.lastCodeFor(email);
  assert.ok(code, 'registration must have issued a verification code');
  const verified = await app.inject({ method: 'POST', url: VERIFY_ROUTE, payload: { email, code } });
  assert.equal(verified.statusCode, 200, JSON.stringify(verified.json()));
  return loginFor(app, email, password);
}

/** Real HTTP sign-in returning the session/csrf cookies and the login response. */
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
  return { sessionToken, csrfToken, familyId: body.familyId, accountId: body.accountId, email, password, loginResponse: login };
}

/** Session-only headers (reads, and expected-401 probes). */
function sessionHeaders(session) {
  return { cookie: `${sessionCookieName()}=${session.sessionToken}` };
}

/** Session + double-submit CSRF headers (mutations). */
function mutationHeaders(session) {
  return {
    cookie: `${sessionCookieName()}=${session.sessionToken}; ${csrfCookieName()}=${session.csrfToken}`,
    'x-pca-csrf-token': session.csrfToken,
  };
}

/**
 * A REAL service-issued session bound to a REAL parent_accounts row in
 * `familyId` with the given family role. Used for authority-contrast members
 * (e.g. a VIEWER) without repeating the full password lifecycle.
 */
async function createFamilyMemberSession({ familyId, role }) {
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
  // Every usable Parent session carries an MFA posture; a real first sign-in
  // opens the NOT_ENROLLED (grace) state the same way (resolveUsableSession
  // fails closed with no grace record).
  const graceStarted = clock.now();
  const graceExpires = new Date(graceStarted.getTime() + PARENT_MFA_GRACE_MS);
  await getPool().query(
    `INSERT INTO parent_mfa_state (account_id, status, grace_started_at, grace_expires_at, created_at, updated_at)
     VALUES (?, 'NOT_ENROLLED', ?, ?, ?, ?)`,
    [accountId, graceStarted, graceExpires, graceStarted, graceStarted],
  );
  return { sessionToken: rawToken, csrfToken: `audit-csrf-${randomBytes(8).toString('hex')}`, familyId, accountId };
}

async function insertFamilyDevice(familyId) {
  const deviceId = randomUUID();
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  return deviceId;
}

function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID()}@example.test`;
}

test('MYSQL HTTP register: 202 PENDING_VERIFICATION, no session cookie, and the durable row is actually written', async () => {
  const app = buildApp();
  try {
    const email = uniqueEmail('audit-register');
    const response = await app.inject({ method: 'POST', url: REGISTER_ROUTE, payload: registrationPayload(email) });
    assert.equal(response.statusCode, 202);
    recordParentRouteScenario({ method: 'POST', route: REGISTER_ROUTE, scenarioId: 'mysql_register_allow', classification: 'ALLOW_PROVEN', expectedStatus: 202, response, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(setCookieJar(response).size, 0, 'registration never establishes a session');

    const persisted = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
    assert.ok(persisted, 'the account must be durably persisted');
    assert.equal(persisted.status, 'PENDING_VERIFICATION');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP verify-email: 200 VERIFIED with no session, and the durable status actually flips', async () => {
  const app = buildApp();
  try {
    const email = uniqueEmail('audit-verify');
    await app.inject({ method: 'POST', url: REGISTER_ROUTE, payload: registrationPayload(email) });
    const code = emailSender.lastCodeFor(email);
    const response = await app.inject({ method: 'POST', url: VERIFY_ROUTE, payload: { email, code } });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: VERIFY_ROUTE, scenarioId: 'mysql_verify_email_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response, evidenceTier: 'MYSQL_HTTP' });
    assert.deepEqual(response.json(), { status: 'VERIFIED', sessionEstablished: false });
    assert.equal(setCookieJar(response).size, 0);

    const persisted = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
    assert.equal(persisted.status, 'VERIFIED');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP login/session: wrong password 401, real login 200, session 200, anonymous and garbage-cookie 401', async () => {
  const app = buildApp();
  try {
    const email = uniqueEmail('audit-login');
    await app.inject({ method: 'POST', url: REGISTER_ROUTE, payload: registrationPayload(email) });
    await app.inject({ method: 'POST', url: VERIFY_ROUTE, payload: { email, code: emailSender.lastCodeFor(email) } });

    const wrong = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email, password: 'definitely not it' } });
    assert.equal(wrong.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_ROUTE, scenarioId: 'mysql_login_wrong_password_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: wrong, evidenceTier: 'MYSQL_HTTP' });

    const session = await loginFor(app, email);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_ROUTE, scenarioId: 'mysql_login_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: session.loginResponse, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: SESSION_ROUTE, headers: sessionHeaders(session) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: SESSION_ROUTE, scenarioId: 'mysql_session_read_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(read.json().familyId, session.familyId);

    const anonymous = await app.inject({ method: 'GET', url: SESSION_ROUTE });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: SESSION_ROUTE, scenarioId: 'mysql_session_read_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const garbage = await app.inject({ method: 'GET', url: SESSION_ROUTE, headers: { cookie: `${sessionCookieName()}=not-a-real-session` } });
    assert.equal(garbage.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: SESSION_ROUTE, scenarioId: 'mysql_session_read_garbage_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: garbage, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP logout: CSRF required, 204 on success, and the revoked session is durably unusable', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-logout'));
    const noCsrf = await app.inject({ method: 'POST', url: LOGOUT_ROUTE, headers: { cookie: `${sessionCookieName()}=${session.sessionToken}; ${csrfCookieName()}=wrong` } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: LOGOUT_ROUTE, scenarioId: 'mysql_logout_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const ok = await app.inject({ method: 'POST', url: LOGOUT_ROUTE, headers: mutationHeaders(session) });
    assert.equal(ok.statusCode, 204);
    recordParentRouteScenario({ method: 'POST', route: LOGOUT_ROUTE, scenarioId: 'mysql_logout_allow', classification: 'ALLOW_PROVEN', expectedStatus: 204, response: ok, evidenceTier: 'MYSQL_HTTP' });

    const after = await app.inject({ method: 'GET', url: SESSION_ROUTE, headers: sessionHeaders(session) });
    assert.equal(after.statusCode, 401, 'the session must be revoked in the database, not merely cookie-cleared');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP revoke-all: mismatched CSRF 403, valid 204, and the session is durably revoked', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-revoke'));
    const mismatched = await app.inject({
      method: 'POST',
      url: REVOKE_ALL_ROUTE,
      headers: { cookie: `${sessionCookieName()}=${session.sessionToken}; ${csrfCookieName()}=${session.csrfToken}`, 'x-pca-csrf-token': 'wrong-value' },
    });
    assert.equal(mismatched.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ALL_ROUTE, scenarioId: 'mysql_revoke_all_mismatched_csrf_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: mismatched, evidenceTier: 'MYSQL_HTTP' });

    const ok = await app.inject({ method: 'POST', url: REVOKE_ALL_ROUTE, headers: mutationHeaders(session) });
    assert.equal(ok.statusCode, 204);
    recordParentRouteScenario({ method: 'POST', route: REVOKE_ALL_ROUTE, scenarioId: 'mysql_revoke_all_allow', classification: 'ALLOW_PROVEN', expectedStatus: 204, response: ok, evidenceTier: 'MYSQL_HTTP' });

    const after = await app.inject({ method: 'GET', url: SESSION_ROUTE, headers: sessionHeaders(session) });
    assert.equal(after.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: SESSION_ROUTE, scenarioId: 'mysql_session_read_after_revoke_all_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: after, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP csrf bootstrap: anonymous 401, live session 200 with matching token', async () => {
  const app = buildApp();
  try {
    const anonymous = await app.inject({ method: 'GET', url: CSRF_ROUTE });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: CSRF_ROUTE, scenarioId: 'mysql_csrf_bootstrap_anonymous_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const session = await registerVerifyLogin(app, uniqueEmail('audit-csrf'));
    const read = await app.inject({ method: 'GET', url: CSRF_ROUTE, headers: sessionHeaders(session) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: CSRF_ROUTE, scenarioId: 'mysql_csrf_bootstrap_session_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });
    assert.match(read.json().csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const readJar = setCookieJar(read);
    if (readJar.has(csrfCookieName())) assert.equal(read.json().csrfToken, readJar.get(csrfCookieName()));
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP identity: anonymous 401, read 200, CSRF 403, contact-mutation 400, and PATCH persists a readable profile', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-identity'));

    const anonymous = await app.inject({ method: 'GET', url: IDENTITY_ROUTE });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: IDENTITY_ROUTE, scenarioId: 'mysql_identity_read_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: IDENTITY_ROUTE, headers: sessionHeaders(session) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: IDENTITY_ROUTE, scenarioId: 'mysql_identity_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({
      method: 'PATCH',
      url: IDENTITY_ROUTE,
      headers: { cookie: `${sessionCookieName()}=${session.sessionToken}; ${csrfCookieName()}=${session.csrfToken}` },
      payload: { firstName: 'N', lastName: 'A' },
    });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'PATCH', route: IDENTITY_ROUTE, scenarioId: 'mysql_identity_patch_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const contactMutation = await app.inject({
      method: 'PATCH',
      url: IDENTITY_ROUTE,
      headers: mutationHeaders(session),
      payload: { firstName: 'N', lastName: 'A', email: 'attacker@example.test' },
    });
    assert.equal(contactMutation.statusCode, 400);
    recordParentRouteScenario({ method: 'PATCH', route: IDENTITY_ROUTE, scenarioId: 'mysql_identity_patch_rejects_contact_mutation', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: contactMutation, evidenceTier: 'MYSQL_HTTP' });

    const saved = await app.inject({
      method: 'PATCH',
      url: IDENTITY_ROUTE,
      headers: mutationHeaders(session),
      payload: { firstName: ' نجوى ', lastName: ' حسن ' },
    });
    assert.equal(saved.statusCode, 200);
    recordParentRouteScenario({ method: 'PATCH', route: IDENTITY_ROUTE, scenarioId: 'mysql_identity_patch_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: saved, evidenceTier: 'MYSQL_HTTP' });

    // Persistence readback through the real route against the database.
    const readBack = await app.inject({ method: 'GET', url: IDENTITY_ROUTE, headers: sessionHeaders(session) });
    assert.equal(readBack.json().firstName, 'نجوى');
    assert.equal(readBack.json().lastName, 'حسن');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP preferences: read 200, CSRF 403, invalid destination 400, and PATCH persists across a fresh read', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-preferences'));

    const initial = await app.inject({ method: 'GET', url: PREFERENCES_ROUTE, headers: sessionHeaders(session) });
    assert.equal(initial.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: PREFERENCES_ROUTE, scenarioId: 'mysql_preferences_read_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: initial, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'PATCH', url: PREFERENCES_ROUTE, headers: sessionHeaders(session), payload: { language: 'ar' } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'mysql_preferences_patch_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const invalid = await app.inject({ method: 'PATCH', url: PREFERENCES_ROUTE, headers: mutationHeaders(session), payload: { emailDestination: 'not-an-email' } });
    assert.equal(invalid.statusCode, 400);
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'mysql_preferences_patch_invalid_destination', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: invalid, evidenceTier: 'MYSQL_HTTP' });

    const changed = await app.inject({ method: 'PATCH', url: PREFERENCES_ROUTE, headers: mutationHeaders(session), payload: { language: 'ar', emailAlertsEnabled: false } });
    assert.equal(changed.statusCode, 200);
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'mysql_preferences_patch_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: changed, evidenceTier: 'MYSQL_HTTP' });

    const readBack = await app.inject({ method: 'GET', url: PREFERENCES_ROUTE, headers: sessionHeaders(session) });
    assert.equal(readBack.json().preferences.language, 'ar');
    assert.equal(readBack.json().preferences.emailAlertsEnabled, false);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP password reset: generically identical 202s, invalid code 401, mismatched confirmation 400, and a full reset persists', async () => {
  const app = buildApp();
  try {
    const email = uniqueEmail('audit-reset');
    await registerVerifyLogin(app, email);

    const real = await app.inject({ method: 'POST', url: RESET_REQUEST_ROUTE, payload: { email } });
    assert.equal(real.statusCode, 202);
    recordParentRouteScenario({ method: 'POST', route: RESET_REQUEST_ROUTE, scenarioId: 'mysql_password_reset_request_known_email', classification: 'ALLOW_PROVEN', expectedStatus: 202, response: real, evidenceTier: 'MYSQL_HTTP' });
    const unknown = await app.inject({ method: 'POST', url: RESET_REQUEST_ROUTE, payload: { email: uniqueEmail('audit-reset-unknown') } });
    assert.equal(unknown.statusCode, 202);
    recordParentRouteScenario({ method: 'POST', route: RESET_REQUEST_ROUTE, scenarioId: 'mysql_password_reset_request_unknown_email', classification: 'ALLOW_PROVEN', expectedStatus: 202, response: unknown, evidenceTier: 'MYSQL_HTTP' });
    assert.deepEqual(real.json(), unknown.json(), 'no account-existence oracle');

    const invalid = await app.inject({ method: 'POST', url: RESET_COMPLETE_ROUTE, payload: { email, code: '000000', newPassword: PASSWORD, newPasswordConfirmation: PASSWORD } });
    assert.equal(invalid.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: RESET_COMPLETE_ROUTE, scenarioId: 'mysql_password_reset_invalid_code_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: invalid, evidenceTier: 'MYSQL_HTTP' });

    const code = emailSender.lastCodeFor(email, 'PASSWORD_RESET');
    assert.ok(code);
    const mismatched = await app.inject({ method: 'POST', url: RESET_COMPLETE_ROUTE, payload: { email, code, newPassword: 'a brand new correct horse battery', newPasswordConfirmation: 'a totally different one' } });
    assert.equal(mismatched.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: RESET_COMPLETE_ROUTE, scenarioId: 'mysql_password_reset_mismatched_confirmation', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: mismatched, evidenceTier: 'MYSQL_HTTP' });

    const NEW_PASSWORD = 'a brand new correct horse battery';
    const completed = await app.inject({ method: 'POST', url: RESET_COMPLETE_ROUTE, payload: { email, code, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD } });
    assert.equal(completed.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: RESET_COMPLETE_ROUTE, scenarioId: 'mysql_password_reset_complete_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: completed, evidenceTier: 'MYSQL_HTTP' });

    // Durable proof: the OLD password no longer authenticates and the NEW one does.
    const oldLogin = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email, password: PASSWORD } });
    assert.equal(oldLogin.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_ROUTE, scenarioId: 'mysql_login_old_password_after_reset_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: oldLogin, evidenceTier: 'MYSQL_HTTP' });
    const newLogin = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email, password: NEW_PASSWORD } });
    assert.equal(newLogin.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP MFA enrollment: CSRF 403, start 200, confirm 200, and the durable state requires TOTP at the next sign-in', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-enroll'));

    const noCsrf = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: sessionHeaders(session), payload: { email: session.email, password: session.password } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: MFA_START_ROUTE, scenarioId: 'mysql_mfa_enrollment_start_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const start = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, password: session.password } });
    assert.equal(start.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: MFA_START_ROUTE, scenarioId: 'mysql_mfa_enrollment_start_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: start, evidenceTier: 'MYSQL_HTTP' });
    const { secret } = start.json();

    const confirm = await app.inject({ method: 'POST', url: MFA_CONFIRM_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, code: totpFor(secret, clock.ms()) } });
    assert.equal(confirm.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: MFA_CONFIRM_ROUTE, scenarioId: 'mysql_mfa_enrollment_confirm_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: confirm, evidenceTier: 'MYSQL_HTTP' });
    assert.deepEqual(confirm.json(), { enrolled: true, sessionEstablished: false });

    const [mfaRow] = await getPool().query(`SELECT status FROM parent_mfa_state WHERE account_id = ?`, [session.accountId]);
    assert.equal(mfaRow[0].status, 'ACTIVE', 'enrollment must be durable');

    // Durable behavioral proof: a fresh browser sign-in now demands TOTP.
    clock.advance(STEP_MS);
    const fresh = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email: session.email, password: session.password } });
    assert.equal(fresh.statusCode, 200);
    assert.deepEqual(fresh.json(), { sessionEstablished: false, stepUpRequired: true });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP login step-up: email OTP alone is pending, wrong TOTP 401, correct TOTP 200', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-login-stepup'));
    const start = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, password: session.password } });
    const { secret } = start.json();
    await app.inject({ method: 'POST', url: MFA_CONFIRM_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, code: totpFor(secret, clock.ms()) } });
    clock.advance(STEP_MS);

    const freshLogin = await app.inject({ method: 'POST', url: LOGIN_ROUTE, payload: { email: session.email, password: session.password } });
    assert.deepEqual(freshLogin.json(), { sessionEstablished: false, stepUpRequired: true });
    const otp = emailSender.lastCodeFor(session.email, 'LOGIN_STEP_UP');
    assert.ok(otp);

    const emailOnly = await app.inject({ method: 'POST', url: LOGIN_STEP_UP_ROUTE, payload: { email: session.email, code: otp } });
    assert.equal(emailOnly.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_STEP_UP_ROUTE, scenarioId: 'mysql_login_step_up_email_only_pending', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 200, response: emailOnly, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(emailOnly.json().mfaRequired, true);

    const wrong = await app.inject({ method: 'POST', url: LOGIN_STEP_UP_ROUTE, payload: { email: session.email, code: otp, totpCode: totpFor(secret, clock.ms()) === '000000' ? '111111' : '000000' } });
    assert.equal(wrong.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_STEP_UP_ROUTE, scenarioId: 'mysql_login_step_up_wrong_totp_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: wrong, evidenceTier: 'MYSQL_HTTP' });

    const ok = await app.inject({ method: 'POST', url: LOGIN_STEP_UP_ROUTE, payload: { email: session.email, code: otp, totpCode: totpFor(secret, clock.ms()) } });
    assert.equal(ok.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: LOGIN_STEP_UP_ROUTE, scenarioId: 'mysql_login_step_up_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: ok, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(ok.json().sessionEstablished, true);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP MFA recovery: generic 202, malformed 400, immediate setup ticket, and confirmed replacement TOTP', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-recovery'));
    const start = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, password: session.password } });
    const { secret } = start.json();
    await app.inject({ method: 'POST', url: MFA_CONFIRM_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, code: totpFor(secret, clock.ms()) } });

    const requested = await app.inject({ method: 'POST', url: MFA_RECOVERY_REQUEST_ROUTE, payload: { email: session.email, password: session.password } });
    assert.equal(requested.statusCode, 202);
    recordParentRouteScenario({ method: 'POST', route: MFA_RECOVERY_REQUEST_ROUTE, scenarioId: 'mysql_mfa_recovery_request_allow', classification: 'ALLOW_PROVEN', expectedStatus: 202, response: requested, evidenceTier: 'MYSQL_HTTP' });

    const malformed = await app.inject({ method: 'POST', url: MFA_RECOVERY_COMPLETE_ROUTE, payload: { email: session.email, password: session.password, code: 'abcdef' } });
    assert.equal(malformed.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: MFA_RECOVERY_COMPLETE_ROUTE, scenarioId: 'mysql_mfa_recovery_complete_malformed_code', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: malformed, evidenceTier: 'MYSQL_HTTP' });

    const completed = await app.inject({ method: 'POST', url: MFA_RECOVERY_COMPLETE_ROUTE, payload: { email: session.email, password: session.password, code: emailSender.lastCodeFor(session.email, 'MFA_RECOVERY') } });
    assert.equal(completed.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: MFA_RECOVERY_COMPLETE_ROUTE, scenarioId: 'mysql_mfa_recovery_complete_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: completed, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(completed.json().status, 'MFA_SETUP_REQUIRED');
    assert.equal(completed.json().mfaSetupRequired, true);
    assert.equal((await app.inject({ method: 'GET', url: SESSION_ROUTE, headers: sessionHeaders(session) })).statusCode, 401, 'recovery revokes the old Parent session');
    const [state] = await getPool().query(`SELECT status, totp_secret_ciphertext, recovery_hold_started_at, recovery_hold_expires_at
      FROM parent_mfa_state WHERE account_id = ?`, [session.accountId]);
    assert.equal(state.status, 'NOT_ENROLLED');
    assert.equal(state.totp_secret_ciphertext, null);
    assert.equal(state.recovery_hold_started_at, null);
    assert.equal(state.recovery_hold_expires_at, null);

    const rawSetCookie = completed.headers['set-cookie'];
    const ticketSetCookie = (Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie]).find((cookie) => cookie?.startsWith(`${mfaEnrollmentTicketCookieName()}=`));
    assert.ok(ticketSetCookie, 'recovery immediately issues the narrow enrollment ticket');
    const ticketHeaders = { cookie: ticketSetCookie.split(';', 1)[0] };
    const replacementStart = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: ticketHeaders, payload: { email: session.email, password: session.password } });
    assert.equal(replacementStart.statusCode, 200, 'the replacement setup can start immediately');
    const replacementConfirm = await app.inject({ method: 'POST', url: MFA_CONFIRM_ROUTE, headers: ticketHeaders, payload: { email: session.email, code: totpFor(replacementStart.json().secret, clock.ms()) } });
    assert.equal(replacementConfirm.statusCode, 200);
    assert.equal(replacementConfirm.json().mfa.status, 'ACTIVE', 'replacement MFA becomes active only after valid confirmation');
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP MFA step-up: CSRF 403, unknown operation 400, pre-enrollment 403, 201 grant, and TOTP replay 401', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, uniqueEmail('audit-stepup'));

    const noCsrf = await app.inject({ method: 'POST', url: MFA_STEP_UP_ROUTE, headers: sessionHeaders(session), payload: { operation: 'BILLING_CHECKOUT_CREATE', code: '123456' } });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: MFA_STEP_UP_ROUTE, scenarioId: 'mysql_mfa_step_up_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const unsupported = await app.inject({ method: 'POST', url: MFA_STEP_UP_ROUTE, headers: mutationHeaders(session), payload: { operation: 'DELETE_EVERYTHING', code: '123456' } });
    assert.equal(unsupported.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: MFA_STEP_UP_ROUTE, scenarioId: 'mysql_mfa_step_up_rejects_unknown_operation', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: unsupported, evidenceTier: 'MYSQL_HTTP' });

    const beforeEnrollment = await app.inject({ method: 'POST', url: MFA_STEP_UP_ROUTE, headers: mutationHeaders(session), payload: { operation: 'BILLING_CHECKOUT_CREATE', code: '123456' } });
    assert.equal(beforeEnrollment.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: MFA_STEP_UP_ROUTE, scenarioId: 'mysql_mfa_step_up_before_enrollment_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: beforeEnrollment, evidenceTier: 'MYSQL_HTTP' });

    const start = await app.inject({ method: 'POST', url: MFA_START_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, password: session.password } });
    const { secret } = start.json();
    await app.inject({ method: 'POST', url: MFA_CONFIRM_ROUTE, headers: mutationHeaders(session), payload: { email: session.email, code: totpFor(secret, clock.ms()) } });
    clock.advance(STEP_MS);

    const granted = await app.inject({ method: 'POST', url: MFA_STEP_UP_ROUTE, headers: mutationHeaders(session), payload: { operation: 'BILLING_CHECKOUT_CREATE', code: totpFor(secret, clock.ms()) } });
    assert.equal(granted.statusCode, 201);
    recordParentRouteScenario({ method: 'POST', route: MFA_STEP_UP_ROUTE, scenarioId: 'mysql_mfa_step_up_allow', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: granted, evidenceTier: 'MYSQL_HTTP' });
    assert.match(granted.json().stepUpToken, /^[A-Za-z0-9_-]{43}$/);

    const replay = await app.inject({ method: 'POST', url: MFA_STEP_UP_ROUTE, headers: mutationHeaders(session), payload: { operation: 'BILLING_CHECKOUT_CREATE', code: totpFor(secret, clock.ms()) } });
    assert.equal(replay.statusCode, 401);
    recordParentRouteScenario({ method: 'POST', route: MFA_STEP_UP_ROUTE, scenarioId: 'mysql_mfa_step_up_totp_replay_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: replay, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP safe zones: role/CSRF/validation/opaque-recipient boundaries with durable create-patch-delete', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-safezone'));
    const deviceId = await insertFamilyDevice(owner.familyId);
    const viewer = await createFamilyMemberSession({ familyId: owner.familyId, role: 'VIEWER' });
    const opaquePayload = { recipientEndpointId: deviceId, ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/safe-zones` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_read_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const viewerRead = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: sessionHeaders(viewer) });
    assert.equal(viewerRead.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_read_viewer_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: viewerRead, evidenceTier: 'MYSQL_HTTP' });

    const noCsrf = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: sessionHeaders(owner), payload: opaquePayload });
    assert.equal(noCsrf.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf, evidenceTier: 'MYSQL_HTTP' });

    const plaintext = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: mutationHeaders(owner), payload: { childProfileId: 'child-a', label: 'Home', latitude: 1, longitude: 2, radiusMeters: 100 } });
    assert.equal(plaintext.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_plaintext_rejected', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: plaintext, evidenceTier: 'MYSQL_HTTP' });

    const viewerMutation = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: mutationHeaders(viewer), payload: opaquePayload });
    assert.equal(viewerMutation.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerMutation, evidenceTier: 'MYSQL_HTTP' });

    const created = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: mutationHeaders(owner), payload: opaquePayload });
    assert.equal(created.statusCode, 201);
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: created, evidenceTier: 'MYSQL_HTTP' });
    const zoneId = created.json().safeZone.zoneId;

    const list = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: sessionHeaders(owner) });
    assert.equal(list.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: list, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(list.json().safeZones.length, 1);

    const patched = await app.inject({ method: 'PATCH', url: `/api/parent/families/${owner.familyId}/safe-zones/${zoneId}`, headers: mutationHeaders(owner), payload: { ciphertextB64: 'BAUG' } });
    assert.equal(patched.statusCode, 200);
    recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_update_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: patched, evidenceTier: 'MYSQL_HTTP' });

    // Wrong-recipient zone (recipient device does not exist in this family):
    // seeded straight through the repository so the route's device check is
    // the thing under test.
    const orphan = await safeZoneRepository.create({ familyId: owner.familyId, recipientEndpointId: 'missing-device-audit', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 });
    const wrongUpdate = await app.inject({ method: 'PATCH', url: `/api/parent/families/${owner.familyId}/safe-zones/${orphan.zoneId}`, headers: mutationHeaders(owner), payload: { ciphertextB64: 'BAUG' } });
    assert.equal(wrongUpdate.statusCode, 404);
    recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_update_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: wrongUpdate, evidenceTier: 'MYSQL_HTTP' });

    const wrongDelete = await app.inject({ method: 'DELETE', url: `/api/parent/families/${owner.familyId}/safe-zones/${orphan.zoneId}`, headers: mutationHeaders(owner) });
    assert.equal(wrongDelete.statusCode, 404);
    recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_delete_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: wrongDelete, evidenceTier: 'MYSQL_HTTP' });

    // Persistence readback: the PATCH actually updated the stored envelope.
    const readBack = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: sessionHeaders(owner) });
    const stored = readBack.json().safeZones.find((zone) => zone.zoneId === zoneId);
    assert.equal(stored.ciphertextB64, 'BAUG');
    assert.equal(stored.revision, 2);

    const removed = await app.inject({ method: 'DELETE', url: `/api/parent/families/${owner.familyId}/safe-zones/${zoneId}`, headers: mutationHeaders(owner) });
    assert.equal(removed.statusCode, 204);
    recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_delete_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 204, response: removed, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP family audit events: anonymous 401, owner 200, cross-family 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-events-owner'));
    const other = await registerVerifyLogin(app, uniqueEmail('audit-events-other'));

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/audit-events` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: AUDIT_EVENTS_ROUTE, scenarioId: 'mysql_audit_events_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/audit-events`, headers: sessionHeaders(owner) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: AUDIT_EVENTS_ROUTE, scenarioId: 'mysql_audit_events_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });

    const crossFamily = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/audit-events`, headers: sessionHeaders(other) });
    assert.equal(crossFamily.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: AUDIT_EVENTS_ROUTE, scenarioId: 'mysql_audit_events_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: crossFamily, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP protection alerts: anonymous 401, owner 200 with a durably recorded alert, cross-family 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-alerts-owner'));
    const other = await registerVerifyLogin(app, uniqueEmail('audit-alerts-other'));
    const alertId = `alert-audit-${randomUUID()}`;
    await protectionAlertLedger.record({
      alertId,
      familyId: owner.familyId,
      deviceId: null,
      parentDeviceId: 'dev-audit-parent',
      trigger: 'PROTECTION_DEGRADED',
      keyEpoch: 1,
      generatedAtUtc: new Date(),
      encryptedPayloadB64: 'b3BhcXVl',
      nonceB64: 'bm9uY2U',
    });

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/protection-alerts` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'mysql_protection_alerts_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/protection-alerts`, headers: sessionHeaders(owner) });
    assert.equal(read.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'mysql_protection_alerts_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read, evidenceTier: 'MYSQL_HTTP' });
    assert.ok(read.json().alerts.some((alert) => alert.alertId === alertId), 'the durably recorded alert must be readable');

    const crossFamily = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/protection-alerts`, headers: sessionHeaders(other) });
    assert.equal(crossFamily.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'mysql_protection_alerts_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: crossFamily, evidenceTier: 'MYSQL_HTTP' });
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
