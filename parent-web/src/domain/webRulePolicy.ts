// PCA-WEB-RUNTIME-1: parent-facing web-rule authoring domain. Mirrors
// backend's `WebRuleService` restriction (doc 26/27) -- a family-scoped
// parent write may only ever create PARENT_ALLOWLIST/PARENT_DENYLIST
// entries; SECURITY_DENYLIST (the global signed feed) and
// CATEGORY_RULE/SCHEDULE_RULE (age-profile configuration) are never
// reachable through this authoring surface.
import { canonicalizeDomain } from './webRuleCanonicalize';

export type WebRuleListType = 'ALLOW' | 'DENY';

export interface WebRuleEntry {
  readonly domain: string;
  readonly listType: WebRuleListType;
  readonly createdAtUtc: string;
}

/**
 * doc 36's parent-change lifecycle -- deliberately distinct states so
 * "parent saved locally" is never displayed as "child applied" (doc 36:
 * "parent saved != child applied").
 *  - LOCAL_DRAFT: edited in this browser tab, not yet handed to any transport.
 *  - PENDING_DELIVERY: queued for delivery once trust/crypto allow it.
 *  - DELIVERED: handed to the family-sync transport successfully.
 *  - APPLIED: the child device has actually confirmed applying this revision
 *    (requires a receipt from post-crypto-activation sync -- doc 36 "APPLIED
 *    requires evidence from child application/receipt").
 *  - FAILED: delivery or application was attempted and rejected.
 *  - STALE: superseded by a newer local revision before it was delivered.
 */
export type WebRuleDeliveryStatus = 'LOCAL_DRAFT' | 'PENDING_DELIVERY' | 'DELIVERED' | 'APPLIED' | 'FAILED' | 'STALE';

export type WebRuleValidationError = 'DOMAIN_EMPTY' | 'DOMAIN_INVALID' | 'DOMAIN_ALREADY_ON_OPPOSITE_LIST';

export interface WebRuleValidationResult {
  valid: boolean;
  errors: WebRuleValidationError[];
  /** The canonicalized domain to actually store, when valid. */
  canonicalDomain: string | null;
}

/**
 * The real validator every add-rule submission path must call (doc 25/26) --
 * never trust an HTML input's raw value directly. Also enforces doc 26's
 * precedence sanity check at authoring time: a domain cannot be added to
 * both the allow and deny list simultaneously for the same family (the
 * engine's own precedence would resolve it, but presenting a parent with a
 * silently-contradictory rule pair is a UX/trust problem this validator
 * catches up front).
 */
export function validateWebRuleDomain(rawDomain: string, listType: WebRuleListType, existingRules: readonly WebRuleEntry[]): WebRuleValidationResult {
  const errors: WebRuleValidationError[] = [];
  const trimmed = rawDomain.trim();

  if (trimmed.length === 0) {
    return { valid: false, errors: ['DOMAIN_EMPTY'], canonicalDomain: null };
  }

  const canonicalDomain = canonicalizeDomain(trimmed);
  if (canonicalDomain === null) {
    return { valid: false, errors: ['DOMAIN_INVALID'], canonicalDomain: null };
  }

  const oppositeList: WebRuleListType = listType === 'ALLOW' ? 'DENY' : 'ALLOW';
  const onOppositeList = existingRules.some((r) => r.domain === canonicalDomain && r.listType === oppositeList);
  if (onOppositeList) errors.push('DOMAIN_ALREADY_ON_OPPOSITE_LIST');

  return { valid: errors.length === 0, errors, canonicalDomain };
}

export function describeWebRuleValidationError(error: WebRuleValidationError): string {
  switch (error) {
    case 'DOMAIN_EMPTY':
      return 'Enter a website address.';
    case 'DOMAIN_INVALID':
      return 'This does not look like a valid website address.';
    case 'DOMAIN_ALREADY_ON_OPPOSITE_LIST':
      return 'This site is already on the other list -- remove it there first.';
  }
}
