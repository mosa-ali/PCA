import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver, isActorResolutionFailure } from '../../dist/familyrbac/TrustSetRoleResolver.js';

function epoch(overrides = {}) {
  return {
    familyId: 'fam-1',
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-child', role: 'CHILD', dskKeyId: 'k3', dskPublicKey: 'pk3', dekKeyId: 'k4', dekPublicKey: 'pk4', status: 'ACTIVE' },
      { deviceId: 'dev-revoked-admin', role: 'ADMINISTRATOR', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'REVOKED' },
    ],
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    supersedesEpoch: null,
    signature: 'sig',
    ...overrides,
  };
}

test('resolveActor returns NO_TRUST_SET when the device has never stored an epoch', () => {
  const resolver = new FamilyTrustSetRoleResolver(new InMemoryFamilyTrustSetStore());
  const result = resolver.resolveActor('fam-1', 'dev-owner');
  assert.equal(result, 'NO_TRUST_SET');
  assert.equal(isActorResolutionFailure(result), true);
});

test('resolveActor resolves the role/epoch of an ACTIVE entry', () => {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  const result = resolver.resolveActor('fam-1', 'dev-owner');
  assert.equal(isActorResolutionFailure(result), false);
  assert.deepEqual(result, { deviceId: 'dev-owner', role: 'OWNER', trustSetEpoch: 5, keyEpoch: 3 });
});

test('resolveActor fails for a device not present in the current trust set (IDOR: no such device)', () => {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  assert.equal(resolver.resolveActor('fam-1', 'dev-unknown'), 'DEVICE_NOT_IN_TRUST_SET');
});

test('resolveActor fails for a REVOKED entry even though it exists with a claimed role', () => {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  assert.equal(resolver.resolveActor('fam-1', 'dev-revoked-admin'), 'DEVICE_NOT_ACTIVE');
});

test('resolveActor fails on a cross-family lookup even for a device id that exists in a DIFFERENT family\'s epoch', () => {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch({ familyId: 'fam-1' }));
  const resolver = new FamilyTrustSetRoleResolver(store);
  assert.equal(resolver.resolveActor('fam-2', 'dev-owner'), 'FAMILY_MISMATCH');
});
