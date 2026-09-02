import { computeSyncConnectionState } from '../familysync/connectionState.js';
import type { SyncConnectionState } from '../familysync/types.js';

interface DeviceHeartbeat {
  isSyncing: boolean;
  lastSuccessfulSyncAtUtc: Date | null;
}

/**
 * Process-local, best-effort view of "when did this device last converge
 * with the relay" -- used only to answer the status route with an honest
 * connection state (doc 40 Section 2), never as an authority the device
 * itself relies on. The device's own local computation (Android's
 * SyncConnectionStateCalculator, mirroring computeSyncConnectionState) is
 * always the one that actually gates local behavior; this is a courtesy
 * server-side view (e.g. for a parent dashboard).
 */
export class DeviceSyncStatusTracker {
  private readonly byDevice = new Map<string, DeviceHeartbeat>();

  markSyncStart(deviceId: string): void {
    const existing = this.byDevice.get(deviceId);
    this.byDevice.set(deviceId, { isSyncing: true, lastSuccessfulSyncAtUtc: existing?.lastSuccessfulSyncAtUtc ?? null });
  }

  markSyncSuccess(deviceId: string, atUtc: Date): void {
    this.byDevice.set(deviceId, { isSyncing: false, lastSuccessfulSyncAtUtc: atUtc });
  }

  markSyncEnd(deviceId: string): void {
    const existing = this.byDevice.get(deviceId);
    this.byDevice.set(deviceId, { isSyncing: false, lastSuccessfulSyncAtUtc: existing?.lastSuccessfulSyncAtUtc ?? null });
  }

  computeState(deviceId: string, hasPendingLocalWork: boolean, nowUtc: Date): SyncConnectionState {
    const heartbeat = this.byDevice.get(deviceId) ?? { isSyncing: false, lastSuccessfulSyncAtUtc: null };
    // A device that can reach this HTTP route at all is, by construction,
    // transport-connected right now -- this endpoint is itself the
    // transport-connectivity signal.
    //
    // KNOWN LIMITATION for parent-facing callers (parentRuntimeSyncRoutes.ts):
    // when a PARENT asks about a device (rather than the device asking about
    // itself), "isTransportConnected: true" is still hardcoded here, so
    // computeState can never answer OFFLINE for a parent caller -- only
    // SYNCING/SYNC_PENDING/STALE/LIVE. This tracker has no separate
    // "last-heartbeat" signal to derive a genuine parent-observable transport
    // state from, so a parent-facing caller gets the same best-effort,
    // never-authoritative view this class's own header already describes,
    // with STALE as the honest fallback for "not receiving recent heartbeats"
    // rather than a fabricated OFFLINE this tracker cannot actually prove.
    return computeSyncConnectionState({
      isTransportConnected: true,
      isSyncing: heartbeat.isSyncing,
      hasPendingLocalWork,
      lastSuccessfulSyncAtUtc: heartbeat.lastSuccessfulSyncAtUtc,
      nowUtc,
    });
  }

  /**
   * Exposes the same last-successful-sync bookkeeping computeState already
   * folds into its connection-state derivation, as its own value -- for a
   * parent-facing caller (parentRuntimeSyncRoutes.ts) that needs the raw
   * timestamp, not just the derived state. Returns null when this
   * process-local tracker has never recorded a successful sync for this
   * device (including after a process restart -- see this class's own
   * header comment on why that is honest, not a bug).
   */
  getLastSuccessfulSync(deviceId: string): Date | null {
    return this.byDevice.get(deviceId)?.lastSuccessfulSyncAtUtc ?? null;
  }
}
