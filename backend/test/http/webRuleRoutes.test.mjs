import assert from 'node:assert/strict';
import test from 'node:test';
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

function buildApp({ webRuleService, authorization, configured = true } = {}) {
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      const identity = deviceTokens.get(token);
      if (!identity || identity.familyId !== expectedFamilyId) {
        const err = new Error('unauthorized');
        err.name = 'RuntimeSyncAuthError';
        throw err;
      }
      return identity;
    },
  };

  const app = Fastify();
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
  const { app } = buildApp({ webRuleService });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: parentAuthHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().rules, []);
  } finally {
    await app.close();
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
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ webRuleService: undefined, authorization, configured: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { domain: 'example.com', listType: 'DENY' },
    });
    assert.equal(response.statusCode, 503);
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
  const { app } = buildApp({ webRuleService });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/web-rules`,
      headers: parentAuthHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().rules, []);
  } finally {
    await app.close();
  }
});
