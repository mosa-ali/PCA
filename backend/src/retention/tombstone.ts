import type { RetentionEntityClass } from './types.js';

/** doc 11 Section 5.4: ID + deletion timestamp ONLY -- no content fields, ever. Adding a field here beyond these three would turn a tombstone into a second, lower-fidelity copy of the deleted data's existence. */
export interface Tombstone {
  entityClass: RetentionEntityClass;
  id: string;
  deletedAtUtc: Date;
}

/** doc 11 Section 5.4 recommended default: no longer than the shortest supported retention window. */
export const DEFAULT_TOMBSTONE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function createTombstone(entityClass: RetentionEntityClass, id: string, deletedAtUtc: Date): Tombstone {
  return { entityClass, id, deletedAtUtc };
}

export function isTombstoneExpired(tombstone: Tombstone, nowUtc: Date, lifetimeMs: number = DEFAULT_TOMBSTONE_LIFETIME_MS): boolean {
  return nowUtc.getTime() >= tombstone.deletedAtUtc.getTime() + lifetimeMs;
}

/** Pure filter: the caller's tombstone store already had these; returns the still-live subset (never mutates or resurrects the input). */
export function pruneExpiredTombstones(tombstones: Tombstone[], nowUtc: Date, lifetimeMs: number = DEFAULT_TOMBSTONE_LIFETIME_MS): Tombstone[] {
  return tombstones.filter((tombstone) => !isTombstoneExpired(tombstone, nowUtc, lifetimeMs));
}

/** doc 11 Section 5 step 5's primary defense: a late-arriving sync replica whose ID matches a live tombstone must never resurrect it. */
export function isCoveredByTombstone(tombstones: Tombstone[], entityClass: RetentionEntityClass, id: string): boolean {
  return tombstones.some((tombstone) => tombstone.entityClass === entityClass && tombstone.id === id);
}
