package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/**
 * Exercises mission section 12's reboot-offline contract: "policy accepted -> Internet lost ->
 * process/device restart -> policy reloaded from local persistence -> same schedule decision
 * still produced." Simulates a process restart by discarding the first [ScheduleRuntime]/store
 * pair and constructing a brand new one from only the persisted [SchedulePolicySnapshot] --
 * exactly the shape Agent 12's durable [SchedulePolicyStore] implementation must support.
 */
class ScheduleRuntimeRebootOfflineTest {

    private fun bedtimePolicy(revision: Int = 1) = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = revision,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "Asia/Riyadh",
        windows = listOf(
            ScheduleWindow(
                id = "bedtime",
                kind = ScheduleWindowKind.BEDTIME,
                daysOfWeek = listOf(0, 1, 2, 3, 4, 5, 6),
                start = TimeOfDay(22, 0),
                end = TimeOfDay(6, 0),
                appScope = AppScope.All,
                timezone = "Asia/Riyadh",
            ),
        ),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
    )

    @Test
    fun `offline restart reproduces the identical decision from persisted state alone`() {
        val nowUtc = Instant.parse("2026-01-07T20:00:00Z") // 23:00 Asia/Riyadh -- inside bedtime
        val snapshot = SchedulePolicySnapshot(
            candidatePolicy = bedtimePolicy(),
            lastKnownGoodPolicy = bedtimePolicy(),
            lastPolicySyncAtUtc = Instant.parse("2026-01-06T00:00:00Z"),
            deviceTrustSetEpoch = 1,
            deviceKeyEpoch = 1,
        )

        val beforeRestart = run {
            val store = InMemorySchedulePolicyStore()
            store.save(snapshot)
            ScheduleRuntime(store).evaluate(nowUtc, "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)
        }

        // Simulate: process restart, Internet lost, policy reloaded from durable persistence
        // (here, a freshly-constructed store seeded only from the same snapshot bytes -- a real
        // implementation reloads from disk).
        val afterRestartOffline = run {
            val reloadedStore = InMemorySchedulePolicyStore()
            reloadedStore.save(snapshot)
            ScheduleRuntime(reloadedStore).evaluate(nowUtc, "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE)
        }

        assertEquals(beforeRestart.decision.decision, afterRestartOffline.decision.decision)
        assertEquals(beforeRestart.decision.matchedWindowId, afterRestartOffline.decision.matchedWindowId)
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, afterRestartOffline.decision.decision)
    }

    @Test
    fun `offline for a long duration does not disable restrictions`() {
        val snapshot = SchedulePolicySnapshot(
            candidatePolicy = bedtimePolicy(),
            lastKnownGoodPolicy = bedtimePolicy(),
            lastPolicySyncAtUtc = Instant.parse("2026-01-01T00:00:00Z"), // long stale
            deviceTrustSetEpoch = 1,
            deviceKeyEpoch = 1,
        )
        val store = InMemorySchedulePolicyStore()
        store.save(snapshot)
        val runtime = ScheduleRuntime(store)

        val nowUtc = Instant.parse("2026-01-10T20:00:00Z") // 9 days offline, still 23:00 Riyadh bedtime
        val result = runtime.evaluate(nowUtc, "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE)

        assertEquals(ScheduleRuntimeState.STALE_REMOTE, result.runtimeState)
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, result.decision.decision)
    }

    @Test
    fun `WELL-3 bedtime and quiet-context helpers reflect the same effective policy`() {
        val store = InMemorySchedulePolicyStore()
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = bedtimePolicy(),
                lastKnownGoodPolicy = bedtimePolicy(),
                lastPolicySyncAtUtc = Instant.parse("2026-01-07T00:00:00Z"),
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )
        val runtime = ScheduleRuntime(store)

        val duringBedtime = Instant.parse("2026-01-07T20:00:00Z") // 23:00 Riyadh
        val duringMidday = Instant.parse("2026-01-07T09:00:00Z") // 12:00 Riyadh

        assertEquals(true, runtime.isPcaBedtimeActive(duringBedtime))
        assertEquals(true, runtime.isScheduledQuietContext(duringBedtime))
        assertEquals(false, runtime.isPcaBedtimeActive(duringMidday))
        assertEquals(false, runtime.isScheduledQuietContext(duringMidday))
    }
}
