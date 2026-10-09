package org.pca.app.runtime.schedule

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.pca.app.runtime.EpochBounds
import java.time.Instant

/**
 * Coordinator integration glue: a dependency-free JSON codec for [SchedulePolicySnapshot], used
 * only by [PersistentSchedulePolicyStore] to round-trip the locally-*accepted* policy durably
 * (mission section 12's offline-restart requirement). `org.json` is part of the Android platform
 * at runtime and already used by this codebase for exactly this purpose (see
 * `feature/wellbeing/policy/ParentPolicyJson.kt`, which documents the same rationale) -- this is
 * not a wire-format/transport decision, purely this store's own local-storage representation.
 */
internal object SchedulePolicyJson {

    fun encodeSnapshot(snapshot: SchedulePolicySnapshot): JSONObject {
        EpochBounds.requireValid(snapshot.deviceTrustSetEpoch, "deviceTrustSetEpoch")
        EpochBounds.requireValid(snapshot.deviceKeyEpoch, "deviceKeyEpoch")
        snapshot.candidatePolicy?.let(::requireValidPolicyEpochs)
        snapshot.lastKnownGoodPolicy?.let(::requireValidPolicyEpochs)
        return JSONObject().apply {
            put("candidatePolicy", snapshot.candidatePolicy?.let { encodePolicy(it) } ?: JSONObject.NULL)
            put("lastKnownGoodPolicy", snapshot.lastKnownGoodPolicy?.let { encodePolicy(it) } ?: JSONObject.NULL)
            put("lastPolicySyncAtUtc", snapshot.lastPolicySyncAtUtc?.toString() ?: JSONObject.NULL)
            put("deviceTrustSetEpoch", snapshot.deviceTrustSetEpoch)
            put("deviceKeyEpoch", snapshot.deviceKeyEpoch)
        }
    }

    fun decodeSnapshot(json: JSONObject): SchedulePolicySnapshot = SchedulePolicySnapshot(
        candidatePolicy = requiredNullableObject(json, "candidatePolicy")?.let { decodePolicy(it) },
        lastKnownGoodPolicy = requiredNullableObject(json, "lastKnownGoodPolicy")?.let { decodePolicy(it) },
        lastPolicySyncAtUtc = requiredNullableInstant(json, "lastPolicySyncAtUtc"),
        deviceTrustSetEpoch = EpochBounds.decodeJson(json, "deviceTrustSetEpoch"),
        deviceKeyEpoch = EpochBounds.decodeJson(json, "deviceKeyEpoch"),
    )

    private fun encodePolicy(policy: SchedulePolicyV1): JSONObject {
        requireValidPolicyEpochs(policy)
        return JSONObject().apply {
            put("version", policy.version)
            put("policyId", policy.policyId)
            put("policyRevision", policy.policyRevision)
            put("familyId", policy.familyId)
            put("childProfileId", policy.childProfileId)
            put("timezone", policy.timezone)
            put("windows", JSONArray().apply { policy.windows.forEach { put(encodeWindow(it)) } })
            put("bonusGrants", JSONArray().apply { policy.bonusGrants.forEach { put(encodeBonus(it)) } })
            put("parentExceptions", JSONArray().apply { policy.parentExceptions.forEach { put(encodeException(it)) } })
            put("dailyLimits", JSONArray().apply { policy.dailyLimits.forEach { put(encodeDailyLimit(it)) } })
            put("trustSetEpoch", policy.trustSetEpoch)
            put("keyEpoch", policy.keyEpoch)
            put("issuedAt", policy.issuedAt.toString())
            put("effectiveFrom", policy.effectiveFrom.toString())
            put("expiresAt", policy.expiresAt?.toString() ?: JSONObject.NULL)
            put("continuousUseLimitMinutes", policy.continuousUseLimitMinutes ?: JSONObject.NULL)
            put("breakDurationMinutes", policy.breakDurationMinutes ?: JSONObject.NULL)
        }
    }

    private fun decodePolicy(json: JSONObject): SchedulePolicyV1 {
        val version = json.getString("version")
        if (version != "1") throw JSONException("Unsupported schedule policy version: $version")
        return SchedulePolicyV1(
            version = version,
            policyId = json.getString("policyId"),
            policyRevision = json.scheduleInt("policyRevision"),
            familyId = json.getString("familyId"),
            childProfileId = json.getString("childProfileId"),
            timezone = json.getString("timezone"),
            windows = json.getJSONArray("windows").let { arr -> (0 until arr.length()).map { decodeWindow(arr.getJSONObject(it)) } },
            bonusGrants = json.getJSONArray("bonusGrants").let { arr -> (0 until arr.length()).map { decodeBonus(arr.getJSONObject(it)) } },
            parentExceptions = json.getJSONArray("parentExceptions").let { arr -> (0 until arr.length()).map { decodeException(arr.getJSONObject(it)) } },
            dailyLimits = json.getJSONArray("dailyLimits").let { arr -> (0 until arr.length()).map { decodeDailyLimit(arr.getJSONObject(it)) } },
            trustSetEpoch = EpochBounds.decodeJson(json, "trustSetEpoch"),
            keyEpoch = EpochBounds.decodeJson(json, "keyEpoch"),
            issuedAt = Instant.parse(json.getString("issuedAt")),
            effectiveFrom = Instant.parse(json.getString("effectiveFrom")),
            expiresAt = optionalNullableInstant(json, "expiresAt"),
            continuousUseLimitMinutes = if (json.isNull("continuousUseLimitMinutes")) null else json.scheduleInt("continuousUseLimitMinutes"),
            breakDurationMinutes = if (json.isNull("breakDurationMinutes")) null else json.scheduleInt("breakDurationMinutes"),
        )
    }

