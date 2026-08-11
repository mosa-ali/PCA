package org.pca.app.foundation

/**
 * Durable local key-value state store -- the generic "persistent state"
 * port PCA-2 capability adapters and PCA-1 enrollment/pairing state depend
 * on, so feature code never talks to a concrete Android storage API
 * directly. A backing implementation is responsible for its own at-rest
 * protection (doc 09 Section 7: OS-backed key protection); callers must
 * never assume plaintext-on-disk semantics either way -- this interface
 * says nothing about encryption, only durability and key/value semantics.
 */
interface PersistentStateStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
    fun contains(key: String): Boolean
    fun clear()
}

/**
 * In-memory reference PersistentStateStore. Like the backend's in-memory
 * ledger reference implementations, this is ordinary bookkeeping with no
 * crypto-sensitive choice -- a real, usable implementation (e.g. for a
 * process-lifetime cache layered in front of a durable store), not a
 * test-only stand-in, though it is NOT itself durable across process
 * death and must never be used where doc 09 Section 7's at-rest
 * protection requirement applies.
 */
class InMemoryPersistentStateStore : PersistentStateStore {
    private val values = mutableMapOf<String, String>()

    override fun getString(key: String): String? = values[key]
    override fun putString(key: String, value: String) { values[key] = value }
    override fun remove(key: String) { values.remove(key) }
    override fun contains(key: String): Boolean = values.containsKey(key)
    override fun clear() { values.clear() }
}
