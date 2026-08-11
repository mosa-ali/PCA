package org.pca.app.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InMemoryEncryptedVaultTest {
    @Test
    fun `getRecord returns null before anything is stored`() {
        val vault = InMemoryEncryptedVault()
        assertNull(vault.getRecord("k"))
    }

    @Test
    fun `putRecord then getRecord round-trips`() {
        val vault = InMemoryEncryptedVault()
        vault.putRecord("k", "v")
        assertEquals("v", vault.getRecord("k"))
    }

    @Test
    fun `deleteRecord removes only the targeted key`() {
        val vault = InMemoryEncryptedVault()
        vault.putRecord("a", "1")
        vault.putRecord("b", "2")
        vault.deleteRecord("a")
        assertNull(vault.getRecord("a"))
        assertEquals("2", vault.getRecord("b"))
    }

    @Test
    fun `wipe irreversibly removes every record`() {
        val vault = InMemoryEncryptedVault()
        vault.putRecord("a", "1")
        vault.putRecord("b", "2")
        vault.wipe()
        assertTrue(vault.allKeys().isEmpty())
        assertNull(vault.getRecord("a"))
        assertNull(vault.getRecord("b"))
    }
}
