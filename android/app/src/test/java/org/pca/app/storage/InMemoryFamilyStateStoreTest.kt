package org.pca.app.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.enrollment.PairingState

class InMemoryFamilyStateStoreTest {
    private fun sampleState() = LocalFamilyState(
        familyId = "family-1",
        deviceId = "device-1",
        pairingState = PairingState.PAIRING_PENDING,
        trustSetEpoch = 1,
        keyEpoch = 1,
    )

    @Test
    fun `currentState is null before anything is saved`() {
        val store = InMemoryFamilyStateStore()
        assertNull(store.currentState())
    }

    @Test
    fun `save then currentState round-trips`() {
        val store = InMemoryFamilyStateStore()
        store.save(sampleState())
        assertEquals(sampleState(), store.currentState())
    }

    @Test
    fun `save overwrites any previously saved state`() {
        val store = InMemoryFamilyStateStore()
        store.save(sampleState())
        val updated = sampleState().copy(pairingState = PairingState.PAIRED, trustSetEpoch = 2)
        store.save(updated)
        assertEquals(updated, store.currentState())
    }

    @Test
    fun `clear removes the saved state`() {
        val store = InMemoryFamilyStateStore()
        store.save(sampleState())
        store.clear()
        assertNull(store.currentState())
    }
}
