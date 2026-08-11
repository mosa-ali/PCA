import type {
  ClassifierResult,
  SafeSearchDirective,
  SafeSearchMode,
  WebRule,
  WebRuleSource,
} from './types.js';

export const MAX_PACKAGE_VERSION_LENGTH = 32;
export const MAX_SIGNATURE_LENGTH = 512;
export const MAX_MODEL_VERSION_LENGTH = 64;
export const MAX_RULES_PER_PACKAGE = 100_000;

/**
 * doc 14 precedence, resolved from the flowchart's evaluation order (B, D,
 * E) PLUS the explicit override text: "Parent allowlist takes precedence
 * over category/AI decisions except for non-overridable security policy...
 * a parent denylist overrides ordinary category allow." Read together:
 * SECURITY_DENYLIST beats everything (even a parent allowlist entry);
 * PARENT_ALLOWLIST then beats every remaining category/schedule source;
 * PARENT_DENYLIST then beats ordinary category/schedule allow. Lower index
 * = higher precedence. The classifier and the eventual default-allow are
 * NOT rule sources -- they only apply once no WebRule matched at all (see
 * resolveWebRuleSource).
 */
export const WEB_RULE_SOURCE_PRIORITY: readonly WebRuleSource[] = [
  'SECURITY_DENYLIST',
  'PARENT_ALLOWLIST',
  'PARENT_DENYLIST',
  'CATEGORY_RULE',
  'SCHEDULE_RULE',
];

/**
 * Selects the single highest-precedence rule for a domain from every rule
 * that matched it (already-filtered by caller to this family + global
 * security rules). Returns null if no rule matched -- caller falls through
 * to the classifier/default-allow steps (doc 14 steps F onward).
 */
export function resolveWebRuleSource(matchedRules: readonly WebRule[]): WebRule | null {
  if (matchedRules.length === 0) return null;
  let best: WebRule | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const rule of matchedRules) {
    const rank = WEB_RULE_SOURCE_PRIORITY.indexOf(rule.source);
    if (rank === -1) continue; // unrecognized source -- never trusted as a match
    if (rank < bestRank) {
      best = rule;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * doc 14: "Thresholds are age-profile specific and conservative for
 * high-harm deterministic indicators... Ambiguous AI-only material follows
 * the selected profile policy -- allow with an event, or hold for parent
 * review -- not a universal opaque block." This module does not choose the
 * per-profile threshold (that is family/profile configuration, out of this
 * module's scope) -- it only maps an already-computed ClassifierResult onto
 * a WebDecisionOutcome, honoring the classifier's own reported disposition
 * rather than re-deriving one from the confidence band, since a future
 * profile policy may map confidence bands differently than this module
 * would guess.
 */
export function resolveClassifierOutcome(result: ClassifierResult): 'BLOCK' | 'REVIEW' | 'ALLOW' {
  return result.disposition;
}

/**
 * doc 14: "safe-search/restricted-mode configuration where the destination/
 * service supports it." A directive whose service does not support
 * SafeSearch must never be reported as enforced -- effectiveMode always
 * collapses to OFF in that case regardless of the requested mode, so a
 * caller can label the outcome truthfully instead of claiming enforcement
 * that did not happen.
 */
export function resolveEffectiveSafeSearchMode(directive: SafeSearchDirective): SafeSearchMode {
  if (!directive.serviceSupportsSafeSearch) return 'OFF';
  return directive.mode;
}

export function isPlausiblePackageVersion(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_PACKAGE_VERSION_LENGTH;
}

export function isPlausibleSignature(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_SIGNATURE_LENGTH;
}

export function isPlausibleModelVersion(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_MODEL_VERSION_LENGTH;
}
