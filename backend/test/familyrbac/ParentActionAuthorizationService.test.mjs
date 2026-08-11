import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';

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

function makeService(nowFn = () => T0) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  const ledger = new InMemoryActionIdempotencyLedger();
  const service = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, ledger, nowFn);
  return { store, service };
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
