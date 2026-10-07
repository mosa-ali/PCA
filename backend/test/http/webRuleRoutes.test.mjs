import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerWebRuleRoutes } from '../../dist/http/routes/webRuleRoutes.js';
import { InMemoryWebRuleRepository, WebRuleService } from '../../dist/web/WebRuleStore.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

const WEB_RULES_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/web-rules';
const WEB_RULES_REMOVE_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/web-rules/remove';

after(async () => {
  await writeParentRouteScenarioReport();
});

const FAMILY = 'family-web-rule-http-1';
const OTHER_FAMILY = 'family-web-rule-other-1';
const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', FAMILY],
  ['child-in-other-family', OTHER_FAMILY],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');

function buildAuthorization({ nowFn = () => T0, roleResolver } = {}) {
  const childProfileResolver = new StaticChildProfileMembershipResolver(CHILD_PROFILE_FAMILY_MAP);
  return new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    nowFn,
    childProfileResolver,
  );
}

function trustedRoleResolver() {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: FAMILY,
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  });
  return new FamilyTrustSetRoleResolver(store);
}

function buildApp({ webRuleService, authorization, configured = true, sideEffectCalls = [], logs = [], parentRole = 'ADMINISTRATOR' } = {}) {
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
  const parentAccountService = {
    async readSession(token) {
      sideEffectCalls.push('parent-account-session-read');
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() { return parentRole; },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      sideEffectCalls.push('device-session-read');
      const identity = deviceTokens.get(token);
      if (!identity || identity.familyId !== expectedFamilyId) {
        const err = new Error('unauthorized');
        err.name = 'RuntimeSyncAuthError';
        throw err;
      }
      return identity;
    },
  };

  const app = Fastify({ logger: { stream: { write(chunk) { logs.push(String(chunk)); } } } });
  registerWebRuleRoutes(app, {
    parentAccountService,
    deviceSessionService,
    webRuleService: configured ? webRuleService : undefined,
    parentActionAuthorization: authorization,
    now: () => T0,
  });
  return { app };
}

const parentAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('GET returns an empty rule list for a family with no rules yet', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    assert.deepEqual(response.json().rules, []);
  } finally {
    await app.close();
  }
});

