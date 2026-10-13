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

    private fun testConsumer(
        repository: PersistentWebRuleRepository,
        verifier: SignedRulePackageVerifier,
        now: () -> Long = { System.currentTimeMillis() },
    ) = SignedRulePackageConsumer(repository, verifier, now, monotonicNowNanos = { 0L })

    private fun pkg(
        version: String,
        expiresAtEpochMillis: Long = Long.MAX_VALUE,
        domain: String = "malware.example",
        issuedAtEpochMillis: Long = 0L,
        rules: List<WebRulePackageEntry> = listOf(WebRulePackageEntry(domain, WebRuleListType.DENY)),
    ) =
        SignedRulePackage(
            packageVersion = version,
            issuedAtEpochMillis = issuedAtEpochMillis,
            signature = "sig",
            expiresAtEpochMillis = expiresAtEpochMillis,
            rules = rules,
        )

    @Test
    fun `the production fail-closed verifier never approves a package -- doc 28's crypto gate`() {
        val repository = repo()
        val consumer = testConsumer(repository, NotApprovedSignedRulePackageVerifier())

        val outcome = consumer.apply(pkg("1.0.0"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedSignatureInvalid)
        assertTrue(repository.findMatching("any-family", "malware.example").isEmpty())
    }

    @Test
    fun `an approved, unexpired, newer package is applied to the security feed`() {
        val repository = repo()
        val consumer = testConsumer(repository, AlwaysApproveVerifier())

        val outcome = consumer.apply(pkg("1.0.0"))

        assertTrue(outcome is ApplyRulePackageOutcome.Applied)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertEquals("1.0.0", repository.securityFeedVersion)
    }

    @Test
    fun `an expired package is rejected without mutating the LKG feed`() {
        val repository = repo()
        val consumer = testConsumer(repository, AlwaysApproveVerifier(), now = { 1_000_000L })

        val outcome = consumer.apply(pkg("1.0.0", expiresAtEpochMillis = 500_000L))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedExpired)
        assertTrue(repository.findMatching("any-family", "malware.example").isEmpty())
    }

    @Test
    fun `a stale-or-equal package version is rejected and the active LKG package remains enforced`() {
        val repository = repo()
        val consumer = testConsumer(repository, AlwaysApproveVerifier())
        consumer.apply(pkg("2.0.0"))

        val outcome = consumer.apply(pkg("1.5.0", domain = "other-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedStale)
        assertEquals("2.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertTrue(repository.findMatching("any-family", "other-malware.example").isEmpty())
    }

    @Test
    fun `a malformed package version is rejected without mutating anything`() {
        val repository = repo()
        val consumer = testConsumer(repository, AlwaysApproveVerifier())

        for (version in listOf("", "1.0", "01.0.0", "9007199254740992.0.0", "x".repeat(33))) {
            val outcome = consumer.apply(pkg(version))
            assertTrue("$version must be rejected", outcome is ApplyRulePackageOutcome.RejectedMalformed)
        }
        assertEquals(null, repository.securityFeedVersion)
    }

    @Test
    fun `a signature-rejected package leaves a previously-applied LKG feed active`() {
        val repository = repo()
        val approving = testConsumer(repository, AlwaysApproveVerifier())
        approving.apply(pkg("1.0.0"))

        val rejecting = testConsumer(repository, NotApprovedSignedRulePackageVerifier())
        val outcome = rejecting.apply(pkg("2.0.0", domain = "new-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedSignatureInvalid)
        assertEquals("1.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
    }

    @Test
    fun `signed package domains must already be canonical and are rejected before verification`() {
        val repository = repo()
        var verifierCalled = false
        val guardedConsumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                verifierCalled = true
                return true
            }
        })

        for (domain in listOf("MALWARE.example", "malware.example.", "https://malware.example/path")) {
            val outcome = guardedConsumer.apply(pkg("1.0.0", domain = domain))
            assertTrue("$domain must be rejected", outcome is ApplyRulePackageOutcome.RejectedMalformed)
        }

        assertEquals(false, verifierCalled)
        assertEquals(null, repository.securityFeedVersion)
        assertTrue(repository.snapshot().isEmpty())
    }

    @Test
    fun `only unique deny entries are accepted in a signed security package`() {
        val repository = repo()
        var verifierCalled = false
        val consumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                verifierCalled = true
                return true
            }
        })
        val invalidEntries = listOf(
            listOf(WebRulePackageEntry("malware.example", WebRuleListType.ALLOW)),
            listOf(
                WebRulePackageEntry("malware.example", WebRuleListType.DENY),
                WebRulePackageEntry("malware.example", WebRuleListType.DENY),
            ),
        )

        for (entries in invalidEntries) {
            val outcome = consumer.apply(pkg("1.0.0", rules = entries))
            assertTrue(outcome is ApplyRulePackageOutcome.RejectedMalformed)
        }

        assertEquals(false, verifierCalled)
        assertEquals(null, repository.securityFeedVersion)
        assertTrue(repository.snapshot().isEmpty())
    }

    @Test
    fun `issued-at must be no later than receipt and precede expiry`() {
        val repository = repo()
        var verifierCalled = false
        val consumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                verifierCalled = true
                return true
            }
        }, now = { 1_000L })

        for (candidate in listOf(
            pkg("1.0.0", expiresAtEpochMillis = 2_000L, issuedAtEpochMillis = 1_001L),
            pkg("1.0.0", expiresAtEpochMillis = 1_000L, issuedAtEpochMillis = 1_000L),
        )) {
            assertTrue(consumer.apply(candidate) is ApplyRulePackageOutcome.RejectedMalformed)
        }

        assertEquals(false, verifierCalled)
        assertEquals(null, repository.securityFeedVersion)
    }

    @Test
    fun `issued-at at receipt is accepted and exposed to signature verification`() {
        val repository = repo()
        var verifiedIssuedAt: Long? = null
        val consumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                verifiedIssuedAt = pkg.issuedAtEpochMillis
                return true
            }
        }, now = { 1_000L })

        val outcome = consumer.apply(pkg("1.0.0", expiresAtEpochMillis = 2_000L, issuedAtEpochMillis = 1_000L))

        assertTrue(outcome is ApplyRulePackageOutcome.Applied)
        assertEquals(1_000L, verifiedIssuedAt)
        assertEquals("1.0.0", repository.securityFeedVersion)
    }

    @Test
    fun `package expiring during verification is rejected without replacing the active feed`() {
        val repository = repo()
        val validConsumer = testConsumer(repository, AlwaysApproveVerifier(), now = { 1_000L })
        assertTrue(validConsumer.apply(pkg("1.0.0", expiresAtEpochMillis = 10_000L)) is ApplyRulePackageOutcome.Applied)
        var clock = 2_000L
        val expiringConsumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                clock = pkg.expiresAtEpochMillis
                return true
            }
        }, now = { clock })

        val outcome = expiringConsumer.apply(pkg("2.0.0", expiresAtEpochMillis = 5_000L, domain = "new-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedExpired)
        assertEquals("1.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertTrue(repository.findMatching("any-family", "new-malware.example").isEmpty())
    }

    @Test
    fun `wall clock rollback during verification cannot extend signed package lifetime`() {
        val repository = repo()
        val validConsumer = testConsumer(repository, AlwaysApproveVerifier(), now = { 1_000L })
        assertTrue(validConsumer.apply(pkg("1.0.0", expiresAtEpochMillis = 10_000L)) is ApplyRulePackageOutcome.Applied)

        var wallClock = 2_000L
        var monotonicNanos = 0L
        val consumer = SignedRulePackageConsumer(
            repository = repository,
            verifier = object : SignedRulePackageVerifier {
                override fun verify(pkg: SignedRulePackage): Boolean {
                    // Simulate system time moving backwards while signature
                    // verification consumes the candidate's full remaining lifetime.
                    wallClock = 500L
                    monotonicNanos = 3_000_000_000L
                    return true
                }
            },
            now = { wallClock },
            monotonicNowNanos = { monotonicNanos },
        )

        val outcome = consumer.apply(pkg("2.0.0", expiresAtEpochMillis = 5_000L, domain = "new-malware.example"))

        assertTrue(outcome is ApplyRulePackageOutcome.RejectedExpired)
        assertEquals("1.0.0", repository.securityFeedVersion)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertTrue(repository.findMatching("any-family", "new-malware.example").isEmpty())
    }

    @Test
    fun `mutable caller rules are snapshotted before verification and apply`() {
        val repository = repo()
        val callerRules = mutableListOf(WebRulePackageEntry("malware.example", WebRuleListType.DENY))
        val candidate = pkg("1.0.0", rules = callerRules)
        var verifiedDomain: String? = null
        var verifierMutationRejected = false
        val consumer = testConsumer(repository, object : SignedRulePackageVerifier {
            override fun verify(pkg: SignedRulePackage): Boolean {
                // Deterministically model a concurrent/callback mutation of
                // the original list while verification is in progress, then
                // attempt to mutate the snapshot supplied to this verifier.
                callerRules[0] = WebRulePackageEntry("changed.example", WebRuleListType.DENY)
                try {
                    (pkg.rules as MutableList<WebRulePackageEntry>)[0] =
                        WebRulePackageEntry("verifier-changed.example", WebRuleListType.DENY)
                } catch (_: UnsupportedOperationException) {
                    verifierMutationRejected = true
                }
                verifiedDomain = pkg.rules.single().domain
                return true
            }
        })

        val outcome = consumer.apply(candidate)

        assertTrue(outcome is ApplyRulePackageOutcome.Applied)
        assertTrue(verifierMutationRejected)
        assertEquals("malware.example", verifiedDomain)
        assertEquals(1, repository.findMatching("any-family", "malware.example").size)
        assertTrue(repository.findMatching("any-family", "changed.example").isEmpty())
        assertTrue(repository.findMatching("any-family", "verifier-changed.example").isEmpty())
        assertEquals("1.0.0", repository.securityFeedVersion)
    }
}
