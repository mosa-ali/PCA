import { compareVersions } from '../release/version.js';

export type ReleaseIntegrityVerdict = 'OK' | 'DIGEST_MISMATCH' | 'BELOW_MINIMUM_SUPPORTED_VERSION';

export interface InstalledArtifact {
  artifactDigest: string; // canonical lowercase 64-char SHA-256 hex, same shape as src/release/types.ts's ReleaseRecord.artifactDigest
  version: string;
}

/**
 * Doc 21 Section 3's package-integrity response: "App signature/package/
 * resource integrity mismatch or unsupported build | Store/platform
 * identity and release metadata verification | Refuse untrusted update/
 * content; retain installed last-valid policy; require supported
 * reinstall/update." This function performs the comparison half of that
 * check -- given the installed artifact's digest/version and the set of
 * digests this device currently trusts (populated from src/release's
 * ReleaseService, never re-fetched or re-verified here), decide whether
 * the install is trustworthy.
 *
 * Deliberately compares against a SET of trusted digests, not a single
 * "current" release: a device that legitimately has not yet updated to
 * the newest published release still has a digest that was ONCE
 * published and trusted -- comparing only against "current" would
 * false-positive on ordinary update lag. `trustedDigests` should be
 * populated by the caller from every release this device is willing to
 * run (typically the currently-published one plus any it has not yet
 * been forced to retire from, per `minimumSupportedVersion`), not from
 * this module, which owns no release repository access.
 *
 * This function does NOT verify `signedMetadata`/the app's platform
 * signature itself -- that is Section 4's "Store/platform identity...
 * verification" half, owned by the platform layer (doc 06/07) and,
 * where cryptographic, gated the same as everything else behind
 * CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW.
 */
export function evaluateReleaseIntegrity(
  installed: InstalledArtifact,
  trustedDigests: ReadonlySet<string>,
  minimumSupportedVersion: string | null,
): ReleaseIntegrityVerdict {
  if (!trustedDigests.has(installed.artifactDigest)) {
    return 'DIGEST_MISMATCH';
  }
  if (minimumSupportedVersion !== null && compareVersions(installed.version, minimumSupportedVersion) < 0) {
    return 'BELOW_MINIMUM_SUPPORTED_VERSION';
  }
  return 'OK';
}
