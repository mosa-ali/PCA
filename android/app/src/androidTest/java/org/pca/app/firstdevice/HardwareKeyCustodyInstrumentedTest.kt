package org.pca.app.firstdevice

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.util.UUID
import android.security.keystore.KeyInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.security.AndroidKeystoreDskProvider

/** Requires a real hardware-backed Android keystore; emulator results are not hardware evidence. */
@RunWith(AndroidJUnit4::class)
class HardwareKeyCustodyInstrumentedTest {
    @Test
    fun generatedKeysRemainHardwareBackedAndNonExportableAndDskSigns() {
        val provider = AndroidKeystoreDskProvider()
        val attempt = UUID.randomUUID().toString().replace("-", "")
        val aliases = listOf(provider.signingKeyAlias(attempt), provider.encryptionKeyAlias(attempt))
        try {
            provider.generateSigningKeyPair(attempt)
            provider.generateEncryptionKeyPair(attempt)
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            for (alias in aliases) {
                assertTrue(store.containsAlias(alias))
                val key = store.getKey(alias, null) as PrivateKey
                assertNull(key.encoded)
                val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
                assertTrue(info.isInsideSecureHardware)
            }
            val message = "PCA hardware custody acceptance".toByteArray(Charsets.UTF_8)
            val signature = provider.signCanonicalDer(aliases[0], message)
            assertEquals(64, signature.size)
            fun integer(bytes: ByteArray): ByteArray {
                val value = BigInteger(1, bytes).toByteArray()
                return byteArrayOf(0x02, value.size.toByte()) + value
            }
            val body = integer(signature.copyOfRange(0, 32)) + integer(signature.copyOfRange(32, 64))
            val der = byteArrayOf(0x30, body.size.toByte()) + body
            assertTrue(Signature.getInstance("SHA256withECDSA").run {
                initVerify(store.getCertificate(aliases[0]).publicKey)
                update(message)
                verify(der)
            })
        } finally {
            aliases.forEach(provider::deleteKeyPair)
        }
    }
}
