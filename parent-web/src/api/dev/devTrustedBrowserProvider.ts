import type { TrustedBrowserProvider, TrustedBrowserSnapshot, TrustedBrowserState } from '../../domain/trustedBrowser';
import { canTransition } from '../../domain/trustedBrowser';

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

let snapshot: TrustedBrowserSnapshot = {
  state: 'BROWSER_NOT_TRUSTED',
  serviceAuthenticated: false,
  browserEndpointId: null,
  trustSetEpoch: null,
  acceptedMinEpoch: null,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
};

function move(to: TrustedBrowserState, patch: Partial<TrustedBrowserSnapshot> = {}): TrustedBrowserSnapshot {
  if (!canTransition(snapshot.state, to)) {
    throw new Error(`Illegal trusted-browser transition ${snapshot.state} -> ${to}`);
  }
  snapshot = { ...snapshot, state: to, ...patch };
  return snapshot;
}

/**
 * DEVELOPMENT_ONLY stub of TrustedBrowserProvider. No real cryptography --
 * the actual DSK/DEK generation, fingerprint confirmation and FTS signing
 * are external/human-reviewed later (docs/architecture/09_SECURITY_PRIVACY_E2EE.md).
 */
export class DevTrustedBrowserProvider implements TrustedBrowserProvider {
  async getSnapshot(): Promise<TrustedBrowserSnapshot> {
    await delay(50);
    return snapshot;
  }

  async beginServiceAuthentication(): Promise<TrustedBrowserSnapshot> {
    await delay();
    snapshot = { ...snapshot, serviceAuthenticated: true };
    return move('PAIRING_REQUIRED');
  }

  async requestPairing(): Promise<TrustedBrowserSnapshot> {
    await delay();
    return move('PAIRING_PENDING', {
      pairingRequestedAtUtc: new Date().toISOString(),
      browserEndpointId: `browser-${Date.now()}`,
      lastFingerprint: 'DEV-FPR-2F91-AB03',
    });
  }

  async simulateParentApproval(): Promise<TrustedBrowserSnapshot> {
    await delay(300);
    return move('TRUSTED', { trustSetEpoch: 4, acceptedMinEpoch: 4 });
  }

  async simulateEpochGoneStale(): Promise<TrustedBrowserSnapshot> {
    await delay();
    return move('EPOCH_STALE', { acceptedMinEpoch: (snapshot.acceptedMinEpoch ?? 4) });
  }

  async simulateRevoke(): Promise<TrustedBrowserSnapshot> {
    await delay();
    return move('REVOKED');
  }

  async reset(): Promise<TrustedBrowserSnapshot> {
    await delay(10);
    snapshot = {
      state: 'BROWSER_NOT_TRUSTED',
      serviceAuthenticated: false,
      browserEndpointId: null,
      trustSetEpoch: null,
      acceptedMinEpoch: null,
      pairingRequestedAtUtc: null,
      lastFingerprint: null,
    };
    return snapshot;
  }
}
