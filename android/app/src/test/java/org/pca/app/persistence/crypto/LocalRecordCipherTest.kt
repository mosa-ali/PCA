package org.pca.app.persistence.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import javax.crypto.AEADBadTagException

class LocalRecordCipherTest {

    @Test
    fun `round trip returns original plaintext`() {
        val cipher: LocalRecordCipher = InMemoryLocalRecordCipher()
        val plaintext = "child-42.example.com/some/path?q=sensitive"

        val field = cipher.encrypt(plaintext)

        assertEquals(plaintext, cipher.decrypt(field))
    }

    @Test
    fun `same plaintext encrypts to different ciphertext each call`() {
        val cipher: LocalRecordCipher = InMemoryLocalRecordCipher()
        val plaintext = "repeat-me"

        val first = cipher.encrypt(plaintext)
        val second = cipher.encrypt(plaintext)

        assertNotEquals(first, second)
        assertEquals(plaintext, cipher.decrypt(first))
        assertEquals(plaintext, cipher.decrypt(second))
    }

    @Test
    fun `tampered ciphertext fails to decrypt instead of returning garbage`() {
        val cipher: LocalRecordCipher = InMemoryLocalRecordCipher()
        val field = cipher.encrypt("do-not-tamper")
        val tampered = field.copy(ciphertext = field.ciphertext.also { it[0] = it[0].inc() })

        assertThrows(AEADBadTagException::class.java) { cipher.decrypt(tampered) }
    }

    @Test
    fun `null-safe wrappers round trip optional fields`() {
        val cipher: LocalRecordCipher = InMemoryLocalRecordCipher()

        assertEquals(null, cipher.encryptOrNull(null))
        assertEquals(null, cipher.decryptOrNull(null))
        assertEquals("present", cipher.decryptOrNull(cipher.encryptOrNull("present")))
    }
}
