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
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'owner-key-1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
      { deviceId: 'dev-child', role: 'CHILD', dskKeyId: 'k7', dskPublicKey: 'pk7', dekKeyId: 'k8', dekPublicKey: 'pk8', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  });
  return new FamilyTrustSetRoleResolver(store);
}

function buildApp({ authorization, submitBatchImpl, configured = true, parentRole = 'ADMINISTRATOR', trustSetRoleResolver = trustedRoleResolver(), deviceChildBindingRepository, deviceSessionFailure = false, nowFn = () => T0 } = {}) {
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
      return typeof parentRole === 'function' ? parentRole(callCounts.activeFamilyRole) : parentRole;
    },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY, dskKeyId: 'owner-key-1' }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: FAMILY, dskKeyId: 'k5' }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      callCounts.actorDevice += 1;
      if (deviceSessionFailure) throw new Error('synthetic device-session store failure');
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
  const delegatedBatches = [];
  const bindingCalls = [];
  const effectiveDeviceChildBindingRepository = deviceChildBindingRepository === undefined
    ? {
      async resolveBinding(familyId, deviceId) {
        bindingCalls.push([familyId, deviceId]);
        return familyId === FAMILY && deviceId === 'dev-child'
          ? { outcome: 'BOUND', childProfileId: 'child-1' }
          : { outcome: 'UNBOUND' };
      },
    }
    : deviceChildBindingRepository;
  const outboundRelayService = {
    async submitBatch(senderDeviceId, familyId, items, authorizeRecipient) {
      const submitted = { senderDeviceId, familyId, items, authoritySnapshots: [] };
      submittedBatches.push(submitted);
      const results = [];
      const eligible = [];
      for (const item of items) {
        const authority = authorizeRecipient ? await authorizeRecipient(item.recipientDeviceId) : true;
        submitted.authoritySnapshots.push(authority);
        if (!authority) {
          results.push({ messageId: item.messageId, outcome: 'INVALID' });
        } else {
          eligible.push(item);
        }
      }
      if (eligible.length === 0) return { results, droppedForBatchBound: [] };
      delegatedBatches.push({ senderDeviceId, familyId, items: eligible });
      const delegated = submitBatchImpl
        ? await submitBatchImpl(senderDeviceId, familyId, eligible)
        : { results: eligible.map((item) => ({ messageId: item.messageId, outcome: 'QUEUED' })), droppedForBatchBound: [] };
      const outcomes = new Map(results.map((item) => [item.messageId, item]));
      for (const item of delegated.results) outcomes.set(item.messageId, item);
      return {
        results: items.flatMap((item) => {
          const outcome = outcomes.get(item.messageId);
          return outcome ? [outcome] : [];
        }),
        droppedForBatchBound: delegated.droppedForBatchBound,
      };
    },
  };

  const app = Fastify();
  registerChildPolicyRoutes(app, {
    parentAccountService,
    deviceSessionService,
    parentActionAuthorization: configured ? authorization : undefined,
    trustSetRoleResolver,
    deviceChildBindingRepository: effectiveDeviceChildBindingRepository,
    outboundRelayService,
    now: nowFn,
  });
  return { app, submittedBatches, delegatedBatches, bindingCalls, callCounts };
}

