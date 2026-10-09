package org.pca.app.runtime.location.geofence

import java.util.Collections
import java.util.IdentityHashMap
import org.pca.app.foundation.PersistentStateStore

/** Contains no coordinates, labels or readable state in its failure message. */
internal class GeofencePersistenceException : IllegalStateException("Safe Zone storage durability unavailable")

/** Per backing-file durability only; separate zone/state files never form a transaction. */
internal object GeofenceDurableStorage {
    private val uncertain = Collections.newSetFromMap(IdentityHashMap<Any, Boolean>())
    private fun healthy(store: PersistentStateStore) {
        if (synchronized(uncertain) { uncertain.contains(store.coordinationLock) }) throw GeofencePersistenceException()
    }
    fun read(store: PersistentStateStore, key: String): String? = synchronized(store.coordinationLock) {
        healthy(store)
        try {
            if (store.getString(markerKey(key)) != null) throw GeofencePersistenceException()
            store.getString(key)
        } catch (_: Exception) { throw GeofencePersistenceException() }
    }
    fun write(store: PersistentStateStore, key: String, value: String?) = synchronized(store.coordinationLock) {
        val previous = read(store, key)
        val marker = markerKey(key)
        fun clearMarker() {
            store.remove(marker); store.flush()
            check(store.getString(marker) == null)
        }
        fun persist(raw: String?) {
            if (raw == null) store.remove(key) else store.putString(key, raw)
            store.flush(); check(store.getString(key) == raw)
        }
        fun poison() { synchronized(uncertain) { uncertain.add(store.coordinationLock) } }
        try {
            store.putString(marker, "pending"); store.flush()
            check(store.getString(marker) == "pending")
        } catch (_: Exception) {
            // No candidate bytes were written. A verified marker cleanup is safe.
            try { clearMarker() } catch (_: Exception) { poison() }
            throw GeofencePersistenceException()
        }
        try { persist(value) } catch (_: Exception) {
            try { persist(previous); clearMarker() } catch (_: Exception) { poison() }
            throw GeofencePersistenceException()
        }
        try { clearMarker() } catch (_: Exception) {
            // Never rollback verified bytes after marker removal may have reached disk.
            poison(); throw GeofencePersistenceException()
        }
    }
    private fun markerKey(key: String) = key + "_pending_write"
}
