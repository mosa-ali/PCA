import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { FamilyRbacPolicyConfigStore } from '../../dist/familyrbac/FamilyRbacPolicyConfigStore.js';
import {
  StaticChildProfileMembershipResolver,
  UnavailableChildProfileMembershipResolver,
} from '../../dist/childprofiles/ChildProfileMembershipResolver.js';

const T0 = new Date('2026-01-01T00:00:00Z');

function epoch(overrides = {}) {
  return {
    familyId: 'fam-1',
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-admin', role: 'ADMINISTRATOR', dskKeyId: 'k3', dskPublicKey: 'pk3', dekKeyId: 'k4', dekPublicKey: 'pk4', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
      { deviceId: 'dev-child', role: 'CHILD', dskKeyId: 'k7', dskPublicKey: 'pk7', dekKeyId: 'k8', dekPublicKey: 'pk8', status: 'ACTIVE' },
      { deviceId: 'dev-revoked-owner-old', role: 'ADMINISTRATOR', dskKeyId: 'k9', dskPublicKey: 'pk9', dekKeyId: 'k10', dekPublicKey: 'pk10', status: 'REVOKED' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
    ...overrides,
  };
}

function makeService(nowFn = () => T0, childProfileResolver = undefined, configProvider = defaultFamilyRbacPolicyConfig) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = childProfileResolver === undefined
    ? new ParentActionAuthorizationService(resolver, configProvider, ledger, nowFn)
    : new ParentActionAuthorizationService(resolver, configProvider, ledger, nowFn, childProfileResolver);
  return { store, service, ledger };
}

function baseRequest(overrides = {}) {
  return {
    familyId: 'fam-1',
    actorDeviceId: 'dev-owner',
    operation: 'VIEW_DASHBOARD',
    targetScope: { kind: 'FAMILY', id: 'fam-1' },
    issuedAt: T0,
    expiresAt: new Date(T0.getTime() + 15 * 60 * 1000),
    stepUp: null,
    idempotencyKey: 'idem-1',
    actionId: 'act-1',
    ...overrides,
  };
}

test('Owner allowed: an ordinary Owner action authorizes', async () => {
  const { service } = makeService();
  const decision = await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY' }));
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('Administrator may manage normal family members with fresh step-up', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-admin', operation: 'ADD_VIEWER', idempotencyKey: 'idem-2', actionId: 'act-2' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_REQUIRED_BUT_ABSENT' });
});

test('Admin allowed only configured operations: EDIT_CHILD_POLICY is unconditionally allowed for Administrator', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-admin', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-3', actionId: 'act-3' }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('Viewer read-only: VIEW_DASHBOARD resolves ALLOW_READ_ONLY, EDIT_CHILD_POLICY denies', async () => {
  const { service } = makeService();
  const view = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'VIEW_DASHBOARD', idempotencyKey: 'idem-4', actionId: 'act-4' }),
  );
  assert.deepEqual(view, { verdict: 'ALLOW_READ_ONLY' });
  const edit = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-5', actionId: 'act-5' }),
  );
  assert.equal(edit.verdict, 'DENY');
});

test('Child cannot parent-control: EDIT_CHILD_POLICY resolves REQUEST_ONLY, never ALLOW', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-child', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-6', actionId: 'act-6' }),
  );
  assert.deepEqual(decision, { verdict: 'REQUEST_ONLY' });
});

test('direct deep-link bypass fails: a Viewer submitting a sensitive owner-only operation is denied regardless of how it was reached', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'EXPORT_FAMILY_DATA', idempotencyKey: 'idem-7', actionId: 'act-7' }),
  );
  assert.equal(decision.verdict, 'DENY');
});

test('stale cached UI role fails: authorization is re-derived from the CURRENT trust set, not any role the caller supplies', async () => {
  // The request object has no role field at all -- there is no way for a caller to assert one. Demonstrate that
  // a device whose trust-set role changed (was OWNER, epoch rotated to demote to VIEWER) is authorized by the NEW role.
  const { store, service } = makeService();
  store.setCurrentEpoch(
    epoch({
      trustSetEpoch: 6,
      entries: [
        { deviceId: 'dev-owner', role: 'VIEWER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
        { deviceId: 'dev-new-owner', role: 'OWNER', dskKeyId: 'k11', dskPublicKey: 'pk11', dekKeyId: 'k12', dekPublicKey: 'pk12', status: 'ACTIVE' },
      ],
    }),
  );
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-owner', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-8', actionId: 'act-8' }),
  );
  assert.equal(decision.verdict, 'DENY'); // demoted to VIEWER in the new epoch, EDIT_CHILD_POLICY is now DENY for Viewer
});

