package org.pca.app.feature.removaldecision

import org.pca.app.foundation.PersistentStateStore

/** Durable storage for the single current [RemovalDecisionRecord] this device holds. */
interface RemovalDecisionRepository {
    fun load(): RemovalDecisionRecord?
    fun save(record: RemovalDecisionRecord)
}

/**
 * Production adapter over [PersistentStateStore] (EncryptedSharedPreferences
 * in the real app graph -- doc 09 Section 7's OS-backed local at-rest
 * protection). Manual `"state:decidedAt:until"` encoding, not
 * `org.json.JSONObject`, deliberately: `org.json` is only wired as a JVM
 * test dependency in this module (`android/app/build.gradle.kts`
 * `testImplementation(libs.org.json)`), so using it from `main` sourceSet
 * code would compile against the Android SDK stub but throw
 * "not mocked" on a real device/at runtime outside Robolectric -- same
 * reasoning [PersistentPinThrottleStateStore] already applies to its own
 * encoding.
 */
class PersistentRemovalDecisionRepository(
    private val stateStore: PersistentStateStore,
    private val key: String = "removal_decision_record_v1",
) : RemovalDecisionRepository {
    override fun load(): RemovalDecisionRecord? {
        val raw = stateStore.getString(key) ?: return null
        val parts = raw.split(":")
        if (parts.size != 3) return null
        val state = runCatching { RemovalDecisionState.valueOf(parts[0]) }.getOrNull() ?: return null
        val decidedAt = parts[1].toLongOrNull() ?: return null
        val until = if (parts[2].isEmpty()) null else parts[2].toLongOrNull()
        return runCatching {
            RemovalDecisionRecord(state = state, decidedAtEpochMillis = decidedAt, temporarilyDisabledUntilEpochMillis = until)
        }.getOrNull()
    }

    override fun save(record: RemovalDecisionRecord) {
        val untilPart = record.temporarilyDisabledUntilEpochMillis?.toString() ?: ""
        stateStore.putString(key, "${record.state.name}:${record.decidedAtEpochMillis}:$untilPart")
    }
}

/** JVM-process-lifetime fake -- tests and dev/preview compositions only. */
class InMemoryRemovalDecisionRepository : RemovalDecisionRepository {
    private var record: RemovalDecisionRecord? = null
    override fun load(): RemovalDecisionRecord? = record
    override fun save(record: RemovalDecisionRecord) { this.record = record }
}
