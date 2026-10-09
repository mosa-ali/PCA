// TODO-14 Wave 2: DATABASE-BACKED INTEGRATED Parent route evidence.
//
// This suite boots REAL Fastify routes (registerParentAccountRoutes,
// registerFamilyAuditEventRoutes, registerProtectionAlertRoutes,
// registerWebRuleRoutes) over REAL MySQL repositories for the Parent account/session/identity/preferences/
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
//   - DeviceSessionService validates test-issued hashed bearer records in its
//     production process-local repository against real MySQL device/family
//     lifecycle epochs. These fixtures bypass proof-of-possession issuance;
//     they do not certify signatures. Missing/invalid bearers must return 401
//     before omitted Web Rules or Safe Zone policy services return 503.
//   - The schedule-policy gate case below uses the real MySQL-backed Parent
//     session/role path, StoreBackedTrustSetRoleResolver, and durable action
//     idempotency ledger. Its device-session identity is an explicit test
//     collaborator; the result is classified CRYPTO_DEVICE_GATED and does
//     not certify device signatures or successful policy delivery.
//   - WebRuleRoutes is registered with its production webRuleService omitted.
//     The route audit records the resulting 503s through the disposable MySQL
//     HTTP harness after Parent role/CSRF and actor-session checks. No Web
//     Rules functionality is enabled.
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
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { MySqlDeviceChallengeRepository } from '../../dist/deviceauth/MySqlDeviceChallengeRepository.js';
import { DeviceSessionService } from '../../dist/runtime-sync/DeviceSessionService.js';
import { InMemoryDeviceSessionRepository } from '../../dist/runtime-sync/DeviceSessionRepository.js';
import { generateSessionToken } from '../../dist/auth/token.js';
import { MySqlFreeAccessAccountRepository } from '../../dist/parentaccount/freeaccess/MySqlFreeAccessAccountRepository.js';
import { MySqlFamilyAuditEventLedger } from '../../dist/familyrbac/MySqlFamilyAuditEventLedger.js';
import { MySqlProtectionAlertLedger } from '../../dist/alerts/MySqlProtectionAlertLedger.js';
import { MySqlActionIdempotencyLedger } from '../../dist/familyrbac/MySqlActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { StoreBackedTrustSetRoleResolver } from '../../dist/familytrustset/StoreBackedTrustSetRoleResolver.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { registerDashboardRoutes } from '../../dist/http/routes/dashboardRoutes.js';
import { registerChildPolicyRoutes } from '../../dist/http/routes/childPolicyRoutes.js';
import { registerFamilyAuditEventRoutes } from '../../dist/http/routes/familyAuditEventRoutes.js';
import { registerProtectionAlertRoutes } from '../../dist/http/routes/protectionAlertRoutes.js';
import { registerWebRuleRoutes } from '../../dist/http/routes/webRuleRoutes.js';
import { DashboardAggregatorService } from '../../dist/parentpanel/DashboardAggregatorService.js';
import { WebFilteringDashboardCardProvider } from '../../dist/parentpanel/WebFilteringDashboardCardProvider.js';
import { YouTubeDashboardCardProvider, UnavailableModeAUsageEvidenceSource } from '../../dist/parentpanel/YouTubeDashboardCardProvider.js';
import { InMemoryBlockDecisionStateRepository } from '../../dist/safebrowser/BlockDecisionStateStore.js';
import { MySqlProfileModeRepository } from '../../dist/youtube/MySqlProfileModeRepository.js';
import { ModeTransitionService } from '../../dist/youtube/ModeTransitionService.js';
import { InMemoryModeBFeatureFlagRepository } from '../../dist/youtube/ModeBFeatureFlagStore.js';
import { ModeAUsageReportService } from '../../dist/youtube/ModeAUsageReportService.js';
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
const DASHBOARD_ROUTE = '/api/parent/families/:familyId/dashboard';
const SCHEDULE_POLICY_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/schedule-policy';

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
const dashboardAggregatorService = new DashboardAggregatorService([
  new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository(), 'INCOMPLETE_EPHEMERAL'),
  new YouTubeDashboardCardProvider(
    new ModeTransitionService(new MySqlProfileModeRepository(), new InMemoryModeBFeatureFlagRepository()),
    new ModeAUsageReportService(),
    new UnavailableModeAUsageEvidenceSource(),
  ),
]);
const clock = createTestClock(new Date(Date.now() - 1000).toISOString());
const actorDeviceRepository = new MySqlDeviceRepository();
const actorSessionRepository = new InMemoryDeviceSessionRepository();
const actorDeviceAuth = new DeviceAuthService(
  new MySqlDeviceChallengeRepository(), actorDeviceRepository,
  { async verify() { throw new Error('this route fixture must not certify device signatures'); } },
  clock.now,
);
const actorDeviceSessionService = new DeviceSessionService(actorDeviceAuth, actorSessionRepository, clock.now);