test('forged role label fails: there is no request field capable of asserting a role at all', async () => {
  const { service } = makeService();
  const forged = baseRequest({ actorDeviceId: 'dev-child', operation: 'CHANGE_ROLE', idempotencyKey: 'idem-9', actionId: 'act-9' });
  assert.equal('role' in forged, false); // the request shape itself cannot carry a role claim
  const decision = await service.authorize(forged);
  assert.equal(decision.verdict, 'DENY'); // resolved role is CHILD regardless of what operation was requested
});

test('stale trustSet epoch fails: a device absent from the CURRENT epoch (rotated out) cannot be resolved', async () => {
  const { store, service } = makeService();
  store.setCurrentEpoch(epoch({ trustSetEpoch: 7, entries: epoch().entries.filter((e) => e.deviceId !== 'dev-owner') }));
  const decision = await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-10', actionId: 'act-10' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
});

test('expired action fails', async () => {
  const { service } = makeService(() => new Date('2026-01-01T01:00:00Z'));
  const decision = await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-11', actionId: 'act-11' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTION_EXPIRED' });
});

test('replayed action succeeds idempotently with the SAME recorded outcome, not a fresh re-evaluation', async () => {
  const { store, service } = makeService();
  const request = baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-12', actionId: 'act-12' });
  const first = await service.authorize(request);
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // Trust set changes AFTER the first authorization (owner demoted) -- a naive re-evaluation would now DENY.
  store.setCurrentEpoch(
    epoch({
      trustSetEpoch: 6,
      entries: [{ deviceId: 'dev-owner', role: 'VIEWER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' }],
    }),
  );
  const replay = await service.authorize(request); // same idempotencyKey + actionId
  assert.deepEqual(replay, first); // idempotent: returns the ORIGINAL recorded outcome
});

test('a different actionId reusing the same idempotencyKey is NOT treated as the same recorded action', async () => {
  const { service } = makeService();
  const first = await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-13', actionId: 'act-13' }));
  assert.deepEqual(first, { verdict: 'ALLOW' });
  const second = await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-13', actionId: 'act-14' }));
  // Falls through to fresh evaluation since actionId doesn't match the cached record -- still ALLOW here, but via re-evaluation, not the cache.
  assert.deepEqual(second, { verdict: 'ALLOW' });
});

test('revoked parent fails: a REVOKED entry cannot authorize despite a plausible claimed role', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-revoked-owner-old', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-15', actionId: 'act-15' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
});

test('cross-family target fails: a FAMILY-scoped target naming a different family is denied even for a legitimate Owner', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'FAMILY', id: 'fam-OTHER' }, idempotencyKey: 'idem-16', actionId: 'act-16' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('cross-family target fails: a DEVICE-scoped target naming a device that is not in the actor\'s own trust set is denied (IDOR)', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      operation: 'REMOVE_REVOKE_DEVICE',
      targetScope: { kind: 'DEVICE', id: 'dev-in-some-other-family' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-cross-device',
      actionId: 'act-cross-device',
    }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('a DEVICE-scoped target that legitimately exists in the actor\'s own trust set is not rejected as cross-family', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      operation: 'REMOVE_REVOKE_DEVICE',
      targetScope: { kind: 'DEVICE', id: 'dev-viewer' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-legit-device',
      actionId: 'act-legit-device',
    }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('Viewer export attempt fails even with a (forged) FRESH step-up assertion attached', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      actorDeviceId: 'dev-viewer',
      operation: 'EXPORT_FAMILY_DATA',
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-17',
      actionId: 'act-17',
    }),
  );
  assert.equal(decision.verdict, 'DENY');
  assert.equal(decision.reason, 'ROLE_NOT_PERMITTED'); // role check runs before step-up ever matters
});

