package org.pca.app.feature.wellbeing.policy

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.feature.wellbeing.model.NudgeFeedback
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local log of [NudgeFeedback] events (item 12). The pre-existing
 * `feature/wellbeing/persistence/` boundary (out of this worktree's ownership, see doc 38)
 * has no store for the feedback log `WellbeingAggregateSummaryBuilder.build` expects a caller to
 * supply; this fills that gap using the same [PersistentStateStore] mechanism every other store in
 * this feature uses (see [ParentPolicyStateStore]'s doc for why this is "the existing boundary"
 * at the port level, not a second storage mechanism).
 *
 * `HELPFUL` already flows into `NudgeSelectionEngine` rate state via the caller; this store exists
 * so an aggregate-only summary can be rebuilt after a restart/offline period, entirely locally, and
 * so a future sync lane has something durable and privacy-minimized to read from (see
 * [org.pca.app.feature.wellbeing.ports.WellbeingFeedbackSyncPort]). No screen-time reward is
 * granted anywhere in this store or its callers (PCA-WELL-005).
 */
class WellbeingFeedbackLogStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun append(feedback: NudgeFeedback) {
        val updated = (loadAll() + feedback).takeLast(MAX_ENTRIES)
        save(updated)
    }

    fun loadAll(): List<NudgeFeedback> {
        val raw = store.getString(key) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                try {
                    NudgeFeedback(
                        suggestionId = o.getString("suggestionId"),
                        type = NudgeFeedbackType.valueOf(o.getString("type")),
                        atMonotonicNanos = o.getLong("atMonotonicNanos"),
                    )
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun clear() {
        store.remove(key)
    }

    private fun save(entries: List<NudgeFeedback>) {
        val arr = JSONArray()
        entries.forEach { fb ->
            arr.put(
                JSONObject()
                    .put("suggestionId", fb.suggestionId)
                    .put("type", fb.type.name)
                    .put("atMonotonicNanos", fb.atMonotonicNanos),
            )
        }
        store.putString(key, arr.toString())
    }

    private companion object {
        const val KEY = "wellbeing_feedback_log_v1"

        /** Bounded so an offline-forever device doesn't grow this file unboundedly; large enough
         * for any realistic aggregate-summary window (doc 35's periodic parent-facing summaries
         * are always short/recent windows, never a full history). */
        const val MAX_ENTRIES = 2000
    }
}
