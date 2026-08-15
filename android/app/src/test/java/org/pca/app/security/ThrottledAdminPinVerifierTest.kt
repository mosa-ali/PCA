package org.pca.app.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.MonotonicTimeSource

private class FakeThrottleMonotonicTimeSource : MonotonicTimeSource {
    var nowMillis: Long = 0L
    override fun elapsedRealtimeMillis(): Long = nowMillis
    override fun elapsedRealtimeNanos(): Long = nowMillis * 1_000_000
}

class ThrottledAdminPinVerifierTest {
    private val samplePin = "6813".toCharArray()
    private val wrongPin = "2290".toCharArray()

    private fun newVerifier(time: FakeThrottleMonotonicTimeSource): ThrottledAdminPinVerifier {
        val store = InMemoryPersistentStateStore()
        val delegate = Pbkdf2AdminPinVerifier(store)
        val throttle = PinAttemptThrottle(time, InMemoryPinThrottleStateStore())
        return ThrottledAdminPinVerifier(delegate, throttle)
    }

    @Test
    fun `correct PIN verifies while not locked out`() {
        val verifier = newVerifier(FakeThrottleMonotonicTimeSource())
        verifier.setPin(samplePin.copyOf())
        assertTrue(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `repeated wrong PINs eventually lock out verification entirely`() {
        val time = FakeThrottleMonotonicTimeSource()
        val verifier = newVerifier(time)
        verifier.setPin(samplePin.copyOf())
        repeat(3) { verifier.verify(wrongPin.copyOf()) }
        assertTrue(verifier.isLockedOut())
        // Even the CORRECT pin must be refused while locked out -- the lockout is a hard gate,
        // not merely a UI suggestion the underlying verifier can be bypassed around.
        assertFalse(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `lockout does not consume an extra failure and does not invoke the inner KDF verify`() {
        val time = FakeThrottleMonotonicTimeSource()
        val verifier = newVerifier(time)
        verifier.setPin(samplePin.copyOf())
        repeat(3) { verifier.verify(wrongPin.copyOf()) }
        val remainingBefore = verifier.remainingLockoutMillis()
        verifier.verify(samplePin.copyOf()) // attempted while locked out
        val remainingAfter = verifier.remainingLockoutMillis()
        assertEquals(remainingBefore, remainingAfter)
    }

    @Test
    fun `after the lockout window elapses the correct PIN verifies again`() {
        val time = FakeThrottleMonotonicTimeSource()
        val verifier = newVerifier(time)
        verifier.setPin(samplePin.copyOf())
        repeat(3) { verifier.verify(wrongPin.copyOf()) }
        time.nowMillis += verifier.remainingLockoutMillis()
        assertTrue(verifier.verify(samplePin.copyOf()))
    }

    @Test
    fun `a successful verify resets the failure streak`() {
        val time = FakeThrottleMonotonicTimeSource()
        val verifier = newVerifier(time)
        verifier.setPin(samplePin.copyOf())
        verifier.verify(wrongPin.copyOf())
        verifier.verify(wrongPin.copyOf())
        assertTrue(verifier.verify(samplePin.copyOf()))
        assertFalse(verifier.isLockedOut())
        // Confirms the streak actually reset: two more wrong attempts after a success should
        // again be "free" (no lockout yet), not pick up where the pre-success streak left off.
        verifier.verify(wrongPin.copyOf())
        verifier.verify(wrongPin.copyOf())
        assertFalse(verifier.isLockedOut())
    }

    @Test
    fun `setPin clears any pre-existing lockout`() {
        val time = FakeThrottleMonotonicTimeSource()
        val verifier = newVerifier(time)
        verifier.setPin(samplePin.copyOf())
        repeat(5) { verifier.verify(wrongPin.copyOf()) }
        assertTrue(verifier.isLockedOut())
        verifier.setPin("4477".toCharArray())
        assertFalse(verifier.isLockedOut())
    }
}
