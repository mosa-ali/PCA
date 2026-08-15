package org.pca.app.enrollment

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Cross-checks [computeKeyFingerprint] against fixed outputs independently computed from the
 * REAL backend algorithm (backend/src/pairing/fingerprint.ts's `computeKeyFingerprint`), not
 * merely re-asserting this file's own logic against itself. If either implementation ever drifts
 * (a different hash, a different grouping, a different encoding), this test catches it -- a
 * mismatch here means the parent-visible fingerprint and the device-visible fingerprint would
 * silently disagree even for byte-identical public key material, defeating PCA-FR-141's
 * visual-confirmation purpose.
 */
class KeyFingerprintTest {

    @Test
    fun `matches the backend's SHA-256 hex fingerprint for a representative public key string`() {
        assertEquals(
            "64dd-b7a2-5cad-b996-8815-2eee-9b81-e329-bc7b-741d-ead8-aad7-d9c6-de2d-198d-9da2",
            computeKeyFingerprint("test-public-key-base64-sample"),
        )
    }

    @Test
    fun `matches the backend's fingerprint of an empty string`() {
        assertEquals(
            "e3b0-c442-98fc-1c14-9afb-f4c8-996f-b924-27ae-41e4-649b-934c-a495-991b-7852-b855",
            computeKeyFingerprint(""),
        )
    }

    @Test
    fun `matches the backend's fingerprint for a short base64-alphabet input`() {
        assertEquals(
            "63c1-dd95-1ffe-df6f-7fd9-68ad-4efa-39b8-ed58-4f16-2f46-e715-114e-e184-f8de-9201",
            computeKeyFingerprint("AAAA"),
        )
    }

    @Test
    fun `deterministic -- the same input always yields the same fingerprint`() {
        val key = "some-public-key-material"
        assertEquals(computeKeyFingerprint(key), computeKeyFingerprint(key))
    }

    @Test
    fun `different inputs yield different fingerprints (no trivial collision)`() {
        assertEquals(false, computeKeyFingerprint("key-a") == computeKeyFingerprint("key-b"))
    }

    @Test
    fun `signing and encryption key fingerprints for the same device are independent of each other`() {
        val dsk = computeKeyFingerprint("dsk-public-key")
        val dek = computeKeyFingerprint("dek-public-key")
        assertEquals(false, dsk == dek)
    }
}
