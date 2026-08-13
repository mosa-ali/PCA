package org.pca.app.feature.webprotection.securityfeed

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.foundation.InMemoryPersistentStateStore

private class AlwaysApproveVerifier : SignedRulePackageVerifier {
    override fun verify(pkg: SignedRulePackage): Boolean = true
}

class SignedRulePackageConsumerTest {

    private fun repo() = PersistentWebRuleRepository(InMemoryPersistentStateStore())

    private fun pkg(version: String, expiresAtEpochMillis: Long = Long.MAX_VALUE, domain: String = "malware.example") =
        SignedRulePackage(
            packageVersion = version,
            signature = "sig",
            expiresAtEpochMillis = expiresAtEpochMillis,
            rules = listOf(WebRulePackageEntry(domain, WebRuleListType.DENY)),
        )

    @Test
    fun `the production fail-closed verifier never approves a package -- doc 28's crypto gate`() {
        val repository = repo()
        val consumer = SignedRulePackageConsumer(repository, NotApprovedSignedRulePackageVerifier())

        val outcome = consumer.apply(pkg("1.0.0"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedSignatureInvalid)
        assertTrue(repository.findMatching("any-family", "malware.example").isEmpty())
    }

    @Test
    fun `an approved, unexpired, newer package is applied to the security feed`() {
        val repository = repo()
        val consumer = SignedRulePackageConsumer(repository, AlwaysApproveVerifier())

        val outcome = consumer.apply(pkg("1.0.0"))

        assertTrue(outcome is ApplyRulePackageOutcome.Applied)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertEquals("1.0.0", repository.securityFeedVersion)
    }

    @Test
    fun `an expired package is rejected without mutating the LKG feed`() {
        val repository = repo()
        val consumer = SignedRulePackageConsumer(repository, AlwaysApproveVerifier(), now = { 1_000_000L })

        val outcome = consumer.apply(pkg("1.0.0", expiresAtEpochMillis = 500_000L))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedExpired)
        assertTrue(repository.findMatching("any-family", "malware.example").isEmpty())
    }

    @Test
    fun `a stale-or-equal package version is rejected and the active LKG package remains enforced`() {
        val repository = repo()
        val consumer = SignedRulePackageConsumer(repository, AlwaysApproveVerifier())
        consumer.apply(pkg("2.0.0"))

        val outcome = consumer.apply(pkg("1.5.0", domain = "other-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedStale)
        assertEquals("2.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertTrue(repository.findMatching("any-family", "other-malware.example").isEmpty())
    }

    @Test
    fun `a malformed package (empty version) is rejected without mutating anything`() {
        val repository = repo()
        val consumer = SignedRulePackageConsumer(repository, AlwaysApproveVerifier())

        val outcome = consumer.apply(pkg(""))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedMalformed)
        assertEquals(null, repository.securityFeedVersion)
    }

    @Test
    fun `a signature-rejected package leaves a previously-applied LKG feed active`() {
        val repository = repo()
        val approving = SignedRulePackageConsumer(repository, AlwaysApproveVerifier())
        approving.apply(pkg("1.0.0"))

        val rejecting = SignedRulePackageConsumer(repository, NotApprovedSignedRulePackageVerifier())
        val outcome = rejecting.apply(pkg("2.0.0", domain = "new-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedSignatureInvalid)
        assertEquals("1.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
    }
}
