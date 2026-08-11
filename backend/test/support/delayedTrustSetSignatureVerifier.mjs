import { signTestOnlyEpoch } from './testOnlyTrustSetSignatureVerifier.mjs';

// TEST-ONLY. Wraps the deterministic test-only verifier with a forced
// microtask yield, so two concurrent FamilyTrustSetRecoveryEngine calls
// both reach their `await verifier.verify(...)` point (and therefore
// both read a pre-write snapshot of the store) before either resumes to
// claim the recovery-transaction ledger or write the store -- exactly
// the interleaving needed to exercise the CONCURRENT_EPOCH_CHANGED /
// RECOVERY_TRANSACTION_ALREADY_USED races deterministically, without
// relying on real OS thread timing.
export function createDelayedTestOnlyTrustSetSignatureVerifier() {
  return {
    async verify(publicKey, canonicalBytes, signature) {
      await Promise.resolve();
      await Promise.resolve();
      return signature === signTestOnlyEpoch(publicKey, canonicalBytes);
    },
  };
}
