import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerChildPolicyRoutes } from '../../dist/http/routes/childPolicyRoutes.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';
import { parseFamilyEnvelope } from '../../dist/familyenvelope/parse.js';
import { envelopeFromRelayCiphertext, envelopeToRelayCiphertext } from '../../dist/runtime-sync/envelopeWireCodec.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

const FAMILY = 'family-schedule-http-1';
const OTHER_FAMILY = 'family-other-http-1';
const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', FAMILY],
  ['child-in-other-family', OTHER_FAMILY],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');
const VALID_ENVELOPE = {
  protocolMajor: 1,
  protocolMinor: 0,
  messageId: 'schedule-policy-message-1',
  familyId: FAMILY,
  senderDeviceId: 'dev-owner',
  recipientDeviceId: 'dev-child',
  senderKeyId: 'owner-key-1',
  messageType: 'POLICY_UPDATE',
  trustSetEpoch: 5,
  keyEpoch: 3,
  sequenceOrNonce: 'schedule-policy-sequence-1',
  issuedAt: T0.toISOString(),
  expiresAt: new Date(T0.getTime() + 5 * 60_000).toISOString(),
  semanticVersion: '1.0.0',
  payload: Buffer.from('opaque-encrypted-policy').toString('base64'),
  signature: 'opaque-signature',
};
const SCHEDULE_POLICY_ROUTE = '/api/parent/families/:familyId/children/:childProfileId/schedule-policy';

after(async () => {
  await writeParentRouteScenarioReport();
});

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

function buildApp({ authorization, submitBatchImpl, configured = true, parentRole = 'ADMINISTRATOR' } = {}) {
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
  const callCounts = { activeFamilyRole: 0, actorDevice: 0 };
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() {
      callCounts.activeFamilyRole += 1;
      return parentRole;
    },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      callCounts.actorDevice += 1;
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
  return { app, submittedBatches, callCounts };
}

const parentAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('an Owner can submit a canonical POLICY_UPDATE envelope: authorized, serialized, and PENDING -- never APPLIED', async () => {
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 202, response });
    const body = response.json();
    assert.equal(body.status, 'PENDING');
    assert.equal(body.messageId, VALID_ENVELOPE.messageId);
    assert.notEqual(body.status, 'APPLIED');
    assert.notEqual(body.status, 'DELIVERED');

    assert.equal(submittedBatches.length, 1);
    assert.equal(submittedBatches[0].senderDeviceId, 'dev-owner');
    assert.equal(submittedBatches[0].familyId, FAMILY);
    assert.equal(submittedBatches[0].items[0].recipientDeviceId, 'dev-child');
    assert.equal(submittedBatches[0].items[0].messageId, VALID_ENVELOPE.messageId);
    assert.equal(submittedBatches[0].items[0].messageType, 'POLICY_UPDATE');
    assert.equal(submittedBatches[0].items[0].enqueuedAtEpochMillis, Date.parse(VALID_ENVELOPE.issuedAt));
    const relayed = envelopeFromRelayCiphertext(submittedBatches[0].items[0].ciphertext);
    assert.ok(relayed);
    assert.equal(relayed.messageId, VALID_ENVELOPE.messageId);
    assert.equal(relayed.messageType, 'POLICY_UPDATE');
    assert.equal(relayed.familyId, FAMILY);
    assert.equal(relayed.senderDeviceId, 'dev-owner');
    assert.equal(relayed.recipient.kind, 'DEVICE');
    assert.equal(relayed.recipient.recipientDeviceId, 'dev-child');
    assert.deepEqual(submittedBatches[0].items[0].ciphertext, envelopeToRelayCiphertext(parseFamilyEnvelope(VALID_ENVELOPE)));
  } finally {
    await app.close();
  }
});

