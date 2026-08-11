import type { SyncConnectionState } from './types.js';

export const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface ComputeConnectionStateInput {
  isTransportConnected: boolean;
  /** True while a reconnect drain (retrieve/verify/apply eligible pending Relay messages) is actively running. */
  isSyncing: boolean;
  hasPendingLocalWork: boolean;
  lastSuccessfulSyncAtUtc: Date | null;
  nowUtc: Date;
  staleThresholdMs?: number;
}

/**
 * Pure derivation of the device's synchronization connection state
 * (PCA-11 "reconnect/offline"). Deliberately does NOT equate "transport
 * connected" with "policy successfully applied" -- LIVE requires both a
 * connected transport AND a recent successful sync, never transport
 * status alone.
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