    private fun requiredNullableObject(json: JSONObject, key: String): JSONObject? {
        if (!json.has(key)) throw JSONException("Missing required field: $key")
        return when (val value = json.get(key)) {
            JSONObject.NULL -> null
            is JSONObject -> value
            else -> throw JSONException("Field $key must be an object or null")
        }
    }

    private fun requiredNullableInstant(json: JSONObject, key: String): Instant? {
        if (!json.has(key)) throw JSONException("Missing required field: $key")
        return decodeNullableInstant(json.get(key), key)
    }

    private fun optionalNullableInstant(json: JSONObject, key: String): Instant? =
        if (json.has(key)) decodeNullableInstant(json.get(key), key) else null

    private fun decodeNullableInstant(value: Any, key: String): Instant? = when (value) {
        JSONObject.NULL -> null
        is String -> Instant.parse(value)
        else -> throw JSONException("Field $key must be a timestamp string or null")
    }

    private fun requireValidPolicyEpochs(policy: SchedulePolicyV1) {
        EpochBounds.requireValid(policy.trustSetEpoch, "trustSetEpoch")
        EpochBounds.requireValid(policy.keyEpoch, "keyEpoch")
    }

    private fun encodeAppScope(scope: AppScope): JSONObject = when (scope) {
        is AppScope.All -> JSONObject().put("mode", "ALL")
        is AppScope.Apps -> JSONObject().put("mode", "APPS").put("apps", JSONArray(scope.apps))
    }

    private fun decodeAppScope(json: JSONObject): AppScope = when (json.getString("mode")) {
        "ALL" -> AppScope.All
        else -> AppScope.Apps(json.getJSONArray("apps").let { arr -> (0 until arr.length()).map { arr.getString(it) } })
    }

    private fun encodeWindow(w: ScheduleWindow): JSONObject = JSONObject()
        .put("id", w.id)
        .put("kind", w.kind.name)
        .put("daysOfWeek", JSONArray(w.daysOfWeek))
        .put("start", JSONObject().put("hour", w.start.hour).put("minute", w.start.minute))
        .put("end", JSONObject().put("hour", w.end.hour).put("minute", w.end.minute))
        .put("appScope", encodeAppScope(w.appScope))
        .put("timezone", w.timezone)

    private fun decodeWindow(json: JSONObject): ScheduleWindow = ScheduleWindow(
        id = json.getString("id"),
        kind = ScheduleWindowKind.valueOf(json.getString("kind")),
        daysOfWeek = json.getJSONArray("daysOfWeek").let { arr -> (0 until arr.length()).map { arr.scheduleInt(it, "daysOfWeek") } },
        start = json.getJSONObject("start").let { TimeOfDay(it.scheduleInt("hour"), it.scheduleInt("minute")) },
        end = json.getJSONObject("end").let { TimeOfDay(it.scheduleInt("hour"), it.scheduleInt("minute")) },
        appScope = decodeAppScope(json.getJSONObject("appScope")),
        timezone = json.getString("timezone"),
    )

    private fun encodeBonus(b: BonusGrant): JSONObject = JSONObject()
        .put("id", b.id)
        .put("appScope", encodeAppScope(b.appScope))
        .put("extraMinutes", b.extraMinutes)
        .put("grantedAtUtc", b.grantedAtUtc.toString())
        .put("expiresAtUtc", b.expiresAtUtc.toString())

    private fun decodeBonus(json: JSONObject): BonusGrant = BonusGrant(
        id = json.getString("id"),
        appScope = decodeAppScope(json.getJSONObject("appScope")),
        extraMinutes = json.scheduleInt("extraMinutes"),
        grantedAtUtc = Instant.parse(json.getString("grantedAtUtc")),
        expiresAtUtc = Instant.parse(json.getString("expiresAtUtc")),
    )

    private fun encodeException(e: ParentException): JSONObject = JSONObject()
        .put("id", e.id)
        .put("appScope", encodeAppScope(e.appScope))
        .put("startAtUtc", e.startAtUtc.toString())
        .put("endAtUtc", e.endAtUtc.toString())
        .put("reason", e.reason)

    private fun decodeException(json: JSONObject): ParentException = ParentException(
        id = json.getString("id"),
        appScope = decodeAppScope(json.getJSONObject("appScope")),
        startAtUtc = Instant.parse(json.getString("startAtUtc")),
        endAtUtc = Instant.parse(json.getString("endAtUtc")),
        reason = json.getString("reason"),
    )

    private fun encodeDailyLimit(d: DailyAppLimit): JSONObject = JSONObject()
        .put("appScope", encodeAppScope(d.appScope))
        .put("limitMinutes", d.limitMinutes)
        .put("usedMinutesToday", d.usedMinutesToday)
        .put("anchorLocalDate", d.anchorLocalDate)

    private fun decodeDailyLimit(json: JSONObject): DailyAppLimit = DailyAppLimit(
        appScope = decodeAppScope(json.getJSONObject("appScope")),
        limitMinutes = json.scheduleInt("limitMinutes"),
        usedMinutesToday = json.scheduleInt("usedMinutesToday"),
        anchorLocalDate = json.getString("anchorLocalDate"),
    )
}
