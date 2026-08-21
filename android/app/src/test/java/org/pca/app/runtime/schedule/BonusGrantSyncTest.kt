package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * PCA-FR-130 ("Bonus Time") runtime-enforcement coverage: proves an
 * on-device-merged [BonusGrant] is actually honored by [ScheduleRuntime]/
 * [ScheduleEvaluator] -- extends the daily limit while active, reverts the
 * moment it expires, survives a simulated process restart without reviving
 * once expired, and never overrides bedtime. Mirrors
 * `ScheduleRuntimeRebootOfflineTest.kt`'s harness conventions exactly (a
 * fresh [InMemorySchedulePolicyStore]/[ScheduleRuntime] pair per phase,
 * simulating "process restart" by discarding the first pair and
 * constructing a brand new one from only the persisted [SchedulePolicySnapshot]).
 */
class BonusGrantSyncTest {

    private fun basePolicy(
        bonusGrants: List<BonusGrant> = emptyList(),
        windows: List<ScheduleWindow> = emptyList(),
        dailyLimits: List<DailyAppLimit> = emptyList(),
        revision: Int = 1,
    ) = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = revision,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "Asia/Riyadh",
        windows = windows,
        bonusGrants = bonusGrants,
        parentExceptions = emptyList(),
        dailyLimits = dailyLimits,
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-07T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-07T00:00:00Z"),
    )

    private fun snapshotOf(policy: SchedulePolicyV1) = SchedulePolicySnapshot(
        candidatePolicy = policy,
        lastKnownGoodPolicy = policy,
        lastPolicySyncAtUtc = Instant.parse("2026-01-07T00:00:00Z"),
        deviceTrustSetEpoch = 1,
        deviceKeyEpoch = 1,
    )

    private fun dailyLimit(used: Int = 30) =
        DailyAppLimit(appScope = AppScope.All, limitMinutes = 30, usedMinutesToday = used, anchorLocalDate = "2026-01-07")

    @Test
    fun `applying a decided grant extends the limit while active, and reverts once it expires`() {
        val store = InMemorySchedulePolicyStore()
        store.save(snapshotOf(basePolicy(dailyLimits = listOf(dailyLimit()))))

        val grant = BonusGrant(
            id = "grant-1",
            appScope = AppScope.All,
            extraMinutes = 15,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"),
            expiresAtUtc = Instant.parse("2026-01-07T09:15:00Z"),
        )
        val applied = BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc)
        assertTrue(applied is BonusGrantSync.ApplyResult.Applied)

        val runtime = ScheduleRuntime(store)
        val duringGrant = runtime.evaluate(
            Instant.parse("2026-01-07T09:05:00Z"), "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE,
        )
        assertEquals(ScheduleDecisionKind.ALLOWED_BONUS, duringGrant.decision.decision)

        val afterExpiry = runtime.evaluate(
            Instant.parse("2026-01-07T09:20:00Z"), "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, afterExpiry.decision.decision)
    }

    @Test
    fun `restart safety -- an expired grant does not revive after a simulated process restart, even offline`() {
        val grant = BonusGrant(
            id = "grant-1",
            appScope = AppScope.All,
            extraMinutes = 15,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"),
            expiresAtUtc = Instant.parse("2026-01-07T09:15:00Z"),
        )

        val persistedSnapshot = run {
            val store = InMemorySchedulePolicyStore()
            store.save(snapshotOf(basePolicy(dailyLimits = listOf(dailyLimit()))))
            val result = BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc) as BonusGrantSync.ApplyResult.Applied
            result.snapshot
        }

        // Simulate: process restart, Internet lost -- a BRAND NEW store/runtime pair, seeded only
        // from the persisted snapshot bytes, evaluated well past the grant's own absolute-UTC expiry.
        val reloadedStore = InMemorySchedulePolicyStore()
        reloadedStore.save(persistedSnapshot)
        val runtime = ScheduleRuntime(reloadedStore)
        // Same Riyadh calendar day as the daily limit's own anchorLocalDate (2026-01-07) -- a
        // different LOCAL day would legitimately reset usedMinutesToday, which is a different
        // mechanism (the daily-limit reset) than what this test is proving (the grant itself does
        // not survive its own expiry across a restart).
        val result = runtime.evaluate(
            Instant.parse("2026-01-07T15:00:00Z"), "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, result.decision.decision)
    }

    @Test
    fun `offline device does not treat an expired grant as unlimited -- fails safe to the ordinary limit`() {
        val store = InMemorySchedulePolicyStore()
        store.save(snapshotOf(basePolicy(dailyLimits = listOf(dailyLimit()))))
        val grant = BonusGrant(
            id = "grant-1",
            appScope = AppScope.All,
            extraMinutes = 15,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"),
            expiresAtUtc = Instant.parse("2026-01-07T09:15:00Z"),
        )
        BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc)
        val runtime = ScheduleRuntime(store)

        // Offline, well past the grant's own expiry but still the SAME Riyadh calendar day as the
        // daily limit's anchorLocalDate (see the restart-safety test's comment above for why that
        // matters) -- must never fall back to "unlimited".
        val result = runtime.evaluate(
            Instant.parse("2026-01-07T18:00:00Z"), "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, result.decision.decision)
    }

    @Test
    fun `an active bonus grant does not override an active bedtime window`() {
        val store = InMemorySchedulePolicyStore()
        val bedtime = ScheduleWindow(
            id = "bedtime",
            kind = ScheduleWindowKind.BEDTIME,
            daysOfWeek = listOf(0, 1, 2, 3, 4, 5, 6),
            start = TimeOfDay(21, 30),
            end = TimeOfDay(7, 0),
            appScope = AppScope.All,
            timezone = "Asia/Riyadh",
        )
        store.save(snapshotOf(basePolicy(windows = listOf(bedtime), dailyLimits = listOf(dailyLimit()))))

        val grant = BonusGrant(
            id = "grant-1",
            appScope = AppScope.All,
            extraMinutes = 60,
            grantedAtUtc = Instant.parse("2026-01-07T00:00:00Z"),
            expiresAtUtc = Instant.parse("2026-01-08T00:00:00Z"),
        )
        BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc)

        val runtime = ScheduleRuntime(store)
        // 23:00 Riyadh -- inside the bedtime window, and well within the (still-active) bonus grant.
        val result = runtime.evaluate(
            Instant.parse("2026-01-07T20:00:00Z"), "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, result.decision.decision)
    }

    @Test
    fun `applying a new grant supersedes a still-active prior grant for the same appScope, never stacking`() {
        val store = InMemorySchedulePolicyStore()
        store.save(snapshotOf(basePolicy(dailyLimits = listOf(dailyLimit()))))

        val first = BonusGrant(
            id = "grant-1", appScope = AppScope.All, extraMinutes = 30,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"), expiresAtUtc = Instant.parse("2026-01-07T09:30:00Z"),
        )
        BonusGrantSync.applyDecidedGrant(store, first, first.grantedAtUtc)

        val second = BonusGrant(
            id = "grant-2", appScope = AppScope.All, extraMinutes = 45,
            grantedAtUtc = Instant.parse("2026-01-07T09:10:00Z"), expiresAtUtc = Instant.parse("2026-01-07T09:55:00Z"),
        )
        val applied = BonusGrantSync.applyDecidedGrant(store, second, second.grantedAtUtc) as BonusGrantSync.ApplyResult.Applied
        val activeGrants = applied.snapshot.candidatePolicy!!.bonusGrants.filter {
            !it.grantedAtUtc.isAfter(Instant.parse("2026-01-07T09:15:00Z")) && it.expiresAtUtc.isAfter(Instant.parse("2026-01-07T09:15:00Z"))
        }
        assertEquals(1, activeGrants.size)
        assertEquals("grant-2", activeGrants.first().id)
    }

    @Test
    fun `revoking an active grant expires it immediately, and revoking again is a safe no-op`() {
        val store = InMemorySchedulePolicyStore()
        store.save(snapshotOf(basePolicy(dailyLimits = listOf(dailyLimit()))))
        val grant = BonusGrant(
            id = "grant-1", appScope = AppScope.All, extraMinutes = 30,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"), expiresAtUtc = Instant.parse("2026-01-07T09:30:00Z"),
        )
        BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc)

        val revokedAt = Instant.parse("2026-01-07T09:10:00Z")
        BonusGrantSync.revokeGrant(store, "grant-1", revokedAt)

        val runtime = ScheduleRuntime(store)
        val afterRevoke = runtime.evaluate(revokedAt, "app-a", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)
        assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, afterRevoke.decision.decision)

        // Revoking again (e.g. a retried/replayed revoke request) must not error or resurrect it.
        val second = BonusGrantSync.revokeGrant(store, "grant-1", Instant.parse("2026-01-07T09:20:00Z"))
        assertTrue(second is BonusGrantSync.ApplyResult.Applied)
    }

    @Test
    fun `applying a grant with no base policy synced yet is a safe no-op, never fabricates a policy`() {
        val store = InMemorySchedulePolicyStore()
        val grant = BonusGrant(
            id = "grant-1", appScope = AppScope.All, extraMinutes = 30,
            grantedAtUtc = Instant.parse("2026-01-07T09:00:00Z"), expiresAtUtc = Instant.parse("2026-01-07T09:30:00Z"),
        )
        val result = BonusGrantSync.applyDecidedGrant(store, grant, grant.grantedAtUtc)
        assertTrue(result is BonusGrantSync.ApplyResult.NoBasePolicy)
        assertNull(store.load())
    }
}