test('stale device-session DSK is rejected before authorization or relay submission', async () => {
  const resolverCalls = [];
  const trustSetRoleResolver = {
    async resolveActor(...args) {
      resolverCalls.push(args);
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches } = buildApp({ authorization, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(resolverCalls, [[FAMILY, 'dev-owner', 'owner-key-1']]);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('current accepted DSK is resolved with the exact authenticated family/device/key tuple', async () => {
  const resolverCalls = [];
  const accepted = trustedRoleResolver();
  const trustSetRoleResolver = {
    resolveActor(...args) {
      resolverCalls.push(args);
      return accepted.resolveActor(...args);
    },
  };
  const authorization = buildAuthorization({ roleResolver: trustSetRoleResolver });
  const { app, bindingCalls } = buildApp({ authorization, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 202);
    assert.deepEqual(resolverCalls, [
      [FAMILY, 'dev-owner', 'owner-key-1'],
      [FAMILY, 'dev-owner', 'owner-key-1'],
      [FAMILY, 'dev-child'],
      [FAMILY, 'dev-child'],
      [FAMILY, 'dev-owner', 'owner-key-1'],
    ]);
    assert.deepEqual(bindingCalls, [[FAMILY, 'dev-child'], [FAMILY, 'dev-child']]);
  } finally {
    await app.close();
  }
});

test('missing accepted Trust Set resolver fails closed before authorization or relay submission', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches } = buildApp({ authorization, trustSetRoleResolver: null });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('malformed accepted Trust Set projection fails closed before authorization or relay submission', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const trustSetRoleResolver = {
    async resolveActor() {
      return { familyId: FAMILY, deviceId: 'dev-owner', dskKeyId: 'owner-key-1', role: 'OWNER', trustSetEpoch: 0, keyEpoch: 1 };
    },
  };
  const { app, submittedBatches } = buildApp({ authorization, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects a sender projection from another family before Parent authorization or relay submission', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      const accepted = trustedRoleResolver().resolveActor(familyId, deviceId, dskKeyId);
      return deviceId === 'dev-owner' && typeof accepted === 'object'
        ? { ...accepted, familyId: OTHER_FAMILY }
        : accepted;
    },
  };
  const { app, submittedBatches } = buildApp({ authorization, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects a recipient projection from another family before relay submission', async () => {
  const accepted = trustedRoleResolver();
  const trustSetRoleResolver = {
    resolveActor(familyId, deviceId, dskKeyId) {
      const projection = accepted.resolveActor(familyId, deviceId, dskKeyId);
      return deviceId === 'dev-child' && typeof projection === 'object'
        ? { ...projection, familyId: OTHER_FAMILY }
        : projection;
    },
  };
  const authorization = buildAuthorization({ roleResolver: trustSetRoleResolver });
  const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, trustSetRoleResolver });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(submittedBatches.length, 0);
    assert.equal(delegatedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects a family-mismatched accepted projection at the relay eligibility boundary', async () => {
  for (const changedActor of ['sender', 'recipient']) {
    const accepted = trustedRoleResolver();
    let senderReads = 0;
    let recipientReads = 0;
    const trustSetRoleResolver = {
      resolveActor(familyId, deviceId, dskKeyId) {
        const projection = accepted.resolveActor(familyId, deviceId, dskKeyId);
        if (typeof projection !== 'object') return projection;
        if (changedActor === 'recipient' && deviceId === 'dev-child') {
          recipientReads += 1;
          if (recipientReads === 2) return { ...projection, familyId: OTHER_FAMILY };
        }
        if (changedActor === 'sender' && deviceId === 'dev-owner' && dskKeyId !== undefined) {
          senderReads += 1;
          if (senderReads === 3) return { ...projection, familyId: OTHER_FAMILY };
        }
        return projection;
      },
    };
    const authorization = buildAuthorization({ roleResolver: trustSetRoleResolver });
    const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, trustSetRoleResolver });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 503, changedActor);
      assert.deepEqual(response.json(), { error: 'authority_unavailable' }, changedActor);
      assert.equal(submittedBatches.length, 1, `${changedActor} check runs in the bounded enqueue callback`);
      assert.equal(delegatedBatches.length, 0, `${changedActor} mismatch must not reach relay storage`);
    } finally {
      await app.close();
    }
  }
});

test('policy envelope sender key must match the authenticated device-session DSK', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { ...VALID_ENVELOPE, senderKeyId: 'old-owner-key' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('device-session storage failure returns retryable 503 and does not authorize or relay', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches } = buildApp({ authorization, deviceSessionFailure: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'actor_device_session_unavailable' });
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('Parent authorization dependency failure returns 503 without queueing or exposing exception text', async () => {
  const privateError = 'synthetic action-ledger database outage';
  const authorization = { async authorize() { throw new Error(privateError); } };
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'authority_unavailable' });
    assert.equal(response.body.includes(privateError), false);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('relay storage failure returns 503 rather than claiming PENDING', async () => {
  const privateError = 'synthetic relay database outage';
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({
    authorization,
    submitBatchImpl: async () => { throw new Error(privateError); },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'relay_unavailable' });
    assert.equal(response.body.includes(privateError), false);
    assert.equal(submittedBatches.length, 1);
  } finally {
    await app.close();
  }
});

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
    assert.equal(response.headers['cache-control'], 'private, no-store');
    recordParentRouteScenario({ method: 'POST', route: SCHEDULE_POLICY_ROUTE, scenarioId: 'schedule_policy_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 202, response });
    const body = response.json();
    assert.equal(body.status, 'PENDING');
    assert.equal(body.messageId, VALID_ENVELOPE.messageId);
    assert.notEqual(body.status, 'APPLIED');
    assert.notEqual(body.status, 'DELIVERED');

    assert.equal(submittedBatches.length, 1);
    assert.equal(submittedBatches[0].senderDeviceId, 'dev-owner');
    assert.equal(submittedBatches[0].familyId, FAMILY);
    assert.deepEqual(submittedBatches[0].authoritySnapshots, [{
      familyId: FAMILY,
      trustSetEpoch: 5,
      keyEpoch: 3,
      sender: { deviceId: 'dev-owner', dskKeyId: 'owner-key-1' },
      recipient: { deviceId: 'dev-child', dskKeyId: 'k7' },
    }], 'the route must pass exact accepted sender and recipient DSK authority to the relay transaction');
    assert.equal(submittedBatches[0].items[0].recipientDeviceId, 'dev-child');
    assert.equal(submittedBatches[0].items[0].messageId, VALID_ENVELOPE.messageId);
    assert.equal(submittedBatches[0].items[0].messageType, 'POLICY_UPDATE');
    assert.equal(submittedBatches[0].items[0].enqueuedAtEpochMillis, Date.parse(VALID_ENVELOPE.issuedAt));
    assert.equal(submittedBatches[0].items[0].validUntil.getTime(), Date.parse(VALID_ENVELOPE.expiresAt));
    assert.equal(submittedBatches[0].items[0].ttlMs, undefined);
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

test('expired policy envelope is rejected after authorization and never queued', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches } = buildApp({
    authorization,
    nowFn: () => new Date(T0.getTime() + 6 * 60_000),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'expired' });
    assert.equal(authorizationCalls, 1);
    assert.equal(submittedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('relay reports envelope expiry during async recipient resolution as a truthful 400 without a PENDING receipt', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches } = buildApp({
    authorization,
    submitBatchImpl: async () => ({ results: [{ messageId: VALID_ENVELOPE.messageId, outcome: 'EXPIRED' }], droppedForBatchBound: [] }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'expired' });
    assert.equal(response.json().status, undefined);
    assert.equal(submittedBatches.length, 1);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects stale or unaccepted future envelope epochs before authorization or relay', async () => {
  let authorizationCalls = 0;
  const authorization = {
    async authorize() {
      authorizationCalls += 1;
      return { verdict: 'ALLOW' };
    },
  };
  const { app, submittedBatches } = buildApp({ authorization });
  try {
    const mismatchedEpochs = [
      { name: 'stale trust-set epoch', trustSetEpoch: 4, keyEpoch: 3 },
      { name: 'future trust-set epoch', trustSetEpoch: 6, keyEpoch: 3 },
      { name: 'stale key epoch', trustSetEpoch: 5, keyEpoch: 2 },
      { name: 'future key epoch', trustSetEpoch: 5, keyEpoch: 4 },
      { name: 'bootstrap key epoch zero', trustSetEpoch: 5, keyEpoch: 0 },
      { name: 'maximum key epoch', trustSetEpoch: 5, keyEpoch: MAX_FAMILY_EPOCH },
    ];
    for (const epochs of mismatchedEpochs) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: { ...VALID_ENVELOPE, trustSetEpoch: epochs.trustSetEpoch, keyEpoch: epochs.keyEpoch },
      });
      assert.equal(response.statusCode, 409, epochs.name);
      assert.deepEqual(response.json(), { error: 'authority_changed' }, epochs.name);
    }
    assert.equal(authorizationCalls, 0);
    assert.equal(submittedBatches.length, 0);
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
      payload: { ...VALID_ENVELOPE, senderDeviceId: 'dev-viewer', senderKeyId: 'k5' },
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

test('a recipient absent from the accepted Trust Set is rejected before relay submission', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches, delegatedBatches } = buildApp({
    authorization,
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
    assert.equal(submittedBatches.length, 0, 'recipient preflight rejects an unaccepted target before submitBatch');
    assert.equal(delegatedBatches.length, 0, 'unaccepted recipient ciphertext must not reach relay storage');
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects an accepted same-family VIEWER recipient after Parent authorization and before relay', async () => {
  let authorizationCalls = 0;
  const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
  const { app, submittedBatches, delegatedBatches } = buildApp({ authorization });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { ...VALID_ENVELOPE, recipientDeviceId: 'dev-viewer' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_recipient' });
    assert.equal(authorizationCalls, 1);
    assert.equal(submittedBatches.length, 0);
    assert.equal(delegatedBatches.length, 0);
  } finally {
    await app.close();
  }
});

test('schedule-policy rejects a CHILD device whose durable enrollment binding is unbound, ambiguous, inactive, or for another profile', async () => {
  const bindingOutcomes = [
    { outcome: 'UNBOUND' },
    { outcome: 'AMBIGUOUS' },
    { outcome: 'DEVICE_INACTIVE' },
    { outcome: 'BOUND', childProfileId: 'child-in-another-family' },
  ];
  for (const binding of bindingOutcomes) {
    let authorizationCalls = 0;
    const authorization = { async authorize() { authorizationCalls += 1; return { verdict: 'ALLOW' }; } };
    const bindingCalls = [];
    const deviceChildBindingRepository = {
      async resolveBinding(...args) {
        bindingCalls.push(args);
        return binding;
      },
    };
    const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, deviceChildBindingRepository });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 400, JSON.stringify(binding));
      assert.deepEqual(response.json(), { error: 'invalid_recipient' });
      assert.deepEqual(bindingCalls, [[FAMILY, 'dev-child']]);
      assert.equal(authorizationCalls, 1);
      assert.equal(submittedBatches.length, 0);
      assert.equal(delegatedBatches.length, 0);
    } finally {
      await app.close();
    }
  }
});