test('GET rejects cross-family and unknown child profiles indistinguishably without reading rules', async () => {
  const listCalls = [];
  const webRuleService = {
    async listParentRules(familyId) {
      listCalls.push(familyId);
      return [];
    },
  };
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/api/parent/families/${FAMILY}/children/child-in-other-family/web-rules`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      }),
      app.inject({
        method: 'GET',
        url: `/api/parent/families/${FAMILY}/children/child-unknown/web-rules`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      }),
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { error: 'forbidden' });
    }
    recordParentRouteScenario({ method: 'GET', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_read_cross_family_child_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: responses[0] });
    recordParentRouteScenario({ method: 'GET', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_read_unknown_child_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: responses[1] });
    assert.deepEqual(listCalls, []);
  } finally {
    await app.close();
  }
});

test('GET remains fail-closed with 503 when the readable rule service is not configured', async () => {
  const sideEffectCalls = [];
  const authorizationCalls = [];
  const authorization = { async authorize(input) { authorizationCalls.push(input); return { verdict: 'ALLOW' }; } };
  const { app } = buildApp({ configured: false, sideEffectCalls, authorization });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 503);
    recordParentRouteScenario({ method: 'GET', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_read_not_configured', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response });
    assert.deepEqual(response.json(), { error: 'not_configured' });
    assert.deepEqual(sideEffectCalls, ['parent-account-session-read', 'device-session-read']);
    assert.deepEqual(authorizationCalls, []);
  } finally {
    await app.close();
  }
});

test('unconfigured Web Rules routes preserve Parent, family, role, CSRF, and device-session checks', async () => {
  const sentinel = 'unconfigured-route-boundary-never-echo.invalid';
  const authorizationCalls = [];
  const authorization = { async authorize(input) { authorizationCalls.push(input); return { verdict: 'ALLOW' }; } };
  const scenarios = [
    {
      id: 'session_required', familyId: FAMILY, headers: { authorization: 'Bearer dev-token-owner' },
      parentRole: 'ADMINISTRATOR', status: 401, body: { error: 'unauthorized' }, calls: [],
    },
    {
      id: 'cross_family_denied', familyId: OTHER_FAMILY,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      parentRole: 'ADMINISTRATOR', status: 403, body: { error: 'family_scope_forbidden' }, calls: ['parent-account-session-read'],
    },
    {
      id: 'non_admin_denied', familyId: FAMILY,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      parentRole: 'VIEWER', status: 403, body: { error: 'forbidden' }, calls: ['parent-account-session-read'],
    },
    {
      id: 'actor_device_session_required', familyId: FAMILY,
      headers: parentAuthHeaders,
      parentRole: 'ADMINISTRATOR', status: 401, body: { error: 'actor_device_session_required' }, calls: ['parent-account-session-read'],
    },
  ];
  const methods = [
    { method: 'GET', route: WEB_RULES_ROUTE, suffix: '', payload: undefined },
    { method: 'POST', route: WEB_RULES_ROUTE, suffix: '', payload: { domain: sentinel, listType: 'DENY' } },
    { method: 'POST', route: WEB_RULES_REMOVE_ROUTE, suffix: '/remove', payload: { domain: sentinel, listType: 'DENY' } },
  ];

  for (const endpoint of methods) {
    for (const scenario of scenarios) {
      const sideEffectCalls = [];
      const logs = [];
      const { app } = buildApp({ configured: false, parentRole: scenario.parentRole, sideEffectCalls, logs, authorization });
      try {
        const response = await app.inject({
          method: endpoint.method,
          url: `/api/parent/families/${scenario.familyId}/children/child-1/web-rules${endpoint.suffix}`,
          headers: scenario.headers,
          ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload }),
        });
        assert.equal(response.statusCode, scenario.status, `${endpoint.method} ${scenario.id}`);
        assert.deepEqual(response.json(), scenario.body, `${endpoint.method} ${scenario.id}`);
        assert.equal(response.body.includes(sentinel), false);
        assert.deepEqual(sideEffectCalls, scenario.calls, `${endpoint.method} ${scenario.id} must stop at the failed boundary`);
        assert.deepEqual(authorizationCalls, [], `${endpoint.method} ${scenario.id} must not run edit authorization`);
        assert.equal(logs.some((entry) => entry.includes(sentinel)), false);
        recordParentRouteScenario({
          method: endpoint.method,
          route: endpoint.route,
          scenarioId: `web_rules_${scenario.id}_${endpoint.method.toLowerCase()}${endpoint.suffix ? '_remove' : ''}`,
          classification: 'EXPECTED_DENIAL',
          expectedStatus: scenario.status,
          response,
        });
      } finally {
        await app.close();
      }
    }
  }

  for (const endpoint of methods.slice(1)) {
    const sideEffectCalls = [];
    const { app } = buildApp({ configured: false, sideEffectCalls, authorization });
    try {
      const response = await app.inject({
        method: endpoint.method,
        url: `/api/parent/families/${FAMILY}/children/child-1/web-rules${endpoint.suffix}`,
        headers: { cookie: parentAuthHeaders.cookie, authorization: 'Bearer dev-token-owner' },
        payload: { domain: sentinel, listType: 'DENY' },
      });
      assert.equal(response.statusCode, 403, `${endpoint.method}${endpoint.suffix} must check CSRF before service availability`);
      assert.deepEqual(response.json(), { error: 'csrf_mismatch' });
      assert.deepEqual(sideEffectCalls, ['parent-account-session-read']);
      assert.deepEqual(authorizationCalls, []);
      assert.equal(response.body.includes(sentinel), false);
      recordParentRouteScenario({
        method: endpoint.method,
        route: endpoint.route,
        scenarioId: `web_rules_csrf_required_${endpoint.method.toLowerCase()}${endpoint.suffix ? '_remove' : ''}`,
        classification: 'EXPECTED_DENIAL',
        expectedStatus: 403,
        response,
      });
    } finally {
      await app.close();
    }
  }

  for (const endpoint of methods.slice(1)) {
    const sideEffectCalls = [];
    const logs = [];
    const { app } = buildApp({ configured: false, sideEffectCalls, logs, authorization });
    try {
      const response = await app.inject({
        method: endpoint.method,
        url: `/api/parent/families/${FAMILY}/children/child-1/web-rules${endpoint.suffix}`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: { domain: sentinel, listType: 'INVALID' },
      });
      assert.equal(response.statusCode, 503, `${endpoint.method}${endpoint.suffix} must not validate a rule payload before service availability`);
      assert.deepEqual(response.json(), { error: 'not_configured' });
      assert.deepEqual(sideEffectCalls, ['parent-account-session-read', 'device-session-read']);
      assert.deepEqual(authorizationCalls, []);
      assert.equal(response.body.includes(sentinel), false);
      assert.equal(logs.some((entry) => entry.includes(sentinel)), false);
    } finally {
      await app.close();
    }
  }
});

test('an Owner can add a denylist rule: authorized, canonicalized, and durably written', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'Example.COM', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.rules, [{ domain: 'example.com', listType: 'DENY', createdAtUtc: T0.toISOString() }]);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_add_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });

    const stored = await repo.listByFamily(FAMILY);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].domain, 'example.com');
    assert.equal(stored[0].source, 'PARENT_DENYLIST');
  } finally {
    await app.close();
  }
});

test('an Owner can remove a previously added rule', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules/remove`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_REMOVE_ROUTE, scenarioId: 'web_rules_remove_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    assert.deepEqual(response.json().rules, []);
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('an invalid domain is rejected with 400 and never stored', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: '192.168.1.1', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 400);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_add_invalid_domain', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response });
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot add a rule: DENY from the real OPERATION_MATRIX, no write', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_add_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('a Viewer Parent account is denied even when its browser device appears as OWNER in the legacy trust set', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization, parentRole: 'VIEWER' });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('cross-family target denial: a childProfileId belonging to another family is rejected, never distinguished from unknown', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-in-other-family/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_add_cross_family_child_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
  } finally {
    await app.close();
  }
});

