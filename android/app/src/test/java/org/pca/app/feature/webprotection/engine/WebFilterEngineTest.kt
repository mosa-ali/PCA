package org.pca.app.feature.webprotection.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.pca.app.feature.webprotection.policy.ClassifierConfidenceBand
import org.pca.app.feature.webprotection.policy.ClassifierDisposition
import org.pca.app.feature.webprotection.policy.ClassifierModality
import org.pca.app.feature.webprotection.policy.ClassifierResult
import org.pca.app.feature.webprotection.policy.VpnDecisionCoverage
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome
import org.pca.app.feature.webprotection.policy.VpnMetadataDecision
import org.pca.app.feature.webprotection.policy.WebDecisionCoverage
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebDecisionSource
import org.pca.app.feature.webprotection.policy.WebLocale
import org.pca.app.feature.webprotection.policy.WebReasonId
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource

private const val FAMILY = "family-1"

class WebFilterEngineTest {

    private fun rule(domain: String, listType: WebRuleListType, source: WebRuleSource, familyId: String? = FAMILY) =
        WebRule(domain, listType, source, familyId, createdAtEpochMillis = 0L)

    // -- Allowed decision -------------------------------------------------

    @Test
    fun `a domain with no matching rule and no classifier is allowed by deterministic default`() {
        val repo = InMemoryWebRuleRepository()
        val engine = WebFilterEngine(repo)

        val decision = engine.decide(FAMILY, "safe-example.com")

        assertEquals(WebDecisionOutcome.ALLOW, decision.outcome)
        assertEquals(WebReasonId.DEFAULT, decision.reasonId)
        assertEquals(WebDecisionCoverage.DOMAIN_ONLY, decision.coverage)
    }