test('a sensitive Owner action without step-up is denied', async () => {
  const { service } = makeService();
  const decision = await service.authorize(baseRequest({ operation: 'EXPORT_FAMILY_DATA', idempotencyKey: 'idem-18', actionId: 'act-18' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_REQUIRED_BUT_ABSENT' });
});

test('an EXPIRED step-up assertion denies a sensitive action', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      operation: 'EXPORT_FAMILY_DATA',
      stepUp: { state: 'EXPIRED', assertedAt: T0, freshUntil: null },
      idempotencyKey: 'idem-19',
      actionId: 'act-19',
    }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_NOT_FRESH' });
});

test('a step-up assertion past its own freshUntil denies even though state is FRESH', async () => {
  const { service } = makeService(() => new Date('2026-01-01T00:10:00Z'));
  const decision = await service.authorize(
    baseRequest({
      operation: 'EXPORT_FAMILY_DATA',
      issuedAt: T0,
      expiresAt: new Date('2026-01-01T00:30:00Z'),
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date('2026-01-01T00:05:00Z') },
      idempotencyKey: 'idem-20',
      actionId: 'act-20',
    }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_NOT_FRESH' });
});

test('a fresh, unexpired step-up assertion allows a sensitive Owner action', async () => {
  const { service } = makeService(() => new Date('2026-01-01T00:02:00Z'));
  const decision = await service.authorize(
    baseRequest({
      operation: 'EXPORT_FAMILY_DATA',
      issuedAt: T0,
      expiresAt: new Date('2026-01-01T00:30:00Z'),
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date('2026-01-01T00:05:00Z') },
      idempotencyKey: 'idem-21',
      actionId: 'act-21',
    }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('a FAILED/UNSUPPORTED/CANCELLED step-up state each deny distinctly', async () => {
  const { service } = makeService();
  for (const [state, reason] of [
    ['FAILED', 'STEP_UP_FAILED'],
    ['UNSUPPORTED', 'STEP_UP_UNSUPPORTED'],
    ['CANCELLED', 'STEP_UP_CANCELLED'],
  ]) {
    const decision = await service.authorize(
      baseRequest({
        operation: 'EXPORT_FAMILY_DATA',
        stepUp: { state, assertedAt: T0, freshUntil: null },
        idempotencyKey: `idem-state-${state}`,
        actionId: `act-state-${state}`,
      }),
    );
    assert.deepEqual(decision, { verdict: 'DENY', reason });
  }
});

test('ownership transfer cannot be emulated by a CHANGE_ROLE action targeting OWNER: Administrator is denied outright', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      actorDeviceId: 'dev-admin',
      operation: 'CHANGE_ROLE',
      targetScope: { kind: 'MEMBER', id: 'dev-owner' },
      idempotencyKey: 'idem-22',
      actionId: 'act-22',
    }),
  );
  assert.equal(decision.verdict, 'DENY');
  // CHANGE_ROLE itself is the only path that could touch a role, and it is Owner-only + step-up -- there is no
  // separate lower-privilege operation an Administrator could use to reach the same effect.
});

// =====================================================================
// PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION
// =====================================================================

function childProfileRequest(overrides = {}) {
  return baseRequest({ operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, ...overrides });
}

test('CHILD_PROFILE: Owner A acting on child A (own family, own child) is allowed', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-1', actionId: 'act-cp-1' }));
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('CHILD_PROFILE: Owner A acting on child B (a DIFFERENT family\'s child) is denied (IDOR)', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-2', actionId: 'act-cp-2' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: Administrator A acting on child B (a DIFFERENT family\'s child) is denied (IDOR)', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    childProfileRequest({
      actorDeviceId: 'dev-admin',
      targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' },
      idempotencyKey: 'idem-cp-3',
      actionId: 'act-cp-3',
    }),
  );
  assert.equal(decision.verdict, 'DENY');
});

