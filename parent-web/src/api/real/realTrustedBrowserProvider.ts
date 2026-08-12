// Real (non-fixture) TrustedBrowserProvider. The parts that are genuinely
// local to this browser -- service-authentication bookkeeping and endpoint
// key generation -- are real WebCrypto operations, not simulated. The parts
// that require a remote authority to actually confirm (parent approval of a
// pairing request, a signed epoch bump, a signed revoke) cannot be
// honestly performed by this browser alone: no backend relay exists yet in
// this repository slice (see KNOWN_BACKEND_INTEGRATION_ACTION in
// ../client.ts) and even once one exists, granting TRUSTED status is
// exactly the kind of decision the DevTrustedBrowserProvider's
// `simulate*` methods short-circuit for demo purposes -- a real
// implementation must never do that. Those methods therefore throw a clear
// PairingBackendUnavailableError here instead of fabricating trust.
import { canTransition } from '../../domain/trustedBrowser';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot, TrustedBrowserState } from '../../domain/trustedBrowser';
import { generateEndpointSigningKey, clearEndpointKey } from '../../security/trustedEndpointKeyStore';
import { ServiceUnavailableError } from '../unavailable';

function initialSnapshot(): TrustedBrowserSnapshot {
  return {
    state: 'BROWSER_NOT_TRUSTED',
    serviceAuthenticated: false,
    browserEndpointId: null,
    trustSetEpoch: null,
    acceptedMinEpoch: null,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
  };
}

/**
 * Real, WebCrypto-backed TrustedBrowserProvider. State is held in memory
 * per instance (module-scope singleton is constructed once by
 * ../client.ts), consistent with never persisting endpoint trust state in
 * Web Storage across reloads -- see ../../security/trustedEndpointKeyStore.ts.
 */
export class RealTrustedBrowserProvider implements TrustedBrowserProvider {
  private snapshot: TrustedBrowserSnapshot = initialSnapshot();

  private move(to: TrustedBrowserState, patch: Partial<TrustedBrowserSnapshot> = {}): TrustedBrowserSnapshot {
    if (!canTransition(this.snapshot.state, to)) {
      throw new Error(`Illegal trusted-browser transition ${this.snapshot.state} -> ${to}`);
    }
    this.snapshot = { ...this.snapshot, state: to, ...patch };
    return this.snapshot;
  }

  async getSnapshot(): Promise<TrustedBrowserSnapshot> {
    return this.snapshot;
  }

  /** Genuinely local: records that the account-level (service) session is authenticated. This is NOT family decryption authority -- see docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 3.2/3.3 and ../../domain/trustedBrowser.ts's header comment. */
  async beginServiceAuthentication(): Promise<TrustedBrowserSnapshot> {
    this.snapshot = { ...this.snapshot, serviceAuthenticated: true };
    return this.move('PAIRING_REQUIRED');
  }

  /**
   * Real WebCrypto key generation happens here: a non-extractable ECDSA
   * P-256 keypair is generated for this endpoint and its public-key
   * fingerprint is recorded. This only reaches PAIRING_PENDING -- moving to
   * TRUSTED additionally requires a remote party (the family owner, via the
   * not-yet-built backend relay) to actually approve it, which this method
   * does not and cannot do by itself.
   */
  async requestPairing(): Promise<TrustedBrowserSnapshot> {
    const { fingerprint } = await generateEndpointSigningKey();
    const browserEndpointId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `endpoint-${Date.now()}`;
    return this.move('PAIRING_PENDING', {
      pairingRequestedAtUtc: new Date().toISOString(),
      browserEndpointId,
      lastFingerprint: fingerprint,
    });
  }

  async simulateParentApproval(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateParentApproval -- real parent-approval confirmation requires the backend relay and a signed Family Trust Set, neither of which exist in this repository slice yet; a real implementation must never fabricate TRUSTED status locally',
    );
  }

  async simulateEpochGoneStale(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateEpochGoneStale -- real epoch transitions are driven by a signed Family Trust Set from the backend relay, not fabricated locally',
    );
  }

  async simulateRevoke(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateRevoke -- a real revoke must be driven by a signed Family Trust Set from the backend relay, not fabricated locally',
    );
  }

  async reset(): Promise<TrustedBrowserSnapshot> {
    clearEndpointKey();
    this.snapshot = initialSnapshot();
    return this.snapshot;
  }
}
