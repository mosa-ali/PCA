package org.pca.app.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnavailableBiometricAuthGateTest {
    @Test
    fun `isAvailable is always false`() {
        assertFalse(UnavailableBiometricAuthGate().isAvailable())
    }

    @Test
    fun `authenticate always reports Failed, never a fake Success`() {
        var result: BiometricAuthResult? = null
        UnavailableBiometricAuthGate().authenticate(BiometricAuthReason.DISABLE_PROTECTION) { result = it }
        assertTrue(result is BiometricAuthResult.Failed)
    }
}
