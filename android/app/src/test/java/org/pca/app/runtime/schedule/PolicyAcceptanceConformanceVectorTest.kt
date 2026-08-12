package org.pca.app.runtime.schedule

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Kotlin side of the policy-acceptance conformance suite: feeds
 * `contracts/schedule-runtime/vectors/policy-acceptance-v1.json` -- the SAME file the TS-side
 * reference (`backend/test/runtime-schedule-conformance/policyAcceptanceVectors.test.mjs`) uses --
 * into [SchedulePolicyValidator]. This state machine has no pre-existing TS production
 * counterpart (see `SchedulePolicyV1.md`); this vector file is what keeps the two new
 * implementations in lock-step rather than silently diverging.
 */
class PolicyAcceptanceConformanceVectorTest {

    @Test
    fun `all shared policy-acceptance vectors produce the same state and effective policy`() {
        val file = locateSharedVectorFile("contracts/schedule-runtime/vectors/policy-acceptance-v1.json")
        assertTrue("could not locate policy-acceptance-v1.json from test working directory", file != null)

        val root = JSONObject(file!!.readText())
        val thresholdMillis = root.getLong("remoteStalenessThresholdMillis")
        val vectors = root.getJSONArray("policyAcceptanceVectors")
        assertTrue(vectors.length() > 0)

        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val id = vector.getString("id")
            val inputJson = vector.getJSONObject("input")

            val candidateJson = inputJson.optJSONObject("candidatePolicy")
            val lastKnownGoodJson = inputJson.optJSONObject("lastKnownGoodPolicy")

            val input = PolicyAcceptanceInput(
                candidatePolicy = candidateJson?.toMinimalPolicy(),
                lastKnownGoodPolicy = lastKnownGoodJson?.toMinimalPolicy(),
                nowUtc = Instant.parse(inputJson.getString("nowUtc")),
                deviceTrustSetEpoch = inputJson.getInt("deviceTrustSetEpoch"),
                deviceKeyEpoch = inputJson.getInt("deviceKeyEpoch"),
                connectivity = Connectivity.valueOf(inputJson.getString("connectivity")),
                lastPolicySyncAtUtc = if (inputJson.isNull("lastPolicySyncAtUtc")) null else inputJson.optString("lastPolicySyncAtUtc", null)?.let { Instant.parse(it) },
                remoteStalenessThresholdMillis = thresholdMillis,
            )

            val result = SchedulePolicyValidator.evaluate(input)
            val expected = vector.getJSONObject("expected")

            assertEquals("state mismatch for $id", expected.getString("state"), result.state.name)

            val expectedEffectiveTag = expected.optString("effectivePolicy", null)
            val expectedEffective: SchedulePolicyV1? = when (expectedEffectiveTag) {
                null -> null
                "candidate" -> input.candidatePolicy
                "lastKnownGood" -> input.lastKnownGoodPolicy
                else -> throw IllegalArgumentException("unknown effectivePolicy tag: $expectedEffectiveTag")
            }
            assertEquals("effectivePolicy mismatch for $id", expectedEffective?.policyId to expectedEffective?.policyRevision, result.effectivePolicy?.policyId to result.effectivePolicy?.policyRevision)
        }
    }

    @Test
    fun `all shared revision-acceptance vectors match isAcceptableRevision`() {
        val file = locateSharedVectorFile("contracts/schedule-runtime/vectors/policy-acceptance-v1.json")
        assertTrue(file != null)
        val root = JSONObject(file!!.readText())
        val vectors = root.getJSONArray("revisionAcceptanceVectors")
        assertTrue(vectors.length() > 0)

        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val id = vector.getString("id")
            val input = vector.getJSONObject("input")
            val candidateRevision = input.getInt("candidateRevision")
            val previouslyAccepted = if (input.isNull("previouslyAcceptedRevision")) null else input.getInt("previouslyAcceptedRevision")
            val expected = vector.getJSONObject("expected").getBoolean("acceptable")

            assertEquals("acceptable mismatch for $id", expected, SchedulePolicyValidator.isAcceptableRevision(candidateRevision, previouslyAccepted))
        }
    }

    /** Vectors only exercise the subset of [SchedulePolicyV1] fields the acceptance gate reads
     * (policyRevision, windows, expiresAt, trustSetEpoch, keyEpoch) plus enough identity to
     * compare which policy was selected as effective -- everything else is filled with
     * conformance-test placeholder values, matching the same minimal-container spirit as the
     * evaluation vectors. */
    private fun JSONObject.toMinimalPolicy(): SchedulePolicyV1 {
        val windowsArray: JSONArray = optJSONArray("windows") ?: JSONArray()
        return SchedulePolicyV1(
            policyId = getString("policyId"),
            policyRevision = getInt("policyRevision"),
            familyId = "vector-family",
            childProfileId = "vector-child",
            timezone = "UTC",
            windows = (0 until windowsArray.length()).map { windowsArray.getJSONObject(it).toMinimalWindow() },
            bonusGrants = emptyList(),
            parentExceptions = emptyList(),
            dailyLimits = emptyList(),
            trustSetEpoch = getInt("trustSetEpoch"),
            keyEpoch = getInt("keyEpoch"),
            issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
            effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
            expiresAt = if (isNull("expiresAt")) null else optString("expiresAt", null)?.let { Instant.parse(it) },
        )
    }

    private fun JSONObject.toMinimalWindow(): ScheduleWindow = ScheduleWindow(
        id = getString("id"),
        kind = ScheduleWindowKind.valueOf(getString("kind")),
        daysOfWeek = getJSONArray("daysOfWeek").let { array -> (0 until array.length()).map { array.getInt(it) } },
        start = getJSONObject("start").let { TimeOfDay(it.getInt("hour"), it.getInt("minute")) },
        end = getJSONObject("end").let { TimeOfDay(it.getInt("hour"), it.getInt("minute")) },
        appScope = AppScope.All,
        timezone = getString("timezone"),
    )
}
