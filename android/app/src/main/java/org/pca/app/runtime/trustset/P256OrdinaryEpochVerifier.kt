package org.pca.app.runtime.trustset

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/** Existing DSK suite only: canonical SEC1 P-256 key and low-S fixed-width P1363 signature. */
class P256OrdinaryEpochVerifier : OrdinaryEpochSignatureVerifier {
    override fun verify(publicKey: String, canonicalBytes: ByteArray, signature: String): Boolean = try {
        require(publicKey.length == 87 && signature.length == 88)
        val keyBytes = Base64.getUrlDecoder().decode(publicKey)
        val sigBytes = Base64.getDecoder().decode(signature)
        require(Base64.getUrlEncoder().withoutPadding().encodeToString(keyBytes) == publicKey)
        require(Base64.getEncoder().encodeToString(sigBytes) == signature)
        require(keyBytes.size == 65 && keyBytes[0].toInt() == 4 && sigBytes.size == 64)
        val parameters = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
        val r = BigInteger(1, sigBytes.copyOfRange(0, 32))
        val s = BigInteger(1, sigBytes.copyOfRange(32, 64))
        require(r.signum() > 0 && r < parameters.order && s.signum() > 0 && s <= parameters.order.shiftRight(1))
        val point = ECPoint(BigInteger(1, keyBytes.copyOfRange(1, 33)), BigInteger(1, keyBytes.copyOfRange(33, 65)))
        val key = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, parameters))
        fun integer(value: BigInteger): ByteArray = value.toByteArray().let { byteArrayOf(2, it.size.toByte()) + it }
        val body = integer(r) + integer(s)
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(key); update(canonicalBytes); verify(byteArrayOf(0x30, body.size.toByte()) + body)
        }
    } catch (_: Exception) { false }
}
