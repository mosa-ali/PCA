package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant

class SchedulePolicyEnvelopePayloadTest {

    private fun samplePolicy() = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = 4,
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
            ScheduleWindow(
                id = "school",
                kind = ScheduleWindowKind.SCHOOL_MODE,
                daysOfWeek = listOf(1, 2, 3, 4, 5),
                start = TimeOfDay(8, 0),
                end = TimeOfDay(14, 0),
                appScope = AppScope.Apps(listOf("homework-app", "calculator-app")),
                timezone = "Asia/Riyadh",
            ),
        ),
        bonusGrants = listOf(
            BonusGrant("bonus-1", AppScope.All, 15, Instant.parse("2026-01-07T09:00:00Z"), Instant.parse("2026-01-07T09:15:00Z")),
        ),
        parentExceptions = listOf(
            ParentException("exc-1", AppScope.Apps(listOf("app-a")), Instant.parse("2026-01-07T11:00:00Z"), Instant.parse("2026-01-07T13:00:00Z"), "family event"),
        ),
        dailyLimits = listOf(
            DailyAppLimit(AppScope.All, 30, 10, "2026-01-07"),
        ),
        trustSetEpoch = 2,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-07T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-07T00:00:00Z"),
        expiresAt = Instant.parse("2026-02-01T00:00:00Z"),
    )

    @Test
    fun `encode then decode round-trips every field exactly`() {
        val original = samplePolicy()
        val decoded = SchedulePolicyEnvelopePayload.decode(SchedulePolicyEnvelopePayload.encode(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `round-trips a policy with no expiresAt`() {
        val original = samplePolicy().copy(expiresAt = null)
        val decoded = SchedulePolicyEnvelopePayload.decode(SchedulePolicyEnvelopePayload.encode(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `round-trips continuousUseLimitMinutes and breakDurationMinutes when present`() {
        val original = samplePolicy().copy(continuousUseLimitMinutes = 45, breakDurationMinutes = 40)
        val decoded = SchedulePolicyEnvelopePayload.decode(SchedulePolicyEnvelopePayload.encode(original))
        assertEquals(original, decoded)
        assertEquals(45, decoded.continuousUseLimitMinutes)
        assertEquals(40, decoded.breakDurationMinutes)
    }

    @Test
    fun `round-trips a policy that omits continuousUseLimitMinutes and breakDurationMinutes`() {
        // samplePolicy() does not set either field -- both default to null on the container.
        val original = samplePolicy()
        val decoded = SchedulePolicyEnvelopePayload.decode(SchedulePolicyEnvelopePayload.encode(original))
        assertEquals(original, decoded)
        assertEquals(null, decoded.continuousUseLimitMinutes)
        assertEquals(null, decoded.breakDurationMinutes)
    }

    @Test
    fun `decoding a legacy plaintext payload predating this field defaults both to null`() {
        // A real payload authored before continuousUseLimitMinutes/breakDurationMinutes existed
        // -- the "policy" object simply has no such keys at all, not even a null placeholder.
        val legacyPlaintext = """
            {"kind":"SCHEDULE_POLICY_V1","policy":{
              "version":"1","policyId":"policy-1","policyRevision":1,"familyId":"family-1",
              "childProfileId":"child-1","timezone":"Asia/Riyadh",
              "windows":[],"bonusGrants":[],"parentExceptions":[],"dailyLimits":[],
              "trustSetEpoch":1,"keyEpoch":1,
              "issuedAt":"2026-01-07T00:00:00Z","effectiveFrom":"2026-01-07T00:00:00Z"
            }}
        """.trimIndent()
        val decoded = SchedulePolicyEnvelopePayload.decode(legacyPlaintext)
        assertEquals(null, decoded.continuousUseLimitMinutes)
        assertEquals(null, decoded.breakDurationMinutes)
    }

    @Test
    fun `a payload with a different kind is rejected rather than force-parsed as a schedule policy`() {
        val wrongKind = """{"kind":"SOME_OTHER_POLICY_UPDATE","policy":{}}"""
        assertThrows(IllegalArgumentException::class.java) { SchedulePolicyEnvelopePayload.decode(wrongKind) }
    }

    @Test
    fun `malformed json is rejected without crashing the caller into an unhandled state`() {
        assertThrows(org.json.JSONException::class.java) { SchedulePolicyEnvelopePayload.decode("not json") }
    }
}
