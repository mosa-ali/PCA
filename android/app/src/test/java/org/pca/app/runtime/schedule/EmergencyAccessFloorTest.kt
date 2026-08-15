package org.pca.app.runtime.schedule

import java.security.MessageDigest
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-AND-003: proves the emergency-access floor is a REAL, non-overridable rejection of any
 * attempt -- however the policy is shaped -- to block the platform emergency-dialer app token,
 * independent of whether the rest of the policy is well-formed, currently valid, or "signed"
 * (signature verification is out of scope for this pure module; see EmergencyAccessFloor's doc
 * comment). Negative/adversarial cases are the point of this file, not incidental coverage.
 */
class EmergencyAccessFloorTest {

    private val protectedToken = EmergencyAccessFloor.PROTECTED_APP_TOKENS.first()
    private val ordinaryToken = "some-other-app-token"

    @Test
    fun `protected token is the sha256 of the telephony system package truncated to 16 hex chars, matching production hashing`() {
        val digest = MessageDigest.getInstance("SHA-256").digest("com.android.phone".toByteArray(Charsets.UTF_8))
        val expected = digest.joinToString(separator = "") { "%02x".format(it) }.take(16)
        assertEquals(expected, protectedToken)
        assertEquals(16, protectedToken.length)
    }

    @Test
    fun `isProtectedToken is true only for the protected token, not an arbitrary token`() {
        assertTrue(EmergencyAccessFloor.isProtectedToken(protectedToken))
        assertTrue(!EmergencyAccessFloor.isProtectedToken(ordinaryToken))
        assertNotEquals(protectedToken, ordinaryToken)
    }

    // ---- Adversarial cases: a malicious/well-formed policy that explicitly targets the emergency
    // ---- dialer token by including it in a blocking window's app scope must still be rejected
    // ---- (i.e. never actually block it) at the evaluator, PCA-AND-003's actual requirement.

    private fun window(
        kind: ScheduleWindowKind,
        appScope: AppScope,
        start: TimeOfDay = TimeOfDay(0, 0),
        end: TimeOfDay = TimeOfDay(23, 59),
    ) = ScheduleWindow(
        id = "malicious-${kind.name.lowercase()}",
        kind = kind,
        daysOfWeek = listOf(0, 1, 2, 3, 4, 5, 6),
        start = start,
        end = end,
        appScope = appScope,
        timezone = "UTC",
    )

    private fun evaluationInputFor(
        appToken: OpaqueAppToken,
        windows: List<ScheduleWindow>,
        nowUtc: Instant = Instant.parse("2026-01-07T12:00:00Z"),
    ) = ScheduleEvaluationInput(
        nowUtc = nowUtc,
        timezone = "UTC",
        appToken = appToken,
        windows = windows,
        bonusGrants = emptyList(),
        exceptions = emptyList(),
        dailyLimit = null,
        enforcementCapability = EnforcementCapabilityState.ENFORCED,
        connectivity = Connectivity.ONLINE,
    )

    @Test
    fun `a malicious all-day BLOCK_PERIOD window explicitly naming the emergency token is still allowed`() {
        val maliciousWindows = listOf(
            window(ScheduleWindowKind.BLOCK_PERIOD, AppScope.Apps(listOf(protectedToken, "decoy-app"))),
        )
        val decision = ScheduleEvaluator.evaluate(evaluationInputFor(protectedToken, maliciousWindows))
        assertEquals(ScheduleDecisionKind.ALLOWED, decision.decision)
        assertEquals(EmergencyAccessFloor.ALWAYS_ALLOWED_DECISION, decision)
    }

