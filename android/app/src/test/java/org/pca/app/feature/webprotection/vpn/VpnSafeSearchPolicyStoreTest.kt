package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.foundation.PersistentStateStore

class VpnSafeSearchPolicyStoreTest {

    @Test
    fun `absent state remains off and a saved mode survives a fresh store instance`() {
        val disk = DurableStore()
        val first = VpnSafeSearchPolicyStore(disk)
        assertEquals(SafeSearchMode.OFF, first.currentMode())

        first.setMode(SafeSearchMode.STRICT)

        assertEquals(1, disk.flushCount)
        assertEquals(SafeSearchMode.STRICT, VpnSafeSearchPolicyStore(disk.afterProcessDeath()).currentMode())
    }

    @Test
    fun `failed candidate flush restores the prior mode before returning failure`() {
        val disk = DurableStore()
        val first = VpnSafeSearchPolicyStore(disk)
        first.setMode(SafeSearchMode.STRICT)
        disk.resetFaults()
        disk.failFlushAt = setOf(1)

        assertFailure { first.setMode(SafeSearchMode.OFF) }

        assertEquals("STRICT", disk.disk[KEY])
        assertEquals(SafeSearchMode.STRICT, first.currentMode())
        assertEquals(SafeSearchMode.STRICT, VpnSafeSearchPolicyStore(disk.afterProcessDeath()).currentMode())
    }

    @Test
    fun `unconfirmed rollback poisons this store until process restart`() {
        val disk = DurableStore()
        val first = VpnSafeSearchPolicyStore(disk)
        first.setMode(SafeSearchMode.STRICT)
        disk.resetFaults()
        disk.failFlushAt = setOf(1, 2)

        assertFailure { first.setMode(SafeSearchMode.OFF) }
        assertFailure { first.currentMode() }
        assertFailure { first.setMode(SafeSearchMode.MODERATE) }
        assertEquals(SafeSearchMode.STRICT, VpnSafeSearchPolicyStore(disk.afterProcessDeath()).currentMode())
    }

    @Test
    fun `malformed state is reported and never overwritten as off`() {
        val disk = DurableStore(mapOf(KEY to "unknown-mode"))
        val store = VpnSafeSearchPolicyStore(disk)

        assertFailure { store.currentMode() }
        assertFailure { store.setMode(SafeSearchMode.STRICT) }

        assertEquals("unknown-mode", disk.disk[KEY])
        assertEquals(0, disk.flushCount)
    }

    @Test
    fun `present but unreadable mode is not treated as off or overwritten`() {
        val disk = DurableStore().apply { unreadableKeys += KEY }
        val store = VpnSafeSearchPolicyStore(disk)

        assertFailure { store.currentMode() }
        assertFailure { store.setMode(SafeSearchMode.STRICT) }

        assertTrue(disk.contains(KEY))
        assertTrue(KEY in disk.unreadableKeys)
        assertEquals(0, disk.flushCount)
    }

    @Test
    fun `failed presence check is treated as unreadable instead of off`() {
        val disk = DurableStore().apply { failContains = true }
        val store = VpnSafeSearchPolicyStore(disk)

        assertFailure { store.currentMode() }
        assertFailure { store.setMode(SafeSearchMode.STRICT) }

        assertTrue(disk.disk.isEmpty())
        assertEquals(0, disk.flushCount)
    }

    private fun assertFailure(block: () -> Unit) {
        try {
            block()
            fail("expected persistence failure")
        } catch (_: IllegalStateException) { }
    }

    private class DurableStore(initial: Map<String, String> = emptyMap()) : PersistentStateStore {
        private val memory = initial.toMutableMap()
        val unreadableKeys = mutableSetOf<String>()
        var disk = initial.toMap()
        var flushCount = 0
        var failFlushAt = emptySet<Int>()
        var failContains = false
        override val coordinationLock: Any = Any()

        override fun getString(key: String): String? = if (key in unreadableKeys) null else memory[key]
        override fun putString(key: String, value: String) { memory[key] = value }
        override fun remove(key: String) { memory.remove(key) }
        override fun contains(key: String): Boolean {
            if (failContains) error("contains failed")
            return memory.containsKey(key) || key in unreadableKeys
        }
        override fun clear() { memory.clear() }
        override fun flush() {
            flushCount++
            if (flushCount in failFlushAt) error("flush failed")
            disk = memory.toMap()
        }

        fun resetFaults() {
            flushCount = 0
            failFlushAt = emptySet()
        }

        fun afterProcessDeath(): DurableStore = DurableStore(disk)
    }

    private companion object {
        const val KEY = "webprotection_vpn_safesearch_mode_v1"
    }
}
