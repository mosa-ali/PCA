import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFamilyTrustSetEpoch } from '../../dist/familytrustset/parse.js';

function rawEntry(overrides = {}) {
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

function rawEpoch(overrides = {}) {
  return {
    familyId: 'family-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [rawEntry()],
    issuedAt: '2026-01-01T00:00:00.000Z',
    supersedesEpoch: null,
    signature: 'sig-1',
    ...overrides,
  };
}

test('parseFamilyTrustSetEpoch accepts a well-formed epoch and converts wire types', () => {
  const parsed = parseFamilyTrustSetEpoch(rawEpoch());
  assert.ok(parsed);
  assert.ok(parsed.issuedAt instanceof Date);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].role, 'OWNER');
});

test('parseFamilyTrustSetEpoch rejects non-object input', () => {
  assert.equal(parseFamilyTrustSetEpoch(null), null);
  assert.equal(parseFamilyTrustSetEpoch('nope'), null);
  assert.equal(parseFamilyTrustSetEpoch([1, 2]), null);
});

test('parseFamilyTrustSetEpoch rejects an empty entries array', () => {
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ entries: [] })), null);
});

test('parseFamilyTrustSetEpoch rejects an oversized entries array', () => {
  const entries = Array.from({ length: 65 }, (_, i) => rawEntry({ deviceId: `device-${i}`, role: 'CHILD' }));
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ entries })), null);
});

test('parseFamilyTrustSetEpoch rejects an unknown role or status', () => {
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ entries: [rawEntry({ role: 'SUPERADMIN' })] })), null);
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ entries: [rawEntry({ status: 'PENDING' })] })), null);
});

test('parseFamilyTrustSetEpoch rejects an entry whose DSK equals its DEK', () => {
  const entries = [rawEntry({ dskPublicKey: 'same-key', dekPublicKey: 'same-key' })];
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ entries })), null);
});

test('parseFamilyTrustSetEpoch rejects a non-canonical ISO timestamp', () => {
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ issuedAt: '2026-01-01' })), null);
});

test('parseFamilyTrustSetEpoch rejects trustSetEpoch below the minimum', () => {
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ trustSetEpoch: 0 })), null);
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ trustSetEpoch: 1.5 })), null);
});

test('parseFamilyTrustSetEpoch accepts supersedesEpoch: null (genesis) and rejects a malformed non-null value', () => {
  assert.ok(parseFamilyTrustSetEpoch(rawEpoch({ supersedesEpoch: null })));
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ supersedesEpoch: -1 })), null);
});

test('parseFamilyTrustSetEpoch rejects an oversized or empty opaque id', () => {
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ familyId: '' })), null);
  assert.equal(parseFamilyTrustSetEpoch(rawEpoch({ familyId: 'x'.repeat(200) })), null);
});
