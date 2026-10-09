package org.pca.app.storage

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
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
    fun `versioned JSON round trips opaque identifiers containing separators and Unicode`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentFamilyStateStore(backing)
        val state = LocalFamilyState(
            familyId = "family|segment|العائلة",
            deviceId = "device|segment|🔐",
            pairingState = PairingState.PAIRING_PENDING,
            trustSetEpoch = 0,
            keyEpoch = 0,
            childProfileId = "child|segment|👧",
        )

        store.save(state)

        assertEquals(state, PersistentFamilyStateStore(backing).currentState())
        assertNull(backing.getString("family_state_v1"))
        assertTrue(backing.getString("family_state_v1.v2")!!.startsWith("{"))
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
            "family-1||ACTIVE|1|1",
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
    fun `partial or corrupt v2 record fails closed instead of falling back to legacy`() {
        val legacy = "family-1|D123|ACTIVE|1|1"
        for (versioned in listOf(
            "{\"version\":2}",
            "{\"version\":2,\"familyId\":\"family-2\"}",
            "not-json",
        )) {
            val backing = InMemoryPersistentStateStore()
            backing.putString("family_state_v1", legacy)
            backing.putString("family_state_v1.v2", versioned)
            val store = PersistentFamilyStateStore(backing)

            assertThrows(CorruptLocalFamilyStateException::class.java) { store.currentState() }
            assertEquals(legacy, backing.getString("family_state_v1"))
            assertEquals(versioned, backing.getString("family_state_v1.v2"))
        }
    }

    @Test
    fun `blank device identity is rejected on save and treated as corrupt in v2`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentFamilyStateStore(backing)
        assertThrows(IllegalArgumentException::class.java) {
            store.save(LocalFamilyState("family", "", PairingState.PAIRING_PENDING, 0, 0))
        }
        assertNull(backing.getString("family_state_v1.v2"))

        store.save(LocalFamilyState("family", "device", PairingState.PAIRING_PENDING, 0, 0))
        val corrupted = JSONObject(backing.getString("family_state_v1.v2")!!)
            .put("deviceId", "")
            .toString()
        backing.putString("family_state_v1.v2", corrupted)

        assertThrows(CorruptLocalFamilyStateException::class.java) { store.currentState() }
        assertEquals(corrupted, backing.getString("family_state_v1.v2"))
    }

    @Test
    fun `clear tombstone prevents a legacy record from being resurrected`() {
        val backing = InMemoryPersistentStateStore()
        val legacy = "family-1|D123|ACTIVE|1|1"
        backing.putString("family_state_v1", legacy)
        val store = PersistentFamilyStateStore(backing)

        assertEquals("family-1", store.currentState()!!.familyId)
        store.clear()

        assertNull(PersistentFamilyStateStore(backing).currentState())
        assertEquals(legacy, backing.getString("family_state_v1"))
        assertEquals("family-state-cleared-v2", backing.getString("family_state_v1.v2"))
    }

    @Test
    fun `clear cannot interleave between the versioned miss and legacy fallback read`() {
        val backing = InMemoryPersistentStateStore()
        val legacy = "family-1|D123|ACTIVE|1|1"
        backing.putString("family_state_v1", legacy)
        val store = PersistentFamilyStateStore(backing)
        val betweenReads = CountDownLatch(1)
        val continueRead = CountDownLatch(1)
        val clearStarted = CountDownLatch(1)
        val clearFinished = CountDownLatch(1)
        val clearWorker = AtomicReference<Thread?>()
        val workers = Executors.newFixedThreadPool(2)

        try {
            val reader = workers.submit<LocalFamilyState?> {
                store.currentState {
                    betweenReads.countDown()
                    check(continueRead.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue("reader did not reach the fallback boundary", betweenReads.await(2, TimeUnit.SECONDS))

            val clearer = workers.submit {
                clearWorker.set(Thread.currentThread())
                clearStarted.countDown()
                store.clear()
                clearFinished.countDown()
            }
            assertTrue("clear task did not start", clearStarted.await(2, TimeUnit.SECONDS))
            val blockedDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (clearWorker.get()?.state != Thread.State.BLOCKED && System.nanoTime() < blockedDeadline) {
                Thread.yield()
            }
            assertEquals("clear must contend on the read transaction lock", Thread.State.BLOCKED, clearWorker.get()?.state)
            assertFalse("clear interleaved before the legacy read", clearFinished.count == 0L)

            continueRead.countDown()
            assertEquals("family-1", reader.get(2, TimeUnit.SECONDS)?.familyId)
            clearer.get(2, TimeUnit.SECONDS)
            assertTrue("clear did not finish after the reader released the lock", clearFinished.await(1, TimeUnit.SECONDS))

            // The read linearized before clear; once the clear tombstone is
            // committed, a fresh read cannot resurrect the retained v1 row.
            assertNull(store.currentState())
            assertEquals(legacy, backing.getString("family_state_v1"))
            assertEquals("family-state-cleared-v2", backing.getString("family_state_v1.v2"))
        } finally {
            continueRead.countDown()
            workers.shutdownNow()
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
