// TODO-14 Wave 4: integrate the Parent-session child-request and bonus-time
// routes against real Parent accounts/sessions, family roles, and the opaque
// MySQL child-profile membership registry. Child-request and BonusGrantLedger
// remain the documented process-local stores; this suite does not introduce
// plaintext database persistence for their family-policy content.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { BonusGrantLedger } from '../../dist/childrequests/BonusGrantLedger.js';
import { InMemoryChildRequestRepository } from '../../dist/childrequests/ChildRequestRepository.js';
import { ChildRequestService } from '../../dist/childrequests/ChildRequestService.js';
import { createParentSessionChildRequestAuthorizer } from '../../dist/childrequests/ParentSessionChildRequestAuthorizer.js';
import { MySqlChildProfileRegistryRepository } from '../../dist/childprofiles/MySqlChildProfileRegistryRepository.js';
import { RegistryBackedChildProfileMembershipResolver } from '../../dist/childprofiles/RegistryBackedChildProfileMembershipResolver.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlFamilyMembershipRepository } from '../../dist/familymembers/MySqlFamilyMembershipRepository.js';
import { registerChildRequestRoutes } from '../../dist/http/routes/childRequestRoutes.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { csrfCookieName, sessionCookieName } from '../../dist/parentaccount/cookies.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createParentAccountTestKit } from '../support/parentMfaTestKit.mjs';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const FAMILY = '/api/parent/families';
const authService = new AuthService(new MySqlAuthRepository());
const parentAccountRepository = new MySqlParentAccountRepository();
const childProfileRegistryRepository = new MySqlChildProfileRegistryRepository();
let nowMs = Date.now() - 1000;
const now = () => new Date(nowMs);
const parentAccountService = createParentAccountTestKit({
  repository: parentAccountRepository,
  authService,
  emailSender: {
    async sendVerificationCode() {},
    async sendLoginStepUpCode() {},
    async sendPasswordResetCode() {},
    async sendMfaRecoveryCode() {},
    async sendSecurityNotice() {},
  },
  familyMembershipRepository: new MySqlFamilyMembershipRepository(),
  mfaRepository: new MySqlParentMfaRepository(),
  now,
}).service;

async function createFamilyWithSession(role = 'ADMINISTRATOR') {
  const familyId = randomUUID();
  const accountId = randomUUID();
  const issued = await authService.issueSession({ accountReferenceHash: randomBytes(32) });
  const serviceAccountId = issued.session.accountId;
  const startedAt = now();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  await getPool().query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'route-audit-placeholder-credential', 'VERIFIED', ?, ?, 'PERPETUAL', NOW(3), NOW(3))`,
    [accountId, randomBytes(32), familyId, serviceAccountId],
  );
  await getPool().query(
    `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', NOW(3), NOW(3))`,
    [randomUUID(), familyId, accountId, serviceAccountId, role],
  );
  const graceExpiresAt = new Date(startedAt.getTime() + PARENT_MFA_GRACE_MS);
  await getPool().query(
    `INSERT INTO parent_mfa_state (account_id, status, grace_started_at, grace_expires_at, created_at, updated_at)
     VALUES (?, 'NOT_ENROLLED', ?, ?, ?, ?)`,
    [accountId, startedAt, graceExpiresAt, startedAt, startedAt],
  );
  return { familyId, accountId, sessionToken: issued.rawToken, csrfToken: randomBytes(12).toString('hex') };
}

function headersFor(session, csrf = false) {
  const cookie = `${sessionCookieName()}=${session.sessionToken}${csrf ? `; ${csrfCookieName()}=${session.csrfToken}` : ''}`;
  return csrf ? { cookie, 'x-pca-csrf-token': session.csrfToken } : { cookie };
}

const admin = await createFamilyWithSession();
const viewer = await createFamilyWithSession('VIEWER');
const { row: child } = await childProfileRegistryRepository.create(admin.familyId, null, now());
const { row: foreignChild } = await childProfileRegistryRepository.create(viewer.familyId, null, now());
const membershipResolver = new RegistryBackedChildProfileMembershipResolver({ registry: childProfileRegistryRepository });
const sessionAuthorizer = createParentSessionChildRequestAuthorizer({
  parentAccountService,
  childProfileMembershipResolver: membershipResolver,
});
const childRequestService = new ChildRequestService(
  new InMemoryChildRequestRepository(),
  { async authorize() { return { verdict: 'DENY', reason: 'NOT_CONFIGURED' }; } },
  now,
  sessionAuthorizer,
);
const bonusGrantLedger = new BonusGrantLedger();
const app = Fastify({ logger: false });
registerChildRequestRoutes(app, {
  parentAccountService,
  childRequestService,
  bonusGrantLedger,
  deviceSessionService: { async requireActorDeviceInFamily() { throw new Error('device route not used in this campaign'); } },
  childProfileMembership: membershipResolver,
  now: () => {
    nowMs += 1000;
    return new Date(nowMs);
  },
});

