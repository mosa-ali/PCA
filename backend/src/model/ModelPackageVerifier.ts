import type { ReleaseRecord } from '../release/types.js';
import type { ModelPackageMetadata } from './types.js';

/**
 * Crypto boundary (lane brief Section 27): this module NEVER creates
 * cryptographic primitives. Signature/digest verification of the
 * underlying release/ ReleaseRecord is delegated entirely to an injected
 * verifier -- mirroring web/SignedRulePackageConsumer's
 * SignedRulePackageVerifier port. Production verification wiring is
 * PENDING_HUMAN_SECURITY_REVIEW; only a deterministic test double exists
 * in this codebase today.
 */
export interface ModelPackageSignatureVerifier {
  /** Verifies signedMetadata/signingKeyId trust for the release ONLY -- digest comparison against the actually-downloaded artifact is a separate, non-cryptographic check PackageVerificationGate performs itself (see its `actualArtifactDigest` parameter), so the two failure modes stay independently testable. */
  verifySignature(release: ReleaseRecord): Promise<boolean>;
}

/** Runs the model's own self-test (a runtime smoke-check, e.g. inference on a fixed known-input/known-output pair) without this module ever executing model code itself. */
export interface ModelSelfTestRunner {
  runSelfTest(metadata: ModelPackageMetadata): Promise<boolean>;
}
