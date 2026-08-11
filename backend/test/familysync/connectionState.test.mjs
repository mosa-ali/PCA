import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSyncConnectionState } from '../../dist/familysync/connectionState.js';

const NOW = new Date('2026-01-07T12:00:00.000Z');

function input(overrides = {}) {
  return {
    isTransportConnected: true,
    isSyncing: false,
    hasPendingLocalWork: false,
    lastSuccessfulSyncAtUtc: NOW,
    nowUtc: NOW,
    ...overrides,
  };
}

test('no transport connection is OFFLINE regardless of anything else', () => {
  assert.equal(computeSyncConnectionState(input({ isTransportConnected: false, isSyncing: true })), 'OFFLINE');
});

test('actively draining is SYNCING', () => {
  assert.equal(computeSyncConnectionState(input({ isSyncing: true })), 'SYNCING');
});

test('connected, recently synced, nothing pending is LIVE', () => {
  assert.equal(computeSyncConnectionState(input()), 'LIVE');
});

test('connected, recently synced, but local work still pending is SYNC_PENDING, not LIVE', () => {
  assert.equal(computeSyncConnectionState(input({ hasPendingLocalWork: true })), 'SYNC_PENDING');
});

test('never successfully synced with pending work is SYNC_PENDING', () => {
  assert.equal(computeSyncConnectionState(input({ lastSuccessfulSyncAtUtc: null, hasPendingLocalWork: true })), 'SYNC_PENDING');
});

test('never successfully synced with no pending work is STALE, not LIVE', () => {
  assert.equal(computeSyncConnectionState(input({ lastSuccessfulSyncAtUtc: null })), 'STALE');
});

test('last sync older than the stale threshold is STALE even though transport is connected', () => {
  const staleSync = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
  assert.equal(computeSyncConnectionState(input({ lastSuccessfulSyncAtUtc: staleSync })), 'STALE');
});

test('connected transport alone never implies successful policy application (LIVE requires a recent successful sync too)', () => {
  const result = computeSyncConnectionState(
    input({ lastSuccessfulSyncAtUtc: new Date(NOW.getTime() - 999 * 24 * 60 * 60 * 1000) }),
  );
  assert.notEqual(result, 'LIVE');
});
