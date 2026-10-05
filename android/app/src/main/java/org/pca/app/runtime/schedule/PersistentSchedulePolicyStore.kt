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

    override fun load(): SchedulePolicySnapshot? = when (val result = read()) {
        SchedulePolicyStoreRead.Absent, SchedulePolicyStoreRead.Corrupt -> null
        is SchedulePolicyStoreRead.Present -> result.snapshot
    }

    override fun read(): SchedulePolicyStoreRead {
        val raw = store.getString(key) ?: return SchedulePolicyStoreRead.Absent
        return runCatching { SchedulePolicyJson.decodeSnapshot(JSONObject(raw)) }
            .fold(
                onSuccess = { SchedulePolicyStoreRead.Present(it) },
                // Do not remove or rewrite the raw bytes. Keep them for diagnosis and recovery.
                onFailure = { SchedulePolicyStoreRead.Corrupt },
            )
    }

    private companion object {
        const val KEY = "schedule_policy_snapshot_v1"
    }
}