test('schedule-policy fails closed when the durable child binding repository is absent or unavailable', async () => {
  for (const deviceChildBindingRepository of [
    null,
    { async resolveBinding() { throw new Error('binding store unavailable'); } },
  ]) {
    const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
    const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, deviceChildBindingRepository });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { error: 'authority_unavailable' });
      assert.equal(submittedBatches.length, 0);
      assert.equal(delegatedBatches.length, 0);
    } finally {
      await app.close();
    }
  }
});

test('schedule-policy rechecks CHILD membership at enqueue and fails closed if the accepted head changed', async () => {
  for (const changedHead of [
    { trustSetEpoch: 6, keyEpoch: 3 },
    { trustSetEpoch: 5, keyEpoch: 4 },
  ]) {
    const childCalls = new Map();
    const accepted = trustedRoleResolver();
    const trustSetRoleResolver = {
      async resolveActor(familyId, deviceId, dskKeyId) {
        if (deviceId !== 'dev-child') return accepted.resolveActor(familyId, deviceId, dskKeyId);
        const count = (childCalls.get(deviceId) ?? 0) + 1;
        childCalls.set(deviceId, count);
        if (count === 1) return accepted.resolveActor(familyId, deviceId, dskKeyId);
        return { familyId, deviceId, role: 'CHILD', dskKeyId: 'k7', ...changedHead };
      },
    };
    const authorization = buildAuthorization({ roleResolver: trustSetRoleResolver });
    const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, trustSetRoleResolver });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 400);
      assert.notEqual(response.statusCode, 202);
      assert.deepEqual(response.json(), { error: 'invalid_recipient' });
      assert.equal(childCalls.get('dev-child'), 2, 'recipient authority is checked before authorization and again at enqueue');
      assert.equal(submittedBatches.length, 1);
      assert.equal(delegatedBatches.length, 0, 'a stale recipient head/key must not reach relay storage');
    } finally {
      await app.close();
    }
  }
});

