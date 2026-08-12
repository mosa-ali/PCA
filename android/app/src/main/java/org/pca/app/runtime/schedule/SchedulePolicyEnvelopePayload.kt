package org.pca.app.runtime.schedule

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Canonical plaintext-before-encryption payload for a `POLICY_UPDATE` Family Envelope message
 * carrying a [SchedulePolicyV1] -- see
 * `contracts/schedule-runtime/payload/SchedulePolicyEnvelopePayload.md` for the full contract.
 * This class only encodes/decodes the plaintext shape; it never touches the envelope's own
 * ciphertext/signature/transport fields (`org.pca.app.runtime.sync`, read-only to this mission,
 * owns wiring this into the actual Family Envelope send/receive path). Uses `org.json`, part of
 * the Android platform framework at runtime (no new Gradle dependency); the `org.json:json` test
 * dependency already present in `build.gradle.kts` supplies a real implementation for JVM unit
 * tests, which the bundled platform stub does not.
 */
object SchedulePolicyEnvelopePayload {

    const val KIND = "SCHEDULE_POLICY_V1"

    fun encode(policy: SchedulePolicyV1): String {
        val root = JSONObject()
        root.put("kind", KIND)
        root.put("policy", encodePolicy(policy))
        return root.toString()
    }

    /** @throws org.json.JSONException on malformed input, or [IllegalArgumentException] if
     * `kind` is not [KIND] -- the caller is expected to route a different `kind` to whichever
     * other POLICY_UPDATE payload handler owns it, never force-parse it as a schedule policy. */
    fun decode(plaintext: String): SchedulePolicyV1 {
        val root = JSONObject(plaintext)
        val kind = root.getString("kind")
        require(kind == KIND) { "Not a $KIND payload (kind=$kind)." }
        return decodePolicy(root.getJSONObject("policy"))
    }

    private fun encodePolicy(policy: SchedulePolicyV1): JSONObject = JSONObject().apply {
        put("version", policy.version)
        put("policyId", policy.policyId)
        put("policyRevision", policy.policyRevision)
        put("familyId", policy.familyId)
        put("childProfileId", policy.childProfileId)
        put("timezone", policy.timezone)
        put("windows", JSONArray(policy.windows.map { encodeWindow(it) }))
        put("bonusGrants", JSONArray(policy.bonusGrants.map { encodeBonusGrant(it) }))
        put("parentExceptions", JSONArray(policy.parentExceptions.map { encodeException(it) }))
        put("dailyLimits", JSONArray(policy.dailyLimits.map { encodeDailyLimit(it) }))
        put("trustSetEpoch", policy.trustSetEpoch)
        put("keyEpoch", policy.keyEpoch)
        put("issuedAt", policy.issuedAt.toString())
        put("effectiveFrom", policy.effectiveFrom.toString())
        put("expiresAt", policy.expiresAt?.toString())
    }

    private fun decodePolicy(json: JSONObject): SchedulePolicyV1 = SchedulePolicyV1(
        version = json.getString("version"),
        policyId = json.getString("policyId"),
        policyRevision = json.getInt("policyRevision"),
        familyId = json.getString("familyId"),
        childProfileId = json.getString("childProfileId"),
        timezone = json.getString("timezone"),
        windows = json.getJSONArray("windows").let { array -> (0 until array.length()).map { decodeWindow(array.getJSONObject(it)) } },
        bonusGrants = json.getJSONArray("bonusGrants").let { array -> (0 until array.length()).map { decodeBonusGrant(array.getJSONObject(it)) } },
        parentExceptions = json.getJSONArray("parentExceptions").let { array -> (0 until array.length()).map { decodeException(array.getJSONObject(it)) } },
        dailyLimits = json.getJSONArray("dailyLimits").let { array -> (0 until array.length()).map { decodeDailyLimit(array.getJSONObject(it)) } },
        trustSetEpoch = json.getInt("trustSetEpoch"),
        keyEpoch = json.getInt("keyEpoch"),
        issuedAt = Instant.parse(json.getString("issuedAt")),
        effectiveFrom = Instant.parse(json.getString("effectiveFrom")),
        expiresAt = json.optString("expiresAt", "").takeIf { it.isNotEmpty() }?.let { Instant.parse(it) },
    )

