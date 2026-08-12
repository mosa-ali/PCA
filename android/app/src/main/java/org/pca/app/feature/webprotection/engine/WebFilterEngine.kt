package org.pca.app.feature.webprotection.engine

import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.ClassifierResult
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.VpnDecisionCoverage
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome
import org.pca.app.feature.webprotection.policy.VpnMetadataDecision
import org.pca.app.feature.webprotection.policy.WebDecision
import org.pca.app.feature.webprotection.policy.WebDecisionCoverage
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebDecisionSource
import org.pca.app.feature.webprotection.policy.WebLocale
import org.pca.app.feature.webprotection.policy.WebReasonId
import org.pca.app.feature.webprotection.policy.resolveClassifierOutcome
import org.pca.app.feature.webprotection.policy.resolveWebRuleSource
import org.pca.app.feature.webprotection.policy.toDecisionSource
import org.pca.app.feature.webprotection.policy.translateWebReason

/**
 * doc 14's deterministic decision pipeline (steps B through I), mirrored
 * line-for-line from `backend/src/web/WebFilterEngine.ts`: this class holds
 * no state of its own, is pure orchestration over an injected
 * [WebRuleRepository], and runs entirely on-device -- satisfying doc 14's
 * offline requirement directly (there is no network call anywhere in this
 * file, by construction, not just by policy).
 *
 * `classifierResult` is optional and, per doc 14 step F, only meaningful
 * when the domain was rendered in the PCA Safe Browser; callers outside that
 * context must omit it. `vpnDecision` is optional and reflects doc 14 layer 2
 * -- when present with outcome UNAVAILABLE, this engine still evaluates
 * rules but never claims network-layer coverage it did not have (the
 * resulting [WebDecision.coverage] stays DOMAIN_ONLY, never FULL_URL).
 *
 * The "remote classifier unavailable must never silently degrade to allow"
 * requirement is satisfied structurally: [decide] never treats a missing/
 * omitted [ClassifierResult] as an ALLOW signal on its own -- it is simply
 * skipped, and evaluation continues to the VPN-metadata and deterministic
 * default-allow steps exactly as if no classifier existed at all. There is
 * no code path in this class that maps "classifier unavailable" to a BLOCK
 * bypass.
 */
class WebFilterEngine(private val rules: WebRuleRepository) {

    fun decide(
        familyId: OpaqueFamilyId,
        domain: CanonicalDomain,
        classifierResult: ClassifierResult? = null,
        vpnDecision: VpnMetadataDecision? = null,
        locale: WebLocale = WebLocale.EN,
    ): WebDecision {
        val matched = rules.findMatching(familyId, domain)
        val winner = resolveWebRuleSource(matched)
        if (winner != null) {
            val outcome = if (winner.listType.name == "ALLOW") WebDecisionOutcome.ALLOW else WebDecisionOutcome.BLOCK
            val source = winner.source.toDecisionSource()
            return build(domain, outcome, source, source.toReasonId(), WebDecisionCoverage.DOMAIN_ONLY, locale)
        }

        if (classifierResult != null) {
            val outcome = resolveClassifierOutcome(classifierResult)
            if (outcome != WebDecisionOutcome.ALLOW) {
                return build(domain, outcome, WebDecisionSource.CLASSIFIER, WebReasonId.CLASSIFIER, WebDecisionCoverage.FULL_URL, locale)
            }
        }

        if (vpnDecision != null && vpnDecision.domain == domain) {
            if (vpnDecision.outcome == VpnDecisionOutcome.BLOCKED) {
                val coverage = if (vpnDecision.coverage == VpnDecisionCoverage.DESTINATION_ONLY) {
                    WebDecisionCoverage.DESTINATION_ONLY
                } else {
                    WebDecisionCoverage.DOMAIN_ONLY
                }
                return build(domain, WebDecisionOutcome.BLOCK, WebDecisionSource.DEFAULT, WebReasonId.PARENT_DENYLIST, coverage, locale)
            }
            if (vpnDecision.outcome == VpnDecisionOutcome.UNAVAILABLE) {
                return build(domain, WebDecisionOutcome.ALLOW, WebDecisionSource.DEFAULT, WebReasonId.VPN_UNAVAILABLE, WebDecisionCoverage.DOMAIN_ONLY, locale)
            }
        }

        return build(domain, WebDecisionOutcome.ALLOW, WebDecisionSource.DEFAULT, WebReasonId.DEFAULT, WebDecisionCoverage.DOMAIN_ONLY, locale)
    }

    private fun WebDecisionSource.toReasonId(): WebReasonId = when (this) {
        WebDecisionSource.SECURITY_DENYLIST -> WebReasonId.SECURITY_DENYLIST
        WebDecisionSource.PARENT_ALLOWLIST -> WebReasonId.PARENT_ALLOWLIST
        WebDecisionSource.PARENT_DENYLIST -> WebReasonId.PARENT_DENYLIST
        WebDecisionSource.CATEGORY_RULE -> WebReasonId.CATEGORY_RULE
        WebDecisionSource.SCHEDULE_RULE -> WebReasonId.SCHEDULE_RULE
        WebDecisionSource.CLASSIFIER -> WebReasonId.CLASSIFIER
        WebDecisionSource.DEFAULT -> WebReasonId.DEFAULT
    }

    private fun build(
        domain: CanonicalDomain,
        outcome: WebDecisionOutcome,
        source: WebDecisionSource,
        reasonId: WebReasonId,
        coverage: WebDecisionCoverage,
        locale: WebLocale,
    ): WebDecision = WebDecision(
        domain = domain,
        outcome = outcome,
        source = source,
        reasonId = reasonId,
        reasonCode = translateWebReason(reasonId, locale),
        coverage = coverage,
    )
}