test('CHILD_PROFILE: a Viewer is denied EDIT_CHILD_POLICY on their OWN family\'s child -- role check, not membership, is the reason', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    childProfileRequest({ actorDeviceId: 'dev-viewer', idempotencyKey: 'idem-cp-4', actionId: 'act-cp-4' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' });
});

test('CHILD_PROFILE: an unknown profile id (NOT_FOUND) is denied with the SAME public reason as a cross-family target', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map());
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-5', actionId: 'act-cp-5' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: a resolver-UNAVAILABLE outcome fails closed (denied), never treated as an implicit ALLOW', async () => {
  const resolver = new UnavailableChildProfileMembershipResolver();
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-6', actionId: 'act-cp-6' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: the DEFAULT resolver (none injected) fails closed for every CHILD_PROFILE target', async () => {
  const { service } = makeService(); // no 5th arg -- exercises the UnavailableChildProfileMembershipResolver default
  const decision = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-7', actionId: 'act-cp-7' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: a malformed (empty) profile id is denied without ever reaching the resolver', async () => {
  let resolverCalled = false;
  const resolver = { resolveMembership: () => { resolverCalled = true; return { status: 'MEMBER_OF_FAMILY' }; } };
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: '' }, idempotencyKey: 'idem-cp-8', actionId: 'act-cp-8' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
  assert.equal(resolverCalled, false);
});

test('CHILD_PROFILE: an oversized profile id is denied (malformed) without ever reaching the resolver', async () => {
  let resolverCalled = false;
  const resolver = { resolveMembership: () => { resolverCalled = true; return { status: 'MEMBER_OF_FAMILY' }; } };
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'x'.repeat(200) }, idempotencyKey: 'idem-cp-9', actionId: 'act-cp-9' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
  assert.equal(resolverCalled, false);
});

test('CHILD_PROFILE: the resolver is re-consulted fresh on every authorize() call -- a family reassignment mid-session is reflected immediately, not served from a stale cache', async () => {
  let owningFamily = 'fam-1';
  const resolver = { resolveMembership: (familyId) => ({ status: owningFamily === familyId ? 'MEMBER_OF_FAMILY' : 'NOT_MEMBER' }) };
  const { service } = makeService(() => T0, resolver);

  const first = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-10a', actionId: 'act-cp-10a' }));
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // The child profile is reassigned to a different family between the two authorize() calls (e.g. a
  // transfer/offboarding completed on the trusted backing store this resolver represents).
  owningFamily = 'fam-OTHER';
  const second = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-10b', actionId: 'act-cp-10b' }));
  assert.deepEqual(second, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: wrong family + a valid FRESH step-up is still denied -- step-up never overrides family scope', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = await service.authorize(
    baseRequest({
      operation: 'EXPORT_FAMILY_DATA', // an ALLOW_WITH_STEP_UP operation, so step-up alone cannot be what denies this
      targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-cp-11',
      actionId: 'act-cp-11',
    }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' }); // membership is checked before step-up is ever consulted
});

test('CHILD_PROFILE idempotency: same idempotencyKey + different target is NOT treated as a replay -- re-evaluated fresh', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const first = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-mutate', actionId: 'act-cp-mutate-1' }),
  );
  assert.deepEqual(first, { verdict: 'ALLOW' });

  const second = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-mutate', actionId: 'act-cp-mutate-2' }),
  );
  assert.deepEqual(second, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE idempotency: the SAME actionId AND idempotencyKey reused with a MUTATED target does NOT ride the cached verdict for the original target', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const first = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-samekey', actionId: 'act-cp-samekey' }),
  );
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // SAME actionId, SAME idempotencyKey, but the target has been mutated to a cross-family child profile. A
  // caching scheme keyed on (idempotencyKey, actionId) alone would incorrectly replay the ORIGINAL ALLOW.
  const replay = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-samekey', actionId: 'act-cp-samekey' }),
  );
  assert.deepEqual(replay, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE idempotency: a genuinely identical replay (offline retry / duplicate reconnect delivery) still returns the SAME cached outcome', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const request = childProfileRequest({ idempotencyKey: 'idem-cp-identical', actionId: 'act-cp-identical' });

  const first = await service.authorize(request);
  assert.deepEqual(first, { verdict: 'ALLOW' });

  const duplicateDelivery = await service.authorize(request); // e.g. the queued offline action's delivery ack was lost and the client retried
  assert.deepEqual(duplicateDelivery, first);
});

test('CHILD_PROFILE idempotency: a denied cross-family attempt cannot be laundered into an ALLOW by replaying with a legitimate target under the SAME actionId/idempotencyKey', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const denied = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-launder', actionId: 'act-cp-launder' }),
  );
  assert.deepEqual(denied, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });

  const relabeled = await service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-launder', actionId: 'act-cp-launder' }),
  );
  assert.deepEqual(relabeled, { verdict: 'ALLOW' }); // re-evaluated fresh against the NEW (legitimate) target, not blocked by the prior denial either
});

