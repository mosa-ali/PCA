package org.pca.app.feature.wellbeing.policy

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for the parent-policy adapter's own state: the
 * [RevisionGuardState] (item 15) and the [WellbeingPolicySyncState] ACCEPTED/ACTIVE vs
 * PENDING_DELIVERY split (item 5). Deliberately a *separate* store class from
 * `org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore` /
 * `CustomSuggestionStore` (which this worktree may not modify -- see doc 38 "ownership boundary"
 * section) rather than a parallel storage *mechanism*: like every other store in this feature,
 * it is a thin class over the same [PersistentStateStore] port PCA-2 already provides (doc 35:
 * "Does not add a second storage mechanism"). This is the store that makes items 5 and 8 actually
 * hold true *after a process death / while offline since acceptance*, not just within one
 * in-memory session.
 *
 * Not wired into `WellbeingDataEraser.purgeAll()` (that class lives under
 * `persistence/` subtree, out of this worktree's ownership) -- [clear] is exposed as this store's own
 * purge hook, ready for a Coordinator to fold into `WellbeingDataEraser` alongside its four
 * existing stores when that lane is next touched (see doc 38's "parent-web / coordinator
 * integration action" section).
 */
class ParentPolicyStateStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    data class Snapshot(
        val syncState: WellbeingPolicySyncState,
        val revisionGuard: RevisionGuardState,
    ) {
        companion object {
            val EMPTY = Snapshot(WellbeingPolicySyncState.EMPTY, RevisionGuardState.INITIAL)
        }
    }

    fun save(snapshot: Snapshot) {
        store.putString(key, encode(snapshot).toString())
    }

    /** Never throws on corrupt/unparseable stored data -- degrades to [Snapshot.EMPTY] (no policy
     * ever accepted), the same fail-safe-decode contract every other store in this feature
     * follows (`WellbeingRateStateStore`'s doc comment). A corrupt snapshot must never be
     * interpreted as "wellbeing disabled" either -- callers fall back to whatever local
     * [org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy] `WellbeingPolicyStore` already
     * has, unaffected by this store's state. */
    fun load(): Snapshot {
        val raw = store.getString(key) ?: return Snapshot.EMPTY
        return try {
            decode(JSONObject(raw))
        } catch (_: Exception) {
            Snapshot.EMPTY
        }
    }

    fun clear() {
        store.remove(key)
    }

    private fun encode(snapshot: Snapshot): JSONObject = JSONObject().apply {
        put("revisionGuard", JSONObject().apply {
            put("currentRevision", snapshot.revisionGuard.currentRevision)
            put("appliedOperationIds", JSONArray(snapshot.revisionGuard.appliedOperationIds.toList()))
        })
        snapshot.syncState.active?.let { active ->
            put("active", JSONObject().apply {
                put("policy", ParentPolicyJson.encode(active.policy))
                put("revision", active.revision)
            })
        }
        snapshot.syncState.pending?.let { pending ->
            put("pending", JSONObject().apply {
                put("policy", ParentPolicyJson.encode(pending.policy))
                put("revision", pending.revision)
                put("receivedAtMonotonicNanos", pending.receivedAtMonotonicNanos)
            })
        }
    }

    private fun decode(json: JSONObject): Snapshot {
        val guardJson = json.getJSONObject("revisionGuard")
        val revisionGuard = RevisionGuardState(
            currentRevision = guardJson.getInt("currentRevision"),
            appliedOperationIds = guardJson.getJSONArray("appliedOperationIds").let { arr ->
                (0 until arr.length()).map { arr.getString(it) }.toSet()
            },
        )
        val active = json.optJSONObject("active")?.let {
            ActivePolicy(ParentPolicyJson.decode(it.getJSONObject("policy")), it.getInt("revision"))
        }
        val pending = json.optJSONObject("pending")?.let {
            PendingPolicy(
                ParentPolicyJson.decode(it.getJSONObject("policy")),
                it.getInt("revision"),
                it.getLong("receivedAtMonotonicNanos"),
            )
        }
        return Snapshot(WellbeingPolicySyncState(active, pending), revisionGuard)
    }

    private companion object {
        const val KEY = "wellbeing_parent_policy_sync_v1"
    }
}
