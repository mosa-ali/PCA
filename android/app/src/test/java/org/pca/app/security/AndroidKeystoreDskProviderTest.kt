package org.pca.app.security

import android.security.keystore.KeyGenParameterSpec
import java.io.InputStream
import java.io.OutputStream
import java.security.Key
import java.security.KeyPair
import java.security.KeyPairGeneratorSpi
import java.security.KeyStoreSpi
import java.security.Provider
import java.security.ProviderException
import java.security.SecureRandom
import java.security.Security
import java.security.cert.Certificate
import java.security.spec.AlgorithmParameterSpec
import java.util.Collections
import java.util.Date
import java.util.Enumeration
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Failure-only JCA provider: creates alias bookkeeping, never key material. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AndroidKeystoreDskProviderTest {
    @Test
    fun signingGenerationFailureDeletesOnlyThePartialAliasWithoutFallback() {
        assertPartialGenerationCleanup(signing = true)
    }

    @Test
    fun encryptionGenerationFailureDeletesOnlyThePartialAliasWithoutFallback() {
        assertPartialGenerationCleanup(signing = false)
    }

    private fun assertPartialGenerationCleanup(signing: Boolean) {
        val state = FailureState()
        val rootAlias = "pca.dsk.committed-root-attempt"
        val unrelatedAlias = "unrelated-key"
        state.aliases.addAll(listOf(rootAlias, unrelatedAlias))
        val provider = FailureProvider(state)
        Security.addProvider(provider)
        try {
            val custody = AndroidKeystoreDskProvider(provider.name)
            val attempt = "new-enrollment-attempt"
            val attemptedAlias = if (signing) custody.signingKeyAlias(attempt) else custody.encryptionKeyAlias(attempt)
            try {
                if (signing) custody.generateSigningKeyPair(attempt) else custody.generateEncryptionKeyPair(attempt)
                fail("Partial provider failure must propagate")
            } catch (failure: ProviderException) {
                assertSame(state.failure, failure)
            }
            assertEquals(listOf(attemptedAlias), state.generationAttempts)
            assertEquals(listOf(attemptedAlias), state.deletedAliases)
            assertFalse(state.aliases.contains(attemptedAlias))
            assertTrue(state.aliases.contains(rootAlias))
            assertTrue(state.aliases.contains(unrelatedAlias))
        } finally {
            Security.removeProvider(provider.name)
        }
    }

    private class FailureState {
        val aliases = linkedSetOf<String>()
        val generationAttempts = mutableListOf<String>()
        val deletedAliases = mutableListOf<String>()
        val failure = ProviderException("Injected generation failure after partial entry creation")
    }

    private class FailureProvider(state: FailureState) :
        Provider("PcaFailureTest-${UUID.randomUUID()}", 1.0, "Failure-only key generation test") {
        init {
            putService(object : Service(this, "KeyStore", name, FailureKeyStore::class.java.name, null, null) {
                override fun newInstance(constructorParameter: Any?): Any = FailureKeyStore(state)
            })
            putService(object : Service(this, "KeyPairGenerator", "EC", FailureGenerator::class.java.name, null, null) {
                override fun newInstance(constructorParameter: Any?): Any = FailureGenerator(state)
            })
        }
    }

    private class FailureGenerator(private val state: FailureState) : KeyPairGeneratorSpi() {
        private lateinit var alias: String
        override fun initialize(keysize: Int, random: SecureRandom?) = error("Expected key parameters")
        override fun initialize(params: AlgorithmParameterSpec?, random: SecureRandom?) {
            alias = (params as KeyGenParameterSpec).keystoreAlias
        }
        override fun generateKeyPair(): KeyPair {
            state.generationAttempts.add(alias)
            state.aliases.add(alias)
            throw state.failure
        }
    }

    private class FailureKeyStore(private val state: FailureState) : KeyStoreSpi() {
        override fun engineLoad(stream: InputStream?, password: CharArray?) = Unit
        override fun engineStore(stream: OutputStream?, password: CharArray?) = error("Not used")
        override fun engineContainsAlias(alias: String): Boolean = alias in state.aliases
        override fun engineAliases(): Enumeration<String> = Collections.enumeration(state.aliases)
        override fun engineSize(): Int = state.aliases.size
        override fun engineDeleteEntry(alias: String) {
            state.deletedAliases.add(alias)
            state.aliases.remove(alias)
        }
        override fun engineIsKeyEntry(alias: String): Boolean = alias in state.aliases
        override fun engineIsCertificateEntry(alias: String): Boolean = false
        override fun engineGetKey(alias: String?, password: CharArray?): Key? = null
        override fun engineGetCertificateChain(alias: String?): Array<Certificate>? = null
        override fun engineGetCertificate(alias: String?): Certificate? = null
        override fun engineGetCreationDate(alias: String?): Date? = null
        override fun engineGetCertificateAlias(cert: Certificate?): String? = null
        override fun engineSetKeyEntry(alias: String?, key: Key?, password: CharArray?, chain: Array<Certificate>?) = error("Not used")
        override fun engineSetKeyEntry(alias: String?, key: ByteArray?, chain: Array<Certificate>?) = error("Not used")
        override fun engineSetCertificateEntry(alias: String?, cert: Certificate?) = error("Not used")
    }
}
