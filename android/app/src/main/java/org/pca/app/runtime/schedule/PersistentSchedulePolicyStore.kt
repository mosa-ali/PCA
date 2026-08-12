package org.pca.app.runtime.schedule

import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore

/**
 * Coordinator integration glue: backs [SchedulePolicyStore] with the same durable, OS-backed
 * [PersistentStateStore] pattern already established for [org.pca.app.feature.screentime.persistence.PersistentScreenTimeSnapshotStore]
 * and [org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore] -- replacing the
 * in-memory reference implementation used during standalone lane development, per mission
 * section 12's "policy accepted -> process/device restart while offline -> same schedule
 * decision still produced" requirement.
 */
class PersistentSchedulePolicyStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : SchedulePolicyStore {

    override fun save(snapshot: SchedulePolicySnapshot) {
        store.putString(key, SchedulePolicyJson.encodeSnapshot(snapshot).toString())
    }

    override fun load(): SchedulePolicySnapshot? {
        val raw = store.getString(key) ?: return null
        return runCatching { SchedulePolicyJson.decodeSnapshot(JSONObject(raw)) }.getOrNull()
    }

    private companion object {
        const val KEY = "schedule_policy_snapshot_v1"
    }
}
