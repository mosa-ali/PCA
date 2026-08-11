package org.pca.app.foundation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InMemoryPersistentStateStoreTest {
    @Test
    fun `getString returns null before anything is stored`() {
        val store = InMemoryPersistentStateStore()
        assertNull(store.getString("k"))
    }

    @Test
    fun `putString then getString round-trips`() {
        val store = InMemoryPersistentStateStore()
        store.putString("k", "v")
        assertEquals("v", store.getString("k"))
    }

    @Test
    fun `contains reflects presence accurately`() {
        val store = InMemoryPersistentStateStore()
        assertFalse(store.contains("k"))
        store.putString("k", "v")
        assertTrue(store.contains("k"))
    }

    @Test
    fun `remove deletes only the targeted key`() {
        val store = InMemoryPersistentStateStore()
        store.putString("a", "1")
        store.putString("b", "2")
        store.remove("a")
        assertNull(store.getString("a"))
        assertEquals("2", store.getString("b"))
    }

    @Test
    fun `clear removes every key`() {
        val store = InMemoryPersistentStateStore()
        store.putString("a", "1")
        store.putString("b", "2")
        store.clear()
        assertFalse(store.contains("a"))
        assertFalse(store.contains("b"))
    }

    @Test
    fun `putString overwrites an existing value for the same key`() {
        val store = InMemoryPersistentStateStore()
        store.putString("k", "first")
        store.putString("k", "second")
        assertEquals("second", store.getString("k"))
    }
}
