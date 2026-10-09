import { isCanonicalDomain } from './canonicalize.js';
import { isPlausiblePackageVersion, isPlausibleSignature, MAX_RULES_PER_PACKAGE } from './policy.js';
import type { SignedRulePackage, WebRule } from './types.js';
import type { SecurityRulePackageRepository } from './WebRuleStore.js';
export { comparePackageVersions } from './policy.js';

/** The verifier must authenticate every metadata field and rule. This consumer
 * does not choose a production cryptographic suite. */
export interface SignedRulePackageVerifier {
  verify(pkg: SignedRulePackage): Promise<boolean>;
}
export type ApplyRulePackageOutcome =
  | { status: 'APPLIED'; ruleCount: number }
  | { status: 'REJECTED_SIGNATURE'; reason: 'SIGNATURE_INVALID' }
  | { status: 'REJECTED_EXPIRED'; reason: 'PACKAGE_EXPIRED' }
  | { status: 'REJECTED_STALE'; reason: 'NOT_NEWER_THAN_ACTIVE'; activeVersion: string }
  | { status: 'REJECTED_MALFORMED'; reason: 'MALFORMED_PACKAGE' };

/** A signed feed is a full snapshot, not an additive patch. The repository
 * commits replacement and the version floor atomically. Rejection preserves
 * the last valid snapshot when consumers race or are recreated. This port does
 * not enable readable Parent Web Rules in production. */
export class SignedRulePackageConsumer {
  private activeVersion: string | null = null;
  constructor(
    private readonly repository: SecurityRulePackageRepository,
    private readonly verifier: SignedRulePackageVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}
  /** Last observed repository floor, not an independently authoritative floor. */
  getActiveVersion(): string | null { return this.activeVersion; }

  async apply(pkg: SignedRulePackage): Promise<ApplyRulePackageOutcome> {
    if (pkg === null || typeof pkg !== 'object' ||
      !isPlausiblePackageVersion(pkg.packageVersion) || !isPlausibleSignature(pkg.signature) ||
      !Array.isArray(pkg.rules) || pkg.rules.length > MAX_RULES_PER_PACKAGE ||
      !(pkg.issuedAt instanceof Date) || !Number.isFinite(pkg.issuedAt.getTime()) ||
      !(pkg.expiresAt instanceof Date) || !Number.isFinite(pkg.expiresAt.getTime())) {
      return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
    }
    const canonicalRules: Array<{ domain: string; listType: WebRule['listType'] }> = [];
    const domains = new Set<string>();
    for (const rule of pkg.rules) {
      if (rule === null || typeof rule !== 'object' || rule.listType !== 'DENY') {
        return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
      }
      // The verifier authenticates the signed package bytes. Requiring the
      // producer's declared CanonicalDomain here ensures the exact domain
      // string that was signed is also the key that reaches the repository;
      // silently normalizing after verification would apply different data.
      if (!isCanonicalDomain(rule.domain) || domains.has(rule.domain)) {
        return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
      }
      domains.add(rule.domain);
      canonicalRules.push({ domain: rule.domain, listType: rule.listType });
    }
    const receivedAt = this.now();
    if (!Number.isFinite(receivedAt.getTime()) || pkg.issuedAt.getTime() > receivedAt.getTime() ||
      pkg.issuedAt.getTime() >= pkg.expiresAt.getTime()) {
      return { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' };
    }
    if (pkg.expiresAt.getTime() <= receivedAt.getTime()) return { status: 'REJECTED_EXPIRED', reason: 'PACKAGE_EXPIRED' };
    // Own verified input before suspension; caller mutation cannot change commit.
    const captured: SignedRulePackage = {
      packageVersion: pkg.packageVersion, signature: pkg.signature,
      issuedAt: new Date(pkg.issuedAt), expiresAt: new Date(pkg.expiresAt),
      rules: pkg.rules.map((rule) => ({ ...rule })),
    };
    const packageVersion = captured.packageVersion;
    const expiresAt = captured.expiresAt.getTime();
    if (!await this.verifier.verify(captured)) return { status: 'REJECTED_SIGNATURE', reason: 'SIGNATURE_INVALID' };
    const commitTime = this.now();
    if (!Number.isFinite(commitTime.getTime()) || expiresAt <= commitTime.getTime()) {
      return { status: 'REJECTED_EXPIRED', reason: 'PACKAGE_EXPIRED' };
    }
    const result = await this.repository.replaceSecurityPackageIfNewer(packageVersion, canonicalRules.map((rule) => ({
      ...rule, source: 'SECURITY_DENYLIST', familyId: null, createdAt: commitTime,
    })));
    if (result.status === 'STALE') {
      this.activeVersion = result.activeVersion;
      return { status: 'REJECTED_STALE', reason: 'NOT_NEWER_THAN_ACTIVE', activeVersion: result.activeVersion };
    }
    this.activeVersion = packageVersion;
    return { status: 'APPLIED', ruleCount: canonicalRules.length };
  }
}
