import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClients } from '../api/client';

export type BrowserConnectivity = 'online' | 'offline';

export interface ReconnectSyncState {
  connectivity: BrowserConnectivity;
  /** True only while an actual reconnect sync pass is running (not on every online event). */
  syncing: boolean;
  lastSyncedAtUtc: string | null;
  /** Set once per completed reconnect pass; cleared on the next state change the caller acknowledges via dismiss(). */
  lastReconnectMessage: string | null;
  dismiss: () => void;
}

/**
 * Coordinates what happens when the browser regains connectivity:
 * re-authenticate the service session, then ask the runtime sync client for
 * its connection status, drain queued envelopes for this session's own
 * endpoint-independent bookkeeping, and refresh "last successful sync".
 *
 * Deliberately a single coordinated effect, not a UI flood: a reconnect
 * pass is deduped via `runningRef` (no overlapping passes), and only ever
 * produces one summary message per pass rather than one notice per
 * sub-step, so the UI never shows a stack of repeated toasts for a single
 * network blip.
 */
export function useReconnectSync(): ReconnectSyncState {
  const clients = getApiClients();
  const [connectivity, setConnectivity] = useState<BrowserConnectivity>(
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAtUtc, setLastSyncedAtUtc] = useState<string | null>(null);
  const [lastReconnectMessage, setLastReconnectMessage] = useState<string | null>(null);
  const runningRef = useRef(false);
  const wasOfflineRef = useRef(false);

  const runReconnectPass = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSyncing(true);
    try {
      // 1. Re-authenticate the service session (a long offline period may
      // have let the session lapse server-side).
      await clients.serviceAuth.getSession();

      // 2. Ask the sync layer for current connection + queued state.
      const status = await clients.runtimeSync.getConnectionStatus();
      if (status.state !== 'ONLINE') {
        // Relay itself still unreachable even though the browser thinks
        // it's online -- report honestly, do not claim a completed sync.
        setLastReconnectMessage('reconnect.relayUnreachable');
        return;
      }

      // 3. Refresh last-successful-sync bookkeeping (receipts are
      // processed per-device by the pages that own that device, e.g.
      // ChildOverview/Dashboard; this pass only refreshes the summary
      // timestamp so no page shows a stale "last synced" value).
      const lastSync = await clients.runtimeSync.getLastSuccessfulSync();
      setLastSyncedAtUtc(lastSync);
      setLastReconnectMessage('reconnect.completed');
    } catch {
      setLastReconnectMessage('reconnect.failed');
    } finally {
      setSyncing(false);
      runningRef.current = false;
    }
  }, [clients]);

  useEffect(() => {
    function handleOnline() {
      setConnectivity('online');
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        void runReconnectPass();
      }
    }
    function handleOffline() {
      wasOfflineRef.current = true;
      setConnectivity('offline');
      setLastReconnectMessage(null);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runReconnectPass]);

  const dismiss = useCallback(() => setLastReconnectMessage(null), []);

  return { connectivity, syncing, lastSyncedAtUtc, lastReconnectMessage, dismiss };
}
