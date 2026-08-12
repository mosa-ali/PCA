package org.pca.app.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.enrollment.PairingState
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentFamilyStateStoreTest {

    @Test
    fun `save then load round-trips every field exactly`() {
        val store = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val state = LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.ACTIVE, trustSetEpoch = 3, keyEpoch = 2)

        store.save(state)

        assertEquals(state, store.currentState())
    }

    @Test
    fun `survives a process restart -- a fresh store instance over the same backing sees the same state`() {
        val backing = InMemoryPersistentStateStore()
        val state = LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.PAIRED, trustSetEpoch = 1, keyEpoch = 1)
        PersistentFamilyStateStore(backing).save(state)

        val afterRestart = PersistentFamilyStateStore(backing).currentState()

        assertEquals(state, afterRestart)
    }

    @Test
    fun `no state saved yet reports null, never a fabricated identity`() {
        val store = PersistentFamilyStateStore(InMemoryPersistentStateStore())

        assertNull(store.currentState())
    }

    @Test
    fun `clear removes the persisted state`() {
        val store = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        store.save(LocalFamilyState(familyId = "family-1", deviceId = "D123", pairingState = PairingState.ACTIVE, trustSetEpoch = 1, keyEpoch = 1))

        store.clear()

        assertNull(store.currentState())
    }

    @Test
    fun `corrupt persisted data fails safe to null rather than crashing`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentFamilyStateStore(backing)
        backing.putString("family_state_v1", "not|a|valid|pairing-state-name")

        assertNull(store.currentState())
    }
}