test('schedule-policy rechecks the durable child-profile binding at enqueue before relay storage', async () => {
  for (const changedBinding of [
    { outcome: 'UNBOUND' },
    { outcome: 'BOUND', childProfileId: 'another-child-profile' },
  ]) {
    const bindingCalls = [];
    const deviceChildBindingRepository = {
      async resolveBinding(familyId, deviceId) {
        bindingCalls.push([familyId, deviceId]);
        return bindingCalls.length === 1
          ? { outcome: 'BOUND', childProfileId: 'child-1' }
          : changedBinding;
      },
    };
    const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
    const { app, submittedBatches, delegatedBatches } = buildApp({ authorization, deviceChildBindingRepository });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
        headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
        payload: VALID_ENVELOPE,
      });
      assert.equal(response.statusCode, 400, JSON.stringify(changedBinding));
      assert.deepEqual(response.json(), { error: 'invalid_recipient' });
      assert.deepEqual(bindingCalls, [[FAMILY, 'dev-child'], [FAMILY, 'dev-child']]);
      assert.equal(submittedBatches.length, 1, 'the final eligibility callback runs inside the attempted relay submission');
      assert.equal(delegatedBatches.length, 0, 'a changed or removed profile binding must not reach relay storage');
    } finally {
      await app.close();
    }
  }
});

