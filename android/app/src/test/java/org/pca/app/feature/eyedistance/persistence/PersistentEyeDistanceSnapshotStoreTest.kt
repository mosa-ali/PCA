package org.pca.app.feature.eyedistance.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentEyeDistanceSnapshotStoreTest {

    private val backing = InMemoryPersistentStateStore()
    private val store = PersistentEyeDistanceSnapshotStore(backing)

    @Test
    fun `encode-decode round trip preserves every field`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(
                phase = EyeDistancePhase.WARNING,
                nearElapsedNanos = 12345L,
                farElapsedNanos = 0L,
                unknownElapsedNanos = 0L,
                restElapsedNanos = 0L,
                warningEpisodeTimestampsNanos = listOf(1L, 2L, 3L),
                lastTickMonotonicNanos = 99999L,
                preSuspendPhase = EyeDistancePhase.MONITORING,
                exceptionActive = true,
                preExceptionPhase = EyeDistancePhase.WARNING,
            ),
            snapshotWallClockMillis = 1_700_000_000_000L,
            bootId = "boot-abc",
        )

        store.save(snapshot)
        val loaded = store.load()

        assertEquals(snapshot, loaded)
    }

    @Test
    fun `round trip with null optional fields and empty episode list`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(),
            snapshotWallClockMillis = 0L,
            bootId = null,
        )
        store.save(snapshot)
        assertEquals(snapshot, store.load())
    }

    @Test
    fun `corrupt persisted value fails safe to null rather than crashing`() {
        backing.putString("eye_distance_snapshot_v1", "not|a|valid|snapshot")
        assertNull(store.load())
    }

    @Test
    fun `unknown enum name from a future app version fails safe to null`() {
        val validEncoded = store.encode(
            EyeDistanceSnapshot(EyeDistanceState(phase = EyeDistancePhase.MONITORING), 0L, null),
        )
        val corrupted = validEncoded.replaceFirst("MONITORING", "SOME_FUTURE_PHASE")
        backing.putString("eye_distance_snapshot_v1", corrupted)
        assertNull(store.load())
    }

    @Test
    fun `persisted representation never contains the literal words frame, landmark, or biometric`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 5L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val encoded = store.encode(snapshot)
        val lower = encoded.lowercase()
        assertFalse(lower.contains("frame"))
        assertFalse(lower.contains("landmark"))
        assertFalse(lower.contains("biometric"))
        assertFalse(lower.contains("face"))
    }
}
