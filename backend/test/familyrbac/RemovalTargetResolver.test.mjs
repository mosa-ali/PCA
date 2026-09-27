import assert from 'node:assert/strict';
import test from 'node:test';
import { RemovalTargetResolver } from '../../dist/familyrbac/RemovalTargetResolver.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const FAMILY = 'family-removal-1';
const DEVICE = 'device-removal-1';
const CHILD = 'child-removal-1';
const FRESH_REPORT = {
  familyId: FAMILY,
  deviceId: DEVICE,
  protectionLevel: 'PROTECTED',
  updatedAt: new Date(NOW.getTime() - 60_000),
};

function makeResolver({ binding = { outcome: 'BOUND', childProfileId: CHILD }, membership = 'MEMBER', report = FRESH_REPORT, now = NOW, maxStalenessMs } = {}) {
  return new RemovalTargetResolver(
    {
      bindings: { resolveBinding: async () => binding },
      memberships: { resolveMembership: async () => membership },
      protectionStatuses: { findForDevice: async () => report },
    },
    { now: () => now, ...(maxStalenessMs === undefined ? {} : { maxStalenessMs }) },
  );
}

test('resolves only one active family child with a fresh protective device self-report', async () => {
  const result = await makeResolver().resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, {
    outcome: 'RESOLVED',
    familyId: FAMILY,
    deviceId: DEVICE,
    childProfileId: CHILD,
    protectionLevel: 'PROTECTED',
    reportedAt: FRESH_REPORT.updatedAt,
  });
});

test('missing device fails closed', async () => {
  const result = await makeResolver({ binding: { outcome: 'DEVICE_NOT_FOUND' } }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, { outcome: 'DEVICE_NOT_FOUND' });
});

test('inactive device fails closed', async () => {
  const result = await makeResolver({ binding: { outcome: 'DEVICE_INACTIVE' } }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, { outcome: 'DEVICE_INACTIVE' });
});

test('missing or null invitation child binding fails closed as UNBOUND', async () => {
  const result = await makeResolver({ binding: { outcome: 'UNBOUND' } }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, { outcome: 'UNBOUND' });
});

test('multiple distinct child bindings fail closed as AMBIGUOUS', async () => {
  const result = await makeResolver({ binding: { outcome: 'AMBIGUOUS' } }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, { outcome: 'AMBIGUOUS' });
});

test('child membership absence or cross-family membership fails closed as UNBOUND', async () => {
  const result = await makeResolver({ membership: 'NOT_MEMBER_OR_NOT_FOUND' }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(result, { outcome: 'UNBOUND' });
});

test('missing or mismatched protection status fails closed', async () => {
  const missing = await makeResolver({ report: null }).resolveForRemoval(FAMILY, DEVICE);
  const mismatched = await makeResolver({ report: { ...FRESH_REPORT, familyId: 'family-other' } }).resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(missing, { outcome: 'STATUS_UNAVAILABLE' });
  assert.deepEqual(mismatched, { outcome: 'STATUS_UNAVAILABLE' });
});

test('stale and future-dated status reports fail closed', async () => {
  const stale = await makeResolver({ report: { ...FRESH_REPORT, updatedAt: new Date(NOW.getTime() - 86_400_001) } })
    .resolveForRemoval(FAMILY, DEVICE);
  const future = await makeResolver({ report: { ...FRESH_REPORT, updatedAt: new Date(NOW.getTime() + 1) } })
    .resolveForRemoval(FAMILY, DEVICE);
  assert.deepEqual(stale, { outcome: 'STALE' });
  assert.deepEqual(future, { outcome: 'STALE' });
});

test('non-protective device self-reports fail closed', async () => {
  for (const protectionLevel of ['STANDARD', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED']) {
    const result = await makeResolver({ report: { ...FRESH_REPORT, protectionLevel } }).resolveForRemoval(FAMILY, DEVICE);
    assert.deepEqual(result, { outcome: 'NOT_PROTECTIVE' });
  }
});

test('DEGRADED remains protective while preserving the reported level', async () => {
  const result = await makeResolver({ report: { ...FRESH_REPORT, protectionLevel: 'DEGRADED' } })
    .resolveForRemoval(FAMILY, DEVICE);
  assert.equal(result.outcome, 'RESOLVED');
  if (result.outcome === 'RESOLVED') assert.equal(result.protectionLevel, 'DEGRADED');
});
