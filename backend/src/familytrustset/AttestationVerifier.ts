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
 *
 * WAVE 6B-R1 amendment (finding R1-02): a VERIFIED verdict must contractually
 * prove WHICH key was attested. The input now carries the expected DSK
 * identity (expectedDskKeyId / expectedDskPublicKey / expectedDskAlgorithm --
 * taken from the durable ceremony row, never from the caller), and the VERIFIED
 * verdict must return the attested key identity it validated
 * (attestedDskKeyId / attestedDskPublicKey / attestedDskAlgorithm). The
 * service independently requires attested == expected (== the proof/attempt
 * DSK, M1-bound) before any commit, so "a valid Android/iOS app/device" can
 * never stand in for "the exact bootstrap DSK".
 *
 * MUST NOT (implementation obligations for the 6C/6D verifiers, enforceable
 * by review, not by the service):
 *  - return the expected values without independently validating them against
 *    platform evidence (no blind echo). Where a platform cannot natively
 *    derive the dskKeyId label (it is a server-minted opaque id), the label
 *    may be returned ONLY conditioned on the attested PUBLIC KEY and
 *    ALGORITHM having been validated against the evidence;
 *  - return values parsed from evidence whose signature/chain was not verified;
 *  - present the statement-(A) bootstrap proof signature as platform
 *    attestation (it is already verified separately and adds no evidence);
 *  - treat the attestation certificate challenge as the ceremony nonce: the
 *    secure key and its attestation record are minted at enrollment, before
 *    any ceremony. Freshness binding is carried by the ceremony proof
 *    signature (challengeId/nonce), not by the attestation certificate.
 *
 * Emission conventions (must match the service's comparison exactly):
 *  - evidenceDigest = sha256 over the exact UTF-8 bytes of the evidence string
 *    (null evidence => null digest);
 *  - public keys use the repository's canonical SEC1 uncompressed, unpadded
 *    base64url form (the same form every strict P-256 verifier accepts).
 */

export type AttestationVerdict =
  | {
      status: 'VERIFIED';
      evidenceDigest: string | null;
      attestedDskKeyId: string;
      attestedDskPublicKey: string;
      attestedDskAlgorithm: string;
    }
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
  /** The exact DSK the ceremony is about to anchor (durable ceremony row; M1-bound to the enrollment attempt). */
  expectedDskKeyId: string;
  expectedDskPublicKey: string;
  expectedDskAlgorithm: string;
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
