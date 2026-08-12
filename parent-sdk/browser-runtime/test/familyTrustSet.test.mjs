import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFamilyTrustSet } from '../dist/familyTrustSet.js';

function baseFts(overrides = {}) {
  return {
    familyId: 'family-1',
    epoch: 5,
    issuedAtUtc: '2026-08-01T00:00:00.000Z',
    expiresAtUtc: '2026-08-15T00:00:00.000Z',
    revokedEndpointIds: [],
    authorizedEndpointIds: ['endpoint-a'],
    ...overrides,
  };
}

const NOW = new Date('2026-08-12T00:00:00.000Z');

test('current, authorized, non-expired FTS verifies ok', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts(),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CURRENT');
});

test('rejects a stale (older-epoch) FTS', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts({ epoch: 3 }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STALE_EPOCH');
});

test('rejects an expired FTS even if epoch is fresh', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts({ expiresAtUtc: '2026-08-01T00:00:00.000Z' }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXPIRED');
});

test('rejects when the local endpoint is listed as revoked', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts({ revokedEndpointIds: ['endpoint-a'] }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENDPOINT_REVOKED');
});

test('rejects when the local endpoint is not in the authorized list', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts({ authorizedEndpointIds: ['endpoint-b'] }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENDPOINT_NOT_AUTHORIZED');
});

test('null acceptedMinEpoch (first-ever FTS) does not trigger staleness', () => {
  const result = verifyFamilyTrustSet({
    fts: baseFts({ epoch: 1 }),
    acceptedMinEpoch: null,
    localEndpointId: 'endpoint-a',
    nowUtc: NOW,
  });
  assert.equal(result.ok, true);
});
