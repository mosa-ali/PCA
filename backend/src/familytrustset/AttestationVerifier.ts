/**
 * Wave 6B attestation boundary (owner ruling 11) for the first-device trust
 * root bootstrap ceremony.
 *
 * This module defines the backend CONTRACT only. Production composition MUST
 * wire the fail-closed verifier below; platform attestation implementations
 * for Android and iOS arrive in waves 6C/6D behind this same interface.
 * There is deliberately NO permissive production verifier, no test verifier
 * exported for production use, and no environment bypass: until a policy-
 * approved verifier is wired, every first-device ceremony ends as
 * ATTESTATION_UNAVAILABLE and no family root can be established in
 * production. Tests inject their own explicit verifier through the service
 * dependency; that injection must never appear in main.ts (pinned by
 * test/tooling/ftsProductionWiring.test.mjs).
 */

export type AttestationVerdict =
  | { status: 'VERIFIED'; evidenceDigest: string | null }
  | { status: 'UNAVAILABLE' }
  | { status: 'REJECTED'; reason: string };

export interface FirstDeviceAttestationInput {
  familyId: string;
  deviceId: string;
  ceremonyId: string;
  challengeId: string;
  nonce: string;
  /** Platform recorded by the original enrollment bootstrap attempt. */
  platform: 'ANDROID' | 'IOS';
  /** Opaque, bounded attestation evidence supplied by the device (or null). */
  attestationEvidence: string | null;
  now: Date;
}

export interface AttestationVerifier {
  verifyFirstDeviceAttestation(input: FirstDeviceAttestationInput): Promise<AttestationVerdict>;
}

/**
 * The production default. No policy-approved attestation verifier has been
 * wired yet (Android/iOS implementations are 6C/6D work), so every lookup
 * resolves UNAVAILABLE and the ceremony service rejects before the atomic
 * commit. This mirrors the repository's existing fail-closed verifier
 * posture (RejectingDeviceSignatureVerifier / RejectingEnvelopeSignatureVerifier).
 */
export class FailClosedAttestationVerifier implements AttestationVerifier {
  async verifyFirstDeviceAttestation(): Promise<AttestationVerdict> {
    return { status: 'UNAVAILABLE' };
  }
}
