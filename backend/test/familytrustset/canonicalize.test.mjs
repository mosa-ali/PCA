import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';

function entry(overrides = {}) {
  return {
    deviceId: 'device-1',
    role: 'OWNER',
    dskKeyId: 'dsk-key-1',
    dskPublicKey: 'dsk-pub-1',
    dekKeyId: 'dek-key-1',
    dekPublicKey: 'dek-pub-1',
    status: 'ACTIVE',
    ...overrides,
  };
}

function baseEpoch(overrides = {}) {
  return {
    familyId: 'family-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [entry()],
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: null,
    ...overrides,
  };
}

test('canonicalizeTrustSetEpoch is deterministic for identical input', () => {
  const a = canonicalizeTrustSetEpoch(baseEpoch());
  const b = canonicalizeTrustSetEpoch(baseEpoch());
  assert.equal(a, b);
});

test('canonicalizeTrustSetEpoch changes when any epoch-level field changes', () => {
  const base = canonicalizeTrustSetEpoch(baseEpoch());
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ familyId: 'family-2' })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ trustSetEpoch: 2 })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ keyEpoch: 2 })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ issuedAt: new Date('2026-01-02T00:00:00.000Z') })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ supersedesEpoch: 0 })), base);
});

test('canonicalizeTrustSetEpoch changes when any entry field changes', () => {
  const base = canonicalizeTrustSetEpoch(baseEpoch());
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ deviceId: 'device-2' })] })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ role: 'CHILD' })] })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ dskPublicKey: 'dsk-pub-2' })] })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ dekPublicKey: 'dek-pub-2' })] })), base);
  assert.notEqual(canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ status: 'REVOKED' })] })), base);
});

test('canonicalizeTrustSetEpoch changes when the entry LIST changes (add/remove/reorder)', () => {
  const one = canonicalizeTrustSetEpoch(baseEpoch({ entries: [entry({ deviceId: 'device-1' })] }));
  const two = canonicalizeTrustSetEpoch(
    baseEpoch({ entries: [entry({ deviceId: 'device-1' }), entry({ deviceId: 'device-2', role: 'CHILD' })] }),
  );
  const reordered = canonicalizeTrustSetEpoch(
    baseEpoch({ entries: [entry({ deviceId: 'device-2', role: 'CHILD' }), entry({ deviceId: 'device-1' })] }),
  );
  assert.notEqual(one, two);
  assert.notEqual(two, reordered);
});
