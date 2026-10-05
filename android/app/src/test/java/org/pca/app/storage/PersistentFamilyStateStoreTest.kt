package org.pca.app.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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
    fun `corrupt persisted data is distinct from absent state and is never rewritten`() {
        for (raw in listOf(
            "family-1|D123|NOT_A_PAIRING_STATE|1|1",
            "not|enough|fields",
        )) {
            val backing = InMemoryPersistentStateStore()
            val store = PersistentFamilyStateStore(backing)
            backing.putString("family_state_v1", raw)

            assertThrows(CorruptLocalFamilyStateException::class.java) { store.currentState() }
            assertEquals(raw, backing.getString("family_state_v1"))
        }
    }

    @Test
    fun `invalid persisted epochs fail closed without rewriting stored state`() {
        for (raw in listOf(
            "family-1|D123|ACTIVE|-1|2",
            "family-1|D123|ACTIVE|2|-1",
            "family-1|D123|ACTIVE|2147483648|2",
        )) {
            val backing = InMemoryPersistentStateStore()
            backing.putString("family_state_v1", raw)
            val store = PersistentFamilyStateStore(backing)

            assertThrows(CorruptLocalFamilyStateException::class.java) { store.currentState() }
            assertEquals(raw, backing.getString("family_state_v1"))
        }
    }

    @Test
    fun `zero epoch sentinels remain valid and saving negatives is rejected`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentFamilyStateStore(backing)
        val zeroState = LocalFamilyState("family-1", "D123", PairingState.PAIRED, 0, 0)

        store.save(zeroState)
        assertEquals(zeroState, store.currentState())
        assertThrows(IllegalArgumentException::class.java) {
            store.save(zeroState.copy(trustSetEpoch = -1))
        }
        assertEquals(zeroState, store.currentState())
    }
}
