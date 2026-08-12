package org.pca.app.runtime.schedule

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Kotlin side of PCA-RUNTIME-SCHEDULE-1's cross-runtime conformance suite: feeds
 * `contracts/schedule-runtime/vectors/schedule-conformance-v1.json` -- the SAME file the TS
 * reference test (`backend/test/runtime-schedule-conformance/evaluationVectors.test.mjs`) uses --
 * into [ScheduleEvaluator]. A failure here is a real TS/Kotlin semantic mismatch, per mission
 * section 8/18 ("TS/Kotlin semantic mismatches = 0").
 */
class ScheduleConformanceVectorTest {

    @Test
    fun `all shared evaluation vectors produce the same decision as the TS reference engine`() {
        val file = locateSharedVectorFile("contracts/schedule-runtime/vectors/schedule-conformance-v1.json")
        assertTrue("could not locate schedule-conformance-v1.json from test working directory", file != null)

        val root = JSONObject(file!!.readText())
        val vectors = root.getJSONArray("vectors")
        assertTrue("expected at least one shared conformance vector", vectors.length() > 0)

        var checked = 0
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val id = vector.getString("id")
            val input = toEvaluationInput(vector.getJSONObject("input"))
            val expected = vector.getJSONObject("expected")

            val result = ScheduleEvaluator.evaluate(input)

            assertEquals("decision mismatch for $id", expected.getString("decision"), result.decision.name)

            if (expected.has("matchedWindowId")) {
                assertEquals("matchedWindowId mismatch for $id", expected.optString("matchedWindowId", null), result.matchedWindowId)
            }
            if (expected.has("matchedWindowIds")) {
                val expectedIds = expected.optJSONArray("matchedWindowIds")
                val expectedList = if (expectedIds == null) null else (0 until expectedIds.length()).map { expectedIds.getString(it) }
                assertEquals("matchedWindowIds mismatch for $id", expectedList, result.matchedWindowIds)
            }
            if (expected.has("intendedDecision")) {
                val expectedIntended = expected.optString("intendedDecision", null)
                assertEquals("intendedDecision mismatch for $id", expectedIntended, result.intendedDecision?.name)
            }
            if (expected.has("remainingMinutesToday")) {
                val expectedRemaining = if (expected.isNull("remainingMinutesToday")) null else expected.getInt("remainingMinutesToday")
                assertEquals("remainingMinutesToday mismatch for $id", expectedRemaining, result.remainingMinutesToday)
            }
            if (expected.optBoolean("hasConfigErrors", false)) {
                assertTrue("expected configErrors for $id", !result.configErrors.isNullOrEmpty())
            }
            checked++
        }

        assertEquals(vectors.length(), checked)
    }

    private fun toEvaluationInput(json: JSONObject): ScheduleEvaluationInput = ScheduleEvaluationInput(
        nowUtc = Instant.parse(json.getString("nowUtc")),
        timezone = json.getString("timezone"),
        appToken = json.getString("appToken"),
        windows = json.getJSONArray("windows").toWindowList(),
        bonusGrants = json.getJSONArray("bonusGrants").toBonusGrantList(),
        exceptions = json.getJSONArray("exceptions").toExceptionList(),
        dailyLimit = if (json.isNull("dailyLimit")) null else json.optJSONObject("dailyLimit")?.toDailyLimit(),
        enforcementCapability = EnforcementCapabilityState.valueOf(json.getString("enforcementCapability")),
        connectivity = Connectivity.valueOf(json.getString("connectivity")),
        lastPolicySyncAtUtc = if (json.isNull("lastPolicySyncAtUtc")) null else json.optString("lastPolicySyncAtUtc", null)?.let { Instant.parse(it) },
    )

    private fun JSONArray.toWindowList(): List<ScheduleWindow> = (0 until length()).map { getJSONObject(it).toWindow() }

    private fun JSONObject.toWindow(): ScheduleWindow = ScheduleWindow(
        id = getString("id"),
        kind = ScheduleWindowKind.valueOf(getString("kind")),
        daysOfWeek = getJSONArray("daysOfWeek").let { array -> (0 until array.length()).map { array.getInt(it) } },
        start = getJSONObject("start").toTimeOfDay(),
        end = getJSONObject("end").toTimeOfDay(),
        appScope = get("appScope").toAppScope(),
        timezone = getString("timezone"),
    )

    private fun JSONObject.toTimeOfDay(): TimeOfDay = TimeOfDay(getInt("hour"), getInt("minute"))

    private fun Any.toAppScope(): AppScope = when (this) {
        "ALL" -> AppScope.All
        is JSONObject -> AppScope.Apps(getJSONArray("apps").let { array -> (0 until array.length()).map { array.getString(it) } })
        else -> throw IllegalArgumentException("invalid appScope: $this")
    }

    private fun JSONArray.toBonusGrantList(): List<BonusGrant> = (0 until length()).map { i ->
        getJSONObject(i).let {
            BonusGrant(
                id = it.getString("id"),
                appScope = it.get("appScope").toAppScope(),
                extraMinutes = it.getInt("extraMinutes"),
                grantedAtUtc = Instant.parse(it.getString("grantedAtUtc")),
                expiresAtUtc = Instant.parse(it.getString("expiresAtUtc")),
            )
        }
    }

    private fun JSONArray.toExceptionList(): List<ParentException> = (0 until length()).map { i ->
        getJSONObject(i).let {
            ParentException(
                id = it.getString("id"),
                appScope = it.get("appScope").toAppScope(),
                startAtUtc = Instant.parse(it.getString("startAtUtc")),
                endAtUtc = Instant.parse(it.getString("endAtUtc")),
                reason = it.getString("reason"),
            )
        }
    }

    private fun JSONObject.toDailyLimit(): DailyAppLimit = DailyAppLimit(
        appScope = get("appScope").toAppScope(),
        limitMinutes = getInt("limitMinutes"),
        usedMinutesToday = getInt("usedMinutesToday"),
        anchorLocalDate = getString("anchorLocalDate"),
    )
}
