import { canonicalizeDomain } from './canonicalize.js';
import type { CanonicalDomain, OpaqueFamilyId, WebRule, WebRuleListType, WebRuleSource } from './types.js';

/**
 * Persistence port for parent-authored allow/deny entries and the global
 * security-feed denylist. `familyId: null` selects the security feed (see
 * WebRule.familyId); a family-scoped write must never be able to touch it.
 * Only a deterministic in-memory implementation exists today -- MySQL
 * persistence is a later slice, mirroring RecoveryRepository/RelayRepository.
 */
export interface WebRuleRepository {
  put(rule: WebRule): Promise<void>;
  remove(familyId: OpaqueFamilyId | null, domain: CanonicalDomain, listType: WebRuleListType): Promise<void>;
  /** Every rule matching this domain, across the family's own rules AND the global security feed -- the full candidate set resolveWebRuleSource ranks. */
  findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): Promise<WebRule[]>;
  /** Every rule stored under this family (across all domains) -- never includes the global security feed (familyId: null) or another family's rules. Backs the parent-facing rule-list authoring surface (WebRuleService.listParentRules), never the per-domain decision pipeline (that stays on findMatching). */
  listByFamily(familyId: OpaqueFamilyId): Promise<WebRule[]>;
}

export class InMemoryWebRuleRepository implements WebRuleRepository {
  private readonly rules = new Map<string, WebRule>();

  private key(familyId: OpaqueFamilyId | null, domain: CanonicalDomain, listType: WebRuleListType): string {
    return `${familyId ?? '*'} ${domain} ${listType}`;
  }

  async put(rule: WebRule): Promise<void> {
    this.rules.set(this.key(rule.familyId, rule.domain, rule.listType), rule);
  }

  async remove(familyId: OpaqueFamilyId | null, domain: CanonicalDomain, listType: WebRuleListType): Promise<void> {
    this.rules.delete(this.key(familyId, domain, listType));
  }

  async findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): Promise<WebRule[]> {
    const matched: WebRule[] = [];
    for (const rule of this.rules.values()) {
      if (rule.domain !== domain) continue;
      if (rule.familyId === null || rule.familyId === familyId) matched.push(rule);
    }
    return matched;
  }

  async listByFamily(familyId: OpaqueFamilyId): Promise<WebRule[]> {
    const matched: WebRule[] = [];
    for (const rule of this.rules.values()) {
      if (rule.familyId === familyId) matched.push(rule);
    }
    return matched;
  }
}

export type WebRuleErrorCode = 'INVALID_DOMAIN' | 'INVALID_SOURCE' | 'FORBIDDEN_SOURCE' | 'SOURCE_LIST_MISMATCH';

export class WebRuleError extends Error {
  readonly code: WebRuleErrorCode;
  constructor(code: WebRuleErrorCode) {
    super(WEB_RULE_ERROR_MESSAGES[code]);
    this.name = 'WebRuleError';
    this.code = code;
  }
}

const WEB_RULE_ERROR_MESSAGES: Record<WebRuleErrorCode, string> = {
  INVALID_DOMAIN: 'Domain is not a plausible canonical domain.',
  INVALID_SOURCE: 'Rule source is not recognized.',
  FORBIDDEN_SOURCE: 'This source cannot be written through the family-scoped API.',
  SOURCE_LIST_MISMATCH: 'PARENT_ALLOWLIST requires ALLOW and PARENT_DENYLIST requires DENY.',
};

const FAMILY_WRITABLE_SOURCES: ReadonlySet<WebRuleSource> = new Set(['PARENT_ALLOWLIST', 'PARENT_DENYLIST']);

/**
 * The parent-facing surface over WebRuleRepository. SECURITY_DENYLIST and
 * CATEGORY_RULE/SCHEDULE_RULE entries are never accepted here -- security
 * rules arrive only through SignedRulePackageConsumer, and category/
 * schedule rules are age-profile configuration owned elsewhere -- so a
 * parent write can never impersonate the security feed or silently widen
 * its own family's category policy through this path.
 */
export class WebRuleService {
  private readonly repository: WebRuleRepository;
  private readonly now: () => Date;

  constructor(repository: WebRuleRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async setParentRule(
    familyId: OpaqueFamilyId,
    domain: unknown,
    listType: WebRuleListType,
    source: 'PARENT_ALLOWLIST' | 'PARENT_DENYLIST',
  ): Promise<WebRule> {
    const canonicalDomain = canonicalizeDomain(domain);
    if (canonicalDomain === null) throw new WebRuleError('INVALID_DOMAIN');
    if (!FAMILY_WRITABLE_SOURCES.has(source)) throw new WebRuleError('FORBIDDEN_SOURCE');
    if (
      (source === 'PARENT_ALLOWLIST' && listType !== 'ALLOW') ||
      (source === 'PARENT_DENYLIST' && listType !== 'DENY')
    ) {
      throw new WebRuleError('SOURCE_LIST_MISMATCH');
    }
    const rule: WebRule = { domain: canonicalDomain, listType, source, familyId, createdAt: this.now() };
    await this.repository.put(rule);
    return rule;
  }

  async removeParentRule(
    familyId: OpaqueFamilyId,
    domain: unknown,
    listType: WebRuleListType,
  ): Promise<void> {
    const canonicalDomain = canonicalizeDomain(domain);
    if (canonicalDomain === null) throw new WebRuleError('INVALID_DOMAIN');
    await this.repository.remove(familyId, canonicalDomain, listType);
  }

  /**
   * The parent-facing rule LIST, filtered to exactly the two sources this
   * service's own writes can ever produce (PARENT_ALLOWLIST/PARENT_DENYLIST)
   * -- mirrors setParentRule/removeParentRule's FORBIDDEN_SOURCE restriction
   * on the read side, so a family-scoped caller can never see a
   * SECURITY_DENYLIST or CATEGORY_RULE/SCHEDULE_RULE entry (age-profile
   * configuration owned elsewhere) through this authoring surface, even
   * though WebRuleRepository.listByFamily itself has no such filter.
   */
  async listParentRules(familyId: OpaqueFamilyId): Promise<WebRule[]> {
    const rules = await this.repository.listByFamily(familyId);
    return rules.filter((rule) => FAMILY_WRITABLE_SOURCES.has(rule.source));
  }
}
