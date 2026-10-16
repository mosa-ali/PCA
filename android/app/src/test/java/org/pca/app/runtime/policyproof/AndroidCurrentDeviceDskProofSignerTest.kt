package org.pca.app.runtime.policyproof

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.InMemoryFirstDeviceRootStore

class AndroidCurrentDeviceDskProofSignerTest {
    private val familyId = "22222222-2222-4222-8222-222222222222"
    private val deviceId = "44444444-4444-4444-8444-444444444444"
    private val keyAlias = "pca.dsk.attempt-1"
    private val signature = ByteArray(64).also { it[31] = 1; it[63] = 1 }

    private fun root(state: FirstDeviceRootState = FirstDeviceRootState.ROOT_COMMITTED): InMemoryFirstDeviceRootStore =
        InMemoryFirstDeviceRootStore().also { store ->
            store.save(FirstDeviceRootRecord(
                seed = FirstDeviceCeremonySeed(
                    attemptId = "attempt-1", attemptRecoveryToken = "recovery", serverBaseUrl = "https://api.example.test",
                    deviceId = deviceId, signingKeyId = "55555555-5555-4555-8555-555555555555",
                    encryptionKeyId = "66666666-6666-4666-8666-666666666666",
                    dskPublicKeyBase64 = "public-key", dekPublicKeyBase64 = "dek-key",
                    dskAlias = keyAlias, dekAlias = "pca.dek.attempt-1",
                ), state = state, familyId = familyId,
            ))
        }

    private fun access() = object : CurrentDeviceDskKeyAccess {
        var checked: Pair<String, String>? = null
        var signed: Pair<String, ByteArray>? = null
        override fun assertCustody(alias: String, expectedPublicKeyBase64: String) { checked = alias to expectedPublicKeyBase64 }
        override fun sign(alias: String, message: ByteArray): ByteArray {
            signed = alias to message.copyOf()
            return signature.copyOf()
        }
    }

    private fun fields() = DevicePolicyApplicationProofV1.ProofFields(
        familyId = familyId,
        deviceId = deviceId,
        policyEnvelopeMessageId = "11111111-1111-4111-8111-111111111111",
        policyEnvelopeSha256Base64Url = "Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc",
        trustSetEpoch = 7,
        keyEpoch = 9,
        applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.DEGRADED,
        challenge = DevicePolicyApplicationProofV1.Challenge(
            challengeId = "66666666-6666-4666-8666-666666666666",
            nonceBase64Url = "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8",
            expiresAt = "2026-10-15T00:56:00.000Z",
        ),
    )

    @Test
    fun signsExactTranscriptAndBootstrapNonceWithCommittedCurrentDeviceDsk() {
        val keyAccess = access()
        val signer = AndroidCurrentDeviceDskProofSigner(root(), keyAccess)
        val transcript = DevicePolicyApplicationProofV1.canonicalTranscript(fields())
        assertArrayEquals(signature, signer.signProof(fields(), transcript))
        assertEquals(keyAlias to "public-key", keyAccess.checked)
        assertEquals(keyAlias, keyAccess.signed?.first)
        assertArrayEquals(transcript, keyAccess.signed?.second)

        val nonce = fields().challenge.nonceBase64Url
        assertArrayEquals(signature, signer.signBootstrapNonce(familyId, deviceId, nonce))
        assertEquals(keyAlias, keyAccess.signed?.first)
        assertArrayEquals(nonce.toByteArray(Charsets.UTF_8), keyAccess.signed?.second)
        assertTrue(keyAccess.checked != null)
    }

    @Test
    fun rejectsWrongScopeUncommittedRootChangedTranscriptAndMalformedNonceBeforeSigning() {
        val keyAccess = access()
        val signer = AndroidCurrentDeviceDskProofSigner(root(), keyAccess)
        val fields = fields()
        val wrongFamily = fields.copy(familyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        assertThrows(IllegalStateException::class.java) {
            signer.signProof(wrongFamily, DevicePolicyApplicationProofV1.canonicalTranscript(wrongFamily))
        }
        assertThrows(IllegalStateException::class.java) {
            signer.signBootstrapNonce(familyId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fields.challenge.nonceBase64Url)
        }
        assertThrows(IllegalArgumentException::class.java) {
            signer.signProof(fields, byteArrayOf(1))
        }
        assertThrows(IllegalArgumentException::class.java) {
            signer.signBootstrapNonce(familyId, deviceId, "not-a-canonical-nonce")
        }
        assertEquals(null, keyAccess.signed)

        assertThrows(IllegalStateException::class.java) {
            AndroidCurrentDeviceDskProofSigner(root(FirstDeviceRootState.AWAITING_APPROVAL), keyAccess)
                .signBootstrapNonce(familyId, deviceId, fields.challenge.nonceBase64Url)
        }
        assertEquals(null, keyAccess.signed)
    }
}
