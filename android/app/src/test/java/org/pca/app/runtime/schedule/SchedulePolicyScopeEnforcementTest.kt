package org.pca.app.runtime.schedule

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SchedulePolicyScopeEnforcementTest {
    private val now = Instant.parse("2026-10-11T12:00:00Z")

    private fun policy(
        familyId: String = "family-a",
        childProfileId: String = "child-a",
        revision: Int = 1,
        trustSetEpoch: Int = 1,
        keyEpoch: Int = 1,
    ) = SchedulePolicyV1(
        policyId = "schedule-1",
        policyRevision = revision,
        familyId = familyId,
        childProfileId = childProfileId,
        timezone = "UTC",
        windows = emptyList(),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = trustSetEpoch,
        keyEpoch = keyEpoch,
        issuedAt = now.minusSeconds(60),
        effectiveFrom = now.minusSeconds(60),
    )

    private fun input(
        candidate: SchedulePolicyV1?,
        lastKnownGood: SchedulePolicyV1?,
        familyId: String? = "family-a",
        childProfileId: String? = "child-a",
        trustSetEpoch: Int = 1,
        keyEpoch: Int = 1,
    ) = PolicyAcceptanceInput(
        candidatePolicy = candidate,
        lastKnownGoodPolicy = lastKnownGood,
        nowUtc = now,
        deviceTrustSetEpoch = trustSetEpoch,
        deviceKeyEpoch = keyEpoch,
        connectivity = Connectivity.ONLINE,
        lastPolicySyncAtUtc = now,
        expectedFamilyId = familyId,
        expectedChildProfileId = childProfileId,
    )

    @Test
    fun `cross-family candidate is rejected while a same-scope last known good remains eligible`() {
        val trustedFallback = policy(revision = 2)
        val result = SchedulePolicyValidator.evaluate(
            input(candidate = policy(familyId = "family-b", revision = 3), lastKnownGood = trustedFallback),
        )

        assertEquals(ScheduleRuntimeState.INVALID, result.state)
        assertEquals(trustedFallback, result.effectivePolicy)
    }

    @Test
    fun `cross-profile last known good cannot be used as fallback`() {
        val result = SchedulePolicyValidator.evaluate(
            input(
                candidate = policy(familyId = "family-b", revision = 3),
                lastKnownGood = policy(childProfileId = "child-b", revision = 2),
            ),
        )

        assertEquals(ScheduleRuntimeState.INVALID, result.state)
        assertNull(result.effectivePolicy)
    }

    @Test
    fun `current-scope candidate is usable even when the saved fallback belongs to an old profile`() {
        val current = policy(revision = 3)
        val result = SchedulePolicyValidator.evaluate(
            input(candidate = current, lastKnownGood = policy(childProfileId = "child-old", revision = 2)),
        )

        assertEquals(ScheduleRuntimeState.CURRENT, result.state)
        assertEquals(current, result.effectivePolicy)
    }

    @Test
    fun `blank local identity fails closed`() {
        val result = SchedulePolicyValidator.evaluate(
            input(candidate = policy(), lastKnownGood = policy(), familyId = " "),
        )

        assertEquals(ScheduleRuntimeState.INVALID, result.state)
        assertNull(result.effectivePolicy)
    }

    @Test
    fun `runtime does not apply a persisted policy when the active local scope is unavailable`() {
        val current = policy()
        val store = InMemorySchedulePolicyStore().apply {
            save(SchedulePolicySnapshot(current, current, now, 1, 1))
        }
        val runtime = ScheduleRuntime(store, currentPolicyScopeProvider = { null })

        val result = runtime.evaluate(now, "package.example", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)

        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertNull(result.effectivePolicy)
    }

    @Test
    fun `runtime uses current family epoch floor instead of a stale snapshot floor`() {
        val current = policy()
        val store = InMemorySchedulePolicyStore().apply {
            save(SchedulePolicySnapshot(current, null, now, 1, 1))
        }
        val runtime = ScheduleRuntime(store, currentPolicyScopeProvider = {
            SchedulePolicyRuntimeScope("family-a", "child-a", trustSetEpoch = 2, keyEpoch = 1)
        })

        val result = runtime.evaluate(now, "package.example", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)

        assertEquals(ScheduleRuntimeState.EPOCH_STALE, result.runtimeState)
    }

    @Test
    fun `runtime rejects inconsistent active scope identity and epoch floors before combining floors`() {
        val current = policy()
        val store = InMemorySchedulePolicyStore().apply {
            // These larger persisted floors previously masked a malformed live family scope.
            save(SchedulePolicySnapshot(current, current, now, 8, 8))
        }
        val invalidScopes = listOf(
            SchedulePolicyRuntimeScope(" ", "child-a", trustSetEpoch = 1, keyEpoch = 1),
            SchedulePolicyRuntimeScope("family-a", " ", trustSetEpoch = 1, keyEpoch = 1),
            SchedulePolicyRuntimeScope("family-a", "child-a", trustSetEpoch = 0, keyEpoch = 1),
            SchedulePolicyRuntimeScope("family-a", "child-a", trustSetEpoch = -1, keyEpoch = 1),
            SchedulePolicyRuntimeScope("family-a", "child-a", trustSetEpoch = 1, keyEpoch = 0),
            SchedulePolicyRuntimeScope("family-a", "child-a", trustSetEpoch = 1, keyEpoch = -1),
        )

        invalidScopes.forEach { invalidScope ->
            val runtime = ScheduleRuntime(store, currentPolicyScopeProvider = { invalidScope })

            val result = runtime.evaluate(
                now,
                "package.example",
                EnforcementCapabilityState.ENFORCED,
                Connectivity.ONLINE,
            )

            assertEquals(invalidScope.toString(), ScheduleRuntimeState.INVALID, result.runtimeState)
            assertNull(invalidScope.toString(), result.effectivePolicy)
        }
    }

    @Test
    fun `runtime fails closed when current family scope provider throws`() {
        val current = policy()
        val store = InMemorySchedulePolicyStore().apply {
            save(SchedulePolicySnapshot(current, current, now, 1, 1))
        }
        val runtime = ScheduleRuntime(store, currentPolicyScopeProvider = {
            throw IllegalStateException("family state unavailable")
        })

        val result = runtime.evaluate(now, "package.example", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)

        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertNull(result.effectivePolicy)
    }
}