after(async () => {
  await app.close();
  await closePool();
  await writeParentRouteScenarioReport();
});

test('MYSQL HTTP Parent child-request and bonus-time routes use real session/role rows and registry membership', async () => {
  const pending = await childRequestService.submit(childRequestService.createDraft(
    admin.familyId,
    randomUUID(),
    null,
    'BONUS_TIME',
    { kind: 'CHILD_PROFILE', id: child.childProfileId },
    'integrated route audit fixture',
    15,
    'ALL',
  ));

  const listRoute = `${FAMILY}/${admin.familyId}/child-requests`;
  const list = await app.inject({ method: 'GET', url: listRoute, headers: headersFor(admin) });
  assert.equal(list.statusCode, 200, JSON.stringify(list.json()));
  assert.equal(list.json().requests.some((request) => request.requestId === pending.requestId), true);
  recordParentRouteScenario({ method: 'GET', route: `${FAMILY}/:familyId/child-requests`, scenarioId: 'mysql_parent_child_request_list_member_admin', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: list, evidenceTier: 'MYSQL_HTTP' });

  const decideRoute = `${FAMILY}/${admin.familyId}/child-requests/${pending.requestId}/decide`;
  const decided = await app.inject({ method: 'POST', url: decideRoute, headers: headersFor(admin, true), payload: { decision: 'APPROVED' } });
  assert.equal(decided.statusCode, 200, JSON.stringify(decided.json()));
  assert.equal(decided.json().request.decidedByAccountId, admin.accountId);
  recordParentRouteScenario({ method: 'POST', route: `${FAMILY}/:familyId/child-requests/:requestId/decide`, scenarioId: 'mysql_parent_child_request_decide_registry_member', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: decided, evidenceTier: 'MYSQL_HTTP' });

  const grantRoute = `${FAMILY}/${admin.familyId}/bonus-time/grant`;
  const grant = await app.inject({
    method: 'POST',
    url: grantRoute,
    headers: headersFor(admin, true),
    payload: { childProfileId: child.childProfileId, extraMinutes: 25, appScope: 'ALL' },
  });
  assert.equal(grant.statusCode, 201, JSON.stringify(grant.json()));
  recordParentRouteScenario({ method: 'POST', route: `${FAMILY}/:familyId/bonus-time/grant`, scenarioId: 'mysql_parent_bonus_direct_grant_registry_member', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: grant, evidenceTier: 'MYSQL_HTTP' });

  const activeRoute = `${FAMILY}/${admin.familyId}/bonus-time/active-grants?childProfileId=${child.childProfileId}`;
  const active = await app.inject({ method: 'GET', url: activeRoute, headers: headersFor(admin) });
  assert.equal(active.statusCode, 200, JSON.stringify(active.json()));
  assert.equal(active.json().grants.length, 1);
  const grantId = active.json().grants[0].id;
  recordParentRouteScenario({ method: 'GET', route: `${FAMILY}/:familyId/bonus-time/active-grants`, scenarioId: 'mysql_parent_bonus_active_grants_registry_member', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: active, evidenceTier: 'MYSQL_HTTP' });

  const revokeRoute = `${FAMILY}/${admin.familyId}/bonus-time/grants/${grantId}/revoke`;
  const revoked = await app.inject({
    method: 'POST',
    url: revokeRoute,
    headers: headersFor(admin, true),
    payload: { childProfileId: child.childProfileId },
  });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.json()));
  assert.deepEqual(bonusGrantLedger.listActive(child.childProfileId, new Date(nowMs + 5000)), []);
  recordParentRouteScenario({ method: 'POST', route: `${FAMILY}/:familyId/bonus-time/grants/:grantId/revoke`, scenarioId: 'mysql_parent_bonus_revoke_registry_member', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: revoked, evidenceTier: 'MYSQL_HTTP' });

  const foreignGrant = await app.inject({
    method: 'POST',
    url: grantRoute,
    headers: headersFor(admin, true),
    payload: { childProfileId: foreignChild.childProfileId, extraMinutes: 10, appScope: 'ALL' },
  });
  assert.equal(foreignGrant.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: `${FAMILY}/:familyId/bonus-time/grant`, scenarioId: 'mysql_parent_bonus_direct_grant_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: foreignGrant, evidenceTier: 'MYSQL_HTTP' });

  const viewerGrant = await app.inject({
    method: 'POST',
    url: `${FAMILY}/${viewer.familyId}/bonus-time/grant`,
    headers: headersFor(viewer, true),
    payload: { childProfileId: foreignChild.childProfileId, extraMinutes: 10, appScope: 'ALL' },
  });
  assert.equal(viewerGrant.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: `${FAMILY}/:familyId/bonus-time/grant`, scenarioId: 'mysql_parent_bonus_direct_grant_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerGrant, evidenceTier: 'MYSQL_HTTP' });
});
