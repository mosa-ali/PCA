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
  registerChildRequestRoutes(app, {
    parentAccountService,
    childRequestService,
    bonusGrantLedger,
    deviceSessionService,
    // SAME childProfileResolver instance the authorization service above uses -- see
    // childRequestRoutes.ts's own doc comment on why active-grants/revoke need this independently.
    childProfileMembership: childProfileResolver,
    now: nowFn,
  });
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

// PCA-FR-131 (CAPABILITY_HONEST_INSTALL_APPROVAL): the HTTP surface over INSTALL_APPROVAL --
// submission with the required target/capability fields, the honest applied-report route, and the
// same VIEWER/cross-family denial shape every other request type already has HTTP coverage for.

test('a device can submit an INSTALL_APPROVAL request, an Owner can approve it, and the device can then honestly report the applied outcome (distinct from the decision itself)', async () => {
  const { app } = buildApp();
  try {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: {
        requestType: 'INSTALL_APPROVAL',
        childProfileId: 'child-1',
        installTargetPackageName: 'com.example.newgame',
        installTargetAppLabel: 'New Game',
        installCapabilityState: 'ENFORCED',
      },
    });
    assert.equal(submit.statusCode, 201);
    const requestId = submit.json().request.requestId;
    assert.equal(submit.json().request.state, 'PENDING');
    assert.equal(submit.json().request.installCapabilityState, 'ENFORCED');
    assert.equal(submit.json().request.installEnforcementOutcome, null);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(decide.statusCode, 200);
    assert.equal(decide.json().request.state, 'APPROVED');
    // decide() never sets the enforcement outcome -- "approved" and "enforced" are different writes.
    assert.equal(decide.json().request.installEnforcementOutcome, null);

    const applied = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests/${requestId}/applied`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { capabilityOutcome: 'ENFORCED' },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json().request.state, 'APPLIED_ACKNOWLEDGED');
    assert.equal(applied.json().request.installEnforcementOutcome, 'ENFORCED');
  } finally {
    await app.close();
  }
});

test('submitting an INSTALL_APPROVAL request with a missing package name, or an unrecognized capability state, is rejected with 400', async () => {
  const { app } = buildApp();
  try {
    const missingPackage = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { requestType: 'INSTALL_APPROVAL', childProfileId: 'child-1', installCapabilityState: 'ENFORCED' },
    });
    assert.equal(missingPackage.statusCode, 400);

    const badCapability = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { requestType: 'INSTALL_APPROVAL', childProfileId: 'child-1', installTargetPackageName: 'com.example.app', installCapabilityState: 'DEFINITELY_BLOCKED' },
    });
    assert.equal(badCapability.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('the /applied route only accepts the report from the SAME child device that submitted the request, and honest capability-unavailable outcomes are recorded verbatim, not upgraded', async () => {
  const { app } = buildApp();
  try {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: {
        requestType: 'INSTALL_APPROVAL',
        childProfileId: 'child-1',
        installTargetPackageName: 'com.example.standardmodeapp',
        installCapabilityState: 'REQUEST_ONLY',
      },
    });
    const requestId = submit.json().request.requestId;
    await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });

    // The OWNER device (not the requesting child device) cannot acknowledge it.
    const wrongDevice = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests/${requestId}/applied`,
      headers: { authorization: 'Bearer dev-token-owner' },
      payload: { capabilityOutcome: 'ENFORCED' },
    });
    assert.equal(wrongDevice.statusCode, 403);

    const applied = await app.inject({
      method: 'POST',
      url: `/api/families/${FAMILY}/child-requests/${requestId}/applied`,
      headers: { authorization: 'Bearer dev-token-child' },
      payload: { capabilityOutcome: 'REQUEST_ONLY' },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json().request.installEnforcementOutcome, 'REQUEST_ONLY');
    assert.notEqual(applied.json().request.installEnforcementOutcome, 'ENFORCED');
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot decide an INSTALL_APPROVAL request (403), and a cross-family target is denied (403)', async () => {
  const { app, childRequestService } = buildApp();
  try {
    const draft = childRequestService.createDraft(
      FAMILY,
      'dev-child',
      'child-1',
      'INSTALL_APPROVAL',
      { kind: 'CHILD_PROFILE', id: 'child-1' },
      null,
      null,
      null,
      'com.example.app',
      null,
      'ENFORCED',
    );
    const pending = await childRequestService.submit(draft);
    const viewerDecide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${pending.requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(viewerDecide.statusCode, 403);

    const crossFamilyDraft = childRequestService.createDraft(
      FAMILY,
      'dev-child',
      'child-1',
      'INSTALL_APPROVAL',
      { kind: 'CHILD_PROFILE', id: 'child-in-other-family' },
      null,
      null,
      null,
      'com.example.app',
      null,
      'ENFORCED',
    );
    const crossPending = await childRequestService.submit(crossFamilyDraft);
    const crossDecide = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/child-requests/${crossPending.requestId}/decide`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { decision: 'APPROVED' },
    });
    assert.equal(crossDecide.statusCode, 403);
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

// PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION regression: active-grants (read) and
// grants/:grantId/revoke (write) touch bonusGrantLedger directly by a client-supplied
// childProfileId and, unlike decide()/grantDirectly(), never passed through
// ChildRequestService/ParentActionAuthorizationService's own CHILD_PROFILE membership check --
// a parent authenticated to their OWN family could read or revoke another family's active bonus
// grant just by supplying that family's childProfileId. Closed by wiring the same
// ChildProfileMembershipResolver these routes already had available into an explicit check.

test('a parent cannot read active bonus grants for a childProfileId belonging to a DIFFERENT family (403, not the other family\'s grant data)', async () => {
  const { app } = buildApp();
  try {
    const grant = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grant`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1', extraMinutes: 20 },
    });
    assert.equal(grant.statusCode, 201);

    // The caller is a legitimately-authenticated Owner of FAMILY, but asks for a childProfileId
    // (per CHILD_PROFILE_FAMILY_MAP) that belongs to 'some-other-family', not their own.
    const crossFamilyRead = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-in-other-family`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(crossFamilyRead.statusCode, 403);
    assert.equal(crossFamilyRead.json().error, 'family_scope_forbidden');

    // The caller's OWN child's grant is unaffected and still readable under its own id.
    const ownRead = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(ownRead.statusCode, 200);
    assert.equal(ownRead.json().grants.length, 1);
  } finally {
    await app.close();
  }
});

test('a parent cannot revoke a bonus grant for a childProfileId belonging to a DIFFERENT family (403), and the grant is unaffected', async () => {
  const { app } = buildApp();
  try {
    const grant = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grant`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1', extraMinutes: 20 },
    });
    const grantId = grant.json().request.requestId;

    // childProfileId claims membership in a different family than the caller's own session family --
    // must be denied even though grantId itself is a real, currently-active grant id.
    const crossFamilyRevoke = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grants/${grantId}/revoke`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-in-other-family' },
    });
    assert.equal(crossFamilyRevoke.statusCode, 403);
    assert.equal(crossFamilyRevoke.json().error, 'family_scope_forbidden');

    const stillActive = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(stillActive.json().grants.length, 1); // the cross-family attempt did not revoke it
  } finally {
    await app.close();
  }
});

test('with no ChildProfileMembershipResolver wired (the production default), active-grants/revoke fail closed (403) rather than silently trusting childProfileId', async () => {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: FAMILY,
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [{ deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' }],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  });
  const roleResolver = new FamilyTrustSetRoleResolver(store);
  // No childProfileMembership resolver supplied to the authorization service either, matching
  // production's own current fail-closed wiring (main.ts's `undefined` for that constructor arg).
  const authorization = new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    () => T0,
  );
  const childRequestService = new ChildRequestService(new InMemoryChildRequestRepository(), authorization, () => T0);
  const bonusGrantLedger = new BonusGrantLedger();
  // Seed a grant directly into the ledger (bypassing the also-fail-closed decide()/grantDirectly()
  // path) so this test isolates active-grants/revoke's OWN membership check from the rest of the
  // fail-closed chain.
  bonusGrantLedger.record('child-1', { id: 'seed-grant', appScope: 'ALL', extraMinutes: 20, grantedAtUtc: T0, expiresAtUtc: new Date(T0.getTime() + 20 * 60_000) }, T0);

  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
  const parentAccountService = { async readSession(token) {
    const session = sessions.get(token);
    if (!session) throw new Error('unauthorized');
    return session;
  } };
  const deviceSessionService = { async requireActorDeviceInFamily(token, expectedFamilyId) {
    if (token !== 'dev-token-owner' || expectedFamilyId !== FAMILY) {
      const err = new Error('unauthorized');
      err.name = 'RuntimeSyncAuthError';
      throw err;
    }
    return { deviceId: 'dev-owner', familyId: FAMILY };
  } };

  const app = Fastify();
  registerChildRequestRoutes(app, {
    parentAccountService,
    childRequestService,
    bonusGrantLedger,
    deviceSessionService,
    // childProfileMembership deliberately omitted -- exercises registerChildRequestRoutes' own
    // UnavailableChildProfileMembershipResolver default.
    now: () => T0,
  });
  try {
    const read = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/bonus-time/active-grants?childProfileId=child-1`,
      headers: { cookie: parentAuthHeaders.cookie },
    });
    assert.equal(read.statusCode, 403);
    assert.equal(read.json().error, 'family_scope_forbidden');

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/bonus-time/grants/seed-grant/revoke`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { childProfileId: 'child-1' },
    });
    assert.equal(revoke.statusCode, 403);
    assert.equal(revoke.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});