async function testActorIdentity(session) {
  const deviceId = await insertFamilyDevice(session.familyId);
  const [dsk] = await actorDeviceRepository.findKeysByDeviceForFamily(session.familyId, deviceId);
  assert.ok(dsk, 'the fixture requires an active DSK row bound to its synthetic session');
  const familySessionEpoch = await actorDeviceRepository.getActiveDeviceSessionEpoch(session.familyId, deviceId);
  assert.notEqual(familySessionEpoch, null, 'the fixture requires an active persisted device and family');
  const { rawToken, tokenHash } = generateSessionToken();
  await actorSessionRepository.create({
    sessionId: randomUUID(), tokenHash, deviceId, familyId: session.familyId,
    dskKeyId: dsk.keyId, dskPublicKey: dsk.publicKey,
    familySessionEpoch, issuedAt: clock.now(),
    expiresAt: new Date(clock.ms() + 60_000), revokedAt: null,
  });
  assert.deepEqual(await actorDeviceSessionService.requireActorDeviceInFamily(rawToken, session.familyId),
    { deviceId, familyId: session.familyId, dskKeyId: dsk.keyId });
  return { authorization: `Bearer ${rawToken}`, deviceId };
}

async function testActorHeaders(session) {
  const { authorization } = await testActorIdentity(session);
  return { authorization };
}

let emailSender;
let parentAccountService;

function buildApp({ schedulePolicyHarness } = {}) {
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
    deviceSessionService: actorDeviceSessionService,
    deviceRepository: new MySqlDeviceRepository(),
    freeAccessAccountRepository: new MySqlFreeAccessAccountRepository(),
  });
  registerDashboardRoutes(app, { parentAccountService, dashboardAggregatorService });
  registerFamilyAuditEventRoutes(app, { parentAccountService, familyAuditEventLedger, deviceSessionService: actorDeviceSessionService });
  registerProtectionAlertRoutes(app, { parentAccountService, protectionAlertLedger, deviceSessionService: actorDeviceSessionService });
  registerWebRuleRoutes(app, {
    parentAccountService,
    deviceSessionService: actorDeviceSessionService,
    // Intentionally omit webRuleService, matching production composition.
  });
  if (schedulePolicyHarness) {
    const { epochStore, actorSessions } = schedulePolicyHarness;
    const parentActionAuthorization = new ParentActionAuthorizationService(
      new StoreBackedTrustSetRoleResolver({ epochStore }),
      defaultFamilyRbacPolicyConfig,
      new MySqlActionIdempotencyLedger(),
    );
    registerChildPolicyRoutes(app, {
      parentAccountService,
      deviceSessionService: {
        async requireActorDeviceInFamily(token, familyId) {
          const identity = actorSessions.get(token);
          if (!identity || identity.familyId !== familyId) {
            const error = new Error('test actor session unavailable');
            error.name = 'RuntimeSyncAuthError';
            throw error;
          }
          return identity;
        },
      },
      parentActionAuthorization,
      outboundRelayService: {
        async submitBatch() {
          schedulePolicyHarness.relayCalls += 1;
          throw new Error('schedule-policy must not relay without an accepted Trust Set');
        },
      },
    });
  }
  return app;
}

after(async () => {
  await writeParentRouteScenarioReport();
});

