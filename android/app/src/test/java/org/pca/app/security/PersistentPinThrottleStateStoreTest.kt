package org.pca.app.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentPinThrottleStateStoreTest {
    @Test
    fun `load returns null before anything is saved`() {
        val store = PersistentPinThrottleStateStore(InMemoryPersistentStateStore())
        assertNull(store.load())
    }

    @Test
    fun `save then load round-trips`() {
        val store = PersistentPinThrottleStateStore(InMemoryPersistentStateStore())
        val state = PinThrottleState(consecutiveFailures = 3, lastFailureElapsedRealtimeMillis = 42_000L)
        store.save(state)
        assertEquals(state, store.load())
    }

    @Test
    fun `clear removes the saved state`() {
        val store = PersistentPinThrottleStateStore(InMemoryPersistentStateStore())
        store.save(PinThrottleState(1, 1L))
        store.clear()
        assertNull(store.load())
    }

    @Test
    fun `malformed persisted value is treated as absent, not a crash`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("admin_pin_throttle_state", "not-a-valid-encoding")
        val store = PersistentPinThrottleStateStore(backing)
        assertNull(store.load())
    }
}