// Offline/reconnect: the receiving/deciding endpoint always calls authorize() live at APPLICATION time (see
// ChildRequestService.decide()), reading the CURRENT trust set and CURRENT child-profile membership -- there
// is no separate "offline decision cache" in this module for a reconnect to trust instead. This test pins
// that guarantee at the authorization-service level: two calls separated by a family/trust-set change
// between them (simulating queue-time vs. apply-time) independently reflect apply-time truth.
test('offline/reconnect re-validation: trust-set state at APPLY time governs, not state at (hypothetical) queue time', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { store, service } = makeService(() => T0, resolver);

  const queueTimeDecision = await service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-reco-1', actionId: 'act-cp-reco-1' }));
  assert.deepEqual(queueTimeDecision, { verdict: 'ALLOW' });

  // Simulate the actor's authority being revoked while the action sat queued offline.
  store.setCurrentEpoch(epoch({ trustSetEpoch: 9, entries: epoch().entries.filter((e) => e.deviceId !== 'dev-owner') }));

  const applyTimeDecision = await service.authorize(
    childProfileRequest({ idempotencyKey: 'idem-cp-reco-2', actionId: 'act-cp-reco-2' }), // a DIFFERENT action/idempotency pair -- a fresh apply-time re-check, not a replay
  );
  assert.deepEqual(applyTimeDecision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
});

// =====================================================================
// PCA product-completion programme, Writer P0-A: family-scoped negative
// tests for the four ParentOperations family/members-shaped features
// (ADD_VIEWER, ADD_ADMINISTRATOR, REMOVE_NON_OWNER_PARENT, CHANGE_ROLE)
// depend on, plus the P0-A success criterion -- every new P0-B/C/D route
// calling this service today gets a correct, honest DENY while the
// resolver is Unavailable*, and needs zero further backend changes once a
// real resolver is wired in.
// =====================================================================

const FAMILY_MEMBER_OPERATIONS = ['ADD_VIEWER', 'ADD_ADMINISTRATOR', 'REMOVE_NON_OWNER_PARENT', 'CHANGE_ROLE'];

test('family/members operations: cross-family MEMBER target fails for every operation this package needs', async () => {
  const { service } = makeService();
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = await service.authorize(
      baseRequest({
        operation,
        targetScope: { kind: 'MEMBER', id: 'dev-in-some-other-family' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
        idempotencyKey: `idem-fm-cross-${operation}`,
        actionId: `act-fm-cross-${operation}`,
      }),
    );
    assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' }, `expected CROSS_FAMILY_TARGET for ${operation}`);
  }
});

test('family/members operations: a Viewer is denied every one of them outright (wrong-role denial)', async () => {
  const { service } = makeService();
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = await service.authorize(
      baseRequest({
        actorDeviceId: 'dev-viewer',
        operation,
        targetScope: { kind: 'MEMBER', id: 'dev-admin' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
        idempotencyKey: `idem-fm-viewer-${operation}`,
        actionId: `act-fm-viewer-${operation}`,
      }),
    );
    assert.equal(decision.verdict, 'DENY', `expected DENY for Viewer attempting ${operation}`);
  }
});

test('family/members operations: an Administrator may manage normal roles with fresh step-up', async () => {
  const { service } = makeService();
  for (const operation of ['ADD_ADMINISTRATOR', 'CHANGE_ROLE']) {
    const decision = await service.authorize(
      baseRequest({
        actorDeviceId: 'dev-admin',
        operation,
        targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
        idempotencyKey: `idem-fm-admin-${operation}`,
        actionId: `act-fm-admin-${operation}`,
      }),
    );
    assert.deepEqual(decision, { verdict: 'ALLOW' }, `expected ALLOW for Administrator attempting ${operation}`);
  }
});

test('family/members operations: an expired action fails for every operation this package needs', async () => {
  const { service } = makeService(() => new Date('2026-01-01T01:00:00Z'));
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = await service.authorize(
      baseRequest({
        operation,
        targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date('2026-01-01T02:00:00Z') },
        idempotencyKey: `idem-fm-expired-${operation}`,
        actionId: `act-fm-expired-${operation}`,
      }),
    );
    assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTION_EXPIRED' }, `expected ACTION_EXPIRED for ${operation}`);
  }
});

