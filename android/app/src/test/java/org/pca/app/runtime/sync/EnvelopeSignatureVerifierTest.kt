package org.pca.app.runtime.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Test
import org.pca.app.runtime.sync.envelope.RejectingEnvelopeSignatureVerifier

class EnvelopeSignatureVerifierTest {
    @Test
    fun `RejectingEnvelopeSignatureVerifier fails closed for every input, never returns true`() = runTest {
        val verifier = RejectingEnvelopeSignatureVerifier()
        assertFalse(verifier.verify("any-public-key", "any-canonical-bytes", "any-signature"))
        assertFalse(verifier.verify("", "", ""))
    }
}