test('family dashboard read uses a real Parent session and reports incomplete capabilities honestly', async () => {
  const app = buildApp();
  try {
    const session = await registerVerifyLogin(app, `route-audit-dashboard-${randomUUID()}@example.test`);
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${session.familyId}/dashboard`,
      headers: sessionHeaders(session),
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.json()));
    recordParentRouteScenario({ method: 'GET', route: DASHBOARD_ROUTE, scenarioId: 'mysql_dashboard_parent_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response, evidenceTier: 'MYSQL_HTTP' });
    const cards = response.json().cards;
    assert.deepEqual(cards.map(({ kind }) => kind).sort(), ['WEB_FILTERING', 'YOUTUBE']);
    assert.deepEqual(cards.find(({ kind }) => kind === 'WEB_FILTERING'), {
      kind: 'WEB_FILTERING',
      capabilityState: 'UNAVAILABLE',
      lastAcknowledgedPolicyRevision: null,
      pendingOrOfflineStatus: 'NONE',
      summaryLabel: 'Site block history unavailable',
    });
    assert.deepEqual(cards.find(({ kind }) => kind === 'YOUTUBE'), {
      kind: 'YOUTUBE',
      capabilityState: 'LIMITED',
      lastAcknowledgedPolicyRevision: null,
      pendingOrOfflineStatus: 'NONE',
      summaryLabel: null,
    });
  } finally {
    await app.close();
  }
});

test('schedule-policy route denies a real Parent session until a signed Trust Set epoch is accepted', async () => {
  const schedulePolicyHarness = { epochStore: new MySqlTrustSetEpochStore(), actorSessions: new Map(), relayCalls: 0 };
  const app = buildApp({ schedulePolicyHarness });
  try {
    const session = await registerVerifyLogin(app, `route-audit-schedule-policy-${randomUUID()}@example.test`);
    const { epochStore, actorSessions } = schedulePolicyHarness;
    actorSessions.set('test-only-actor-session', { deviceId: 'test-parent-actor', familyId: session.familyId });
    assert.equal(await epochStore.readLatestEpoch(session.familyId), null, 'the disposable family has no accepted signed epoch');
    const issuedAt = new Date(Date.now() - 1_000);

    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${session.familyId}/children/child-audit-schedule/schedule-policy`,
      headers: { ...mutationHeaders(session), authorization: 'Bearer test-only-actor-session' },
      payload: {
        protocolMajor: 1,
        protocolMinor: 0,
        messageId: `schedule-policy-${randomUUID()}`,
        familyId: session.familyId,
        senderDeviceId: 'test-parent-actor',
        recipientDeviceId: 'test-recipient',
        senderKeyId: 'test-parent-key',
        messageType: 'POLICY_UPDATE',
        trustSetEpoch: 1,
        keyEpoch: 1,
        sequenceOrNonce: `schedule-policy-sequence-${randomUUID()}`,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
        semanticVersion: '1.0.0',
        payload: Buffer.from('opaque-encrypted-policy').toString('base64'),
        signature: 'opaque-signature',
      },
    });

    assert.equal(response.statusCode, 403, JSON.stringify(response.json()));
    assert.deepEqual(response.json(), { error: 'forbidden' });
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'mysql_schedule_policy_no_accepted_trust_set', classification: 'CRYPTO_DEVICE_GATED', expectedStatus: 403, response, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(schedulePolicyHarness.relayCalls, 0, 'no encrypted schedule policy may be relayed without accepted authority');
    assert.equal(await epochStore.readLatestEpoch(session.familyId), null, 'the request must not create or alter Trust Set authority');
  } finally {
    await app.close();
  }
});

const WEB_RULES_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/web-rules';
const WEB_RULES_REMOVE_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/web-rules/remove';