test('schedule-policy rechecks the sender Trust Set authority at enqueue after Parent authorization', async () => {
  let senderDemoted = false;
  const trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (familyId !== FAMILY) return 'FAMILY_MISMATCH';
      if (deviceId === 'dev-owner') {
        if (dskKeyId !== undefined && dskKeyId !== 'owner-key-1') return 'DEVICE_NOT_ACTIVE';
        return senderDemoted
          ? { familyId, deviceId, role: 'VIEWER', dskKeyId: 'owner-key-1', trustSetEpoch: 6, keyEpoch: 3 }
          : { familyId, deviceId, role: 'OWNER', dskKeyId: 'owner-key-1', trustSetEpoch: 5, keyEpoch: 3 };
      }
      if (deviceId === 'dev-child') return { familyId, deviceId, role: 'CHILD', dskKeyId: 'k7', trustSetEpoch: 5, keyEpoch: 3 };
      return 'DEVICE_NOT_IN_TRUST_SET';
    },
  };
  let bindingReads = 0;
  const deviceChildBindingRepository = {
    async resolveBinding(familyId, deviceId) {
      bindingReads += 1;
      // The second lookup is the final enqueue-boundary binding check. Rotate
      // the sender after recipient/profile checks but before the sender's final
      // authorization check in that same callback.
      if (bindingReads === 2) senderDemoted = true;
      return familyId === FAMILY && deviceId === 'dev-child'
        ? { outcome: 'BOUND', childProfileId: 'child-1' }
        : { outcome: 'UNBOUND' };
    },
  };
  const authorization = buildAuthorization({ roleResolver: trustSetRoleResolver });
  const { app, submittedBatches, delegatedBatches } = buildApp({
    authorization,
    trustSetRoleResolver,
    deviceChildBindingRepository,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'authority_changed' });
    assert.equal(bindingReads, 2, 'sender rotation happens during the final profile-binding lookup');
    assert.equal(submittedBatches.length, 1, 'the final sender check runs inside the relay submission boundary');
    assert.equal(delegatedBatches.length, 0, 'a demoted sender cannot persist an envelope authorized under its previous epoch');
  } finally {
    await app.close();
  }
});

test('schedule-policy rechecks Parent account membership at enqueue after recipient and binding reads', async () => {
  let parentRole = 'ADMINISTRATOR';
  let bindingReads = 0;
  const deviceChildBindingRepository = {
    async resolveBinding(familyId, deviceId) {
      bindingReads += 1;
      if (bindingReads === 2) parentRole = 'VIEWER';
      return familyId === FAMILY && deviceId === 'dev-child'
        ? { outcome: 'BOUND', childProfileId: 'child-1' }
        : { outcome: 'UNBOUND' };
    },
  };
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches, delegatedBatches, callCounts } = buildApp({
    authorization,
    parentRole: () => parentRole,
    deviceChildBindingRepository,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(bindingReads, 2, 'the Parent membership changes during the final recipient-binding read');
    assert.equal(callCounts.activeFamilyRole, 2, 'the account role is resolved again at the final enqueue boundary');
    assert.equal(submittedBatches.length, 1, 'the final Parent check runs inside recipient eligibility');
    assert.equal(delegatedBatches.length, 0, 'revoked/demoted Parent authority cannot persist a policy envelope');
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

test('schedule-policy maps a final relay authority race to 409 without claiming PENDING', async () => {
  const authorization = buildAuthorization({ roleResolver: trustedRoleResolver() });
  const { app, submittedBatches, delegatedBatches } = buildApp({
    authorization,
    submitBatchImpl: () => ({
      results: [{ messageId: VALID_ENVELOPE.messageId, outcome: 'AUTHORITY_CHANGED' }],
      droppedForBatchBound: [],
    }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/schedule-policy`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: VALID_ENVELOPE,
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'authority_changed' });
    assert.equal(submittedBatches.length, 1);
    assert.equal(delegatedBatches.length, 1);
  } finally {
    await app.close();
  }
});
