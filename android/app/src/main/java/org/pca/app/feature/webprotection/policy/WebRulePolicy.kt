package org.pca.app.feature.webprotection.policy

/**
 * doc 14 precedence, mirroring `backend/src/web/policy.ts`'s
 * `WEB_RULE_SOURCE_PRIORITY` exactly: SECURITY_DENYLIST beats everything
 * (even a parent allowlist entry); PARENT_ALLOWLIST then beats every
 * remaining category/schedule source; PARENT_DENYLIST then beats ordinary
 * category/schedule allow. Lower index = higher precedence.
 */
val WEB_RULE_SOURCE_PRIORITY: List<WebRuleSource> = listOf(
    WebRuleSource.SECURITY_DENYLIST,
    WebRuleSource.PARENT_ALLOWLIST,
    WebRuleSource.PARENT_DENYLIST,
    WebRuleSource.CATEGORY_RULE,
    WebRuleSource.SCHEDULE_RULE,
)

/**
 * Selects the single highest-precedence rule for a domain from every rule
 * that matched it. Returns null if no rule matched -- caller falls through to
 * the classifier/default-allow steps (doc 14 steps F onward).
 */
fun resolveWebRuleSource(matchedRules: List<WebRule>): WebRule? {
    if (matchedRules.isEmpty()) return null
    var best: WebRule? = null
    var bestRank = Int.MAX_VALUE
    for (rule in matchedRules) {
        val rank = WEB_RULE_SOURCE_PRIORITY.indexOf(rule.source)
        if (rank == -1) continue // unrecognized source -- never trusted as a match
        if (rank < bestRank) {
            best = rule
            bestRank = rank
        }
    }
    return best
}

/**
 * Mirrors `resolveClassifierOutcome`: honors the classifier's own reported
 * disposition rather than re-deriving one from the confidence band, since a
 * future profile policy may map confidence bands differently than this
 * module would guess.
 */
fun resolveClassifierOutcome(result: ClassifierResult): WebDecisionOutcome = when (result.disposition) {
    ClassifierDisposition.BLOCK -> WebDecisionOutcome.BLOCK
    ClassifierDisposition.REVIEW -> WebDecisionOutcome.REVIEW
    ClassifierDisposition.ALLOW -> WebDecisionOutcome.ALLOW
}

/** doc 14: a directive whose service does not support SafeSearch must never be reported as enforced. */
fun resolveEffectiveSafeSearchMode(directive: SafeSearchDirective): SafeSearchMode =
    if (!directive.serviceSupportsSafeSearch) SafeSearchMode.OFF else directive.mode

/**
 * doc 14: "a parent denylist overrides ordinary category allow" and a
 * security block is the one case doc 14 calls "non-overridable security
 * policy." A SECURITY_DENYLIST block is therefore never requestable.
 */
fun isBlockRequestable(source: WebDecisionSource): Boolean = source != WebDecisionSource.SECURITY_DENYLIST

/** Widening conversion used at the WebRule -> WebDecision boundary (WebRuleSource is a strict subset of WebDecisionSource). */
fun WebRuleSource.toDecisionSource(): WebDecisionSource = when (this) {
    WebRuleSource.SECURITY_DENYLIST -> WebDecisionSource.SECURITY_DENYLIST
    WebRuleSource.PARENT_ALLOWLIST -> WebDecisionSource.PARENT_ALLOWLIST
    WebRuleSource.PARENT_DENYLIST -> WebDecisionSource.PARENT_DENYLIST
    WebRuleSource.CATEGORY_RULE -> WebDecisionSource.CATEGORY_RULE
    WebRuleSource.SCHEDULE_RULE -> WebDecisionSource.SCHEDULE_RULE
}
