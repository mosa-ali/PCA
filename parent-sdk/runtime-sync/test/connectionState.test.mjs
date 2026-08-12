import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSyncConnectionState } from '../dist/connectionState.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');

test('transport disconnected is always OFFLINE, regardless of any other input', () => {
  assert.equal(
    computeSyncConnectionState({ isTransportConnected: false, isSyncing: true, hasPendingLocalWork: true, lastSuccessfulSyncAtUtc: NOW, nowUtc: NOW }),
    'OFFLINE',
  );
});

test('transport connected but never synced is STALE, not LIVE -- connectivity alone is not enough', () => {
  assert.equal(
    computeSyncConnectionState({ isTransportConnected: true, isSyncing: false, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: null, nowUtc: NOW }),
    'STALE',
  );
});

test('a recent successful sync with no pending work is LIVE', () => {
  assert.equal(
    computeSyncConnectionState({
      isTransportConnected: true,
      isSyncing: false,
      hasPendingLocalWork: false,
      lastSuccessfulSyncAtUtc: new Date(NOW.getTime() - 1000),
      nowUtc: NOW,
    }),
    'LIVE',
  );
});

test('a recent successful sync WITH pending local work is SYNC_PENDING, not LIVE', () => {
  assert.equal(
    computeSyncConnectionState({
      isTransportConnected: true,
      isSyncing: false,
      hasPendingLocalWork: true,
      lastSuccessfulSyncAtUtc: new Date(NOW.getTime() - 1000),
      nowUtc: NOW,
    }),
    'SYNC_PENDING',
  );
});

test('a sync older than the stale threshold is STALE even with no pending work', () => {
  assert.equal(
    computeSyncConnectionState({
      isTransportConnected: true,
      isSyncing: false,
      hasPendingLocalWork: false,
      lastSuccessfulSyncAtUtc: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      nowUtc: NOW,
    }),
    'STALE',
  );
});

test('actively syncing takes priority over everything else while it runs', () => {
  assert.equal(
    computeSyncConnectionState({ isTransportConnected: true, isSyncing: true, hasPendingLocalWork: false, lastSuccessfulSyncAtUtc: NOW, nowUtc: NOW }),
    'SYNCING',
  );
});
