export type OpaqueFamilyId = string;
export type OpaqueProfileId = string;

/** Lowercased, scheme/path/port/trailing-dot-stripped registrable-ish hostname. Never an IP literal or a full URL. Produced only by canonicalize.ts. */
export type CanonicalDomain = string;

/**
 * doc 14's four decision-pipeline sources, in the SAME order the flowchart
 * evaluates them (B -> D -> E -> F/G). `SECURITY_DENYLIST` is the
 * "non-overridable security policy" the doc text calls out separately from
 * an ordinary parent denylist -- it is the only source that can override a
 * parent allowlist entry (see policy.ts's WEB_RULE_SOURCE_PRIORITY).
 */
export type WebRuleSource =
  | 'SECURITY_DENYLIST'
  | 'PARENT_ALLOWLIST'
  | 'PARENT_DENYLIST'
  | 'CATEGORY_RULE'
  | 'SCHEDULE_RULE';

export type WebRuleListType = 'ALLOW' | 'DENY';

/**
 * One parent- or security-feed-authored rule over a canonical domain.
 * `familyId: null` marks a security-feed rule (malware/phishing/scam) that
 * applies across all families, never scoped to one.
 */
export interface WebRule {
  domain: CanonicalDomain;
  listType: WebRuleListType;
  source: WebRuleSource;
  familyId: OpaqueFamilyId | null;
  createdAt: Date;
}

/**
 * doc 14: "Rule and model packages must be signed, versioned, expiry-aware
 * and rollbackable." This module never generates or signs a package --
 * only verifies and applies one via an injected SignedRulePackageVerifier
 * (see SignedRulePackageConsumer.ts). `rules` here are the security-feed
 * (malware/phishing/scam) entries the package carries; parent allow/deny
 * entries are never part of a signed package -- those are always
 * locally parent-authored (see WebRuleStore).
 */
export interface SignedRulePackage {
  packageVersion: string;
  issuedAt: Date;
  expiresAt: Date;
  signature: string;
  rules: ReadonlyArray<{ domain: CanonicalDomain; listType: WebRuleListType }>;
}

export type ClassifierModality = 'TEXT' | 'IMAGE';

export type ClassifierConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';

export type ClassifierDisposition = 'BLOCK' | 'REVIEW' | 'ALLOW';

/**
 * doc 14: "AI decisions include model/rule version, modality, confidence
 * band, policy threshold and final disposition." Produced entirely outside
 * this module (the on-device classifier itself is out of scope for a
 * backend lane) -- this is the CONSUMER-side shape this module accepts,
 * never a classifier implementation. Only legitimate for content actually
 * rendered in the PCA Safe Browser (doc 14 step F), which callers must
 * enforce before constructing one.
 */
export interface ClassifierResult {
  modelVersion: string;
  modality: ClassifierModality;
  confidenceBand: ClassifierConfidenceBand;
  disposition: ClassifierDisposition;
}

/**
 * doc 14 layer 2 (Android local VPN/DNS controls) and doc 15's "Network/
 * domain filter" row: this module never operates the VPN itself (PCA-2
 * owns generic VPN mechanics) -- it only consumes a metadata-only decision
 * event the VPN/DNS layer already made, to fold into WebDecision without
 * ever claiming HTTPS path/content visibility it did not have.
 * `coverage` mirrors doc 15's reporting-contract vocabulary so a WebDecision
 * built from this never overstates what was actually observed.
 */
export interface VpnMetadataDecision {
  domain: CanonicalDomain;
  outcome: 'ALLOWED' | 'BLOCKED' | 'UNAVAILABLE';
  coverage: 'DESTINATION_ONLY' | 'DOMAIN_ONLY';
}

export type WebDecisionOutcome = 'ALLOW' | 'BLOCK' | 'REVIEW';

/** The full set of stable machine reason keys a WebDecision can carry -- one more member (`VPN_UNAVAILABLE`) than `source` alone can express; see WebDecision.reasonId. Defined here (not in i18n/) so i18n/types.ts's MessageId union can import it, never the reverse. */
export type WebReasonId = WebRuleSource | 'CLASSIFIER' | 'DEFAULT' | 'VPN_UNAVAILABLE';

/**
 * doc 15's reporting-contract fields, scoped to a single web decision. `source` is the field
 * that already existed pre-PCA-16A and remains unchanged (matching rule/branch category).
 * `reasonId` is a NEW, separate stable machine key (PCA-16A correction, BACKEND_I18N_NOT_WIRED):
 * unlike `source`, it distinguishes the VPN-unavailable default-allow from an ordinary
 * no-rule-matched default-allow -- two cases `source: 'DEFAULT'` alone cannot tell apart.
 * `reasonCode` is now LOCALIZED presentation text resolved from backend/src/i18n's catalogue
 * (see WebFilterEngine.decide's `locale` parameter) -- policy/audit code must key off `source`/
 * `reasonId`, never parse or compare against `reasonCode`'s prose.
 */
export interface WebDecision {
  domain: CanonicalDomain;
  outcome: WebDecisionOutcome;
  source: WebRuleSource | 'CLASSIFIER' | 'DEFAULT';
  reasonId: WebReasonId;
  reasonCode: string;
  coverage: 'FULL_URL' | 'DOMAIN_ONLY' | 'DESTINATION_ONLY';
}

export type SafeSearchMode = 'STRICT' | 'MODERATE' | 'OFF';

/** doc 14 layer 1: "safe-search/restricted-mode configuration where the destination/service supports it." `serviceSupportsSafeSearch: false` must never be reported as enforced. */
export interface SafeSearchDirective {
  mode: SafeSearchMode;
  serviceSupportsSafeSearch: boolean;
}
