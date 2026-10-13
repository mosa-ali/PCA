package org.pca.app.runtime.schedule

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopedSchedulePolicyStoreTest {
    private fun scope(familyId: String, childProfileId: String, deviceId: String? = null) =
        SchedulePolicyStorageScope(
            familyId = familyId,
            childProfileId = childProfileId,
            recipientDeviceId = deviceId,
        )

    private fun runtimeScope(scope: SchedulePolicyStorageScope) =
        SchedulePolicyRuntimeScope(
            familyId = scope.familyId,
            childProfileId = scope.childProfileId,
            trustSetEpoch = 2,
            keyEpoch = 3,
        )

    private fun snapshot(
        familyId: String,
        childProfileId: String,
        policyId: String,
        withBedtime: Boolean = false,
    ): SchedulePolicySnapshot {
        val policy = SchedulePolicyV1(
            policyId = policyId,
            policyRevision = 1,
            familyId = familyId,
            childProfileId = childProfileId,
            timezone = if (withBedtime) "Asia/Riyadh" else "UTC",
            windows = if (!withBedtime) emptyList() else listOf(
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
            trustSetEpoch = 2,
            keyEpoch = 3,
            issuedAt = Instant.parse("2026-10-01T00:00:00Z"),
            effectiveFrom = Instant.parse("2026-10-01T00:00:00Z"),
        )
        return SchedulePolicySnapshot(
            candidatePolicy = policy,
            lastKnownGoodPolicy = policy,
            lastPolicySyncAtUtc = Instant.parse("2026-10-02T00:00:00Z"),
            deviceTrustSetEpoch = 2,
            deviceKeyEpoch = 3,
        )
    }

    @Test
    fun `process restart restores only the exact family profile and recipient device namespace`() {
        var activeScope = scope("family-a", "child-a", "device-a")
        val beforeRestart = DiskBackedPersistentStateStore()
        val first = ScopedSchedulePolicyStore(beforeRestart, { activeScope })
        val familyASnapshot = snapshot("family-a", "child-a", "policy-a", withBedtime = true)
        first.save(familyASnapshot)

        val afterRestart = beforeRestart.afterProcessDeath()
        val restarted = ScopedSchedulePolicyStore(afterRestart, { activeScope })
        assertEquals(SchedulePolicyStoreRead.Present(familyASnapshot), restarted.read())
        val nowUtc = Instant.parse("2026-10-07T20:00:00Z") // 23:00 Asia/Riyadh, inside bedtime
        val runtimeA = ScheduleRuntime(restarted, currentPolicyScopeProvider = { runtimeScope(activeScope) })
        assertEquals(
            ScheduleDecisionKind.BLOCKED_BEDTIME,
            runtimeA.evaluate(nowUtc, "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE).decision.decision,
        )

        activeScope = scope("family-b", "child-b", "device-b")
        assertEquals(SchedulePolicyStoreRead.Absent, restarted.read())
        val runtimeB = ScheduleRuntime(restarted, currentPolicyScopeProvider = { runtimeScope(activeScope) })
        val beforeBPolicy = runtimeB.evaluate(
            nowUtc,
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.OFFLINE,
        )
        assertEquals(ScheduleRuntimeState.NO_ACCEPTED_POLICY, beforeBPolicy.runtimeState)
        assertNull(beforeBPolicy.effectivePolicy)
        val familyBSnapshot = snapshot("family-b", "child-b", "policy-b")
        restarted.save(familyBSnapshot)
        assertEquals(SchedulePolicyStoreRead.Present(familyBSnapshot), restarted.read())

        activeScope = scope("family-a", "child-a", "device-a")
        assertEquals(SchedulePolicyStoreRead.Present(familyASnapshot), restarted.read())
        assertTrue(afterRestart.durableSnapshot().keys.none { key ->
            key.contains("family-a") || key.contains("child-a") || key.contains("device-a")
        })
    }

    @Test
    fun `legacy global snapshot migrates only for exact embedded family profile and remains retained`() {
        val disk = DiskBackedPersistentStateStore()
        val accepted = snapshot("family-a", "child-a", "policy-a")
        PersistentSchedulePolicyStore(disk).save(accepted)
        val legacyBeforeMigration = disk.durableSnapshot()
        var activeScope = scope("family-a", "child-a")
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })

        assertEquals(SchedulePolicyStoreRead.Present(accepted), scoped.read())
        assertEquals(legacyBeforeMigration, disk.durableSnapshot().filterKeys { it.startsWith("schedule_policy_snapshot_v1") })
        assertTrue(disk.durableSnapshot().keys.any { it.startsWith("schedule_policy_scope_v1:") })

        activeScope = scope("family-b", "child-b")
        assertEquals(SchedulePolicyStoreRead.Absent, scoped.read())
        assertTrue(disk.durableSnapshot().keys.any { it.startsWith("schedule_policy_snapshot_v1") })
    }

    @Test
    fun `device-bound scope does not adopt legacy bytes that lack a recipient device binding`() {
        val disk = DiskBackedPersistentStateStore()
        val accepted = snapshot("family-a", "child-a", "policy-a")
        PersistentSchedulePolicyStore(disk).save(accepted)
        var activeScope = scope("family-a", "child-a", "device-a")
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })

        assertEquals(SchedulePolicyStoreRead.Absent, scoped.read())
        assertFalse(disk.durableSnapshot().keys.any { it.startsWith("schedule_policy_scope_v1:") })
        assertTrue(disk.durableSnapshot().keys.any { it.startsWith("schedule_policy_snapshot_v1") })
    }

    @Test
    fun `family profile and recipient device each isolate stored policy`() {
        val disk = DiskBackedPersistentStateStore()
        var activeScope = scope("family-a", "child-a", "device-a")
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })
        scoped.save(snapshot("family-a", "child-a", "policy-a"))

        listOf(
            scope("family-b", "child-a", "device-a"),
            scope("family-a", "child-b", "device-a"),
            scope("family-a", "child-a", "device-b"),
        ).forEach { changedScope ->
            activeScope = changedScope
            assertEquals(SchedulePolicyStoreRead.Absent, scoped.read())
        }
    }

    @Test
    fun `length-prefixed scope digest separates ambiguous family profile concatenations`() {
        val disk = DiskBackedPersistentStateStore()
        var activeScope = scope("ab", "c")
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })
        val first = snapshot("ab", "c", "policy-ab-c")
        scoped.save(first)

        activeScope = scope("a", "bc")
        assertEquals(SchedulePolicyStoreRead.Absent, scoped.read())

        val second = snapshot("a", "bc", "policy-a-bc")
        scoped.save(second)
        activeScope = scope("ab", "c")
        assertEquals(SchedulePolicyStoreRead.Present(first), scoped.read())
        activeScope = scope("a", "bc")
        assertEquals(SchedulePolicyStoreRead.Present(second), scoped.read())
    }

    @Test
    fun `recipient device change between load and validation is rejected by every runtime consumer`() {
        val deviceA = scope("family-a", "child-a", "device-a")
        val deviceB = scope("family-a", "child-a", "device-b")
        fun runtimeWithDeviceTransition(): Pair<ScheduleRuntime, () -> Boolean> {
            val disk = DiskBackedPersistentStateStore()
            var activeScope = deviceA
            var switchDeviceAfterReadScopeCapture = false
            val scoped = ScopedSchedulePolicyStore(disk, currentScopeProvider = {
                val captured = activeScope
                if (switchDeviceAfterReadScopeCapture) {
                    switchDeviceAfterReadScopeCapture = false
                    activeScope = deviceB
                }
                captured
            })
            scoped.save(snapshot("family-a", "child-a", "policy-a", withBedtime = true))
            switchDeviceAfterReadScopeCapture = true
            var rejectedTransition = false
            val runtime = ScheduleRuntime(scoped, currentPolicyScopeProvider = {
                if (scoped.lastReadMatchesScope(activeScope)) runtimeScope(activeScope)
                else {
                    rejectedTransition = true
                    null
                }
            })
            return runtime to { rejectedTransition }
        }

        val (evaluatingRuntime, evaluateRejectedTransition) = runtimeWithDeviceTransition()
        val result = evaluatingRuntime.evaluate(
            Instant.parse("2026-10-07T20:00:00Z"),
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.OFFLINE,
        )
        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertNull(result.effectivePolicy)
        assertTrue(evaluateRejectedTransition())

        val (bedtimeRuntime, bedtimeRejectedTransition) = runtimeWithDeviceTransition()
        assertFalse(bedtimeRuntime.isPcaBedtimeActive(Instant.parse("2026-10-07T20:00:00Z")))
        assertTrue(bedtimeRejectedTransition())

        val (quietRuntime, quietRejectedTransition) = runtimeWithDeviceTransition()
        assertFalse(quietRuntime.isScheduledQuietContext(Instant.parse("2026-10-07T20:00:00Z")))
        assertTrue(quietRejectedTransition())
    }

    @Test
    fun `concurrent read for another device cannot overwrite caller read scope token`() {
        val disk = DiskBackedPersistentStateStore()
        val deviceA = scope("family-a", "child-a", "device-a")
        val deviceB = scope("family-a", "child-a", "device-b")
        var activeScope = deviceA
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })
        val deviceASnapshot = snapshot("family-a", "child-a", "policy-a", withBedtime = true)
        scoped.save(deviceASnapshot)
        var interleaveOtherDeviceRead = true
        var otherDeviceRead: SchedulePolicyStoreRead? = null
        val runtime = ScheduleRuntime(scoped, currentPolicyScopeProvider = {
            val currentScope = activeScope
            if (interleaveOtherDeviceRead) {
                interleaveOtherDeviceRead = false
                activeScope = deviceB
                val otherDeviceReader = Thread { otherDeviceRead = scoped.read() }
                otherDeviceReader.start()
                otherDeviceReader.join()
                activeScope = deviceA
            }
            if (scoped.lastReadMatchesScope(currentScope)) runtimeScope(currentScope) else null
        })

        val result = runtime.evaluate(
            Instant.parse("2026-10-07T20:00:00Z"),
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(SchedulePolicyStoreRead.Absent, otherDeviceRead)
        assertEquals(ScheduleRuntimeState.CURRENT, result.runtimeState)
        assertEquals(deviceASnapshot.candidatePolicy, result.effectivePolicy)
    }

    @Test
    fun `save rejects a policy snapshot whose embedded scope is not the active recipient scope`() {
        val disk = DiskBackedPersistentStateStore()
        val activeScope = scope("family-a", "child-a", "device-a")
        val scoped = ScopedSchedulePolicyStore(disk, { activeScope })

        val failure = runCatching { scoped.save(snapshot("family-b", "child-b", "policy-b")) }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertEquals(SchedulePolicyStoreRead.Absent, scoped.read())
        assertTrue(disk.durableSnapshot().isEmpty())
    }
}
