// Trusted browser endpoint flow -- models the fact that a successful
// "service login" (account authentication) does NOT by itself grant family
// decryption authority (docs/architecture/09_SECURITY_PRIVACY_E2EE.md
// Section 3.2/3.3, docs/architecture/18_PARENT_CONTROL_PANEL_RBAC.md).
// Those are two separate trust boundaries: (1) "am I logged into the PCA
// account service" and (2) "does this specific browser endpoint hold a
// trust-set-authorized device key that can decrypt/sign for this family".
//
// The real cryptography (DSK/DEK generation, fingerprint confirmation,
// signed FTS epochs) is out of scope here and is external/human-reviewed
// later -- see docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 3.1.
// This module only defines the client-visible state machine and an
// interface (TrustedBrowserProvider) a real implementation can fulfil.

export type TrustedBrowserState =
  | 'BROWSER_NOT_TRUSTED'
  | 'PAIRING_REQUIRED'
  | 'PAIRING_PENDING'
  | 'TRUSTED'
  | 'EPOCH_STALE'
  | 'REVOKED';

export interface TrustedBrowserSnapshot {
  state: TrustedBrowserState;
  serviceAuthenticated: boolean;
  browserEndpointId: string | null;
  trustSetEpoch: number | null;
  acceptedMinEpoch: number | null;
  pairingRequestedAtUtc: string | null;
  lastFingerprint: string | null;
}

const ALLOWED_TRANSITIONS: Record<TrustedBrowserState, TrustedBrowserState[]> = {
  BROWSER_NOT_TRUSTED: ['PAIRING_REQUIRED'],
  PAIRING_REQUIRED: ['PAIRING_PENDING', 'BROWSER_NOT_TRUSTED'],
  PAIRING_PENDING: ['TRUSTED', 'BROWSER_NOT_TRUSTED', 'PAIRING_REQUIRED'],
  TRUSTED: ['EPOCH_STALE', 'REVOKED'],
  EPOCH_STALE: ['TRUSTED', 'REVOKED'],
  REVOKED: ['PAIRING_REQUIRED'],
};

export function canTransition(from: TrustedBrowserState, to: TrustedBrowserState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * TrustedBrowserProvider -- interface a real crypto/pairing implementation
 * fulfils. The dev stub (src/api/dev/devTrustedBrowserProvider.ts) simulates
 * state transitions without any real key material.
 */
export interface TrustedBrowserProvider {
  getSnapshot(): Promise<TrustedBrowserSnapshot>;
  beginServiceAuthentication(): Promise<TrustedBrowserSnapshot>;
  requestPairing(): Promise<TrustedBrowserSnapshot>;
  simulateParentApproval(): Promise<TrustedBrowserSnapshot>;
  simulateEpochGoneStale(): Promise<TrustedBrowserSnapshot>;
  simulateRevoke(): Promise<TrustedBrowserSnapshot>;
  reset(): Promise<TrustedBrowserSnapshot>;
}
