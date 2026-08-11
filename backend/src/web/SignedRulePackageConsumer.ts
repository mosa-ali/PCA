import { canonicalizeDomain } from './canonicalize.js';
import { isPlausiblePackageVersion, isPlausibleSignature, MAX_RULES_PER_PACKAGE } from './policy.js';
import type { SignedRulePackage, WebRule } from './types.js';
import type { WebRuleRepository } from './WebRuleStore.js';

/**
 * Injected verifier for a package's detached signature -- this module
 * performs no signature MATH itself (mirrors EnvelopeSignatureVerifier's
 * separation in familyenvelope/), only the accept/reject/rollback
 * decision around whatever a caller-supplied verifier reports.
 */
export interface SignedRulePackageVerifier {
  verify(pkg: SignedRulePackage): Promise<boolean>;
}

export type ApplyRulePackageOutcome =
  | { status: 'APPLIED'; ruleCount: number }
  | { status: 'REJECTED_SIGNATURE'; reason: 'SIGNATURE_INVALID' }
  | { status: 'REJECTED_EXPIRED'; reason: 'PACKAGE_EXPIRED' }
  | { status: 'REJECTED_STALE'; reason: 'NOT_NEWER_THAN_ACTIVE'; activeVersion: string }
  | { status: 'REJECTED_MALFORMED'; reason: 'MALFORMED_PACKAGE' };

/**
 * doc 14: "Failed signature verification leaves the last known valid
 * package active, raises a local integrity alert, and never replaces
 * rules with an unverified package." This class tracks only which
 * package version is currently active (for staleness/rollback
 * comparisons) -- rejection never mutates the WebRuleRepository, so the
 * previously-applied SECURITY_DENYLIST rules remain untouched on any
 * rejection path.
 */
export class SignedRulePackageConsumer {
  private readonly repository: WebRuleRepository;
  private readonly verifier: SignedRulePackageVerifier;
  private readonly now: () => Date;
  private activeVersion: string | null = null;

  constructor(repository: WebRuleRepository, verifier: SignedRulePackageVerifier, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.verifier = verifier;
    this.now = now;
  }

  getActiveVersion(): string | null {
    return this.activeVersion;
  }

  async apply(pkg: SignedRulePackage): Promise<ApplyRulePackageOutcome> {
    if (
      !isPlausiblePackageVersion(pkg.packageVersion) ||
      !isPlausibleSignature(pkg.signature) ||
      !(pkg.rules.length <= MAX_RULES_PER_PACKAGE)
    ) {
      return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
    }

    const canonicalRules: Array<{ domain: string; listType: WebRule['listType'] }> = [];
    for (const rule of pkg.rules) {
      const domain = canonicalizeDomain(rule.domain);
      if (domain === null) return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
      canonicalRules.push({ domain, listType: rule.listType });
    }

    // Rollbackable per doc 14: an older-or-equal version is refused outright, distinct from an unsigned/expired rejection, so a compromised or delayed feed cannot downgrade the active ruleset.
    if (this.activeVersion !== null && comparePackageVersions(pkg.packageVersion, this.activeVersion) <= 0) {
      return { status: 'REJECTED_STALE', reason: 'NOT_NEWER_THAN_ACTIVE', activeVersion: this.activeVersion };
    }

    if (pkg.expiresAt.getTime() <= this.now().getTime()) {
      return { status: 'REJECTED_EXPIRED', reason: 'PACKAGE_EXPIRED' };
    }

    const verified = await this.verifier.verify(pkg);
    if (!verified) {
      return { status: 'REJECTED_SIGNATURE', reason: 'SIGNATURE_INVALID' };
    }

    for (const rule of canonicalRules) {
      await this.repository.put({
        domain: rule.domain,
        listType: rule.listType,
        source: 'SECURITY_DENYLIST',
        familyId: null,
        createdAt: this.now(),
      });
    }
    this.activeVersion = pkg.packageVersion;
    return { status: 'APPLIED', ruleCount: canonicalRules.length };
  }
}

/** Numeric dotted-triple comparison, mirroring familyenvelope/policy.ts's compareSemanticVersions convention. Falls back to lexicographic only for non-dotted-triple version strings. */
export function comparePackageVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  const aNumeric = aParts.length === 3 && aParts.every(Number.isFinite);
  const bNumeric = bParts.length === 3 && bParts.every(Number.isFinite);
  if (aNumeric && bNumeric) {
    for (let i = 0; i < 3; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
