import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerChildPolicyRoutes } from '../../dist/http/routes/childPolicyRoutes.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';

const FAMILY = 'family-schedule-http-1';
const OTHER_FAMILY = 'family-other-http-1';
const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', FAMILY],
  ['child-in-other-family', OTHER_FAMILY],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');
const VALID_ENVELOPE = { recipientDeviceId: 'dev-child', ciphertextB64: 'YWJjZGVmZ2g', nonceB64: 'MDEyMzQ1Njc4OTAxMjM0NQ', keyEpoch: 3 };

function buildAuthorization({ nowFn = () => T0, roleResolver } = {}) {
  const childProfileResolver = new StaticChildProfileMembershipResolver(CHILD_PROFILE_FAMILY_MAP);
  const authorization = new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    nowFn,
    childProfileResolver,
  );
  return authorization;
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

function buildApp({ authorization, submitBatchImpl, configured = true } = {}) {
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
  const submittedBatches = [];
  const outboundRelayService = {
    async submitBatch(senderDeviceId, familyId, items) {
      submittedBatches.push({ senderDeviceId, familyId, items });
      if (submitBatchImpl) return submitBatchImpl(senderDeviceId, familyId, items);
      return { results: items.map((item) => ({ messageId: item.messageId, outcome: 'QUEUED' })), droppedForBatchBound: [] };
    },
  };

  const app = Fastify();
  registerChildPolicyRoutes(app, {
    parentAccountService,
    deviceSessionService,
    parentActionAuthorization: configured ? authorization : undefined,
    outboundRelayService,
    now: () => T0,
  });
  return { app, submittedBatches };
}

const parentAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('an Owner can submit a schedule-policy envelope: authorized, relayed, and PENDING -- never APPLIED', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.equal(body.status, 'PENDING');
    assert.equal(typeof body.messageId, 'string');
    assert.notEqual(body.status, 'APPLIED');
    assert.notEqual(body.status, 'DELIVERED');

    assert.equal(submittedBatches.length, 1);
    assert.equal(submittedBatches[0].senderDeviceId, 'dev-owner');
    assert.equal(submittedBatches[0].familyId, FAMILY);
    assert.equal(submittedBatches[0].items[0].recipientDeviceId, 'dev-child');
    assert.equal(submittedBatches[0].items[0].messageType, 'SCHEDULE_POLICY_V1');
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot edit child policy: DENY from the real OPERATION_MATRIX, no relay submission', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('cross-family target denial: a childProfileId belonging to another family is rejected, never distinguished from unknown', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-in-other-family/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('while UnavailableTrustSetRoleResolver is wired (production default), every submission fails closed honestly -- the real success-criterion proof for this route', async () => {
  const authorization = buildAuthorization({ roleResolver: new UnavailableTrustSetRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('a foreign/spoofed recipientDeviceId is rejected by the relay even after authorization allows the childProfileId target', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({
    authorization,
    submitBatchImpl: (senderDeviceId, familyId, items) => ({
      results: items.map((item) => ({ messageId: item.messageId, outcome: 'CROSS_FAMILY_RECIPIENT' })),
      droppedForBatchBound: [],
    }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { ...VALID_ENVELOPE, recipientDeviceId: 'dev-not-in-this-family' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(submittedBatches.length, 1); // the relay WAS called (and correctly rejected it) -- authorization alone is not the whole defense
  } finally {
    await app.close();
  }
});

test('missing CSRF header is rejected before any authorization or relay call', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { cookie: parentAuthHeaders.cookie, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('missing actor-device-session bearer token is rejected with 401, never treated as an implicit family role', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: parentAuthHeaders,
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 401);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('the route fails closed with 503 when not configured, rather than a silent allow', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization, configured: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('a malformed envelope body (missing keyEpoch) is rejected with 400 before authorization runs', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const { keyEpoch: _drop, ...malformed } = VALID_ENVELOPE;
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: malformed,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});
