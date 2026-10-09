package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.json.JSONException
import org.json.JSONObject
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

    @Test
    fun `envelope payload accepts the INT32 maximum exactly`() {
        val maximum = samplePolicy().copy(trustSetEpoch = Int.MAX_VALUE, keyEpoch = Int.MAX_VALUE)

        assertEquals(maximum, SchedulePolicyEnvelopePayload.decode(SchedulePolicyEnvelopePayload.encode(maximum)))
    }

    @Test
    fun `envelope payload rejects an epoch above INT32 maximum before narrowing`() {
        val json = JSONObject(SchedulePolicyEnvelopePayload.encode(samplePolicy()))
        json.getJSONObject("policy").put("trustSetEpoch", Int.MAX_VALUE.toLong() + 1L)

        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(json.toString()) }
    }

    @Test
    fun `envelope payload rejects string and fractional epochs instead of coercing them`() {
        val stringEpoch = JSONObject(SchedulePolicyEnvelopePayload.encode(samplePolicy()))
        stringEpoch.getJSONObject("policy").put("keyEpoch", "1")
        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(stringEpoch.toString()) }

        val fractionalEpoch = JSONObject(SchedulePolicyEnvelopePayload.encode(samplePolicy()))
        fractionalEpoch.getJSONObject("policy").put("keyEpoch", 1.5)
        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(fractionalEpoch.toString()) }
    }

    @Test
    fun `envelope payload accepts integral decimal and exponent JSON number forms`() {
        val encoded = SchedulePolicyEnvelopePayload.encode(samplePolicy())
        val decimalEpoch = encoded.replace("\"trustSetEpoch\":2", "\"trustSetEpoch\":2.0")
        val exponentEpoch = encoded.replace("\"keyEpoch\":1", "\"keyEpoch\":1e0")

        assertEquals(samplePolicy(), SchedulePolicyEnvelopePayload.decode(decimalEpoch))
        assertEquals(samplePolicy(), SchedulePolicyEnvelopePayload.decode(exponentEpoch))
    }

    @Test
    fun `envelope payload accepts integral decimal and exponent schedule fields`() {
        val encoded = SchedulePolicyEnvelopePayload.encode(samplePolicy())
        val decimalHour = encoded.replace("\"hour\":22", "\"hour\":22.0")
        val exponentWeekday = encoded.replace("\"daysOfWeek\":[0,1,2,3,4,5,6]", "\"daysOfWeek\":[0e0,1,2,3,4,5,6]")

        assertEquals(samplePolicy(), SchedulePolicyEnvelopePayload.decode(decimalHour))
        assertEquals(samplePolicy(), SchedulePolicyEnvelopePayload.decode(exponentWeekday))
    }

    @Test
    fun `envelope payload rejects string fractional and overflowing schedule integers`() {
        val encoded = SchedulePolicyEnvelopePayload.encode(samplePolicy())

        val stringHour = JSONObject(encoded)
        stringHour.getJSONObject("policy").getJSONArray("windows").getJSONObject(0)
            .getJSONObject("start").put("hour", "22")
        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(stringHour.toString()) }

        val fractionalDay = JSONObject(encoded)
        fractionalDay.getJSONObject("policy").getJSONArray("windows").getJSONObject(0)
            .getJSONArray("daysOfWeek").put(0, 1.5)
        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(fractionalDay.toString()) }

        val overflowLimit = JSONObject(encoded)
        overflowLimit.getJSONObject("policy").getJSONArray("dailyLimits").getJSONObject(0)
            .put("limitMinutes", Int.MAX_VALUE.toLong() + 1L)
        assertThrows(JSONException::class.java) { SchedulePolicyEnvelopePayload.decode(overflowLimit.toString()) }
    }

    @Test
    fun `persisted schedule decoder rejects coerced and fractional window integers`() {
        val encoded = SchedulePolicyJson.encodeSnapshot(
            SchedulePolicySnapshot(
                candidatePolicy = samplePolicy(),
                lastKnownGoodPolicy = null,
                lastPolicySyncAtUtc = null,
                deviceTrustSetEpoch = 0,
                deviceKeyEpoch = 0,
            ),
        )
        val window = encoded.getJSONObject("candidatePolicy").getJSONArray("windows").getJSONObject(0)
        window.getJSONArray("daysOfWeek").put(0, "0")
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(encoded) }

        val fractional = SchedulePolicyJson.encodeSnapshot(
            SchedulePolicySnapshot(samplePolicy(), null, null, 0, 0),
        )
        fractional.getJSONObject("candidatePolicy").getJSONArray("windows").getJSONObject(0)
            .getJSONObject("end").put("minute", 0.25)
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(fractional) }
    }

    @Test
    fun `persistent snapshot decoder keeps zero floors and exact maximum`() {
        val encoded = SchedulePolicyJson.encodeSnapshot(
            SchedulePolicySnapshot(
                candidatePolicy = samplePolicy().copy(trustSetEpoch = Int.MAX_VALUE, keyEpoch = Int.MAX_VALUE),
                lastKnownGoodPolicy = null,
                lastPolicySyncAtUtc = null,
                deviceTrustSetEpoch = 0,
                deviceKeyEpoch = Int.MAX_VALUE,
            ),
        )

        val decoded = SchedulePolicyJson.decodeSnapshot(encoded)

        assertEquals(0, decoded.deviceTrustSetEpoch)
        assertEquals(Int.MAX_VALUE, decoded.deviceKeyEpoch)
        assertEquals(Int.MAX_VALUE, decoded.candidatePolicy?.trustSetEpoch)
        assertEquals(Int.MAX_VALUE, decoded.candidatePolicy?.keyEpoch)
    }

    @Test
    fun `persistent snapshot decoder rejects overflow string fractional and negative epoch values`() {
        val overflow = SchedulePolicyJson.encodeSnapshot(emptySnapshot()).put("deviceTrustSetEpoch", Int.MAX_VALUE.toLong() + 1L)
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(overflow) }

        val stringValue = SchedulePolicyJson.encodeSnapshot(emptySnapshot()).put("deviceKeyEpoch", "1")
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(stringValue) }

        val fractional = SchedulePolicyJson.encodeSnapshot(emptySnapshot()).put("deviceKeyEpoch", 1.5)
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(fractional) }

        val negative = SchedulePolicyJson.encodeSnapshot(emptySnapshot()).put("deviceKeyEpoch", -1)
        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(negative) }
    }

    @Test
    fun `persistent snapshot decoder accepts integral decimal and exponent JSON number forms`() {
        val decimal = JSONObject("""{"candidatePolicy":null,"lastKnownGoodPolicy":null,"lastPolicySyncAtUtc":null,"deviceTrustSetEpoch":0.0,"deviceKeyEpoch":1e0}""")

        val decoded = SchedulePolicyJson.decodeSnapshot(decimal)

        assertEquals(0, decoded.deviceTrustSetEpoch)
        assertEquals(1, decoded.deviceKeyEpoch)
    }

    @Test
    fun `persistent snapshot decoder rejects overflowing nested policy epoch before narrowing`() {
        val encoded = SchedulePolicyJson.encodeSnapshot(
            SchedulePolicySnapshot(
                candidatePolicy = samplePolicy(),
                lastKnownGoodPolicy = null,
                lastPolicySyncAtUtc = null,
                deviceTrustSetEpoch = 0,
                deviceKeyEpoch = 0,
            ),
        )
        encoded.getJSONObject("candidatePolicy").put("keyEpoch", Int.MAX_VALUE.toLong() + 1L)

        assertThrows(JSONException::class.java) { SchedulePolicyJson.decodeSnapshot(encoded) }
    }

    @Test
    fun `schedule validator preserves zero unset floor and rejects negative candidate or floor`() {
        val now = Instant.parse("2026-01-07T12:00:00Z")
        fun input(policy: SchedulePolicyV1, trustFloor: Int = 0, keyFloor: Int = 0) = PolicyAcceptanceInput(
            candidatePolicy = policy,
            lastKnownGoodPolicy = null,
            nowUtc = now,
            deviceTrustSetEpoch = trustFloor,
            deviceKeyEpoch = keyFloor,
            connectivity = Connectivity.ONLINE,
            lastPolicySyncAtUtc = now,
        )

        val zero = samplePolicy().copy(trustSetEpoch = 0, keyEpoch = 0)
        assertEquals(ScheduleRuntimeState.CURRENT, SchedulePolicyValidator.evaluate(input(zero)).state)
        assertEquals(ScheduleRuntimeState.INVALID, SchedulePolicyValidator.evaluate(input(zero.copy(keyEpoch = -1))).state)
        assertEquals(ScheduleRuntimeState.INVALID, SchedulePolicyValidator.evaluate(input(zero, trustFloor = -1)).state)
    }

    private fun emptySnapshot() = SchedulePolicySnapshot(
        candidatePolicy = null,
        lastKnownGoodPolicy = null,
        lastPolicySyncAtUtc = null,
        deviceTrustSetEpoch = 0,
        deviceKeyEpoch = 0,
    )
}
