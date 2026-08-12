package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.ports.BreakStateSource
import org.pca.app.feature.wellbeing.ports.EligibleAppSignalSource
import org.pca.app.feature.wellbeing.ports.NotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.ScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.SuppressionContextSource
import org.pca.app.feature.wellbeing.ports.WallClockCalendarSource
import org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource
import org.pca.app.feature.wellbeing.policy.ScheduleWindowEvaluator.WallClockSnapshot
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.MonotonicTimeSource

/**
 * End-to-end offline proof that the parent-policy adapter feeds
 * [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine] and
 * [WellbeingTriggerDispatcher] completely unchanged, with no network dependency anywhere in the
 * path (item 18) -- every test here uses only [InMemoryPersistentStateStore] and hand-built fakes,
 * never a real transport.
 */
class ParentPolicyOfflineIntegrationTest {

    private class FakeMonotonicTimeSource(var now: Long = 0L) : MonotonicTimeSource {
        override fun elapsedRealtimeMillis(): Long = now / 1_000_000
        override fun elapsedRealtimeNanos(): Long = now
    }

    private object NullEligibleAppSignalSource : EligibleAppSignalSource {
        override fun currentEligibleAppToken(): String? = null
    }

    private class FixedScreenLockStateSource(val locked: Boolean) : ScreenLockStateSource {
        override fun isScreenLocked(): Boolean = locked
    }

    private object AlwaysCapableNotificationSource : NotificationCapabilitySource {
        override fun notificationsEnabled(): Boolean = true
        override fun lockScreenNotificationsAvailable(): Boolean = true
    }

    private object NoSuppressionContextSource : SuppressionContextSource {
        override fun isEmergencyActive(): Boolean = false
        override fun isCallActive(): Boolean = false
        override fun isNavigationOrSafetyContextActive(): Boolean = false
        override fun isSchoolModeActive(): Boolean = false
        override fun isCriticalWarningActive(): Boolean = false
        override fun isDegradedOrErrorFlow(): Boolean = false
    }

    private object NoBreakStateSource : BreakStateSource {
        override fun isBreakShieldActive(): Boolean = false
    }

    private class FixedWallClock(val minute: Int) : WallClockCalendarSource {
        override fun minuteOfDay(): Int = minute
    }

    /** Fake for the pre-existing WELL-3 seam (item 14) -- this test USES the seam, never
     * reimplements bedtime/schedule logic itself. */
    private class FakeScheduleContextSource(var bedtimeActive: Boolean = false) : WellbeingScheduleContextSource {
        override fun isPcaBedtimeActive(): Boolean = bedtimeActive
        override fun isScheduledQuietContext(): Boolean = false
    }

    private fun dispatcher(
        clock: FakeMonotonicTimeSource,
        scheduleSource: WellbeingScheduleContextSource = FakeScheduleContextSource(),
    ) = WellbeingTriggerDispatcher(
        monotonicTimeSource = clock,
        eligibleAppSignalSource = NullEligibleAppSignalSource,
        screenLockStateSource = FixedScreenLockStateSource(locked = false),
        notificationCapabilitySource = AlwaysCapableNotificationSource,
        suppressionContextSource = NoSuppressionContextSource,
        breakStateSource = NoBreakStateSource,
        wallClockCalendarSource = FixedWallClock(minute = 720),
        scheduleContextSource = scheduleSource,
    )

    private val now = WallClockSnapshot("2026-08-12", "WED", 720)
    private val childId = "child-1"

    private fun customMessage(
        category: SdkWellbeingCategory,
        triggers: Set<SdkWellbeingTrigger>,
        requiresAdultSupervision: Boolean = false,
        lockScreenAllowed: Boolean = false,
    ) = SdkCustomWellbeingMessage(
        messageId = "family-msg-1",
        enabled = true,
        category = category,
        languageTexts = mapOf("en" to SdkLanguageText("Family idea", "Do something kind for a sibling today.")),
        schedule = SdkScheduleWindow(),
        delivery = SdkDeliveryPolicy(
            triggers = triggers,
            minimumIntervalMinutes = 5,
            maximumPerDay = 6,
            repeatCooldownMinutes = 15,
            lockScreenAllowed = lockScreenAllowed,
            requiresAdultSupervision = requiresAdultSupervision,
        ),
        target = SdkTargetScope(SdkTargetMode.ALL_CHILDREN),
    )

