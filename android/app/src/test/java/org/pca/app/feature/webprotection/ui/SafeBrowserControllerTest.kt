package org.pca.app.feature.webprotection.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.webprotection.engine.InMemoryWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebFilterEngine
import org.pca.app.feature.webprotection.identity.WebProtectionIdentity
import org.pca.app.feature.webprotection.identity.WebProtectionIdentityContextProvider
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.feature.webprotection.safebrowser.ParentUnblockRequestService
import org.pca.app.feature.webprotection.safebrowser.PersistentParentUnblockRequestRepository
import org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.FamilySyncRuntimePort
import org.robolectric.RobolectricTestRunner

private const val FAMILY = "family-1"
private const val AWAIT_TIMEOUT_MILLIS = 5_000L

private class FixedIdentity(private val identity: WebProtectionIdentity) : WebProtectionIdentityContextProvider {
    override fun current(): WebProtectionIdentity = identity
}

private class FakeFamilySyncRuntimePort(private var state: FamilySyncConnectionState) : FamilySyncRuntimePort {
    val submittedRequests = mutableListOf<ChildRequestPayload>()
    override fun currentConnectionState(): FamilySyncConnectionState = state
    override fun lastSuccessfulSyncEpochMillis(): Long? = null
    override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean {
        submittedRequests.add(request)
        return true
    }
}

/**
 * [org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy.evaluateNavigation]
 * is invoked from a background coroutine launched by [SafeBrowserController] (never blocking the
 * WebView chrome thread), and a BLOCK/REVIEW outcome performs a real Room write through
 * [WebVisitRepository] on its own executor thread -- genuinely asynchronous relative to this test
 * method, not just dispatcher bookkeeping. These tests therefore poll for the expected terminal
 * state with a bounded real-time timeout rather than assuming synchronous completion.
 */
@RunWith(RobolectricTestRunner::class)
class SafeBrowserControllerTest {
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
    fun tearDown() { db.close() }

    private fun controller(
        identity: WebProtectionIdentity = WebProtectionIdentity.Trusted(FAMILY, "profile-1", "device-1"),
        syncPort: FamilySyncRuntimePort = FakeFamilySyncRuntimePort(FamilySyncConnectionState.OFFLINE),
    ): SafeBrowserController = SafeBrowserController(
        identityContextProvider = FixedIdentity(identity),
        navigationPolicy = SafeBrowserNavigationPolicy(WebFilterEngine(rules), webVisits),
        unblockRequestService = ParentUnblockRequestService(PersistentParentUnblockRequestRepository(InMemoryPersistentStateStore())),
        childRequestQueue = ChildRequestOfflineQueue(InMemoryPersistentStateStore()),
        familySyncRuntimePort = syncPort,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
    )

    private fun awaitHeld(controller: SafeBrowserController): SafeBrowserScreenState.Held {
        val deadline = System.currentTimeMillis() + AWAIT_TIMEOUT_MILLIS
        while (System.currentTimeMillis() < deadline) {
            val current = controller.screenState.value
            if (current is SafeBrowserScreenState.Held) return current
            Thread.sleep(10)
        }
        throw AssertionError("expected Held state within timeout, got ${controller.screenState.value}")
    }

    private fun awaitAskParentState(controller: SafeBrowserController, expected: AskParentState): SafeBrowserScreenState.Held {
        val deadline = System.currentTimeMillis() + AWAIT_TIMEOUT_MILLIS
        while (System.currentTimeMillis() < deadline) {
            val current = controller.screenState.value
            if (current is SafeBrowserScreenState.Held && current.askParentState == expected) return current
            Thread.sleep(10)
        }
        throw AssertionError("expected AskParentState.$expected within timeout, got ${controller.screenState.value}")
    }

    @Test
    fun `an allowed https navigation is approved for load`() {
        val controller = controller()

        controller.onMainFrameNavigation("https://safe-site.example/")

        assertEquals("https://safe-site.example/", controller.pendingApprovedLoad)
        assertTrue(controller.screenState.value is SafeBrowserScreenState.Browsing)
    }

    @Test
    fun `a denied domain is held, never approved for load`() {
        rules.put(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))
        val controller = controller()

        controller.onMainFrameNavigation("https://blocked.example/")

