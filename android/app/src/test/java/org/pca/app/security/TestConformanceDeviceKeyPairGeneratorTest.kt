package org.pca.app.security

import org.junit.Assert.assertNotEquals
import org.junit.Test

class TestConformanceDeviceKeyPairGeneratorTest {
    @Test
    fun `different attempts do not collapse when hash byte and generation ordinal cancel`() {
        val generator = TestConformanceDeviceKeyPairGenerator()

        // Under the previous fake-key formula, String.hashCode() for the final attempt-id
        // characters differs by two, exactly cancelling the two-call ordinal gap between the
        // signing aliases (and likewise the encryption aliases).
        val firstSigning = generator.generateSigningKeyPair("c")
        val firstEncryption = generator.generateEncryptionKeyPair("c")
        val secondSigning = generator.generateSigningKeyPair("a")
        val secondEncryption = generator.generateEncryptionKeyPair("a")

        assertNotEquals(firstSigning.publicKeyBase64, secondSigning.publicKeyBase64)
        assertNotEquals(firstEncryption.publicKeyBase64, secondEncryption.publicKeyBase64)
    }
}
