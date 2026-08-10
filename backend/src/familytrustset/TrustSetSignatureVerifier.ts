/**
 * Verifies that `signature` is a valid signature, produced by the private
 * key corresponding to `publicKey`, over `canonicalBytes` (the
 * deterministic canonical representation of an epoch's signable fields --
 * see canonicalize.ts).
 *
 * NO concrete signature algorithm is selected or implemented anywhere
 * behind this interface, for the same reason as
 * src/deviceauth/DeviceSignatureVerifier.ts and
 * src/familyenvelope/EnvelopeSignatureVerifier.ts: production suite
 * selection is gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW
 * (doc 09 Section 3.1/3.6, PCA-DEC-020). `publicKey` is always a DSK
 * (Device Signing Key) -- a DEK must never be accepted here.
 */
export interface TrustSetSignatureVerifier {
  verify(publicKey: string, canonicalBytes: string, signature: string): Promise<boolean>;
}