        val held = awaitHeld(controller)
        assertEquals(null, controller.pendingApprovedLoad)
        assertEquals("blocked.example", held.decision.domain)
    }

    @Test
    fun `javascript scheme is rejected outright, never reaches the navigation policy`() {
        val controller = controller()

        val outcome = controller.onMainFrameNavigation("javascript:alert(1)")

        assertEquals(NavigationRequestOutcome.DoNotLoad, outcome)
        assertEquals(null, controller.pendingApprovedLoad)
        assertTrue(controller.screenState.value is SafeBrowserScreenState.Browsing)
    }

    @Test
    fun `file scheme is rejected outright`() {
        val controller = controller()
        val outcome = controller.onMainFrameNavigation("file:///etc/hosts")
        assertEquals(NavigationRequestOutcome.DoNotLoad, outcome)
        assertEquals(null, controller.pendingApprovedLoad)
    }

    @Test
    fun `intent scheme is rejected outright`() {
        val controller = controller()
        val outcome = controller.onMainFrameNavigation("intent://scan/#Intent;scheme=zxing;end")
        assertEquals(NavigationRequestOutcome.DoNotLoad, outcome)
        assertEquals(null, controller.pendingApprovedLoad)
    }

    @Test
    fun `a redirect target that is itself denied is held even though the original URL was allowed`() {
        rules.put(WebRule("redirect-target.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))
        val controller = controller()

        controller.onMainFrameNavigation("https://safe-site.example/")
        assertEquals("https://safe-site.example/", controller.pendingApprovedLoad)
        // Chrome layer re-calls with the exact approved URL to actually load it.
        controller.onMainFrameNavigation("https://safe-site.example/")
        controller.onPageFinished("https://safe-site.example/", canGoBack = false)

        // Server redirect target -- must be independently re-evaluated (doc 7), not inherit the approval.
        controller.onMainFrameNavigation("https://redirect-target.example/")

        val held = awaitHeld(controller)
        assertEquals("redirect-target.example", held.decision.domain)
    }

    @Test
    fun `Safe Limited Mode -- TrustedFamilyContextUnavailable never evaluates family-scoped rules but still blocks the security feed`() {
        rules.put(WebRule("parent-blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))
        rules.put(WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L))
        val controller = controller(identity = WebProtectionIdentity.TrustedFamilyContextUnavailable)

        assertEquals(WebProtectionCoverage.SAFE_LIMITED_MODE_GLOBAL_ONLY, controller.coverage)

        controller.onMainFrameNavigation("https://malware.example/")
        val held = awaitHeld(controller)
        assertEquals("malware.example", held.decision.domain)

        val controller2 = controller(identity = WebProtectionIdentity.TrustedFamilyContextUnavailable)
        controller2.onMainFrameNavigation("https://parent-blocked.example/")
        // No family context -> the family-scoped rule must never match; this stays in Browsing (approved for load).
        assertEquals("https://parent-blocked.example/", controller2.pendingApprovedLoad)
    }

    @Test
    fun `Ask Parent while offline queues locally as PENDING_SYNC_LOCAL, never a self-approval`() {
        rules.put(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))
        val syncPort = FakeFamilySyncRuntimePort(FamilySyncConnectionState.OFFLINE)
        val controller = controller(syncPort = syncPort)
        controller.onMainFrameNavigation("https://blocked.example/")
        awaitHeld(controller)

        controller.submitAskParent()

        val held = awaitAskParentState(controller, AskParentState.PENDING_SYNC_LOCAL)
        assertEquals(AskParentState.PENDING_SYNC_LOCAL, held.askParentState)
        assertTrue(syncPort.submittedRequests.isEmpty())
    }

    @Test
    fun `Ask Parent while the family sync port is LIVE is actually submitted`() {
        rules.put(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, FAMILY, 0L))
        val syncPort = FakeFamilySyncRuntimePort(FamilySyncConnectionState.LIVE)
        val controller = controller(syncPort = syncPort)
        controller.onMainFrameNavigation("https://blocked.example/")
        awaitHeld(controller)

        controller.submitAskParent()

        val held = awaitAskParentState(controller, AskParentState.SUBMITTED_TO_PARENT)
        assertEquals(1, syncPort.submittedRequests.size)
        assertEquals("WEB_UNBLOCK_REQUEST", syncPort.submittedRequests.single().kind)
        assertEquals("blocked.example", held.decision.domain)
    }

    @Test
    fun `a non-overridable SECURITY_DENYLIST block cannot be requested from a parent`() {
        rules.put(WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L))
        val controller = controller()
        controller.onMainFrameNavigation("https://malware.example/")
        awaitHeld(controller)

        controller.submitAskParent()

        val held = awaitAskParentState(controller, AskParentState.NOT_REQUESTABLE)
        assertEquals(false, held.decision.requestable)
    }
}