test('while UnavailableTrustSetRoleResolver is wired (production default), every mutation fails closed honestly', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: new UnavailableTrustSetRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('missing CSRF header is rejected before any authorization or write', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { cookie: parentAuthHeaders.cookie, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(await repo.listByFamily(FAMILY), []);
  } finally {
    await app.close();
  }
});

test('missing actor-device-session bearer token is rejected with 401, never treated as an implicit family role', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: parentAuthHeaders,
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('the mutation route fails closed with 503 when not configured, rather than a silent allow', async () => {
  const authorizationCalls = [];
  const authorization = { async authorize(input) { authorizationCalls.push(input); return { verdict: 'ALLOW' }; } };
  const sideEffectCalls = [];
  const logs = [];
  const unapprovedService = {
    async setParentRule() { sideEffectCalls.push('persistence'); },
    async removeParentRule() { sideEffectCalls.push('persistence'); },
    async listParentRules() { sideEffectCalls.push('persistence'); return []; },
  };
  const { app } = buildApp({ webRuleService: unapprovedService, authorization, configured: false, sideEffectCalls, logs });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 503);
    recordParentRouteScenario({ method: 'POST', route: WEB_RULES_ROUTE, scenarioId: 'web_rules_add_not_configured', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response });
    assert.deepEqual(sideEffectCalls, ['parent-account-session-read', 'device-session-read']);
    assert.deepEqual(authorizationCalls, []);
  } finally {
    await app.close();
  }
});

test('the remove route fails closed without echoing or logging the submitted domain', async () => {
  const authorizationCalls = [];
  const authorization = { async authorize(input) { authorizationCalls.push(input); return { verdict: 'ALLOW' }; } };
  const sideEffectCalls = [];
  const logs = [];
  const unapprovedService = {
    async setParentRule() { sideEffectCalls.push('set'); },
    async removeParentRule() { sideEffectCalls.push('remove'); },
    async listParentRules() { sideEffectCalls.push('list'); return []; },
  };
  const { app } = buildApp({ webRuleService: unapprovedService, authorization, configured: false, sideEffectCalls, logs });
  const sentinel = 'remove-not-configured-never-persisted.invalid';
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules/remove`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: sentinel, listType: 'DENY' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes(sentinel), false);
    assert.deepEqual(response.json(), { error: 'not_configured' });
    assert.deepEqual(sideEffectCalls, ['parent-account-session-read', 'device-session-read'], 'only Parent and actor-device authentication may run before the unavailable-service response');
    assert.deepEqual(authorizationCalls, []);
    assert.equal(logs.some((entry) => entry.includes(sentinel)), false, 'Fastify logs must not contain the parent-authored domain');
    recordParentRouteScenario({
      method: 'POST',
      route: WEB_RULES_REMOVE_ROUTE,
      scenarioId: 'web_rules_remove_not_configured',
      classification: 'SERVICE_NOT_CONFIGURED',
      expectedStatus: 503,
      response,
    });
  } finally {
    await app.close();
  }
});

test('production fail-closed boundary does not persist, log, audit, or echo a synthetic domain', async () => {
  const authorizationCalls = [];
  const authorization = { async authorize(input) { authorizationCalls.push(input); return { verdict: 'ALLOW' }; } };
  const sideEffectCalls = [];
  const logs = [];
  const unapprovedService = {
    async setParentRule() { sideEffectCalls.push('persistence'); },
    async removeParentRule() { sideEffectCalls.push('persistence'); },
    async listParentRules() { sideEffectCalls.push('persistence'); return []; },
  };
  const { app } = buildApp({ webRuleService: unapprovedService, authorization, configured: false, sideEffectCalls, logs });
  const sentinel = 'a012-synthetic-never-persisted.invalid';
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: sentinel, listType: 'DENY' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes(sentinel), false);
    assert.deepEqual(response.json(), { error: 'not_configured' });
    assert.deepEqual(sideEffectCalls, ['parent-account-session-read', 'device-session-read'], 'the fail-closed boundary performs authentication checks but no persistence, action authorization, audit, or telemetry');
    assert.deepEqual(authorizationCalls, []);
    assert.equal(logs.some((entry) => entry.includes(sentinel)), false, 'Fastify logs must not contain the parent-authored domain');
  } finally {
    await app.close();
  }
});

test('a malformed body (invalid listType) is rejected with 400 before authorization runs', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'BLOCK' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('an unauthenticated request (no session cookie) is rejected with 401', async () => {
  const repo = new InMemoryWebRuleRepository();
  const webRuleService = new WebRuleService(repo, () => T0);
  const { app } = buildApp({ webRuleService });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('a security-feed rule never leaks through the parent-facing GET route', async () => {
  const repo = new InMemoryWebRuleRepository();
  await repo.put({ domain: 'malware.example', listType: 'DENY', source: 'SECURITY_DENYLIST', familyId: FAMILY, createdAt: T0 });
  const webRuleService = new WebRuleService(repo, () => T0);
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService, authorization });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().rules, []);
  } finally {
    await app.close();
  }
});
