import assert from 'node:assert/strict';
import test from 'node:test';
import { createTombstone, isTombstoneExpired, pruneExpiredTombstones, isCoveredByTombstone } from '../../dist/retention/tombstone.js';

test('a tombstone covers a late-arriving replica of the same record, preventing resurrection', () => {
  const tombstone = createTombstone('WEB_VISIT', 'r1', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(isCoveredByTombstone([tombstone], 'WEB_VISIT', 'r1'), true);
  assert.equal(isCoveredByTombstone([tombstone], 'WEB_VISIT', 'r2'), false);
  assert.equal(isCoveredByTombstone([tombstone], 'USAGE_SESSION', 'r1'), false);
});

test('a tombstone expires after its bounded lifetime (default 14 days)', () => {
  const tombstone = createTombstone('WEB_VISIT', 'r1', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(isTombstoneExpired(tombstone, new Date('2026-01-10T00:00:00.000Z')), false);
  assert.equal(isTombstoneExpired(tombstone, new Date('2026-01-16T00:00:00.000Z')), true);
});

test('pruneExpiredTombstones removes only the expired ones, leaving live tombstones untouched', () => {
  const tombstones = [
    createTombstone('WEB_VISIT', 'old', new Date('2026-01-01T00:00:00.000Z')),
    createTombstone('WEB_VISIT', 'recent', new Date('2026-01-14T00:00:00.000Z')),
  ];
  const pruned = pruneExpiredTombstones(tombstones, new Date('2026-01-16T00:00:00.000Z'));
  assert.deepEqual(pruned.map((t) => t.id), ['recent']);
});

test('a tombstone carries no content fields -- only entityClass, id, deletedAtUtc', () => {
  const tombstone = createTombstone('WEB_VISIT', 'r1', new Date('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(Object.keys(tombstone).sort(), ['deletedAtUtc', 'entityClass', 'id']);
});
