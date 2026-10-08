package org.pca.app.storage

import java.util.IdentityHashMap
import org.pca.app.foundation.PersistentStateStore

/** No record contents or recovery credentials may appear in storage errors. */
class EnrollmentPersistenceException : IllegalStateException("Local enrollment storage could not be confirmed")

/** A failed rollback blocks every enrollment wrapper sharing this backing store for this process. */
internal object DurableEnrollmentStorage {
    private val uncertain = IdentityHashMap<Any, Boolean>()

    private fun checkHealthy(store: PersistentStateStore) {
        if (synchronized(uncertain) { uncertain.containsKey(store.coordinationLock) }) {
            throw EnrollmentPersistenceException()
        }
    }

    fun read(store: PersistentStateStore, key: String): String? = synchronized(store.coordinationLock) {
        checkHealthy(store)
        try { store.getString(key) } catch (_: Exception) { throw EnrollmentPersistenceException() }
    }

    fun write(store: PersistentStateStore, key: String, value: String?) = synchronized(store.coordinationLock) {
        checkHealthy(store)
        val previous = read(store, key)
        fun persist(raw: String?) {
            if (raw == null) store.remove(key) else store.putString(key, raw)
            store.flush()
            check(store.getString(key) == raw)
        }
        try {
            persist(value)
        } catch (_: Exception) {
            try { persist(previous) } catch (_: Exception) {
                synchronized(uncertain) { uncertain[store.coordinationLock] = true }
            }
            throw EnrollmentPersistenceException()
        }
    }
}
