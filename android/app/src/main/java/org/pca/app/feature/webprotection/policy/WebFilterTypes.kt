package org.pca.app.feature.webprotection.policy

/**
 * doc 14's on-device deterministic web-filter pipeline, mirrored from
 * `backend/src/web/types.ts` and `backend/src/safebrowser/types.ts` field-for-field.
 * This is NOT a client of the backend module -- doc 14's offline requirement
 * ("local deterministic rules must continue to work with zero network
 * dependency") means this decision pipeline must run entirely on-device, so
 * the backend TypeScript module is a design contract to mirror, not a service
 * to call. Any future backend/Android drift here must be caught by keeping
 * this file's shapes in lockstep with the backend types it mirrors.
 */

/** Lowercased, scheme/path/port/trailing-dot-stripped registrable-ish hostname. Never an IP literal or a full URL. Produced only by [org.pca.app.feature.webprotection.policy.canonicalizeDomain]. */
typealias CanonicalDomain = String

typealias OpaqueFamilyId = String

/**
 * doc 14's four decision-pipeline sources, in the SAME order the flowchart
 * evaluates them (B -> D -> E -> F/G). `SECURITY_DENYLIST` is the only
 * source that can override a parent allowlist entry (see
 * [WEB_RULE_SOURCE_PRIORITY]).
 */
enum class WebRuleSource { SECURITY_DENYLIST, PARENT_ALLOWLIST, PARENT_DENYLIST, CATEGORY_RULE, SCHEDULE_RULE }

enum class WebRuleListType { ALLOW, DENY }

/**
 * One parent- or security-feed-authored rule over a canonical domain.
 * `familyId: null` marks a security-feed rule (malware/phishing/scam) that
 * applies across all families, never scoped to one.
 */
data class WebRule(
    val domain: CanonicalDomain,
    val listType: WebRuleListType,
    val source: WebRuleSource,
    val familyId: OpaqueFamilyId?,
    val createdAtEpochMillis: Long,
)

enum class ClassifierModality { TEXT, IMAGE }

enum class ClassifierConfidenceBand { LOW, MEDIUM, HIGH }

enum class ClassifierDisposition { BLOCK, REVIEW, ALLOW }

/**
 * doc 14: "AI decisions include model/rule version, modality, confidence
 * band, policy threshold and final disposition." Only legitimate for content
 * actually rendered in the PCA Safe Browser (doc 14 step F) -- callers must
 * enforce that before constructing one. On-device only: this project's
 * architecture (doc 14 "Optional on-device AI") never defines a remote/cloud
 * classifier; any future cloud classification "requires an explicit owner
 * decision, separate informed parent opt-in... and legal/commercial review"
 * (doc 14) that has not happened, so this module never calls out to a
 * network classifier and this type structurally cannot represent one that
 * did (no endpoint/URL field exists here).
 */
data class ClassifierResult(
    val modelVersion: String,
    val modality: ClassifierModality,
    val confidenceBand: ClassifierConfidenceBand,
    val disposition: ClassifierDisposition,
)

/**
 * Whether the optional on-device classifier actually ran for this
 * navigation. [UNAVAILABLE] must NEVER be interpreted by a caller as
 * "therefore allow" -- [org.pca.app.feature.webprotection.engine.WebFilterEngine]
 * falls back to the deterministic rule set regardless, and the resulting
 * [WebDecision.coverage] honestly stays at [WebDecisionCoverage.DOMAIN_ONLY]
 * (never [WebDecisionCoverage.FULL_URL]) whenever the classifier did not run,
 * so a caller can display genuinely reduced coverage rather than a silently
 * opened gate.
 */
enum class ClassifierAvailability { AVAILABLE, UNAVAILABLE_NO_MODEL, UNAVAILABLE_BUDGET_SKIPPED, UNAVAILABLE_TIMEOUT }

enum class VpnDecisionOutcome { ALLOWED, BLOCKED, UNAVAILABLE }

enum class VpnDecisionCoverage { DESTINATION_ONLY, DOMAIN_ONLY }

/**
 * doc 14 layer 2 (Android local VPN/DNS controls) and doc 15's "Network/
 * domain filter" row: metadata-only decision event the VPN/DNS layer already
 * made, to fold into [WebDecision] without ever claiming HTTPS path/content
 * visibility that was not actually observed. See
 * [org.pca.app.feature.webprotection.vpn.VpnMetadataDecisionAdapter] for the
 * concrete producer, built on top of the existing
 * [org.pca.app.platform.VpnCapabilitySource] foundation.
 */
data class VpnMetadataDecision(
    val domain: CanonicalDomain,
    val outcome: VpnDecisionOutcome,
    val coverage: VpnDecisionCoverage,
)

enum class WebDecisionOutcome { ALLOW, BLOCK, REVIEW }

/** Machine-stable decision source, mirroring backend `WebDecision.source`. */
enum class WebDecisionSource { SECURITY_DENYLIST, PARENT_ALLOWLIST, PARENT_DENYLIST, CATEGORY_RULE, SCHEDULE_RULE, CLASSIFIER, DEFAULT }

/**
 * The full set of stable machine reason keys a [WebDecision] can carry -- one
 * more member ([VPN_UNAVAILABLE]) than [WebDecisionSource] alone can express,
 * mirroring backend `WebReasonId`: it distinguishes the VPN-unavailable
 * default-allow from an ordinary no-rule-matched default-allow.
 */
enum class WebReasonId { SECURITY_DENYLIST, PARENT_ALLOWLIST, PARENT_DENYLIST, CATEGORY_RULE, SCHEDULE_RULE, CLASSIFIER, DEFAULT, VPN_UNAVAILABLE }

enum class WebDecisionCoverage { FULL_URL, DOMAIN_ONLY, DESTINATION_ONLY }

/**
 * doc 15's reporting-contract fields, scoped to a single web decision.
 * `reasonCode` is localized presentation text -- policy/audit code must key
 * off `source`/`reasonId`, never parse or compare against `reasonCode`'s
 * prose (mirrors backend PCA-16A correction).
 */
data class WebDecision(
    val domain: CanonicalDomain,
    val outcome: WebDecisionOutcome,
    val source: WebDecisionSource,
    val reasonId: WebReasonId,
    val reasonCode: String,
    val coverage: WebDecisionCoverage,
)

enum class SafeSearchMode { STRICT, MODERATE, OFF }

/** doc 14 layer 1. `serviceSupportsSafeSearch = false` must never be reported as enforced. */
data class SafeSearchDirective(val mode: SafeSearchMode, val serviceSupportsSafeSearch: Boolean)

enum class WebLocale { EN, AR }
