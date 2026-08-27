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

test('Owner allowed: an ordinary Owner action authorizes', () => {
  const { service } = makeService();
  const decision = service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY' }));
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('Admin allowed only configured operations: default config denies ADD_VIEWER for Administrator', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-admin', operation: 'ADD_VIEWER', idempotencyKey: 'idem-2', actionId: 'act-2' }),
  );
  assert.equal(decision.verdict, 'DENY');
  assert.equal(decision.reason, 'ROLE_NOT_PERMITTED');
});

test('Admin allowed only configured operations: EDIT_CHILD_POLICY is unconditionally allowed for Administrator', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-admin', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-3', actionId: 'act-3' }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('Viewer read-only: VIEW_DASHBOARD resolves ALLOW_READ_ONLY, EDIT_CHILD_POLICY denies', () => {
  const { service } = makeService();
  const view = service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'VIEW_DASHBOARD', idempotencyKey: 'idem-4', actionId: 'act-4' }),
  );
  assert.deepEqual(view, { verdict: 'ALLOW_READ_ONLY' });
  const edit = service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-5', actionId: 'act-5' }),
  );
  assert.equal(edit.verdict, 'DENY');
});

test('Child cannot parent-control: EDIT_CHILD_POLICY resolves REQUEST_ONLY, never ALLOW', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-child', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-6', actionId: 'act-6' }),
  );
  assert.deepEqual(decision, { verdict: 'REQUEST_ONLY' });
});

test('direct deep-link bypass fails: a Viewer submitting a sensitive owner-only operation is denied regardless of how it was reached', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-viewer', operation: 'EXPORT_FAMILY_DATA', idempotencyKey: 'idem-7', actionId: 'act-7' }),
  );
  assert.equal(decision.verdict, 'DENY');
});

test('stale cached UI role fails: authorization is re-derived from the CURRENT trust set, not any role the caller supplies', () => {
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
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-owner', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-8', actionId: 'act-8' }),
  );
  assert.equal(decision.verdict, 'DENY'); // demoted to VIEWER in the new epoch, EDIT_CHILD_POLICY is now DENY for Viewer
});

test('forged role label fails: there is no request field capable of asserting a role at all', () => {
  const { service } = makeService();
  const forged = baseRequest({ actorDeviceId: 'dev-child', operation: 'CHANGE_ROLE', idempotencyKey: 'idem-9', actionId: 'act-9' });
  assert.equal('role' in forged, false); // the request shape itself cannot carry a role claim
  const decision = service.authorize(forged);
  assert.equal(decision.verdict, 'DENY'); // resolved role is CHILD regardless of what operation was requested
});

test('stale trustSet epoch fails: a device absent from the CURRENT epoch (rotated out) cannot be resolved', () => {
  const { store, service } = makeService();
  store.setCurrentEpoch(epoch({ trustSetEpoch: 7, entries: epoch().entries.filter((e) => e.deviceId !== 'dev-owner') }));
  const decision = service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-10', actionId: 'act-10' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
});

test('expired action fails', () => {
  const { service } = makeService(() => new Date('2026-01-01T01:00:00Z'));
  const decision = service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-11', actionId: 'act-11' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTION_EXPIRED' });
});

test('replayed action succeeds idempotently with the SAME recorded outcome, not a fresh re-evaluation', () => {
  const { store, service } = makeService();
  const request = baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-12', actionId: 'act-12' });
  const first = service.authorize(request);
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // Trust set changes AFTER the first authorization (owner demoted) -- a naive re-evaluation would now DENY.
  store.setCurrentEpoch(
    epoch({
      trustSetEpoch: 6,
      entries: [{ deviceId: 'dev-owner', role: 'VIEWER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' }],
    }),
  );
  const replay = service.authorize(request); // same idempotencyKey + actionId
  assert.deepEqual(replay, first); // idempotent: returns the ORIGINAL recorded outcome
});