test('MYSQL HTTP Web Rules declarations remain explicitly service-gated with a real Parent session and no domain echo', async () => {
  const app = buildApp();
  const domain = `mysql-web-rules-no-echo-${randomUUID()}.example`;
  try {
    const session = await registerVerifyLogin(app, `route-audit-web-rules-${randomUUID()}@example.test`);
    const actorHeaders = await testActorHeaders(session);
    const otherFamily = await registerVerifyLogin(app, uniqueEmail('audit-web-rules-other-family'));
    const foreignActorHeaders = await testActorHeaders(otherFamily);
    const unknownActorHeaders = { authorization: `Bearer ${generateSessionToken().rawToken}` };
    const scenarios = [
      {
        method: 'GET',
        route: WEB_RULES_ROUTE,
        scenarioId: 'mysql_web_rules_read_not_configured',
        url: `/api/parent/families/${session.familyId}/children/child-audit-web-rules/web-rules`,
        headers: { ...sessionHeaders(session), ...actorHeaders },
      },
      {
        method: 'POST',
        route: WEB_RULES_ROUTE,
        scenarioId: 'mysql_web_rules_add_not_configured',
        url: `/api/parent/families/${session.familyId}/children/child-audit-web-rules/web-rules`,
        headers: { ...mutationHeaders(session), ...actorHeaders },
        payload: { domain, listType: 'DENY' },
      },
      {
        method: 'POST',
        route: WEB_RULES_REMOVE_ROUTE,
        scenarioId: 'mysql_web_rules_remove_not_configured',
        url: `/api/parent/families/${session.familyId}/children/child-audit-web-rules/web-rules/remove`,
        headers: { ...mutationHeaders(session), ...actorHeaders },
        payload: { domain, listType: 'DENY' },
      },
    ];

    for (const scenario of scenarios) {
      const withoutActor = { ...scenario.headers };
      delete withoutActor.authorization;
      const denied = await app.inject({ method: scenario.method, url: scenario.url, headers: withoutActor,
        ...(scenario.payload ? { payload: scenario.payload } : {}) });
      assert.equal(denied.statusCode, 401);
      assert.deepEqual(denied.json(), { error: 'actor_device_session_required' });
      assert.equal(denied.body.includes(domain), false);
      recordParentRouteScenario({ method: scenario.method, route: scenario.route,
        scenarioId: `${scenario.scenarioId}_requires_actor`, classification: 'EXPECTED_DENIAL',
        expectedStatus: 401, response: denied, evidenceTier: 'MYSQL_HTTP' });
      for (const invalidHeaders of [unknownActorHeaders, foreignActorHeaders]) {
        const invalid = await app.inject({ method: scenario.method, url: scenario.url,
          headers: { ...scenario.headers, ...invalidHeaders },
          ...(scenario.payload ? { payload: scenario.payload } : {}) });
        assert.equal(invalid.statusCode, 401);
        assert.deepEqual(invalid.json(), { error: 'actor_device_session_invalid' });
        assert.equal(invalid.body.includes(domain), false);
      }
      const response = await app.inject({
        method: scenario.method,
        url: scenario.url,
        headers: scenario.headers,
        ...(scenario.payload ? { payload: scenario.payload } : {}),
      });
      assert.equal(response.statusCode, 503, `${scenario.scenarioId}: ${JSON.stringify(response.json())}`);
      assert.deepEqual(response.json(), { error: 'not_configured' });
      assert.equal(response.body.includes(domain), false, `${scenario.scenarioId} must not echo the domain`);
      recordParentRouteScenario({
        method: scenario.method,
        route: scenario.route,
        scenarioId: scenario.scenarioId,
        classification: 'SERVICE_NOT_CONFIGURED',
        expectedStatus: 503,
        response,
        evidenceTier: 'MYSQL_HTTP',
      });
    }
  } finally {
    await app.close();
  }
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
  const keyId = randomUUID();
  const publicKey = randomBytes(33).toString('base64url');
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', NOW(3), NULL)`,
    [deviceId, keyId, publicKey],
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
    const [rows] = await getPool().query(`SELECT status, totp_secret_ciphertext, recovery_hold_started_at, recovery_hold_expires_at
      FROM parent_mfa_state WHERE account_id = ?`, [session.accountId]);
    const state = rows[0];
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

test('MYSQL HTTP safe zones: role/CSRF/validation boundaries and missing actor authority fail closed without writes', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-safezone'));
    const deviceId = await insertFamilyDevice(owner.familyId);
    const actorHeaders = await testActorHeaders(owner);
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

    const missingActor = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: mutationHeaders(owner), payload: opaquePayload });
    assert.equal(missingActor.statusCode, 401);
    assert.deepEqual(missingActor.json(), { error: 'actor_device_session_required' });
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_requires_actor', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: missingActor, evidenceTier: 'MYSQL_HTTP' });

    const otherFamily = await registerVerifyLogin(app, uniqueEmail('audit-safezone-other-family'));
    const foreignActorHeaders = await testActorHeaders(otherFamily);
    for (const invalidHeaders of [{ authorization: `Bearer ${generateSessionToken().rawToken}` }, foreignActorHeaders]) {
      const invalid = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`,
        headers: { ...mutationHeaders(owner), ...invalidHeaders }, payload: opaquePayload });
      assert.equal(invalid.statusCode, 401);
      assert.deepEqual(invalid.json(), { error: 'actor_device_session_invalid' });
    }

    const createUnavailable = await app.inject({ method: 'POST', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: { ...mutationHeaders(owner), ...actorHeaders }, payload: opaquePayload });
    assert.equal(createUnavailable.statusCode, 503);
    assert.deepEqual(createUnavailable.json(), { error: 'family_authority_unavailable' });
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_create_actor_authority_unavailable', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response: createUnavailable, evidenceTier: 'MYSQL_HTTP' });
    assert.equal((await safeZoneRepository.list(owner.familyId)).length, 0, 'the unavailable actor authority must prevent a Safe Zone insert');

    // A disposable fixture and validated actor let PATCH/DELETE reach the missing-policy
    // gate. It is never treated as proof that an unauthenticated actor may
    // mutate a production row.
    const fixture = await safeZoneRepository.create({ familyId: owner.familyId, recipientEndpointId: deviceId, ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 });
    for (const method of ['PATCH', 'DELETE']) {
      for (const actor of [null, { authorization: `Bearer ${generateSessionToken().rawToken}` }, foreignActorHeaders]) {
        const denied = await app.inject({ method,
          url: `/api/parent/families/${owner.familyId}/safe-zones/${fixture.zoneId}`,
          headers: { ...mutationHeaders(owner), ...(actor ?? {}) },
          ...(method === 'PATCH' ? { payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } } : {}) });
        assert.equal(denied.statusCode, 401);
        assert.deepEqual(denied.json(), { error: actor ? 'actor_device_session_invalid' : 'actor_device_session_required' });
      }
    }
    const patchUnavailable = await app.inject({ method: 'PATCH', url: `/api/parent/families/${owner.familyId}/safe-zones/${fixture.zoneId}`, headers: { ...mutationHeaders(owner), ...actorHeaders }, payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } });
    assert.equal(patchUnavailable.statusCode, 503);
    assert.deepEqual(patchUnavailable.json(), { error: 'family_authority_unavailable' });
    recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_update_actor_authority_unavailable', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response: patchUnavailable, evidenceTier: 'MYSQL_HTTP' });

    const deleteUnavailable = await app.inject({ method: 'DELETE', url: `/api/parent/families/${owner.familyId}/safe-zones/${fixture.zoneId}`, headers: { ...mutationHeaders(owner), ...actorHeaders } });
    assert.equal(deleteUnavailable.statusCode, 503);
    assert.deepEqual(deleteUnavailable.json(), { error: 'family_authority_unavailable' });
    recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'mysql_safe_zones_delete_actor_authority_unavailable', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response: deleteUnavailable, evidenceTier: 'MYSQL_HTTP' });

    const readBack = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/safe-zones`, headers: sessionHeaders(owner) });
    assert.equal(readBack.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'mysql_safe_zones_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: readBack, evidenceTier: 'MYSQL_HTTP' });
    assert.equal(readBack.json().safeZones.length, 1);
    assert.equal(readBack.json().safeZones[0].zoneId, fixture.zoneId);
    assert.equal(readBack.json().safeZones[0].ciphertextB64, 'AQID');
    assert.equal(readBack.json().safeZones[0].revision, 1);
  } finally {
    await app.close();
  }
});