    // --- item 6: GIVE_ME_AN_IDEA works fully offline from curated + synced custom content -------

    @Test
    fun `offline give-me-an-idea delivers a locally-synced custom suggestion with no network call`() {
        val message = customMessage(SdkWellbeingCategory.CUSTOM, setOf(SdkWellbeingTrigger.CHILD_REQUESTED_IDEA))
        val parentPolicy = ParentWellbeingPolicyV1(
            policyId = "f", policyRevision = 1, familyScopeRef = "s",
            targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = true,
            customMessages = listOf(message),
        )
        // Restrict eligible categories to the adapter-only PARENT_CUSTOM_OTHER bucket (which has
        // zero curated catalogue entries by design) so the picked suggestion is unambiguously ours.
        val basePolicy = WellbeingNudgePolicy(enabledCategories = setOf(WellbeingCategory.PARENT_CUSTOM_OTHER))
        val derivedPolicy = ParentPolicyToAndroidPolicyAdapter.derivePolicy(basePolicy, parentPolicy)
        val curated = ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor(parentPolicy)
        val customPool = ParentCustomMessagePool.eligibleFor(
            parentPolicy.customMessages, NudgeTrigger.CHILD_REQUESTED_IDEA, childId, "en", now,
        )

        val clock = FakeMonotonicTimeSource(now = 1_000_000_000L)
        val (selection, _) = dispatcher(clock).dispatch(
            NudgeTrigger.CHILD_REQUESTED_IDEA, derivedPolicy, NudgeRateState(), curated, customPool,
        )

        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
        val picked = selection.suggestions.single()
        assertTrue(picked.isCustom)
        assertEquals(WellbeingCategory.PARENT_CUSTOM_OTHER, picked.category)
    }

    // --- item 8: adult-supervision hard gate holds offline, through the unchanged engine gate ---

    @Test
    fun `adult-supervision-required synced custom message is excluded from lock-screen delivery even after offline reload`() {
        val message = customMessage(
            SdkWellbeingCategory.HOME_RESPONSIBILITY,
            triggers = setOf(SdkWellbeingTrigger.PERIODIC),
            requiresAdultSupervision = true,
            lockScreenAllowed = true, // deliberately hostile input: parent payload claims lock-screen-allowed
        )
        val parentPolicy = ParentWellbeingPolicyV1(
            policyId = "f", policyRevision = 1, familyScopeRef = "s",
            targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = true,
            customMessages = listOf(message),
        )

        // Accept, promote, persist, then read back through a brand-new store instance -- this is
        // the "offline since acceptance" simulation (process death / no further connectivity).
        val backing = InMemoryPersistentStateStore()
        val stateStore = ParentPolicyStateStore(backing)
        val received = ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, parentPolicy, "op-1")
        stateStore.save(ParentPolicySyncCoordinator.promote(received.snapshot))

        val reloaded = ParentPolicyStateStore(backing).load()
        val reloadedMessage = reloaded.syncState.active!!.policy.customMessages.single()

        val produced = ParentCustomMessageAdapter.map(reloadedMessage, childId, "en", now)
        val suggestion = (produced as ParentCustomMessageAdapter.MappingResult.Produced).suggestion
        assertTrue(suggestion.requiresAdultSupervision)
        // Defense-in-depth: never lock-screen-safe once adult supervision is required, regardless
        // of what the payload's lockScreenAllowed claimed.
        assertFalse(suggestion.lockScreenSafe)

        val policy = WellbeingNudgePolicy(enabledCategories = setOf(WellbeingCategory.HOME_RESPONSIBILITY))
        val clock = FakeMonotonicTimeSource(now = 5_000_000_000L)
        val context = dispatcher(clock).buildContext(NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT)

        val (lockScreenSelection, _) = NudgeSelectionEngine.evaluate(
            policy, context, NudgeRateState(), catalogueEntries = emptyList(), customApprovedEntries = listOf(suggestion),
        )
        assertEquals(NudgeDeliveryStatus.NO_ELIGIBLE_SUGGESTION, lockScreenSelection.status)