test('schedule-policy accepts protocol-boundary key epochs including zero', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    for (const keyEpoch of [0, MAX_FAMILY_EPOCH]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: { ...VALID_ENVELOPE, keyEpoch },
      });
      assert.equal(response.statusCode, 202, `keyEpoch=${keyEpoch}`);
    }
    assert.equal(submittedBatches.length, 2);
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
      payload: { ...VALID_ENVELOPE, senderDeviceId: 'dev-viewer' },
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_viewer_device_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('a Viewer Parent account is denied even when its browser device appears as OWNER in the legacy trust set', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({ authorization, parentRole: 'VIEWER' });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_viewer_account_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_cross_family_child_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('when the explicit UnavailableTrustSetRoleResolver is supplied, every submission fails closed honestly -- the real success-criterion proof for this route', async () => {
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_unavailable_trust_set', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 403, response });
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_foreign_recipient_rejected', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response });
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_requires_device_bearer', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_not_configured', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response });
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('an unconfigured schedule-policy route preserves Parent, family, CSRF, role, and device checks before 503', async () => {
  const scenarios = [
    { id: 'session_required', familyId: FAMILY, headers: {}, parentRole: 'ADMINISTRATOR', payload: VALID_ENVELOPE, status: 401, error: 'unauthorized', roleReads: 0, deviceReads: 0 },
    { id: 'cross_family_denied', familyId: OTHER_FAMILY, headers: parentAuthHeaders, parentRole: 'ADMINISTRATOR', payload: VALID_ENVELOPE, status: 403, error: 'family_scope_forbidden', roleReads: 0, deviceReads: 0 },
    { id: 'csrf_required', familyId: FAMILY, headers: { cookie: parentAuthHeaders.cookie }, parentRole: 'ADMINISTRATOR', payload: VALID_ENVELOPE, status: 403, error: 'csrf_mismatch', roleReads: 0, deviceReads: 0 },
    { id: 'non_admin_denied', familyId: FAMILY, headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' }, parentRole: 'VIEWER', payload: VALID_ENVELOPE, status: 403, error: 'forbidden', roleReads: 1, deviceReads: 0 },
    { id: 'actor_device_required', familyId: FAMILY, headers: parentAuthHeaders, parentRole: 'ADMINISTRATOR', payload: VALID_ENVELOPE, status: 401, error: 'actor_device_session_required', roleReads: 1, deviceReads: 0 },
    { id: 'valid_caller_invalid_body_unavailable', familyId: FAMILY, headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' }, parentRole: 'ADMINISTRATOR', payload: { ciphertextB64: 'must-not-be-validated' }, status: 503, error: 'not_configured', roleReads: 1, deviceReads: 1 },
  ];
  for (const scenario of scenarios) {
    const { app, submittedBatches, callCounts } = buildApp({ configured: false, parentRole: scenario.parentRole });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${scenario.familyId}/children/child-1/schedule-policy`,
        headers: scenario.headers,
        payload: scenario.payload,
      });
      assert.equal(response.statusCode, scenario.status, scenario.id);
      assert.deepEqual(response.json(), { error: scenario.error }, scenario.id);
      assert.equal(response.body.includes('must-not-be-validated'), false);
      assert.equal(callCounts.activeFamilyRole, scenario.roleReads, scenario.id);
      assert.equal(callCounts.actorDevice, scenario.deviceReads, scenario.id);
      assert.equal(submittedBatches.length, 0);
      recordParentRouteScenario({
        method: 'POST', route: SCHEDULE_POLICY_ROUTE,
        scenarioId: `schedule_policy_unconfigured_${scenario.id}`,
        classification: scenario.status === 503 ? 'SERVICE_NOT_CONFIGURED' : 'EXPECTED_DENIAL',
        expectedStatus: scenario.status,
        response,
      });
    } finally {
      await app.close();
    }
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
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_malformed_envelope', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response });
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects malformed envelopes before role, actor-device, authority, or relay work', async () => {
  let authorizationCalls = 0;
  const authorization = {
    async authorize() {
      authorizationCalls += 1;
      return { verdict: 'ALLOW' };
    },
  };
  const { app, submittedBatches, callCounts } = buildApp({ authorization });
  try {
    for (const keyEpoch of [MAX_FAMILY_EPOCH + 1, Number.MAX_SAFE_INTEGER + 1, 1.5, '3', -1]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: { ...VALID_ENVELOPE, keyEpoch },
      });
      assert.equal(response.statusCode, 400, `keyEpoch=${keyEpoch}`);
    }
    assert.equal(callCounts.activeFamilyRole, 0);
    assert.equal(callCounts.actorDevice, 0);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects noncanonical envelope payload encoding and payloads above protocol bounds before authorization', async () => {
  let authorizationCalls = 0;
  const authorization = {
    async authorize() {
      authorizationCalls += 1;
      return { verdict: 'ALLOW' };
    },
  };
  const { app, submittedBatches, callCounts } = buildApp({ authorization });
  try {
    const invalidBodies = [
      { ...VALID_ENVELOPE, payload: 'AB==' }, // noncanonical trailing bits
      { ...VALID_ENVELOPE, payload: Buffer.alloc(64 * 1024 + 1).toString('base64') },
      { ...VALID_ENVELOPE, expiresAt: VALID_ENVELOPE.issuedAt },
      { ...VALID_ENVELOPE, extraPlaintext: 'schedule contents must stay encrypted' },
      { ...VALID_ENVELOPE, recipientGroup: 'all-devices' },
      { ...VALID_ENVELOPE, messageType: 'SCHEDULE_POLICY_V1' },
    ];
    for (const payload of invalidBodies) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload,
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(callCounts.activeFamilyRole, 0);
    assert.equal(callCounts.actorDevice, 0);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects family or sender metadata not bound to the authenticated Parent device', async () => {
  let authorizationCalls = 0;
  const authorization = {
    async authorize() {
      authorizationCalls += 1;
      return { verdict: 'ALLOW' };
    },
  };
  const { app, submittedBatches, callCounts } = buildApp({ authorization });
  try {
    const wrongFamily = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { ...VALID_ENVELOPE, familyId: OTHER_FAMILY },
    });
    assert.equal(wrongFamily.statusCode, 400);

    const wrongSender = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { ...VALID_ENVELOPE, senderDeviceId: 'dev-viewer' },
    });
    assert.equal(wrongSender.statusCode, 400);
    assert.equal(callCounts.activeFamilyRole, 1); // family mismatch rejected before role; sender mismatch after actor binding
    assert.equal(callCounts.actorDevice, 1);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy only reports PENDING when the exact messageId is explicitly queued', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const cases = [
    { name: 'missing result', result: { results: [], droppedForBatchBound: [] } },
    { name: 'different result id', result: { results: [{ messageId: 'different-message', outcome: 'QUEUED' }], droppedForBatchBound: [] } },
    { name: 'batch-bound drop', result: { results: [], droppedForBatchBound: [VALID_ENVELOPE.messageId] } },
  ];
  for (const scenario of cases) {
    const { app, submittedBatches } = buildApp({ authorization, submitBatchImpl: () => scenario.result });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 503, scenario.name);
      assert.deepEqual(response.json(), { error: 'relay_unavailable' }, scenario.name);
      assert.equal(submittedBatches.length, 1);
    } finally {
      await app.close();
    }
  }
});