    @Test
    fun `a parent allowlist entry allows even when a category rule would otherwise block`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("borderline.example", WebRuleListType.ALLOW, WebRuleSource.PARENT_ALLOWLIST))
        repo.put(rule("borderline.example", WebRuleListType.DENY, WebRuleSource.CATEGORY_RULE))
        val engine = WebFilterEngine(repo)

        val decision = engine.decide(FAMILY, "borderline.example")

        assertEquals(WebDecisionOutcome.ALLOW, decision.outcome)
        assertEquals(WebDecisionSource.PARENT_ALLOWLIST, decision.source)
    }

    // -- Blocked decision ---------------------------------------------------

    @Test
    fun `a parent denylist entry blocks the domain`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("blocked-by-parent.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST))
        val engine = WebFilterEngine(repo)

        val decision = engine.decide(FAMILY, "blocked-by-parent.example")

        assertEquals(WebDecisionOutcome.BLOCK, decision.outcome)
        assertEquals(WebDecisionSource.PARENT_DENYLIST, decision.source)
        assertEquals(WebReasonId.PARENT_DENYLIST, decision.reasonId)
    }

    @Test
    fun `a security denylist entry overrides even a parent allowlist entry`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("phishing.example", WebRuleListType.ALLOW, WebRuleSource.PARENT_ALLOWLIST))
        repo.put(rule("phishing.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, familyId = null))
        val engine = WebFilterEngine(repo)

        val decision = engine.decide(FAMILY, "phishing.example")

        assertEquals(WebDecisionOutcome.BLOCK, decision.outcome)
        assertEquals(WebDecisionSource.SECURITY_DENYLIST, decision.source)
    }

    // -- Review decision ------------------------------------------------

    @Test
    fun `an on-device classifier REVIEW disposition holds the page for review, not an outright block`() {
        val repo = InMemoryWebRuleRepository()
        val engine = WebFilterEngine(repo)
        val classifierResult = ClassifierResult(
            modelVersion = "v1",
            modality = ClassifierModality.TEXT,
            confidenceBand = ClassifierConfidenceBand.MEDIUM,
            disposition = ClassifierDisposition.REVIEW,
        )

        val decision = engine.decide(FAMILY, "ambiguous-content.example", classifierResult = classifierResult)

        assertEquals(WebDecisionOutcome.REVIEW, decision.outcome)
        assertEquals(WebDecisionSource.CLASSIFIER, decision.source)
        // Classifier only ever runs on content actually rendered in the Safe Browser --
        // its coverage is honestly FULL_URL, unlike every rule-only path (DOMAIN_ONLY).
        assertEquals(WebDecisionCoverage.FULL_URL, decision.coverage)
    }

    @Test
    fun `a rule match takes precedence over the classifier even when the classifier would allow`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("rule-wins.example", WebRuleListType.DENY, WebRuleSource.CATEGORY_RULE))
        val engine = WebFilterEngine(repo)
        val classifierResult = ClassifierResult("v1", ClassifierModality.TEXT, ClassifierConfidenceBand.LOW, ClassifierDisposition.ALLOW)

        val decision = engine.decide(FAMILY, "rule-wins.example", classifierResult = classifierResult)

        assertEquals(WebDecisionOutcome.BLOCK, decision.outcome)
        assertEquals(WebDecisionSource.CATEGORY_RULE, decision.source)
    }

    // -- Offline deterministic block (zero network dependency) --------------

    @Test
    fun `deterministic rule blocking works with no classifier and no VPN signal supplied at all`() {
        // This IS the offline path: no ClassifierResult, no VpnMetadataDecision -- only the
        // in-memory rule repository, which itself performs no I/O of any kind.
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("offline-blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST))
        val engine = WebFilterEngine(repo)

        val decision = engine.decide(FAMILY, "offline-blocked.example", classifierResult = null, vpnDecision = null)

        assertEquals(WebDecisionOutcome.BLOCK, decision.outcome)
    }

    // -- Remote/on-device classifier unavailable must never resolve to allow-all -----

    @Test
    fun `classifier omitted (unavailable) never overrides an existing block rule`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("still-blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST))
        val engine = WebFilterEngine(repo)

        // Caller represents "classifier unavailable" by simply omitting classifierResult --
        // exactly what a real Safe Browser caller does when ClassifierAvailability != AVAILABLE.
        val decision = engine.decide(FAMILY, "still-blocked.example", classifierResult = null)

        assertEquals(WebDecisionOutcome.BLOCK, decision.outcome)
    }

    @Test
    fun `classifier unavailable with no rule match falls back to deterministic default-allow, honestly scoped to DOMAIN_ONLY coverage`() {
        val repo = InMemoryWebRuleRepository()
        val engine = WebFilterEngine(repo)

        val withoutClassifier = engine.decide(FAMILY, "unrated.example", classifierResult = null)

        assertEquals(WebDecisionOutcome.ALLOW, withoutClassifier.outcome)
        assertEquals(WebReasonId.DEFAULT, withoutClassifier.reasonId)
        // The decisive proof this never "silently opens the gate" further than the deterministic
        // default already does: coverage never claims FULL_URL visibility a classifier would have
        // provided -- it stays at the same DOMAIN_ONLY level a real classifier BLOCK/REVIEW result
        // would have escalated past (compare against the FULL_URL-coverage REVIEW test above).
        assertEquals(WebDecisionCoverage.DOMAIN_ONLY, withoutClassifier.coverage)

        // A classifier that ran and reported ALLOW contributes no additional coverage claim either
        // -- decide() falls through to the identical default-allow path, so "classifier available
        // and it said allow" and "classifier unavailable" are honestly indistinguishable in coverage,
        // never overstating what was actually inspected.
        val withClassifierAllow = engine.decide(
            FAMILY,
            "unrated.example",
            classifierResult = ClassifierResult("v1", ClassifierModality.TEXT, ClassifierConfidenceBand.HIGH, ClassifierDisposition.ALLOW),
        )
        assertEquals(withoutClassifier.coverage, withClassifierAllow.coverage)

        // Only a classifier result that actually escalates (BLOCK/REVIEW) ever claims FULL_URL --
        // proving the coverage flag is a genuine signal, not a constant.
        val withClassifierReview = engine.decide(
            FAMILY,
            "unrated.example",
            classifierResult = ClassifierResult("v1", ClassifierModality.TEXT, ClassifierConfidenceBand.MEDIUM, ClassifierDisposition.REVIEW),
        )
        assertNotEquals(withoutClassifier.coverage, withClassifierReview.coverage)
        assertEquals(WebDecisionCoverage.FULL_URL, withClassifierReview.coverage)
    }

    // -- VPN metadata layer -----------------------------------------------

    @Test
    fun `VPN metadata reported UNAVAILABLE never claims network-layer coverage and still evaluates rules first`() {
        val repo = InMemoryWebRuleRepository()
        val engine = WebFilterEngine(repo)
        val vpnUnavailable = VpnMetadataDecision("no-tunnel.example", VpnDecisionOutcome.UNAVAILABLE, VpnDecisionCoverage.DOMAIN_ONLY)

        val decision = engine.decide(FAMILY, "no-tunnel.example", vpnDecision = vpnUnavailable)

        assertEquals(WebDecisionOutcome.ALLOW, decision.outcome)
        assertEquals(WebReasonId.VPN_UNAVAILABLE, decision.reasonId)
        assertEquals(WebDecisionCoverage.DOMAIN_ONLY, decision.coverage)
    }

    @Test
    fun `a rule match takes precedence over a VPN-reported block`() {
        val repo = InMemoryWebRuleRepository()
        repo.put(rule("allow-wins.example", WebRuleListType.ALLOW, WebRuleSource.PARENT_ALLOWLIST))
        val engine = WebFilterEngine(repo)
        val vpnBlocked = VpnMetadataDecision("allow-wins.example", VpnDecisionOutcome.BLOCKED, VpnDecisionCoverage.DOMAIN_ONLY)

        val decision = engine.decide(FAMILY, "allow-wins.example", vpnDecision = vpnBlocked)

        assertEquals(WebDecisionOutcome.ALLOW, decision.outcome)
        assertEquals(WebDecisionSource.PARENT_ALLOWLIST, decision.source)
    }
}