        // Sanity: the SAME suggestion IS eligible on a clearly-foreground, interactive surface.
        val ideaContext = dispatcher(clock).buildContext(NudgeTrigger.CHILD_REQUESTED_IDEA)
        val (ideaSelection, _) = NudgeSelectionEngine.evaluate(
            policy, ideaContext, NudgeRateState(), catalogueEntries = emptyList(), customApprovedEntries = listOf(suggestion),
        )
        assertEquals(NudgeDeliveryStatus.DELIVERED, ideaSelection.status)
    }

    // --- FREQUENCY: adapter-derived frequency knobs are actually respected through the dispatcher

    @Test
    fun `adapter-derived minimum interval rate-limits the very next dispatch`() {
        val strict = customMessage(SdkWellbeingCategory.READING, setOf(SdkWellbeingTrigger.PERIODIC)).copy(
            delivery = SdkDeliveryPolicy(
                triggers = setOf(SdkWellbeingTrigger.PERIODIC),
                minimumIntervalMinutes = 30,
                maximumPerDay = 6,
                repeatCooldownMinutes = 15,
                lockScreenAllowed = false,
            ),
        )
        val parentPolicy = ParentWellbeingPolicyV1(
            policyId = "f", policyRevision = 1, familyScopeRef = "s",
            targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = true,
            customMessages = listOf(strict),
        )
        val base = WellbeingNudgePolicy() // default minimumInterval is much shorter than 30 minutes
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(base, parentPolicy)
        val curated = ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor(parentPolicy)

        val clock = FakeMonotonicTimeSource(now = 0L)
        val d = dispatcher(clock)
        val (first, rateAfterFirst) = d.dispatch(NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, derived, NudgeRateState(), curated)
        assertEquals(NudgeDeliveryStatus.DELIVERED, first.status)

        clock.now += 5.minutesToNanos() // well under the derived 30-minute floor
        val (second, _) = d.dispatch(NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, derived, rateAfterFirst, curated)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT, second.status)
    }

    private fun Int.minutesToNanos(): Long = this * 60L * 1_000_000_000L

    // --- item 14: the pre-existing WELL-3 schedule seam is consulted unchanged, never reimplemented

    @Test
    fun `PCA bedtime suppression via the existing WellbeingScheduleContextSource seam still applies through adapter-derived policy`() {
        val parentPolicy = ParentWellbeingPolicyV1(
            policyId = "f", policyRevision = 1, familyScopeRef = "s",
            targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = true,
        )
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(WellbeingNudgePolicy(), parentPolicy)
        val curated = ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor(parentPolicy)

        val clock = FakeMonotonicTimeSource(now = 0L)
        val bedtimeSource = FakeScheduleContextSource(bedtimeActive = true)
        val (selection, _) = dispatcher(clock, bedtimeSource).dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, derived, NudgeRateState(), curated,
        )
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME, selection.status)
    }

    // --- item 13: no reconnect backlog -----------------------------------------------------------

    @Test
    fun `promoting a policy received while offline never produces more than the single requested nudge on the next dispatch`() {
        val v1 = ParentWellbeingPolicyV1(
            policyId = "f", policyRevision = 1, familyScopeRef = "s",
            targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN), enabled = true,
        )
        val v2 = v1.copy(
            policyRevision = 2,
            customMessages = listOf(customMessage(SdkWellbeingCategory.READING, setOf(SdkWellbeingTrigger.PERIODIC))),
        )
        val afterV1 = ParentPolicySyncCoordinator.promote(
            ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1").snapshot,
        )
        // v2 "arrives" while offline and is only received, never promoted yet.
        val received = ParentPolicySyncCoordinator.receive(afterV1, v2, "op-2")
        assertEquals(1, received.snapshot.syncState.active?.revision)

        // Reconnect: promote v2 into effect.
        val promoted = ParentPolicySyncCoordinator.promote(received.snapshot)
        assertEquals(2, promoted.syncState.active?.revision)

        val activePolicy = promoted.syncState.active!!.policy
        val derived = ParentPolicyToAndroidPolicyAdapter.derivePolicy(WellbeingNudgePolicy(), activePolicy)
        val curated = ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor(activePolicy)
        val customPool = ParentCustomMessagePool.eligibleFor(
            activePolicy.customMessages, NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, childId, "en", now,
        )

        val clock = FakeMonotonicTimeSource(now = 0L)
        val (selection, _) = dispatcher(clock).dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, derived, NudgeRateState(), curated, customPool,
        )
        // Exactly one nudge for this one dispatch call -- nothing resembling a batch/backlog of
        // "everything that would have fired while v2 was pending" is ever produced.
        assertTrue(selection.suggestions.size <= 1)
    }
}
