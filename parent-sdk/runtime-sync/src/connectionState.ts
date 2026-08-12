import type { SyncConnectionState } from './types.js';

export const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface ComputeConnectionStateInput {
  isTransportConnected: boolean;
  isSyncing: boolean;
  hasPendingLocalWork: boolean;
  lastSuccessfulSyncAtUtc: Date | null;
  nowUtc: Date;
  staleThresholdMs?: number;
}

/**
 * Ported, not imported, from backend/src/familysync/connectionState.ts's
 * `computeSyncConnectionState` -- this SDK is a separate runtime/package
 * (browser-neutral, no dependency on the backend workspace), so the exact
 * same pure logic is duplicated here rather than shared. Both
 * implementations are independently tested against the same behavior
 * (doc 40 Section 2): LIVE requires both a connected transport AND a
 * recent successful sync, never transport status alone.
 */
export function computeSyncConnectionState(input: ComputeConnectionStateInput): SyncConnectionState {
  if (!input.isTransportConnected) return 'OFFLINE';
  if (input.isSyncing) return 'SYNCING';

  const staleThresholdMs = input.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  if (input.lastSuccessfulSyncAtUtc === null) {
    return input.hasPendingLocalWork ? 'SYNC_PENDING' : 'STALE';
  }
  const ageMs = input.nowUtc.getTime() - input.lastSuccessfulSyncAtUtc.getTime();
  if (ageMs < 0 || ageMs > staleThresholdMs) return 'STALE';
  return input.hasPendingLocalWork ? 'SYNC_PENDING' : 'LIVE';
}