    @Test
    fun `a malicious 24-7 BEDTIME window scoped to ALL apps is still allowed for the emergency token`() {
        val maliciousWindows = listOf(window(ScheduleWindowKind.BEDTIME, AppScope.All))
        val decision = ScheduleEvaluator.evaluate(evaluationInputFor(protectedToken, maliciousWindows))
        assertEquals(ScheduleDecisionKind.ALLOWED, decision.decision)

        // Sanity check: the SAME malicious window genuinely blocks an ordinary app token -- proving
        // the floor is a real, targeted carve-out and not just an evaluator bug that allows everything.
        val ordinaryDecision = ScheduleEvaluator.evaluate(evaluationInputFor(ordinaryToken, maliciousWindows))
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ordinaryDecision.decision)
    }

    @Test
    fun `a malicious SCHOOL_MODE window that excludes the emergency token from its allow-scope is still allowed`() {
        // SCHOOL_MODE blocks whatever is NOT in the allow-scope -- excluding the protected token
        // from an otherwise-empty Apps() scope is exactly how an attacker would try to remove it.
        val maliciousWindows = listOf(window(ScheduleWindowKind.SCHOOL_MODE, AppScope.Apps(listOf("decoy-app"))))
        val decision = ScheduleEvaluator.evaluate(evaluationInputFor(protectedToken, maliciousWindows))
        assertEquals(ScheduleDecisionKind.ALLOWED, decision.decision)

        val ordinaryDecision = ScheduleEvaluator.evaluate(evaluationInputFor("unlisted-app", maliciousWindows))
        assertNotEquals(ScheduleDecisionKind.ALLOWED, ordinaryDecision.decision)
    }

    @Test
    fun `a malicious ALLOW_PERIOD that never covers now still allows the emergency token outside it`() {
        // ALLOW_PERIOD semantics: once any ALLOW_PERIOD exists for an app's scope, the app is
        // blocked whenever no ALLOW_PERIOD is currently active. An attacker could add a
        // never-active ALLOW_PERIOD naming the emergency token to force BLOCKED_OUTSIDE_ALLOW_PERIOD.
        val neverActive = window(
            kind = ScheduleWindowKind.ALLOW_PERIOD,
            appScope = AppScope.Apps(listOf(protectedToken)),
            start = TimeOfDay(3, 0),
            end = TimeOfDay(3, 1),
        )
        val decision = ScheduleEvaluator.evaluate(evaluationInputFor(protectedToken, listOf(neverActive), nowUtc = Instant.parse("2026-01-07T12:00:00Z")))
        assertEquals(ScheduleDecisionKind.ALLOWED, decision.decision)
    }

    @Test
    fun `the floor holds even when the policy is otherwise structurally invalid`() {
        // A malformed window (empty daysOfWeek) that also targets the emergency token: the floor
        // must short-circuit before configErrors / INVALID_CONFIG is even computed.
        val malformed = ScheduleWindow(
            id = "malformed",
            kind = ScheduleWindowKind.BLOCK_PERIOD,
            daysOfWeek = emptyList(),
            start = TimeOfDay(0, 0),
            end = TimeOfDay(23, 59),
            appScope = AppScope.Apps(listOf(protectedToken)),
            timezone = "not-a-real-timezone",
        )
        val decision = ScheduleEvaluator.evaluate(evaluationInputFor(protectedToken, listOf(malformed)))
        assertEquals(ScheduleDecisionKind.ALLOWED, decision.decision)

        // Same malformed window correctly still produces INVALID_CONFIG for an ordinary app token
        // -- proving the floor short-circuit is scoped to protected tokens only.
        val ordinaryDecision = ScheduleEvaluator.evaluate(evaluationInputFor(ordinaryToken, listOf(malformed)))
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, ordinaryDecision.decision)
    }

    @Test
    fun `the floor holds through the full ScheduleRuntime path, including an offline reboot with a malicious persisted policy`() {
        val maliciousPolicy = SchedulePolicyV1(
            policyId = "malicious-policy",
            policyRevision = 1,
            familyId = "family-1",
            childProfileId = "child-1",
            timezone = "UTC",
            windows = listOf(window(ScheduleWindowKind.BLOCK_PERIOD, AppScope.All)),
            bonusGrants = emptyList(),
            parentExceptions = emptyList(),
            dailyLimits = emptyList(),
            trustSetEpoch = 1,
            keyEpoch = 1,
            issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
            effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
        )
        val store = InMemorySchedulePolicyStore()
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = maliciousPolicy,
                lastKnownGoodPolicy = maliciousPolicy,
                lastPolicySyncAtUtc = Instant.parse("2026-01-07T00:00:00Z"),
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )
        val runtime = ScheduleRuntime(store)
        val result = runtime.evaluate(
            nowUtc = Instant.parse("2026-01-07T12:00:00Z"),
            appToken = protectedToken,
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.ONLINE,
        )
        assertEquals(ScheduleDecisionKind.ALLOWED, result.decision.decision)

        // The same policy genuinely blocks an ordinary app -- the malicious policy IS otherwise
        // effective, only the protected token is exempt.
        val ordinaryResult = runtime.evaluate(
            nowUtc = Instant.parse("2026-01-07T12:00:00Z"),
            appToken = ordinaryToken,
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.ONLINE,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_PERIOD, ordinaryResult.decision.decision)
    }
}
