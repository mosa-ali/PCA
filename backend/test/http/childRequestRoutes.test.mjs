import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerChildRequestRoutes } from '../../dist/http/routes/childRequestRoutes.js';
import { InMemoryChildRequestRepository } from '../../dist/childrequests/ChildRequestRepository.js';
import { ChildRequestService } from '../../dist/childrequests/ChildRequestService.js';
import { BonusGrantLedger } from '../../dist/childrequests/BonusGrantLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';

const FAMILY = 'family-bonus-http-1';
const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', FAMILY],
  ['child-in-other-family', 'some-other-family'],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');

function buildApp({ nowFn = () => T0 } = {}) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: FAMILY,
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
      { deviceId: 'dev-child', role: 'CHILD', dskKeyId: 'k3', dskPublicKey: 'pk3', dekKeyId: 'k4', dekPublicKey: 'pk4', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  });
  const roleResolver = new FamilyTrustSetRoleResolver(store);
  const childProfileResolver = new StaticChildProfileMembershipResolver(CHILD_PROFILE_FAMILY_MAP);
  const authorization = new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    nowFn,
    childProfileResolver,
  );
  const childRequestService = new ChildRequestService(new InMemoryChildRequestRepository(), authorization, nowFn);
  const bonusGrantLedger = new BonusGrantLedger();

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
    ['dev-token-child', { deviceId: 'dev-child', familyId: FAMILY }],
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
  registerChildRequestRoutes(app, { parentAccountService, childRequestService, bonusGrantLedger, deviceSessionService, now: nowFn });
  return { app, childRequestService, bonusGrantLedger };
}

const parentAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('a child device can submit a BONUS_TIME request, and the Owner can list + approve it', async () => {
  const { app } = buildApp();
  try {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { requestType: 'BONUS_TIME', childProfileId: 'child-1', requestedExtraMinutes: 30, requestedAppScope: 'ALL' },
    });
    assert.equal(submit.statusCode, 201);
    const requestId = submit.json().request.requestId;
    assert.equal(submit.json().request.state, 'PENDING');

    const list = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/child-requests`, headers: { cookie: parentAuthHeaders.cookie } });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().requests.length, 1);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(decide.statusCode, 200);
    assert.equal(decide.json().request.state, 'APPROVED');
    assert.equal(decide.json().request.grantedExtraMinutes, 30);

    const active = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(active.statusCode, 200);
    assert.equal(active.json().grants.length, 1);
    assert.equal(active.json().grants[0].extraMinutes, 30);
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot decide a request (403), even with a valid family session and CSRF token', async () => {
  const { app, childRequestService } = buildApp();
  try {
    const draft = childRequestService.createDraft(FAMILY, 'dev-child', 'child-1', 'BONUS_TIME', { kind: 'CHILD_PROFILE', id: 'child-1' }, null, 30, 'ALL');
    const pending = await childRequestService.submit(draft);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${pending.requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(decide.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('a decide POST without the CSRF header is rejected (403), and without a device-session bearer token is rejected (401)', async () => {
  const { app, childRequestService } = buildApp();
  try {
    const draft = childRequestService.createDraft(FAMILY, 'dev-child', 'child-1', 'BONUS_TIME', { kind: 'CHILD_PROFILE', id: 'child-1' }, null, 30, 'ALL');
    const pending = await childRequestService.submit(draft);

    const noCsrf = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${pending.requestId}/decide`,
      headers: { cookie: parentAuthHeaders.cookie, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(noCsrf.statusCode, 403);

    const noBearer = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${pending.requestId}/decide`,
      headers: parentAuthHeaders,
      payload: { decision: 'APPROVED' },
    });
    assert.equal(noBearer.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('requesting more than the bound is rejected with 400 at the HTTP layer (child submit) and again for a direct grant', async () => {
  const { app } = buildApp();
  try {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { requestType: 'BONUS_TIME', childProfileId: 'child-1', requestedExtraMinutes: 999, requestedAppScope: 'ALL' },
    });
    assert.equal(submit.statusCode, 400);

    const grant = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grant`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1', extraMinutes: 999 },
    });
    assert.equal(grant.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('a parent can directly grant bonus time (no pending child request) and then revoke it before it expires', async () => {
  const { app } = buildApp();
  try {
    const grant = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grant`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1', extraMinutes: 20, reasonNote: 'Finished chores early' },
    });
    assert.equal(grant.statusCode, 201);
    const grantId = grant.json().request.requestId;

    const beforeRevoke = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(beforeRevoke.json().grants.length, 1);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grants/${grantId}/revoke`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1' },
    });
    assert.equal(revoke.statusCode, 200);

    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(afterRevoke.json().grants.length, 0);
  } finally {
    await app.close();
  }
});

test('a request targeting a CHILD_PROFILE from a different family is denied at decide (cross-family, 403)', async () => {
  const { app, childRequestService } = buildApp();
  try {
    const draft = childRequestService.createDraft(
      FAMILY,
      'dev-child',
      'child-1',
      'BONUS_TIME',
      { kind: 'CHILD_PROFILE', id: 'child-in-other-family' },
      null,
      30,
      'ALL',
    );
    const pending = await childRequestService.submit(draft);
    const decide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${pending.requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(decide.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('a repeated decide POST (same actor, same outcome) is idempotent -- same 200 result, not a duplicate grant', async () => {
  const { app, bonusGrantLedger } = buildApp();
  try {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { requestType: 'BONUS_TIME', childProfileId: 'child-1', requestedExtraMinutes: 30, requestedAppScope: 'ALL' },
    });
    const requestId = submit.json().request.requestId;

    const first = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.json().request.grantedExtraMinutes, second.json().request.grantedExtraMinutes);
    assert.equal(bonusGrantLedger.listActive('child-1', T0).length, 1); // not double-recorded
  } finally {
    await app.close();
  }
});