    private fun encodeAppScope(scope: AppScope): Any = when (scope) {
        is AppScope.All -> "ALL"
        is AppScope.Apps -> JSONObject().apply { put("apps", JSONArray(scope.apps)) }
    }

    private fun decodeAppScope(value: Any): AppScope = when (value) {
        "ALL" -> AppScope.All
        is JSONObject -> {
            val apps = value.getJSONArray("apps")
            AppScope.Apps((0 until apps.length()).map { apps.getString(it) })
        }
        else -> throw org.json.JSONException("invalid appScope: $value")
    }

    private fun encodeWindow(window: ScheduleWindow): JSONObject = JSONObject().apply {
        put("id", window.id)
        put("kind", window.kind.name)
        put("daysOfWeek", JSONArray(window.daysOfWeek))
        put("start", JSONObject().apply { put("hour", window.start.hour); put("minute", window.start.minute) })
        put("end", JSONObject().apply { put("hour", window.end.hour); put("minute", window.end.minute) })
        put("appScope", encodeAppScope(window.appScope))
        put("timezone", window.timezone)
    }

    private fun decodeWindow(json: JSONObject): ScheduleWindow = ScheduleWindow(
        id = json.getString("id"),
        kind = ScheduleWindowKind.valueOf(json.getString("kind")),
        daysOfWeek = json.getJSONArray("daysOfWeek").let { array -> (0 until array.length()).map { array.getInt(it) } },
        start = json.getJSONObject("start").let { TimeOfDay(it.getInt("hour"), it.getInt("minute")) },
        end = json.getJSONObject("end").let { TimeOfDay(it.getInt("hour"), it.getInt("minute")) },
        appScope = decodeAppScope(json.get("appScope")),
        timezone = json.getString("timezone"),
    )

    private fun encodeBonusGrant(grant: BonusGrant): JSONObject = JSONObject().apply {
        put("id", grant.id)
        put("appScope", encodeAppScope(grant.appScope))
        put("extraMinutes", grant.extraMinutes)
        put("grantedAtUtc", grant.grantedAtUtc.toString())
        put("expiresAtUtc", grant.expiresAtUtc.toString())
    }

    private fun decodeBonusGrant(json: JSONObject): BonusGrant = BonusGrant(
        id = json.getString("id"),
        appScope = decodeAppScope(json.get("appScope")),
        extraMinutes = json.getInt("extraMinutes"),
        grantedAtUtc = Instant.parse(json.getString("grantedAtUtc")),
        expiresAtUtc = Instant.parse(json.getString("expiresAtUtc")),
    )

    private fun encodeException(exception: ParentException): JSONObject = JSONObject().apply {
        put("id", exception.id)
        put("appScope", encodeAppScope(exception.appScope))
        put("startAtUtc", exception.startAtUtc.toString())
        put("endAtUtc", exception.endAtUtc.toString())
        put("reason", exception.reason)
    }

    private fun decodeException(json: JSONObject): ParentException = ParentException(
        id = json.getString("id"),
        appScope = decodeAppScope(json.get("appScope")),
        startAtUtc = Instant.parse(json.getString("startAtUtc")),
        endAtUtc = Instant.parse(json.getString("endAtUtc")),
        reason = json.getString("reason"),
    )

    private fun encodeDailyLimit(limit: DailyAppLimit): JSONObject = JSONObject().apply {
        put("appScope", encodeAppScope(limit.appScope))
        put("limitMinutes", limit.limitMinutes)
        put("usedMinutesToday", limit.usedMinutesToday)
        put("anchorLocalDate", limit.anchorLocalDate)
    }

    private fun decodeDailyLimit(json: JSONObject): DailyAppLimit = DailyAppLimit(
        appScope = decodeAppScope(json.get("appScope")),
        limitMinutes = json.getInt("limitMinutes"),
        usedMinutesToday = json.getInt("usedMinutesToday"),
        anchorLocalDate = json.getString("anchorLocalDate"),
    )
}
