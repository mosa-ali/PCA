package org.pca.app.runtime.trustset

import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.firstdevice.P256DerSignature
import org.pca.app.firstdevice.FirstDeviceCanonical

class P256OrdinaryEpochVerifierTest {
    @Test fun existingDskSuiteVerifiesExactBytesAndRejectsTamperingAndNonCanonicalWire() {
        val keys = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val message = "canonical epoch bytes".toByteArray()
        val der = Signature.getInstance("SHA256withECDSA").run { initSign(keys.private); update(message); sign() }
        val signature = Base64.getEncoder().encodeToString(P256DerSignature.toLowSIeeeP1363(der))
        val public = FirstDeviceCanonical.canonicalPublicKeyBase64(keys.public as ECPublicKey)
        val verifier = P256OrdinaryEpochVerifier()
        assertTrue(verifier.verify(public, message, signature))
        assertFalse(verifier.verify(public, "other".toByteArray(), signature))
        assertFalse(verifier.verify(public, message, signature.trimEnd('=')))
        assertFalse(verifier.verify(public, message, Base64.getEncoder().encodeToString(ByteArray(64))))
    }
}
