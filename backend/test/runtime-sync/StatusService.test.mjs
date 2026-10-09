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
