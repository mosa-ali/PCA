package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class SchedulePolicyDailyLimitValidationTest {
    private val now = Instant.parse("2026-01-07T12:00:00Z")

    private fun policy(
        revision: Int = 1,
        dailyLimit: DailyAppLimit = validLimit(),
    ) = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = revision,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "UTC",
        windows = emptyList(),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = listOf(dailyLimit),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
    )

    private fun validLimit(
        limitMinutes: Int = 30,
        usedMinutesToday: Int = 0,
        anchorLocalDate: String = "2026-01-07",
    ) = DailyAppLimit(AppScope.All, limitMinutes, usedMinutesToday, anchorLocalDate)

    private fun acceptance(candidate: SchedulePolicyV1, lastKnownGood: SchedulePolicyV1? = null) =
        SchedulePolicyValidator.evaluate(
            PolicyAcceptanceInput(
                candidatePolicy = candidate,
                lastKnownGoodPolicy = lastKnownGood,
                nowUtc = now,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
                connectivity = Connectivity.ONLINE,
                lastPolicySyncAtUtc = now,
            ),
        )

    @Test
    fun `negative counters are rejected while zero and the supported integer boundary remain valid`() {
        val malformed = listOf(
            policy(dailyLimit = validLimit(limitMinutes = -1)),
            policy(dailyLimit = validLimit(usedMinutesToday = -1)),
        )

        malformed.forEach { candidate ->
            val result = acceptance(candidate)
            assertEquals(ScheduleRuntimeState.INVALID, result.state)
            assertNull(result.effectivePolicy)
        }

        val zeroBoundary = acceptance(policy(dailyLimit = validLimit(limitMinutes = 0, usedMinutesToday = 0)))
        assertEquals(ScheduleRuntimeState.CURRENT, zeroBoundary.state)

        val upperBoundary = acceptance(
            policy(dailyLimit = validLimit(limitMinutes = Int.MAX_VALUE, usedMinutesToday = Int.MAX_VALUE)),
        )
        assertEquals(ScheduleRuntimeState.CURRENT, upperBoundary.state)
    }

    @Test
    fun `daily limit anchor accepts only canonical valid Gregorian dates`() {
        listOf(
            "2026-02-29", // impossible non-leap day
            "2026-2-09", // not zero-padded
            "2026-13-01", // invalid month
            "0000-12-31", // outside the product's four-digit Gregorian year range
            "٢٠٢٦-01-07", // non-ASCII digits are not canonical wire dates
        ).forEach { invalidDate ->
            val result = acceptance(policy(dailyLimit = validLimit(anchorLocalDate = invalidDate)))
            assertEquals("anchor=$invalidDate", ScheduleRuntimeState.INVALID, result.state)
            assertNull(result.effectivePolicy)
        }

        val leapDay = acceptance(policy(dailyLimit = validLimit(anchorLocalDate = "2024-02-29")))
        assertEquals(ScheduleRuntimeState.CURRENT, leapDay.state)
    }

    @Test
    fun `large positive grant totals do not overflow evaluator arithmetic`() {
        val grants = List(3) { index ->
            BonusGrant(
                id = "bonus-$index",
                appScope = AppScope.All,
                extraMinutes = Int.MAX_VALUE,
                grantedAtUtc = now.minusSeconds(60),
                expiresAtUtc = now.plusSeconds(3_600),
            )
        }
        val candidate = policy(
            dailyLimit = validLimit(limitMinutes = Int.MAX_VALUE),
        ).copy(bonusGrants = grants)

        val decision = ScheduleEvaluator.evaluate(
            candidate.toEvaluationInput(
                nowUtc = now,
                appToken = "app-a",
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
                lastPolicySyncAtUtc = now,
            ),
        )

        assertEquals(ScheduleDecisionKind.ALLOWED_BONUS, decision.decision)
        assertEquals(Int.MAX_VALUE.toLong() * 4L, decision.remainingMinutesToday)
    }

    @Test
    fun `invalid daily limit candidate falls back after process restart`() {
        val lastKnownGood = policy(revision = 1, dailyLimit = validLimit(usedMinutesToday = 30))
        val candidate = policy(revision = 2, dailyLimit = validLimit(anchorLocalDate = "2026-02-30"))
        val snapshot = SchedulePolicySnapshot(
            candidatePolicy = candidate,
            lastKnownGoodPolicy = lastKnownGood,
            lastPolicySyncAtUtc = now,
            deviceTrustSetEpoch = 1,
            deviceKeyEpoch = 1,
        )
        val disk = DiskBackedPersistentStateStore()
        PersistentSchedulePolicyStore(disk).save(snapshot)

        val restarted = ScheduleRuntime(PersistentSchedulePolicyStore(disk.afterProcessDeath()))
        val result = restarted.evaluate(now, "app-a",
            EnforcementCapabilityState.ENFORCED, Connectivity.OFFLINE)

        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertEquals(lastKnownGood, result.effectivePolicy)
        assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, result.decision.decision)
    }
}
