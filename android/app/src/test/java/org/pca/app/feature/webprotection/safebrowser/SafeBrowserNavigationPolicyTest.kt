package org.pca.app.feature.webprotection.safebrowser

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.webprotection.engine.InMemoryWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebFilterEngine
import org.pca.app.feature.webprotection.policy.ClassifierConfidenceBand
import org.pca.app.feature.webprotection.policy.ClassifierDisposition
import org.pca.app.feature.webprotection.policy.ClassifierModality
import org.pca.app.feature.webprotection.policy.ClassifierResult
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.WebVisitRepository
import org.robolectric.RobolectricTestRunner

private const val FAMILY = "family-1"
private const val PROFILE = "profile-1"
private const val DEVICE = "device-1"

@RunWith(RobolectricTestRunner::class)
class SafeBrowserNavigationPolicyTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var webVisits: WebVisitRepository
    private lateinit var rules: InMemoryWebRuleRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        webVisits = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())
        rules = InMemoryWebRuleRepository()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun policy() = SafeBrowserNavigationPolicy(WebFilterEngine(rules), webVisits)

    @Test
    fun `an allowed navigation is never persisted locally`() = runTest {
        val outcome = policy().evaluateNavigation(FAMILY, PROFILE, DEVICE, "https://safe-site.example/page")

        assertTrue(outcome is NavigationOutcome.Allow)
        assertEquals(0, webVisits.getForDevice(DEVICE).size)
    }

    @Test
    fun `a blocked navigation persists full URL and title scoped to the Safe Browser context only`() = runTest {
        rules.put(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))

        val outcome = policy().evaluateNavigation(
            FAMILY, PROFILE, DEVICE,
            url = "https://blocked.example/some/secret/path",
            pageTitle = "A Blocked Page",
        )

        assertTrue(outcome is NavigationOutcome.Held)
        val held = outcome as NavigationOutcome.Held
        assertEquals(WebDecisionOutcome.BLOCK, held.blockDecision.outcome)
        assertTrue(held.blockDecision.requestable)

        val stored = webVisits.getForDevice(DEVICE).single()
        assertEquals(WebVisitAction.BLOCKED, stored.action)
        assertEquals("https://blocked.example/some/secret/path", stored.url)
        assertEquals("A Blocked Page", stored.title)
        assertEquals("blocked.example", stored.domain)
    }

    @Test
    fun `a security block is held but not requestable for parent review`() = runTest {
        rules.put(WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L))

        val outcome = policy().evaluateNavigation(FAMILY, PROFILE, DEVICE, "https://malware.example/")

        val held = outcome as NavigationOutcome.Held
        assertEquals(false, held.blockDecision.requestable)
    }

    @Test
    fun `a classifier REVIEW disposition is held for review, not persisted as an outright BLOCK`() = runTest {
        val classifierResult = ClassifierResult(
            modelVersion = "v1",
            modality = ClassifierModality.TEXT,
            confidenceBand = ClassifierConfidenceBand.MEDIUM,
            disposition = ClassifierDisposition.REVIEW,
        )

        val outcome = policy().evaluateNavigation(
            FAMILY, PROFILE, DEVICE,
            url = "https://ambiguous-content.example/page",
            pageTitle = "Ambiguous Page",
            classifierResult = classifierResult,
        )

        val held = outcome as NavigationOutcome.Held
        assertEquals(WebDecisionOutcome.REVIEW, held.blockDecision.outcome)

        val stored = webVisits.getForDevice(DEVICE).single()
        assertEquals(WebVisitAction.REVIEW, stored.action)
    }

    @Test
    fun `an invalid URL raises NavigationError InvalidUrl rather than silently allowing`() = runTest {
        try {
            policy().evaluateNavigation(FAMILY, PROFILE, DEVICE, url = "http://192.168.0.1/")
            assertTrue("expected NavigationError.InvalidUrl", false)
        } catch (e: NavigationError.InvalidUrl) {
            // expected -- an unparseable/IP-literal destination is never silently treated as allowed.
        }
    }
}