test('family/members operations: ADD_VIEWER for Owner needs no step-up and no FamilyRbacPolicyConfig delegation', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({ operation: 'ADD_VIEWER', targetScope: { kind: 'MEMBER', id: 'dev-viewer' }, idempotencyKey: 'idem-fm-owner-add-viewer', actionId: 'act-fm-owner-add-viewer' }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('family/members operations: ADD_VIEWER for Administrator is allowed with fresh step-up', async () => {
  const { service } = makeService();
  const decision = await service.authorize(
    baseRequest({
      actorDeviceId: 'dev-admin',
      operation: 'ADD_VIEWER',
      targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-fm-admin-add-viewer-default',
      actionId: 'act-fm-admin-add-viewer-default',
    }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('FamilyRbacPolicyConfigStore remains readable without changing normal Administrator authority', async () => {
  const configStore = new FamilyRbacPolicyConfigStore({
    async getForFamily() { return null; },
    async setForFamily() {},
  });
  await configStore.setForFamily('fam-1', { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: false }, T0);
  // The configuration remains durable compatibility state; normal role
  // authority no longer depends on an opt-in delegation flag.
  assert.equal(configStore.snapshotFor('fam-NEVER-CONFIGURED').administratorCanManageViewers, false);

  const { service } = makeService(() => T0, undefined, configStore.snapshotFor);

  const allowed = await service.authorize(
    baseRequest({
      actorDeviceId: 'dev-admin',
      operation: 'ADD_VIEWER',
      targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-fm-rbac-store-fam1',
      actionId: 'act-fm-rbac-store-fam1',
    }),
  );
  assert.deepEqual(allowed, { verdict: 'ALLOW' });
});

// =====================================================================
// P0-A success criterion (see IMPLEMENTATION_SEQUENCE in
// PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md): every future P0-B/C/D
// route calling ParentActionAuthorizationService today, wired to the REAL
// production UnavailableTrustSetRoleResolver (not the in-memory test
// resolver used everywhere else in this file), must get a correct, honest
// fail-closed DENY -- never a crash, never a silent ALLOW -- and will start
// working with zero further backend changes the moment a real resolver
// replaces it.
// =====================================================================

test('P0-A success criterion: every family/members operation fails closed with ACTOR_NOT_RESOLVABLE against the REAL production UnavailableTrustSetRoleResolver', async () => {
  const resolver = new UnavailableTrustSetRoleResolver();
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, ledger, () => T0);

  for (const operation of [...FAMILY_MEMBER_OPERATIONS, 'EDIT_CHILD_POLICY']) {
    const decision = await service.authorize(
      baseRequest({
        operation,
        targetScope: operation === 'EDIT_CHILD_POLICY' ? { kind: 'CHILD_PROFILE', id: 'child-A' } : { kind: 'MEMBER', id: 'dev-viewer' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
        idempotencyKey: `idem-p0a-unavailable-${operation}`,
        actionId: `act-p0a-unavailable-${operation}`,
      }),
    );
    assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' }, `expected fail-closed DENY for ${operation} against UnavailableTrustSetRoleResolver`);
  }
});

test('P0-A success criterion: does not crash or throw when authorizing against UnavailableTrustSetRoleResolver -- an honest DENY, never an unhandled exception', async () => {
  const resolver = new UnavailableTrustSetRoleResolver();
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, ledger, () => T0);
  // doesNotReject, NOT doesNotThrow: authorize() is asynchronous now, so a
  // failure arrives as a REJECTED PROMISE. assert.doesNotThrow would have
  // passed vacuously against the Promise itself and stopped testing anything --
  // exactly the silent-strengthening-loss this suite exists to prevent.
  await assert.doesNotReject(() =>
    service.authorize(
      baseRequest({
        operation: 'ADD_VIEWER',
        targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
        idempotencyKey: 'idem-p0a-no-throw',
        actionId: 'act-p0a-no-throw',
      }),
    ),
  );
});

test('SEC-1 regression: the fingerprint written to the ledger is a SHA-256 hex digest, never the raw request shape', async () => {
  // This is the fast, DB-free half of the SEC-1 regression. The durable column
  // is CHAR(64) ascii with a hex-pattern CHECK, so a raw
  // "family|device|operation|kind|id" composite is not merely inelegant -- it is
  // REJECTED by the database, and because a CHECK violation is not a
  // duplicate-key error the ledger rethrows it and authorize() rejects on every
  // call. The unit suite and the ledger DB suite both stayed green while that
  // was true, because both wrote synthetic fingerprints; this case asserts the
  // WRITER's own output instead, which is what the real table receives.
  const { service, ledger } = makeService();
  const request = baseRequest({ operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-fp-1', actionId: 'act-fp-1' });
  await service.authorize(request);

  const stored = await ledger.getRecorded('fam-1', 'idem-fp-1');
  assert.match(stored.requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(stored.requestFingerprint.includes('|'), false, 'the raw composite must never be what is stored');
  assert.equal(stored.requestFingerprint.includes('child-A'), false, 'nor may it embed a target id in readable form');

  // Deterministic for the same shape, and bound to the shape: the SAME key with
  // a mutated targetScope must produce a DIFFERENT fingerprint, or a caller
  // could replay the original target's verdict against a new one (PCA10).
  await service.authorize(request);
  assert.equal((await ledger.getRecorded('fam-1', 'idem-fp-1')).requestFingerprint, stored.requestFingerprint);
  await service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-fp-2', actionId: 'act-fp-2' }));
  assert.notEqual((await ledger.getRecorded('fam-1', 'idem-fp-2')).requestFingerprint, stored.requestFingerprint);
});

test('SEC-5 regression: a lost insert race returns the ledger RECORDED verdict, never this caller own freshly computed one', async () => {
  // Two concurrent deliveries of the same action can each find the ledger empty,
  // each evaluate against trust-set state that moved in between, and reach
  // DIFFERENT verdicts. Only one of those becomes the durable record, and every
  // future replay returns it -- so a losing caller that returned its own verdict
  // would hold an answer the ledger contradicts, i.e. the exact divergence
  // replay protection exists to prevent. The ledger double below reproduces that
  // race exactly: it misses on read, then reveals the winner on write.
  const { service, ledger } = makeService();
  const request = baseRequest({
    operation: 'EDIT_CHILD_POLICY',
    targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' },
    idempotencyKey: 'idem-race',
    actionId: 'act-race',
  });
  await service.authorize(request); // learn the fingerprint this request shape produces
  const winningFingerprint = (await ledger.getRecorded('fam-1', 'idem-race')).requestFingerprint;
  const concurrentWinner = { actionId: 'act-race', requestFingerprint: winningFingerprint, outcome: '{"verdict":"DENY","reason":"STEP_UP_NOT_FRESH"}' };

  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const racingService = new ParentActionAuthorizationService(
    new FamilyTrustSetRoleResolver(store),
    defaultFamilyRbacPolicyConfig,
    { getRecorded: async () => null, record: async () => concurrentWinner },
    () => T0,
  );

  assert.deepEqual(await racingService.authorize(request), { verdict: 'DENY', reason: 'STEP_UP_NOT_FRESH' });
});

test('SEC-5 boundary: a record under a DIFFERENT actionId is NOT adopted -- authorize() never launders another request verdict', async () => {
  // The other half of the rule above. The same idempotency key reused for a
  // DIFFERENT action must not let this caller inherit whatever outcome that
  // other action recorded: this call has just evaluated THIS request, and
  // adopting an unrelated verdict is the laundering PCA10 forbids. The winner
  // row is kept (first-writer-wins) but the caller gets its own verdict.
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const otherRequestRecord = { actionId: 'act-someone-else', requestFingerprint: 'a'.repeat(64), outcome: '{"verdict":"ALLOW"}' };
  const service = new ParentActionAuthorizationService(
    new FamilyTrustSetRoleResolver(store),
    defaultFamilyRbacPolicyConfig,
    { getRecorded: async () => null, record: async () => otherRequestRecord },
    () => T0,
  );

  const decision = await service.authorize(
    baseRequest({ actorDeviceId: 'dev-child', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-shared', actionId: 'act-mine' }),
  );
  assert.deepEqual(decision, { verdict: 'REQUEST_ONLY' });
});
