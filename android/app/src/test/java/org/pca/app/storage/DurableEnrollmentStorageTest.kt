package org.pca.app.storage

import org.junit.Assert.*
import org.junit.Test
import org.pca.app.enrollment.PairingState
import org.pca.app.foundation.PersistentStateStore

class DurableEnrollmentStorageTest {
    private class DiskStore(initial: Map<String, String> = emptyMap()) : PersistentStateStore {
        val memory = initial.toMutableMap()
        var disk = initial.toMap()
        var failingFlushes = 0
        var discardNextWrite = false
        override fun getString(key: String) = memory[key]
        override fun contains(key: String) = memory.containsKey(key)
        override fun putString(key: String, value: String) {
            if (discardNextWrite) discardNextWrite = false else memory[key] = value
        }
        override fun remove(key: String) { memory.remove(key) }
        override fun clear() { memory.clear() }
        override fun flush() {
            if (failingFlushes > 0) { failingFlushes--; error("disk failure") }
            disk = memory.toMap()
        }
    }

    private fun attempt() = PendingEnrollmentAttempt(
        "attempt", "recovery", "https://example.test", "ANDROID",
        "dsk", "dsk-alias", "dek", "dek-alias", PendingEnrollmentAttemptStatus.BOOTSTRAPPING,
    )

    @Test fun `pending and family saves survive disk-only restart`() {
        val backing = DiskStore()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        val family = PersistentFamilyStateStore(backing)
        pending.save(attempt())
        val state = LocalFamilyState("family", "device", PairingState.PAIRING_PENDING, 0, 0)
        family.save(state)
        val restarted = DiskStore(backing.disk)
        assertEquals(attempt(), PersistentPendingEnrollmentAttemptStore(restarted).current())
        assertEquals(state, PersistentFamilyStateStore(restarted).currentState())
        pending.clear()
        assertNull(PersistentPendingEnrollmentAttemptStore(DiskStore(backing.disk)).current())
    }

    @Test fun `failed save rolls back visible and durable bytes`() {
        val backing = DiskStore()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        pending.save(attempt())
        val oldDisk = backing.disk
        backing.failingFlushes = 1
        assertThrows(EnrollmentPersistenceException::class.java) { pending.save(attempt().copy(attemptId = "replacement")) }
        assertEquals(oldDisk, backing.disk)
        assertEquals(attempt(), pending.current())
    }

    @Test fun `failed pending clear preserves disk recovery record`() {
        val backing = DiskStore()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        pending.save(attempt())
        backing.failingFlushes = 1
        assertThrows(EnrollmentPersistenceException::class.java) { pending.clear() }
        assertEquals(attempt(), PersistentPendingEnrollmentAttemptStore(DiskStore(backing.disk)).current())
    }

    @Test fun `readback mismatch is rejected and previous record restored`() {
        val backing = DiskStore()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        pending.save(attempt())
        backing.discardNextWrite = true
        assertThrows(EnrollmentPersistenceException::class.java) { pending.save(attempt().copy(attemptId = "replacement")) }
        assertEquals(attempt(), pending.current())
    }

    @Test fun `unconfirmed rollback blocks fresh wrappers and family writes`() {
        val backing = DiskStore()
        PersistentPendingEnrollmentAttemptStore(backing).save(attempt())
        backing.failingFlushes = 2
        assertThrows(EnrollmentPersistenceException::class.java) { PersistentPendingEnrollmentAttemptStore(backing).clear() }
        assertThrows(EnrollmentPersistenceException::class.java) { PersistentPendingEnrollmentAttemptStore(backing).current() }
        assertThrows(EnrollmentPersistenceException::class.java) {
            PersistentFamilyStateStore(backing).save(LocalFamilyState("family", "device", PairingState.PAIRING_PENDING, 0, 0))
        }
        assertThrows(EnrollmentPersistenceException::class.java) { PersistentFamilyStateStore(backing).currentState() }
        // A new process inspects the actual durable record, never the failed memory view.
        assertEquals(attempt(), PersistentPendingEnrollmentAttemptStore(DiskStore(backing.disk)).current())
    }
}
