import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerEyeProtectionRoutes } from '../../dist/http/routes/eyeProtectionRoutes.js';
import { EyeProtectionSettingsService } from '../../dist/eyeprotection/EyeProtectionSettingsService.js';
import { InMemoryEyeProtectionSettingsRepository } from '../../dist/eyeprotection/EyeProtectionSettingsRepository.js';
import { csrfCookieName, sessionCookieName } from '../../dist/parentaccount/cookies.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

const FAMILY = 'family-eye-protection-http-1';
const OTHER_FAMILY = 'family-eye-protection-other-1';
const parentAuthHeaders = { cookie: `${sessionCookieName()}=session-admin; ${csrfCookieName()}=csrf-a`, 'x-pca-csrf-token': 'csrf-a' };

after(async () => {
  await writeParentRouteScenarioReport();
});

function buildApp({ configured = true, membershipConfigured = true } = {}) {
  const repository = new InMemoryEyeProtectionSettingsRepository();
  const service = new EyeProtectionSettingsService(repository);
  const childProfileRegistryRepository = {
    async resolveMembership(familyId, childProfileId) {
      return familyId === FAMILY && childProfileId === 'child-1' ? 'MEMBER' : 'NOT_MEMBER_OR_NOT_FOUND';
    },
  };
  const metrics = { settingsReadCount: 0, settingsWriteCount: 0 };
  const instrumentedService = {
    async get(...args) {
      metrics.settingsReadCount += 1;
      return service.get(...args);
    },
    async updateReminders(...args) {
      metrics.settingsWriteCount += 1;
      return service.updateReminders(...args);
    },
  };
  const sessions = new Map([
    ['session-admin', { accountId: 'acct-admin', familyId: FAMILY }],
    ['session-viewer', { accountId: 'acct-viewer', familyId: FAMILY }],
    ['session-other', { accountId: 'acct-admin', familyId: OTHER_FAMILY }],
  ]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole(accountId, familyId) {
      if (familyId !== FAMILY) return null;
      return accountId === 'acct-admin' ? 'ADMINISTRATOR' : accountId === 'acct-viewer' ? 'VIEWER' : null;
    },
  };
  const app = Fastify();
  registerEyeProtectionRoutes(app, {
    parentAccountService,
    eyeProtectionSettingsService: configured ? instrumentedService : undefined,
    childProfileRegistryRepository: membershipConfigured ? childProfileRegistryRepository : undefined,
  });
  return { app, repository, metrics };
}

test('GET allows an active family Viewer and returns a safe default', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-viewer` } });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_viewer_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    assert.equal(response.json().eyeProtection.remindersEnabled, false);
  } finally { await app.close(); }
});

test('GET denies both foreign and missing child profiles identically before reading settings', async () => {
  const { app, metrics } = buildApp();
  try {
    const foreign = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/children/child-other/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-viewer` } });
    const missing = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/children/child-missing/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-viewer` } });
    assert.equal(foreign.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_foreign_child_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: foreign });
    assert.deepEqual(foreign.json(), missing.json());
    assert.equal(foreign.json().error, 'family_scope_forbidden');
    assert.equal(metrics.settingsReadCount, 0);
  } finally { await app.close(); }
});

test('missing durable membership authority fails closed before settings access', async () => {
  const { app, metrics } = buildApp({ membershipConfigured: false });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-viewer` } });
    assert.equal(response.statusCode, 503);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_membership_authority_unavailable', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response });
    assert.equal(response.json().error, 'membership_authority_unavailable');
    assert.equal(metrics.settingsReadCount, 0);
  } finally { await app.close(); }
});

test('active Administrator can update without a device bearer token', async () => {
  const { app, repository, metrics } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`, headers: parentAuthHeaders, payload: { remindersEnabled: true } });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_administrator_update_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    assert.equal((await repository.get(FAMILY, 'child-1')).remindersEnabled, true);
    assert.equal(metrics.settingsWriteCount, 1);
  } finally { await app.close(); }
});

test('POST denies foreign and missing child profiles identically before writing', async () => {
  const { app, repository, metrics } = buildApp();
  try {
    const foreign = await app.inject({ method: 'POST', url: `/api/parent/families/${FAMILY}/children/child-other/eye-protection`, headers: parentAuthHeaders, payload: { remindersEnabled: true } });
    const missing = await app.inject({ method: 'POST', url: `/api/parent/families/${FAMILY}/children/child-missing/eye-protection`, headers: parentAuthHeaders, payload: { remindersEnabled: true } });
    assert.equal(foreign.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_foreign_child_update_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: foreign });
    assert.deepEqual(foreign.json(), missing.json());
    assert.equal(foreign.json().error, 'family_scope_forbidden');
    assert.equal((await repository.get(FAMILY, 'child-other')).remindersEnabled, false);
    assert.equal((await repository.get(FAMILY, 'child-missing')).remindersEnabled, false);
    assert.equal(metrics.settingsWriteCount, 0);
  } finally { await app.close(); }
});

test('Viewer is denied an update and does not write', async () => {
  const { app, repository } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-viewer; ${csrfCookieName()}=csrf-a`, 'x-pca-csrf-token': 'csrf-a' }, payload: { remindersEnabled: true } });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_viewer_update_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal((await repository.get(FAMILY, 'child-1')).remindersEnabled, false);
  } finally { await app.close(); }
});

test('family mismatch is denied and no cross-family setting is written', async () => {
  const { app, repository } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/api/parent/families/${OTHER_FAMILY}/children/child-1/eye-protection`, headers: parentAuthHeaders, payload: { remindersEnabled: true } });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_cross_family_update_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal((await repository.get(OTHER_FAMILY, 'child-1')).remindersEnabled, false);
  } finally { await app.close(); }
});

test('missing CSRF header is rejected', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`, headers: { cookie: `${sessionCookieName()}=session-admin; ${csrfCookieName()}=csrf-a` }, payload: { remindersEnabled: true } });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: '/api/parent/families/:familyId/children/:childProfileId/eye-protection', scenarioId: 'eye_protection_csrf_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(response.json().error, 'csrf_mismatch');
  } finally { await app.close(); }
});
