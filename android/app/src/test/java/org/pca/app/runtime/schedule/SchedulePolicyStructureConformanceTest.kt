package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SchedulePolicyStructureConformanceTest {
    private val now = Instant.parse("2026-10-09T12:00:00Z")

    private fun window(id: String, days: List<Int> = listOf(1), scope: AppScope = AppScope.All) = ScheduleWindow(
        id = id,
        kind = ScheduleWindowKind.SCHOOL_MODE,
        daysOfWeek = days,
        start = TimeOfDay(8, 0),
        end = TimeOfDay(16, 0),
        appScope = scope,
        timezone = "UTC",
    )

    private fun policy(windows: List<ScheduleWindow>, revision: Int = 1) = SchedulePolicyV1(
        policyId = "policy",
        policyRevision = revision,
        familyId = "family",
        childProfileId = "child",
        timezone = "UTC",
        windows = windows,
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = now,
        effectiveFrom = now,
    )

    private fun input(candidate: SchedulePolicyV1, lastKnownGood: SchedulePolicyV1? = null) = PolicyAcceptanceInput(
        candidatePolicy = candidate,
        lastKnownGoodPolicy = lastKnownGood,
        nowUtc = now,
        deviceTrustSetEpoch = 1,
        deviceKeyEpoch = 1,
        connectivity = Connectivity.ONLINE,
        lastPolicySyncAtUtc = now,
    )

    @Test
    fun `exact duplicate UTF-8 window identity is invalid and retains last known good`() {
        val accepted = policy(listOf(window("school")))
        val duplicate = policy(listOf(window("school"), window("school")), revision = 2)
        val reusedAcrossDays = policy(
            listOf(window("school", listOf(1)), window("school", listOf(2))),
            revision = 3,
        )

        val result = SchedulePolicyValidator.evaluate(input(duplicate, accepted))

        assertEquals(ScheduleRuntimeState.INVALID, result.state)
        assertEquals(accepted, result.effectivePolicy)
        assertEquals(
            "the same opaque window id cannot denote separate day-specific windows",
            ScheduleRuntimeState.INVALID,
            SchedulePolicyValidator.evaluate(input(reusedAcrossDays, accepted)).state,
        )
        val direct = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = now,
                timezone = "UTC",
                appToken = "app",
                windows = duplicate.windows,
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, direct.decision)
        assertTrue(direct.configErrors.orEmpty().any { it.contains("duplicate window id") })
    }

    @Test
    fun `canonically equivalent but byte-distinct UTF-8 ids remain distinct`() {
        val composed = "caf\u00e9"
        val decomposed = "cafe\u0301"
        assertTrue(composed != decomposed)

        val result = SchedulePolicyValidator.evaluate(input(policy(listOf(window(composed), window(decomposed)))))

        assertEquals(ScheduleRuntimeState.CURRENT, result.state)
    }

    @Test
    fun `unpaired surrogate window identity is rejected as invalid configuration`() {
        for (id in listOf("bad\uD800id", "bad\uDC00id")) {
            val malformedIdentity = window(id)
            assertTrue(validateScheduleWindow(malformedIdentity).any { it.contains("valid UTF-8") })
            assertEquals(ScheduleRuntimeState.INVALID,
                SchedulePolicyValidator.evaluate(input(policy(listOf(malformedIdentity)))).state)
        }
    }

    @Test
    fun `policy timezone is validated even when no daily limit needs it`() {
        val accepted = policy(emptyList())
        assertEquals(ScheduleRuntimeState.CURRENT, SchedulePolicyValidator.evaluate(input(accepted)).state)

        for (timezone in listOf("", "Not/A_Zone", "GMT+3", "+03:00")) {
            val result = SchedulePolicyValidator.evaluate(input(accepted.copy(policyRevision = 2, timezone = timezone), accepted))
            assertEquals("timezone=$timezone", ScheduleRuntimeState.INVALID, result.state)
            assertEquals(accepted, result.effectivePolicy)
        }
    }

    @Test
    fun `schedule evaluator rejects an invalid policy timezone before default allow`() {
        fun evaluate(timezone: String) = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = now,
                timezone = timezone,
                appToken = "app",
                windows = emptyList(),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )

        for (timezone in listOf("", "Not/A_Zone", "GMT+3", "+03:00")) {
            val result = evaluate(timezone)
            assertEquals("timezone=$timezone", ScheduleDecisionKind.INVALID_CONFIG, result.decision)
            assertTrue(result.configErrors.orEmpty().any { it.contains("policy timezone") })
        }
        assertEquals(ScheduleDecisionKind.ALLOWED, evaluate("Asia/Riyadh").decision)
    }

    @Test
    fun `schedule evaluator rejects an empty app token before emergency access override`() {
        fun evaluate(appToken: String, emergencyTokens: Set<String> = emptySet()) = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = now,
                timezone = "UTC",
                appToken = appToken,
                windows = emptyList(),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
                communicationSurfaces = CommunicationSafetySurfaceTokens(
                    emergencySurfaceTokens = emergencyTokens,
                ),
            ),
        )

        val invalid = evaluate("")
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, invalid.decision)
        assertTrue(invalid.configErrors.orEmpty().contains("app token must be a non-empty string"))

        // The input identity check has precedence even if a malformed adapter marks that same
        // empty value as protected. Backend token validation also requires length > 0.
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, evaluate("", setOf("")).decision)

        // Match backend validateAppToken's exact non-empty rule; whitespace is not silently
        // normalized because app tokens are opaque and the backend accepts any non-empty string.
        assertEquals(ScheduleDecisionKind.ALLOWED, evaluate(" ").decision)
    }

    @Test
    fun `supplemental policy scopes and intervals fail closed at policy and evaluator boundaries`() {
        val accepted = policy(emptyList())
        val invalid = accepted.copy(
            policyRevision = 2,
            bonusGrants = listOf(BonusGrant("bad-bonus", AppScope.Apps(listOf("")), -1,
                now.plusSeconds(60), now)),
            parentExceptions = listOf(ParentException("bad-exception", AppScope.Apps(listOf("")),
                now.plusSeconds(60), now, "test")),
            dailyLimits = listOf(DailyAppLimit(AppScope.Apps(listOf("")), 10, 0, "2026-10-09")),
        )

        val acceptedResult = SchedulePolicyValidator.evaluate(input(invalid, accepted))
        assertEquals(ScheduleRuntimeState.INVALID, acceptedResult.state)
        assertEquals(accepted, acceptedResult.effectivePolicy)

        val directResult = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = now,
                timezone = "UTC",
                appToken = "app",
                windows = emptyList(),
                bonusGrants = invalid.bonusGrants,
                exceptions = invalid.parentExceptions,
                dailyLimit = invalid.dailyLimits.single(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, directResult.decision)
        assertTrue(directResult.configErrors.orEmpty().any { it.contains("non-empty app tokens") })
        assertTrue(directResult.configErrors.orEmpty().any { it.contains("end after start") })
    }

    @Test
    fun `supplemental policy instants outside JavaScript Date range are rejected`() {
        val maximum = Instant.ofEpochMilli(8_640_000_000_000_000L)
        val oneNanosecondBeyondMaximum = maximum.plusNanos(1L)
        val invalid = policy(emptyList()).copy(
            bonusGrants = listOf(BonusGrant("out-of-range", AppScope.All, 5,
                oneNanosecondBeyondMaximum, oneNanosecondBeyondMaximum.plusNanos(1L))),
        )
        assertEquals(ScheduleRuntimeState.INVALID, SchedulePolicyValidator.evaluate(input(invalid)).state)
        assertTrue(validateBonusGrant(BonusGrant(
            "upper-bound", AppScope.All, 1, maximum.minusMillis(1L), maximum,
        )).isEmpty())
        assertTrue(validateBonusGrant(BonusGrant(
            "upper-overflow", AppScope.All, 1, maximum, oneNanosecondBeyondMaximum,
        )).isNotEmpty())
    }

    @Test
    fun `repeated weekday entries retain the reference includes semantics`() {
        val one = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = Instant.parse("2026-10-05T10:00:00Z"),
                timezone = "UTC",
                appToken = "app",
                windows = listOf(window("school", listOf(1), AppScope.Apps(emptyList()))),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )
        val repeated = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = Instant.parse("2026-10-05T10:00:00Z"),
                timezone = "UTC",
                appToken = "app",
                windows = listOf(window("school", listOf(1, 1), AppScope.Apps(emptyList()))),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )

        assertEquals(one.decision, repeated.decision)
        assertEquals(one.matchedWindowIds, repeated.matchedWindowIds)
    }
}
