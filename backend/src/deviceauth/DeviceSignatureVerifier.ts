/**
 * Verifies that `signature` is a valid signature over `message`, produced
 * by the private key corresponding to `publicKey`.
 *
 * NO concrete signature algorithm is selected or implemented anywhere
 * behind this interface. Production suite selection (e.g. Ed25519 vs.
 * ECDSA-P256, encoding, domain-separation prefix) is explicitly gated
 * behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW (doc 09 Section 3.1,
 * PCA-DEC-020) and must not be decided by this codebase unilaterally. This
 * interface exists purely so the rest of the device-authentication
 * protocol -- challenge issuance, single-use consumption, expiry, replay
 * protection -- can be built and tested now, with a reviewed concrete
 * verifier substituted later without changing DeviceAuthService or its
 * callers.
 *
 * `publicKey` is always the device's already-registered DSK (Device
 * Signing Key, doc 09 Section 3.1) -- a DEK must never be accepted here.
 */
export interface DeviceSignatureVerifier {
  verify(publicKey: string, message: string, signature: string): Promise<boolean>;
}
