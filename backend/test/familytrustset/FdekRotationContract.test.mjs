import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceKeysToWrapFdekFor } from '../../dist/familytrustset/FdekRotationContract.js';

function entry(overrides = {}) {
  return {
    deviceId: 'device-1',
    role: 'OWNER',
    dskKeyId: 'dsk-key',
    dskPublicKey: 'dsk-pub',
    dekKeyId: 'dek-key',
    dekPublicKey: 'dek-pub',
    status: 'ACTIVE',
    ...overrides,
  };
}

function epoch(entries) {
  return {
    familyId: 'family-1',
    trustSetEpoch: 2,
    keyEpoch: 2,
    entries,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: 1,
    signature: 'sig',
  };
}

test('every ACTIVE entry is a wrap target', () => {
  const targets = deviceKeysToWrapFdekFor(epoch([entry(), entry({ deviceId: 'device-2', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' })]));
  assert.equal(targets.length, 2);
  assert.deepEqual(new Set(targets.map((t) => t.deviceId)), new Set(['device-1', 'device-2']));
});

test('a REVOKED entry is never a wrap target -- the whole point of revocation', () => {
  const targets = deviceKeysToWrapFdekFor(epoch([entry({ status: 'REVOKED' }), entry({ deviceId: 'device-2', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' })]));
  assert.deepEqual(targets.map((t) => t.deviceId), ['device-2']);
});

test('DEVICE_OFFLINE / EPOCH_STALE / ROTATION_PENDING / RECOVERY_REQUIRED entries are excluded until they converge to ACTIVE', () => {
  const targets = deviceKeysToWrapFdekFor(
    epoch([
      entry({ deviceId: 'offline', status: 'DEVICE_OFFLINE' }),
      entry({ deviceId: 'stale', status: 'EPOCH_STALE' }),
      entry({ deviceId: 'pending', status: 'ROTATION_PENDING' }),
      entry({ deviceId: 'recovering', status: 'RECOVERY_REQUIRED' }),
      entry({ deviceId: 'active', status: 'ACTIVE' }),
    ]),
  );
  assert.deepEqual(targets.map((t) => t.deviceId), ['active']);
});

test('returns only the fields a wrapping step needs -- deviceId, dekKeyId, dekPublicKey -- never the DSK', () => {
  const [target] = deviceKeysToWrapFdekFor(epoch([entry()]));
  assert.deepEqual(Object.keys(target).sort(), ['dekKeyId', 'dekPublicKey', 'deviceId']);
});

test('an epoch with no ACTIVE entries returns an empty wrap target list', () => {
  const targets = deviceKeysToWrapFdekFor(epoch([entry({ status: 'REVOKED' })]));
  assert.deepEqual(targets, []);
});
