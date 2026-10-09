import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceSyncStatusTracker } from '../../dist/runtime-sync/StatusService.js';

test('successful-sync freshness snapshots caller and returned Date values', () => {
  const tracker = new DeviceSyncStatusTracker();
  const acceptedAt = new Date('2026-10-08T23:00:00.000Z');
  const expectedTimestamp = acceptedAt.toISOString();

  tracker.markSyncSuccess('device-1', acceptedAt);
  acceptedAt.setTime(0);

  const projection = tracker.getLastSuccessfulSync('device-1');
  assert.equal(projection.toISOString(), expectedTimestamp);
  projection.setTime(0);

  assert.equal(tracker.getLastSuccessfulSync('device-1').toISOString(), expectedTimestamp);
  assert.equal(
    tracker.computeState('device-1', false, new Date('2026-10-09T00:00:00.000Z')),
    'LIVE',
    'caller-owned Date mutation must not turn a recent successful sync into stale state',
  );
});

test('overlapping reconnects remain SYNCING until every active request ends', () => {
  const tracker = new DeviceSyncStatusTracker();
  const deviceId = 'device-overlapping-reconnects';
  const now = new Date('2026-10-09T00:00:00.000Z');

  tracker.markSyncStart(deviceId);
  tracker.markSyncStart(deviceId);
  tracker.markSyncEnd(deviceId);
  assert.equal(
    tracker.computeState(deviceId, false, now),
    'SYNCING',
    'one completed reconnect must not clear another request that is still in flight',
  );

  const acceptedAt = new Date('2026-10-08T23:59:00.000Z');
  tracker.markSyncSuccess(deviceId, acceptedAt);
  tracker.markSyncEnd(deviceId);
  assert.equal(tracker.computeState(deviceId, false, now), 'LIVE');
  assert.equal(tracker.getLastSuccessfulSync(deviceId).toISOString(), acceptedAt.toISOString());
});
