package org.pca.app.runtime.schedule

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.pca.app.runtime.EpochBounds
import org.pca.app.runtime.trustset.StrictJsonMemberNames
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
        EpochBounds.requireValid(policy.trustSetEpoch, "trustSetEpoch")
        EpochBounds.requireValid(policy.keyEpoch, "keyEpoch")
        val root = JSONObject()
        root.put("kind", KIND)
        root.put("policy", encodePolicy(policy))
        return root.toString()
    }

    /** @throws org.json.JSONException on malformed input, or [IllegalArgumentException] if
     * `kind` is not [KIND] -- the caller is expected to route a different `kind` to whichever
     * other POLICY_UPDATE payload handler owns it, never force-parse it as a schedule policy. */
    fun decode(plaintext: String): SchedulePolicyV1 {
        try {
            StrictJsonMemberNames.requireUnique(plaintext)
        } catch (_: IllegalArgumentException) {
            // Run strict grammar and decoded-name checks before JSONObject's permissive,
            // last-value-wins parser can interpret ambiguous schedule plaintext.
            throw JSONException("invalid_schedule_policy_json")
        } catch (_: IllegalStateException) {
            throw JSONException("invalid_schedule_policy_json")
        }
        val root = JSONObject(plaintext)
        root.requireClosedFields(required = setOf("kind", "policy"))
        val kind = root.getString("kind")
        require(kind == KIND) { "Not a $KIND payload (kind=$kind)." }
        return decodePolicy(root.getJSONObject("policy"))
    }

    /**
     * Decode only after the caller has verified and decrypted the signed family envelope.
     * The payload's epochs must exactly match that envelope's authenticated metadata; this
     * helper performs no sender, signature, membership, or freshness authorization itself.
     */
    fun decodeForEnvelope(
        plaintext: String,
        envelopeTrustSetEpoch: Long,
        envelopeKeyEpoch: Long,
    ): SchedulePolicyV1 {
        EpochBounds.requireValid(envelopeTrustSetEpoch, "trustSetEpoch")
        EpochBounds.requireValid(envelopeKeyEpoch, "keyEpoch")
        val policy = decode(plaintext)
        require(policy.trustSetEpoch.toLong() == envelopeTrustSetEpoch &&
            policy.keyEpoch.toLong() == envelopeKeyEpoch) {
            "schedule_policy_envelope_epoch_mismatch"
        }
        return policy
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
        put("continuousUseLimitMinutes", policy.continuousUseLimitMinutes)
        put("breakDurationMinutes", policy.breakDurationMinutes)
    }

    private fun decodePolicy(json: JSONObject): SchedulePolicyV1 {
        json.requireClosedFields(
            required = setOf("version", "policyId", "policyRevision", "familyId", "childProfileId", "timezone",
                "windows", "bonusGrants", "parentExceptions", "dailyLimits", "trustSetEpoch", "keyEpoch",
                "issuedAt", "effectiveFrom"),
            optional = setOf("expiresAt", "continuousUseLimitMinutes", "breakDurationMinutes"),
        )
        return SchedulePolicyV1(
            version = json.getString("version"),
            policyId = json.getString("policyId"),
            policyRevision = json.scheduleInt("policyRevision"),
            familyId = json.getString("familyId"),
            childProfileId = json.getString("childProfileId"),
            timezone = json.getString("timezone"),
            windows = json.getJSONArray("windows").let { array -> (0 until array.length()).map { decodeWindow(array.getJSONObject(it)) } },
            bonusGrants = json.getJSONArray("bonusGrants").let { array -> (0 until array.length()).map { decodeBonusGrant(array.getJSONObject(it)) } },
            parentExceptions = json.getJSONArray("parentExceptions").let { array -> (0 until array.length()).map { decodeException(array.getJSONObject(it)) } },
            dailyLimits = json.getJSONArray("dailyLimits").let { array -> (0 until array.length()).map { decodeDailyLimit(array.getJSONObject(it)) } },
            trustSetEpoch = EpochBounds.decodeJson(json, "trustSetEpoch"),
            keyEpoch = EpochBounds.decodeJson(json, "keyEpoch"),
            issuedAt = Instant.parse(json.getString("issuedAt")),
            effectiveFrom = Instant.parse(json.getString("effectiveFrom")),
            expiresAt = json.optString("expiresAt", "").takeIf { it.isNotEmpty() }?.let { Instant.parse(it) },
            continuousUseLimitMinutes = decodeOptionalInt(json, "continuousUseLimitMinutes"),
            breakDurationMinutes = decodeOptionalInt(json, "breakDurationMinutes"),
        )
    }

    /** Absent key and an explicit JSON `null` both decode to Kotlin `null` -- [JSONObject.isNull]
     * already treats "no such key" and "value is the NULL sentinel" identically, so a plaintext
     * payload authored before this field existed (key absent entirely) round-trips the same way
     * as one that explicitly nulls it out. */
    private fun decodeOptionalInt(json: JSONObject, key: String): Int? =
        if (json.isNull(key)) null else json.scheduleInt(key)

    private fun encodeAppScope(scope: AppScope): Any = when (scope) {
        is AppScope.All -> "ALL"
        is AppScope.Apps -> JSONObject().apply { put("apps", JSONArray(scope.apps)) }
    }

    private fun decodeAppScope(value: Any): AppScope = when (value) {
        "ALL" -> AppScope.All
        is JSONObject -> {
            value.requireClosedFields(required = setOf("apps"))
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

    private fun decodeWindow(json: JSONObject): ScheduleWindow {
        json.requireClosedFields(required = setOf("id", "kind", "daysOfWeek", "start", "end", "appScope", "timezone"))
        val start = json.getJSONObject("start").also { it.requireClosedFields(required = setOf("hour", "minute")) }
        val end = json.getJSONObject("end").also { it.requireClosedFields(required = setOf("hour", "minute")) }
        return ScheduleWindow(
            id = json.getString("id"),
            kind = ScheduleWindowKind.valueOf(json.getString("kind")),
            daysOfWeek = json.getJSONArray("daysOfWeek").let { array -> (0 until array.length()).map { array.scheduleInt(it, "daysOfWeek") } },
            start = TimeOfDay(start.scheduleInt("hour"), start.scheduleInt("minute")),
            end = TimeOfDay(end.scheduleInt("hour"), end.scheduleInt("minute")),
            appScope = decodeAppScope(json.get("appScope")),
            timezone = json.getString("timezone"),
        )
    }

    private fun encodeBonusGrant(grant: BonusGrant): JSONObject = JSONObject().apply {
        put("id", grant.id)
        put("appScope", encodeAppScope(grant.appScope))
        put("extraMinutes", grant.extraMinutes)
        put("grantedAtUtc", grant.grantedAtUtc.toString())
        put("expiresAtUtc", grant.expiresAtUtc.toString())
    }

    private fun decodeBonusGrant(json: JSONObject): BonusGrant {
        json.requireClosedFields(required = setOf("id", "appScope", "extraMinutes", "grantedAtUtc", "expiresAtUtc"))
        return BonusGrant(
            id = json.getString("id"),
            appScope = decodeAppScope(json.get("appScope")),
            extraMinutes = json.scheduleInt("extraMinutes"),
            grantedAtUtc = Instant.parse(json.getString("grantedAtUtc")),
            expiresAtUtc = Instant.parse(json.getString("expiresAtUtc")),
        )
    }

    private fun encodeException(exception: ParentException): JSONObject = JSONObject().apply {
        put("id", exception.id)
        put("appScope", encodeAppScope(exception.appScope))
        put("startAtUtc", exception.startAtUtc.toString())
        put("endAtUtc", exception.endAtUtc.toString())
        put("reason", exception.reason)
    }

    private fun decodeException(json: JSONObject): ParentException {
        json.requireClosedFields(required = setOf("id", "appScope", "startAtUtc", "endAtUtc", "reason"))
        return ParentException(
            id = json.getString("id"),
            appScope = decodeAppScope(json.get("appScope")),
            startAtUtc = Instant.parse(json.getString("startAtUtc")),
            endAtUtc = Instant.parse(json.getString("endAtUtc")),
            reason = json.getString("reason"),
        )
    }

    private fun encodeDailyLimit(limit: DailyAppLimit): JSONObject = JSONObject().apply {
        put("appScope", encodeAppScope(limit.appScope))
        put("limitMinutes", limit.limitMinutes)
        put("usedMinutesToday", limit.usedMinutesToday)
        put("anchorLocalDate", limit.anchorLocalDate)
    }

    private fun decodeDailyLimit(json: JSONObject): DailyAppLimit {
        json.requireClosedFields(required = setOf("appScope", "limitMinutes", "usedMinutesToday", "anchorLocalDate"))
        return DailyAppLimit(
            appScope = decodeAppScope(json.get("appScope")),
            limitMinutes = json.scheduleInt("limitMinutes"),
            usedMinutesToday = json.scheduleInt("usedMinutesToday"),
            anchorLocalDate = json.getString("anchorLocalDate"),
        )
    }

    private fun JSONObject.requireClosedFields(required: Set<String>, optional: Set<String> = emptySet()) {
        val names = keys().asSequence().toSet()
        require(names.containsAll(required) && names.all { it in required || it in optional }) {
            "unexpected_schedule_policy_fields"
        }
    }
}
