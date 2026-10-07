package org.pca.app.runtime.usage

import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.platform.UsageClockSample

class UsageObservationSnapshotStoreTest {
    private val key = "usage_observation_snapshot_v1"
    private fun snapshot() = UsageObservationSnapshot(
        UsageSessionEngineState(OpenUsageSession("app|NULL|ع", 100L, 9_100L), 100L),
        "boot-1", 2, UsageClockSample(1_000L, 10_000L), "device-1", UsageObservationCoverage.OBSERVED, "generation-1",
        UsageClockSample(0L, 9_000L))

    @Test fun `v2 roundtrip preserves exact identities delimiters and bridge provenance`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentUsageObservationSnapshotStore(backing)
        val value = snapshot()
        store.save(value)
        assertTrue(backing.getString(key)!!.startsWith("v2:"))
        assertEquals(value, store.load())
        assertEquals(value.engineState, UsageObservationRestorer.restore(store.load(), "boot-1"))
        assertEquals(UsageSessionEngineState.INITIAL, UsageObservationRestorer.restore(store.load(), "different-boot"))
        assertEquals(UsageSessionEngineState.INITIAL, UsageObservationRestorer.restore(store.load(), null))
    }

    @Test fun `legacy snapshot is recognized but does not restore unverified open credit`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString(key, "app-a|100|9100|100|boot-1")
        val store = PersistentUsageObservationSnapshotStore(backing)
        val legacy = store.load()!!
        assertEquals(1, legacy.schemaVersion)
        assertEquals(UsageSessionEngineState.INITIAL, UsageObservationRestorer.restore(legacy, "boot-1"))
        store.save(snapshot())
        assertEquals(2, store.load()!!.schemaVersion)
    }

    @Test fun `corruption is distinguishable from missing state`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentUsageObservationSnapshotStore(backing)
        assertNull(store.load())
        for (raw in listOf("broken", "v2:!!!!", "v2:AAAAAA==", "a|x|0|0|boot")) {
            backing.putString(key, raw)
            assertThrows(UsageObservationSnapshotUnavailable::class.java) { store.load() }
        }
    }

    @Test fun `truncated or trailing v2 payload cannot become a valid snapshot`() {
        val store = PersistentUsageObservationSnapshotStore(InMemoryPersistentStateStore())
        val raw = store.encode(snapshot())
        assertNull(store.decode(raw.dropLast(4)))
        val bytes = java.util.Base64.getDecoder().decode(raw.removePrefix("v2:"))
        assertNull(store.decode("v2:" + java.util.Base64.getEncoder().encodeToString(bytes + byteArrayOf(0))))
    }

    @Test fun `flush and exact readback failures are observable`() {
        val backing = InMemoryPersistentStateStore()
        var failFlush = true
        var corruptReadback = false
        val faulting = object : PersistentStateStore by backing {
            override fun flush() { if (failFlush) error("flush failed") }
            override fun getString(key: String): String? = if (corruptReadback) "corrupt" else backing.getString(key)
        }
        val store = PersistentUsageObservationSnapshotStore(faulting)
        assertThrows(IllegalStateException::class.java) { store.save(snapshot()) }
        failFlush = false; corruptReadback = true
        assertThrows(UsageObservationSnapshotUnavailable::class.java) { store.save(snapshot()) }
    }

    @Test fun `invalid authority snapshots cannot be written`() {
        val store = PersistentUsageObservationSnapshotStore(InMemoryPersistentStateStore())
        val valid = snapshot()
        for (invalid in listOf(valid.copy(bootId = null), valid.copy(deviceId = null),
            valid.copy(bridgeSample = null), valid.copy(coverage = UsageObservationCoverage.UNKNOWN),
            valid.copy(engineState = valid.engineState.copy(lastProcessedElapsedMillis = 99L)),
            valid.copy(bridgeSample = UsageClockSample(-1L, 0L)), valid.copy(deviceId = "\uD800"))) {
            assertThrows(Exception::class.java) { store.save(invalid) }
        }
    }

    @Test fun `impossible persisted original wall start is rejected on both save and decode`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentUsageObservationSnapshotStore(backing)
        val valid = snapshot()
        val open = valid.engineState.openSession!!
        for (epoch in listOf(Long.MAX_VALUE, 100L, 20_000L)) {
            val invalid = valid.copy(engineState = valid.engineState.copy(
                openSession = open.copy(startedAtEpochMillis = epoch)))
            assertThrows(IllegalArgumentException::class.java) { store.save(invalid) }
            val bytes = java.util.Base64.getDecoder().decode(store.encode(valid).removePrefix("v2:"))
            java.nio.ByteBuffer.wrap(bytes).putLong(bytes.size - 8, epoch)
            val raw = "v2:" + java.util.Base64.getEncoder().encodeToString(bytes)
            assertNull(store.decode(raw))
            backing.putString(key, raw)
            assertThrows(UsageObservationSnapshotUnavailable::class.java) { store.load() }
        }
    }
}
