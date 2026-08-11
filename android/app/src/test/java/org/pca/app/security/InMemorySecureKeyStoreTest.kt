package org.pca.app.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InMemorySecureKeyStoreTest {
    @Test
    fun `hasBlob is false before anything is stored`() {
        val store = InMemorySecureKeyStore()
        assertFalse(store.hasBlob("alias-1"))
    }

    @Test
    fun `storeBlob then loadBlob round-trips`() {
        val store = InMemorySecureKeyStore()
        store.storeBlob("alias-1", "base64-blob")
        assertEquals("base64-blob", store.loadBlob("alias-1"))
        assertTrue(store.hasBlob("alias-1"))
    }

    @Test
    fun `deleteBlob removes only the targeted alias`() {
        val store = InMemorySecureKeyStore()
        store.storeBlob("a", "1")
        store.storeBlob("b", "2")
        store.deleteBlob("a")
        assertNull(store.loadBlob("a"))
        assertEquals("2", store.loadBlob("b"))
    }

    @Test
    fun `aliases reflects every stored alias`() {
        val store = InMemorySecureKeyStore()
        store.storeBlob("a", "1")
        store.storeBlob("b", "2")
        assertEquals(setOf("a", "b"), store.aliases())
    }
}
