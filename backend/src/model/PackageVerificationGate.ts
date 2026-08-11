import { declaresProhibitedUse, isPlatformAndRuntimeCompatible, isStructurallyPlausibleMetadata } from './policy.js';
import type { ModelPackageSignatureVerifier, ModelSelfTestRunner } from './ModelPackageVerifier.js';
import type { ReleaseRecord } from '../release/types.js';
import type { DeviceRuntimeCapability, ModelPackageMetadata, PackageVerificationResult } from './types.js';

/**
 * doc 23 Section 3/PCA-AI-002 + lane brief Section 26: every one of these
 * checks must pass before a candidate package can reach VERIFIED. The
 * FIRST failing check short-circuits the rest -- this function never
 * mutates any lifecycle state itself (ModelLifecycleService owns that); it
 * is a pure(ish) decision given the injected verifier/self-test ports.
 */
export class PackageVerificationGate {
  private readonly signatureVerifier: ModelPackageSignatureVerifier;
  private readonly selfTestRunner: ModelSelfTestRunner;
  private readonly now: () => Date;

  constructor(signatureVerifier: ModelPackageSignatureVerifier, selfTestRunner: ModelSelfTestRunner, now: () => Date = () => new Date()) {
    this.signatureVerifier = signatureVerifier;
    this.selfTestRunner = selfTestRunner;
    this.now = now;
  }

  async verify(
    metadata: ModelPackageMetadata,
    release: ReleaseRecord,
    actualArtifactDigest: string,
    device: DeviceRuntimeCapability,
  ): Promise<PackageVerificationResult> {
    if (!isStructurallyPlausibleMetadata(metadata)) {
      return { outcome: 'FAILED', reason: 'INVALID_PROVENANCE_METADATA' };
    }
    if (declaresProhibitedUse(metadata)) {
      return { outcome: 'FAILED', reason: 'PROHIBITED_USE_CASE_DECLARATION' };
    }
    if (metadata.expiresAt.getTime() <= this.now().getTime()) {
      return { outcome: 'FAILED', reason: 'EXPIRED_PACKAGE' };
    }

    // UNSUPPORTED_FORMAT (the package itself declares no runnable format at all) is a distinct, more
    // specific failure than UNSUPPORTED_RUNTIME (the package declares formats, but none match this
    // device) -- checked first so a malformed/empty declaration is never misreported as a device gap.
    if (metadata.formatRuntimeCompatibility.length === 0) {
      return { outcome: 'FAILED', reason: 'UNSUPPORTED_FORMAT' };
    }

    const { platformOk, runtimeOk } = isPlatformAndRuntimeCompatible(metadata, device);
    if (!platformOk) return { outcome: 'FAILED', reason: 'WRONG_PLATFORM' };
    if (!runtimeOk) return { outcome: 'FAILED', reason: 'UNSUPPORTED_RUNTIME' };

    if (actualArtifactDigest !== release.artifactDigest) {
      return { outcome: 'FAILED', reason: 'WRONG_DIGEST' };
    }

    const signatureValid = await this.signatureVerifier.verifySignature(release);
    if (!signatureValid) return { outcome: 'FAILED', reason: 'BAD_SIGNATURE' };

    const selfTestPassed = await this.selfTestRunner.runSelfTest(metadata);
    if (!selfTestPassed) return { outcome: 'FAILED', reason: 'FAILED_SELF_TEST' };

    return { outcome: 'PASSED' };
  }
}