test('MYSQL HTTP family audit events: anonymous 401, owner 200, cross-family 403', async () => {
  const app = buildApp();
  try {
    const owner = await registerVerifyLogin(app, uniqueEmail('audit-events-owner'));
    const other = await registerVerifyLogin(app, uniqueEmail('audit-events-other'));
    const actorHeaders = await testActorHeaders(owner);

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/audit-events` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: AUDIT_EVENTS_ROUTE, scenarioId: 'mysql_audit_events_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/audit-events`, headers: { ...sessionHeaders(owner), ...actorHeaders } });
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
    const actor = await testActorIdentity(owner);
    const alertId = `alert-audit-${randomUUID()}`;
    await protectionAlertLedger.record({
      alertId,
      familyId: owner.familyId,
      deviceId: null,
      parentDeviceId: actor.deviceId,
      trigger: 'PROTECTION_DEGRADED',
      keyEpoch: 1,
      generatedAtUtc: new Date(),
      encryptedPayloadB64: 'b3BhcXVl',
      nonceB64: 'bm9uY2U',
    });

    const anonymous = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/protection-alerts` });
    assert.equal(anonymous.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: PROTECTION_ALERTS_ROUTE, scenarioId: 'mysql_protection_alerts_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: anonymous, evidenceTier: 'MYSQL_HTTP' });

    const read = await app.inject({ method: 'GET', url: `/api/parent/families/${owner.familyId}/protection-alerts`, headers: { ...sessionHeaders(owner), authorization: actor.authorization } });
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
