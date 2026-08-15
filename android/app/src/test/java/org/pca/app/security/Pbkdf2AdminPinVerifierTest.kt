package org.pca.app.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class Pbkdf2AdminPinVerifierTest {
    // NOTE: never a real/plausible PIN pattern (e.g. never "1234"/"0000") in a fixture -- an
    // arbitrary-looking digit string, per this mission's "never leak the pattern into logs" rule.
    private val samplePin = "7042".toCharArray()
    private val otherPin = "9158".toCharArray()

    private fun newVerifier(): Pbkdf2AdminPinVerifier = Pbkdf2AdminPinVerifier(InMemoryPersistentStateStore())

    @Test
    fun `isPinSet is false before any PIN is set`() {
        assertFalse(newVerifier().isPinSet())
    }

    @Test
    fun `verify fails when no PIN has ever been set`() {
        val verifier = newVerifier()
        assertFalse(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `setPin then verify with the same PIN succeeds`() {
        val verifier = newVerifier()
        verifier.setPin(samplePin.copyOf())
        assertTrue(verifier.isPinSet())
        assertTrue(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `verify with a wrong PIN fails`() {
        val verifier = newVerifier()
        verifier.setPin(samplePin.copyOf())
        assertFalse(verifier.verify(otherPin.copyOf()))
    }

    @Test
    fun `clearPin removes the stored PIN entirely`() {
        val verifier = newVerifier()
        verifier.setPin(samplePin.copyOf())
        verifier.clearPin()
        assertFalse(verifier.isPinSet())
        assertFalse(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `setPin rejects a too-short PIN`() {
        val verifier = newVerifier()
        assertThrows(IllegalArgumentException::class.java) {
            verifier.setPin("12".toCharArray())
        }
    }

    @Test
    fun `setPin rejects a too-long PIN`() {
        val verifier = newVerifier()
        assertThrows(IllegalArgumentException::class.java) {
            verifier.setPin("1234567890123".toCharArray())
        }
    }

    @Test
    fun `the raw PIN is never present in the persisted store value`() {
        val store = InMemoryPersistentStateStore()
        val verifier = Pbkdf2AdminPinVerifier(store)
        verifier.setPin(samplePin.copyOf())
        val raw = store.getString("admin_pin_verifier_v1")
        requireNotNull(raw)
        assertFalse("stored verifier must never contain the raw PIN digits", raw.contains(String(samplePin)))
    }

    @Test
    fun `setPin fills the caller-supplied CharArray so the raw PIN is not left in memory`() {
        val verifier = newVerifier()
        val pin = samplePin.copyOf()
        verifier.setPin(pin)
        assertFalse(pin.concatToString() == String(samplePin))
    }

    @Test
    fun `verify fills the caller-supplied CharArray after use`() {
        val verifier = newVerifier()
        verifier.setPin(samplePin.copyOf())
        val candidate = samplePin.copyOf()
        verifier.verify(candidate)
        assertFalse(candidate.concatToString() == String(samplePin))
    }

    @Test
    fun `two different devices setting the same PIN get different stored salts`() {
        val storeA = InMemoryPersistentStateStore()
        val storeB = InMemoryPersistentStateStore()
        Pbkdf2AdminPinVerifier(storeA).setPin(samplePin.copyOf())
        Pbkdf2AdminPinVerifier(storeB).setPin(samplePin.copyOf())
        assertNotEquals(storeA.getString("admin_pin_verifier_v1"), storeB.getString("admin_pin_verifier_v1"))
    }
}
