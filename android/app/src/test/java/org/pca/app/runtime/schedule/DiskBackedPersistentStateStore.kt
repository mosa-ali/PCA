package org.pca.app.runtime.schedule

import org.pca.app.foundation.PersistentStateStore

/** Minimal process-restart fixture: writes are visible in memory immediately and reach disk on flush. */
internal class DiskBackedPersistentStateStore(
    initialDiskState: Map<String, String> = emptyMap(),
) : PersistentStateStore {
    private val values = initialDiskState.toMutableMap()
    private var durableValues = initialDiskState.toMap()

    var failFlushNumbers: Set<Int> = emptySet()
    var corruptNextReadForKey: String? = null
    var corruptReadAfterSuccessfulReadsForKey: Pair<String, Int>? = null
    var failNextReadForKey: String? = null
    var flushCount: Int = 0
        private set

    override fun getString(key: String): String? {
        if (failNextReadForKey == key) {
            failNextReadForKey = null
            throw IllegalStateException("Injected read failure for $key")
        }
        if (corruptNextReadForKey == key) {
            corruptNextReadForKey = null
            return "corrupt-readback"
        }
        val delayedCorruption = corruptReadAfterSuccessfulReadsForKey
        if (delayedCorruption?.first == key) {
            if (delayedCorruption.second <= 0) {
                corruptReadAfterSuccessfulReadsForKey = null
                return "corrupt-readback"
            }
            corruptReadAfterSuccessfulReadsForKey = key to delayedCorruption.second - 1
        }
        return values[key]
    }

    override fun putString(key: String, value: String) {
        values[key] = value
    }

    override fun remove(key: String) {
        values.remove(key)
    }

    override fun contains(key: String): Boolean = values.containsKey(key)

    override fun clear() {
        values.clear()
    }

    override fun flush() {
        flushCount++
        check(flushCount !in failFlushNumbers) { "Injected flush failure #$flushCount" }
        durableValues = values.toMap()
    }

    fun durableSnapshot(): Map<String, String> = durableValues.toMap()

    fun afterProcessDeath(): DiskBackedPersistentStateStore =
        DiskBackedPersistentStateStore(durableValues)
}