test('a different actionId reusing the same idempotencyKey is NOT treated as the same recorded action', () => {
  const { service } = makeService();
  const first = service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-13', actionId: 'act-13' }));
  assert.deepEqual(first, { verdict: 'ALLOW' });
  const second = service.authorize(baseRequest({ operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-13', actionId: 'act-14' }));
  // Falls through to fresh evaluation since actionId doesn't match the cached record -- still ALLOW here, but via re-evaluation, not the cache.
  assert.deepEqual(second, { verdict: 'ALLOW' });
});

test('revoked parent fails: a REVOKED entry cannot authorize despite a plausible claimed role', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ actorDeviceId: 'dev-revoked-owner-old', operation: 'EDIT_CHILD_POLICY', idempotencyKey: 'idem-15', actionId: 'act-15' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
});

test('cross-family target fails: a FAMILY-scoped target naming a different family is denied even for a legitimate Owner', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'FAMILY', id: 'fam-OTHER' }, idempotencyKey: 'idem-16', actionId: 'act-16' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('cross-family target fails: a DEVICE-scoped target naming a device that is not in the actor\'s own trust set is denied (IDOR)', () => {
  const { service } = makeService();
  const decision = service.authorize(
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

test('a DEVICE-scoped target that legitimately exists in the actor\'s own trust set is not rejected as cross-family', () => {
  const { service } = makeService();
  const decision = service.authorize(
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

test('Viewer export attempt fails even with a (forged) FRESH step-up assertion attached', () => {
  const { service } = makeService();
  const decision = service.authorize(
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

test('a sensitive Owner action without step-up is denied', () => {
  const { service } = makeService();
  const decision = service.authorize(baseRequest({ operation: 'EXPORT_FAMILY_DATA', idempotencyKey: 'idem-18', actionId: 'act-18' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_REQUIRED_BUT_ABSENT' });
});

test('an EXPIRED step-up assertion denies a sensitive action', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({
      operation: 'EXPORT_FAMILY_DATA',
      stepUp: { state: 'EXPIRED', assertedAt: T0, freshUntil: null },
      idempotencyKey: 'idem-19',
      actionId: 'act-19',
    }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'STEP_UP_NOT_FRESH' });
});

test('a step-up assertion past its own freshUntil denies even though state is FRESH', () => {
  const { service } = makeService(() => new Date('2026-01-01T00:10:00Z'));
  const decision = service.authorize(
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

test('a fresh, unexpired step-up assertion allows a sensitive Owner action', () => {
  const { service } = makeService(() => new Date('2026-01-01T00:02:00Z'));
  const decision = service.authorize(
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

test('a FAILED/UNSUPPORTED/CANCELLED step-up state each deny distinctly', () => {
  const { service } = makeService();
  for (const [state, reason] of [
    ['FAILED', 'STEP_UP_FAILED'],
    ['UNSUPPORTED', 'STEP_UP_UNSUPPORTED'],
    ['CANCELLED', 'STEP_UP_CANCELLED'],
  ]) {
    const decision = service.authorize(
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

test('ownership transfer cannot be emulated by a CHANGE_ROLE action targeting OWNER: Administrator is denied outright', () => {
  const { service } = makeService();
  const decision = service.authorize(
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

test('CHILD_PROFILE: Owner A acting on child A (own family, own child) is allowed', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-1', actionId: 'act-cp-1' }));
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('CHILD_PROFILE: Owner A acting on child B (a DIFFERENT family\'s child) is denied (IDOR)', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-2', actionId: 'act-cp-2' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: Administrator A acting on child B (a DIFFERENT family\'s child) is denied (IDOR)', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
    childProfileRequest({
      actorDeviceId: 'dev-admin',
      targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' },
      idempotencyKey: 'idem-cp-3',
      actionId: 'act-cp-3',
    }),
  );
  assert.equal(decision.verdict, 'DENY');
});

test('CHILD_PROFILE: a Viewer is denied EDIT_CHILD_POLICY on their OWN family\'s child -- role check, not membership, is the reason', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
    childProfileRequest({ actorDeviceId: 'dev-viewer', idempotencyKey: 'idem-cp-4', actionId: 'act-cp-4' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' });
});

test('CHILD_PROFILE: an unknown profile id (NOT_FOUND) is denied with the SAME public reason as a cross-family target', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map());
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-5', actionId: 'act-cp-5' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: a resolver-UNAVAILABLE outcome fails closed (denied), never treated as an implicit ALLOW', () => {
  const resolver = new UnavailableChildProfileMembershipResolver();
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-6', actionId: 'act-cp-6' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: the DEFAULT resolver (none injected) fails closed for every CHILD_PROFILE target', () => {
  const { service } = makeService(); // no 5th arg -- exercises the UnavailableChildProfileMembershipResolver default
  const decision = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-7', actionId: 'act-cp-7' }));
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: a malformed (empty) profile id is denied without ever reaching the resolver', () => {
  let resolverCalled = false;
  const resolver = { resolveMembership: () => { resolverCalled = true; return { status: 'MEMBER_OF_FAMILY' }; } };
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: '' }, idempotencyKey: 'idem-cp-8', actionId: 'act-cp-8' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
  assert.equal(resolverCalled, false);
});

test('CHILD_PROFILE: an oversized profile id is denied (malformed) without ever reaching the resolver', () => {
  let resolverCalled = false;
  const resolver = { resolveMembership: () => { resolverCalled = true; return { status: 'MEMBER_OF_FAMILY' }; } };
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'x'.repeat(200) }, idempotencyKey: 'idem-cp-9', actionId: 'act-cp-9' }),
  );
  assert.deepEqual(decision, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
  assert.equal(resolverCalled, false);
});

test('CHILD_PROFILE: the resolver is re-consulted fresh on every authorize() call -- a family reassignment mid-session is reflected immediately, not served from a stale cache', () => {
  let owningFamily = 'fam-1';
  const resolver = { resolveMembership: (familyId) => ({ status: owningFamily === familyId ? 'MEMBER_OF_FAMILY' : 'NOT_MEMBER' }) };
  const { service } = makeService(() => T0, resolver);

  const first = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-10a', actionId: 'act-cp-10a' }));
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // The child profile is reassigned to a different family between the two authorize() calls (e.g. a
  // transfer/offboarding completed on the trusted backing store this resolver represents).
  owningFamily = 'fam-OTHER';
  const second = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-10b', actionId: 'act-cp-10b' }));
  assert.deepEqual(second, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE: wrong family + a valid FRESH step-up is still denied -- step-up never overrides family scope', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);
  const decision = service.authorize(
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

test('CHILD_PROFILE idempotency: same idempotencyKey + different target is NOT treated as a replay -- re-evaluated fresh', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const first = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-mutate', actionId: 'act-cp-mutate-1' }),
  );
  assert.deepEqual(first, { verdict: 'ALLOW' });

  const second = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-mutate', actionId: 'act-cp-mutate-2' }),
  );
  assert.deepEqual(second, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE idempotency: the SAME actionId AND idempotencyKey reused with a MUTATED target does NOT ride the cached verdict for the original target', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const first = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-samekey', actionId: 'act-cp-samekey' }),
  );
  assert.deepEqual(first, { verdict: 'ALLOW' });

  // SAME actionId, SAME idempotencyKey, but the target has been mutated to a cross-family child profile. A
  // caching scheme keyed on (idempotencyKey, actionId) alone would incorrectly replay the ORIGINAL ALLOW.
  const replay = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-samekey', actionId: 'act-cp-samekey' }),
  );
  assert.deepEqual(replay, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });
});

test('CHILD_PROFILE idempotency: a genuinely identical replay (offline retry / duplicate reconnect delivery) still returns the SAME cached outcome', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { service } = makeService(() => T0, resolver);
  const request = childProfileRequest({ idempotencyKey: 'idem-cp-identical', actionId: 'act-cp-identical' });

  const first = service.authorize(request);
  assert.deepEqual(first, { verdict: 'ALLOW' });

  const duplicateDelivery = service.authorize(request); // e.g. the queued offline action's delivery ack was lost and the client retried
  assert.deepEqual(duplicateDelivery, first);
});

test('CHILD_PROFILE idempotency: a denied cross-family attempt cannot be laundered into an ALLOW by replaying with a legitimate target under the SAME actionId/idempotencyKey', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1'], ['child-B', 'fam-OTHER']]));
  const { service } = makeService(() => T0, resolver);

  const denied = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-B' }, idempotencyKey: 'idem-cp-launder', actionId: 'act-cp-launder' }),
  );
  assert.deepEqual(denied, { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' });

  const relabeled = service.authorize(
    childProfileRequest({ targetScope: { kind: 'CHILD_PROFILE', id: 'child-A' }, idempotencyKey: 'idem-cp-launder', actionId: 'act-cp-launder' }),
  );
  assert.deepEqual(relabeled, { verdict: 'ALLOW' }); // re-evaluated fresh against the NEW (legitimate) target, not blocked by the prior denial either
});

// Offline/reconnect: the receiving/deciding endpoint always calls authorize() live at APPLICATION time (see
// ChildRequestService.decide()), reading the CURRENT trust set and CURRENT child-profile membership -- there
// is no separate "offline decision cache" in this module for a reconnect to trust instead. This test pins
// that guarantee at the authorization-service level: two calls separated by a family/trust-set change
// between them (simulating queue-time vs. apply-time) independently reflect apply-time truth.
test('offline/reconnect re-validation: trust-set state at APPLY time governs, not state at (hypothetical) queue time', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-A', 'fam-1']]));
  const { store, service } = makeService(() => T0, resolver);

  const queueTimeDecision = service.authorize(childProfileRequest({ idempotencyKey: 'idem-cp-reco-1', actionId: 'act-cp-reco-1' }));
  assert.deepEqual(queueTimeDecision, { verdict: 'ALLOW' });

  // Simulate the actor's authority being revoked while the action sat queued offline.
  store.setCurrentEpoch(epoch({ trustSetEpoch: 9, entries: epoch().entries.filter((e) => e.deviceId !== 'dev-owner') }));

  const applyTimeDecision = service.authorize(
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

test('family/members operations: cross-family MEMBER target fails for every operation this package needs, even for a legitimate Owner', () => {
  const { service } = makeService();
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = service.authorize(
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

test('family/members operations: a Viewer is denied every one of them outright (wrong-role denial)', () => {
  const { service } = makeService();
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = service.authorize(
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

test('family/members operations: an Administrator is denied ADD_ADMINISTRATOR/CHANGE_ROLE outright -- these are Owner-only regardless of FamilyRbacPolicyConfig', () => {
  const { service } = makeService();
  for (const operation of ['ADD_ADMINISTRATOR', 'CHANGE_ROLE']) {
    const decision = service.authorize(
      baseRequest({
        actorDeviceId: 'dev-admin',
        operation,
        targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
        stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
        idempotencyKey: `idem-fm-admin-${operation}`,
        actionId: `act-fm-admin-${operation}`,
      }),
    );
    assert.equal(decision.verdict, 'DENY', `expected DENY for Administrator attempting ${operation}`);
  }
});

test('family/members operations: an expired action fails for every operation this package needs', () => {
  const { service } = makeService(() => new Date('2026-01-01T01:00:00Z'));
  for (const operation of FAMILY_MEMBER_OPERATIONS) {
    const decision = service.authorize(
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

test('family/members operations: ADD_VIEWER for Owner needs no step-up and no FamilyRbacPolicyConfig delegation', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({ operation: 'ADD_VIEWER', targetScope: { kind: 'MEMBER', id: 'dev-viewer' }, idempotencyKey: 'idem-fm-owner-add-viewer', actionId: 'act-fm-owner-add-viewer' }),
  );
  assert.deepEqual(decision, { verdict: 'ALLOW' });
});

test('family/members operations: ADD_VIEWER for Administrator is denied under the default (safe) FamilyRbacPolicyConfig even with fresh step-up', () => {
  const { service } = makeService();
  const decision = service.authorize(
    baseRequest({
      actorDeviceId: 'dev-admin',
      operation: 'ADD_VIEWER',
      targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-fm-admin-add-viewer-default',
      actionId: 'act-fm-admin-add-viewer-default',
    }),
  );
  assert.equal(decision.verdict, 'DENY');
});

test('FamilyRbacPolicyConfigStore integration: real per-family config (not the hardcoded default) genuinely changes the ADD_VIEWER verdict for an Administrator, proving configProvider is called with the REQUEST familyId', async () => {
  const configStore = new FamilyRbacPolicyConfigStore({
    async getForFamily() { return null; },
    async setForFamily() {},
  });
  await configStore.setForFamily('fam-1', { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: false }, T0);
  // Sanity: an unconfigured family still gets the safe default, so this isn't just "always ALLOW now".
  assert.equal(configStore.snapshotFor('fam-NEVER-CONFIGURED').administratorCanManageViewers, false);

  const { service } = makeService(() => T0, undefined, configStore.snapshotFor);

  const allowed = service.authorize(
    baseRequest({
      actorDeviceId: 'dev-admin',
      operation: 'ADD_VIEWER',
      targetScope: { kind: 'MEMBER', id: 'dev-viewer' },
      stepUp: { state: 'FRESH', assertedAt: T0, freshUntil: new Date(T0.getTime() + 60_000) },
      idempotencyKey: 'idem-fm-rbac-store-fam1',
      actionId: 'act-fm-rbac-store-fam1',
    }),
  );
  assert.deepEqual(allowed, { verdict: 'ALLOW' }); // fam-1's real, durable config delegates administratorCanManageViewers -- the default alone would DENY this (see the "default (safe) FamilyRbacPolicyConfig" test above)
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

test('P0-A success criterion: every family/members operation fails closed with ACTOR_NOT_RESOLVABLE against the REAL production UnavailableTrustSetRoleResolver', () => {
  const resolver = new UnavailableTrustSetRoleResolver();
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, ledger, () => T0);

  for (const operation of [...FAMILY_MEMBER_OPERATIONS, 'EDIT_CHILD_POLICY']) {
    const decision = service.authorize(
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

test('P0-A success criterion: does not crash or throw when authorizing against UnavailableTrustSetRoleResolver -- an honest DENY, never an unhandled exception', () => {
  const resolver = new UnavailableTrustSetRoleResolver();
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, ledger, () => T0);
  assert.doesNotThrow(() =>
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
