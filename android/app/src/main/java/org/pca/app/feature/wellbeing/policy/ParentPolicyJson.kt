package org.pca.app.feature.wellbeing.policy

import org.json.JSONArray
import org.json.JSONObject

/**
 * Minimal, dependency-free JSON codec for [ParentWellbeingPolicyV1] and friends, used only by
 * [ParentPolicyStateStore] to round-trip the locally-*accepted* policy durably (item 5's offline
 * requirement). `org.json` is already a test dependency of this module
 * (`app/src/test/java/org/pca/app/persistence/SchemaExportTest.kt`) and is part of the Android
 * platform at runtime, so this adds no new dependency. This is NOT a wire-format/transport
 * decision (doc 36 section 15 explicitly leaves that to another lane) -- it is purely this
 * module's own local-storage representation, exactly as free a choice as
 * `WellbeingPolicyStore`'s pipe-delimited encoding is for its own local storage.
 */
internal object ParentPolicyJson {

    fun encode(policy: ParentWellbeingPolicyV1): JSONObject = JSONObject().apply {
        put("policyId", policy.policyId)
        put("policyRevision", policy.policyRevision)
        put("familyScopeRef", policy.familyScopeRef)
        put("targets", encodeTarget(policy.targets))
        put("enabled", policy.enabled)
        put("selectedCuratedSuggestionIds", JSONArray().apply {
            policy.selectedCuratedSuggestionIds.forEach {
                put(JSONObject().put("suggestionId", it.suggestionId).put("enabled", it.enabled))
            }
        })
        put("customMessages", JSONArray().apply { policy.customMessages.forEach { put(encodeMessage(it)) } })
        put("createdAt", policy.createdAt)
        put("updatedAt", policy.updatedAt)
    }

    fun decode(json: JSONObject): ParentWellbeingPolicyV1 = ParentWellbeingPolicyV1(
        policyId = json.getString("policyId"),
        policyRevision = json.getInt("policyRevision"),
        familyScopeRef = json.getString("familyScopeRef"),
        targets = decodeTarget(json.getJSONObject("targets")),
        enabled = json.getBoolean("enabled"),
        selectedCuratedSuggestionIds = json.optJSONArray("selectedCuratedSuggestionIds")?.let { arr ->
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                SdkCuratedSuggestionSelection(o.getString("suggestionId"), o.getBoolean("enabled"))
            }
        } ?: emptyList(),
        customMessages = json.optJSONArray("customMessages")?.let { arr ->
            (0 until arr.length()).map { i -> decodeMessage(arr.getJSONObject(i)) }
        } ?: emptyList(),
        createdAt = json.optString("createdAt", ""),
        updatedAt = json.optString("updatedAt", ""),
    )

    private fun encodeTarget(target: SdkTargetScope): JSONObject = JSONObject()
        .put("mode", target.mode.name)
        .put("childProfileIds", JSONArray(target.childProfileIds))

    private fun decodeTarget(json: JSONObject): SdkTargetScope = SdkTargetScope(
        mode = SdkTargetMode.valueOf(json.getString("mode")),
        childProfileIds = json.optJSONArray("childProfileIds")?.let { arr ->
            (0 until arr.length()).map { arr.getString(it) }
        } ?: emptyList(),
    )

    private fun encodeMessage(message: SdkCustomWellbeingMessage): JSONObject = JSONObject().apply {
        put("messageId", message.messageId)
        put("enabled", message.enabled)
        put("category", message.category.name)
        put("languageTexts", JSONObject().apply {
            message.languageTexts.forEach { (tag, text) ->
                put(tag, JSONObject().put("title", text.title).put("body", text.body))
            }
        })
        put("schedule", encodeSchedule(message.schedule))
        put("delivery", encodeDelivery(message.delivery))
        put("target", encodeTarget(message.target))
        put("archivedAt", message.archivedAt ?: JSONObject.NULL)
    }

    private fun decodeMessage(json: JSONObject): SdkCustomWellbeingMessage = SdkCustomWellbeingMessage(
        messageId = json.getString("messageId"),
        enabled = json.getBoolean("enabled"),
        category = SdkWellbeingCategory.valueOf(json.getString("category")),
        languageTexts = json.getJSONObject("languageTexts").let { texts ->
            texts.keys().asSequence().associateWith { tag ->
                val t = texts.getJSONObject(tag)
                SdkLanguageText(t.getString("title"), t.getString("body"))
            }
        },
        schedule = decodeSchedule(json.getJSONObject("schedule")),
        delivery = decodeDelivery(json.getJSONObject("delivery")),
        target = decodeTarget(json.getJSONObject("target")),
        archivedAt = if (json.isNull("archivedAt")) null else json.optString("archivedAt", null),
    )

    private fun encodeSchedule(schedule: SdkScheduleWindow): JSONObject = JSONObject().apply {
        put("startDate", schedule.startDate ?: JSONObject.NULL)
        put("endDate", schedule.endDate ?: JSONObject.NULL)
        put("daysOfWeek", JSONArray(schedule.daysOfWeek.toList()))
        put("timeWindows", JSONArray().apply {
            schedule.timeWindows.forEach { put(JSONObject().put("startMinute", it.startMinute).put("endMinute", it.endMinute)) }
        })
        put("timezoneId", schedule.timezoneId ?: JSONObject.NULL)
    }

    private fun decodeSchedule(json: JSONObject): SdkScheduleWindow = SdkScheduleWindow(
        startDate = if (json.isNull("startDate")) null else json.optString("startDate", null),
        endDate = if (json.isNull("endDate")) null else json.optString("endDate", null),
        daysOfWeek = json.optJSONArray("daysOfWeek")?.let { arr -> (0 until arr.length()).map { arr.getString(it) }.toSet() } ?: emptySet(),
        timeWindows = json.optJSONArray("timeWindows")?.let { arr ->
            (0 until arr.length()).map { i -> val o = arr.getJSONObject(i); SdkTimeWindow(o.getInt("startMinute"), o.getInt("endMinute")) }
        } ?: emptyList(),
        timezoneId = if (json.isNull("timezoneId")) null else json.optString("timezoneId", null),
    )

    private fun encodeDelivery(delivery: SdkDeliveryPolicy): JSONObject = JSONObject()
        .put("triggers", JSONArray(delivery.triggers.map { it.name }))
        .put("minimumIntervalMinutes", delivery.minimumIntervalMinutes)
        .put("maximumPerDay", delivery.maximumPerDay)
        .put("repeatCooldownMinutes", delivery.repeatCooldownMinutes)
        .put("lockScreenAllowed", delivery.lockScreenAllowed)
        .put("dismissible", delivery.dismissible)
        .put("snoozable", delivery.snoozable)
        .put("requiresAdultSupervision", delivery.requiresAdultSupervision)

    private fun decodeDelivery(json: JSONObject): SdkDeliveryPolicy = SdkDeliveryPolicy(
        triggers = json.getJSONArray("triggers").let { arr -> (0 until arr.length()).map { SdkWellbeingTrigger.valueOf(arr.getString(it)) }.toSet() },
        minimumIntervalMinutes = json.getInt("minimumIntervalMinutes"),
        maximumPerDay = json.getInt("maximumPerDay"),
        repeatCooldownMinutes = json.getInt("repeatCooldownMinutes"),
        lockScreenAllowed = json.getBoolean("lockScreenAllowed"),
        dismissible = json.optBoolean("dismissible", true),
        snoozable = json.optBoolean("snoozable", true),
        requiresAdultSupervision = json.optBoolean("requiresAdultSupervision", false),
    )
}
