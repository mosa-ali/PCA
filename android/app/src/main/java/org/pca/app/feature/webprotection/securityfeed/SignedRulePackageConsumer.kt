package org.pca.app.feature.webprotection.securityfeed

import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebRuleReplaceResult
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.feature.webprotection.policy.canonicalizeDomain

private const val MAX_PACKAGE_VERSION_LENGTH = 32
private const val MAX_SIGNATURE_LENGTH = 512
private const val MAX_RULES_PER_PACKAGE = 100_000

private fun isPlausiblePackageVersion(candidate: String): Boolean =
    candidate.isNotEmpty() && candidate.length <= MAX_PACKAGE_VERSION_LENGTH

private fun isPlausibleSignature(candidate: String): Boolean =
    candidate.isNotEmpty() && candidate.length <= MAX_SIGNATURE_LENGTH

data class WebRulePackageEntry(val domain: String, val listType: WebRuleListType)

/** Mirrors backend `SignedRulePackage` -- the security-feed (malware/phishing/scam) delivery shape only; parent allow/deny entries are never part of a signed package. */
data class SignedRulePackage(
    val packageVersion: String,
    val signature: String,
    val expiresAtEpochMillis: Long,
    val rules: List<WebRulePackageEntry>,
)

/**
 * doc 28's injected verifier boundary for the security-feed package's
 * detached signature -- mirrors `SignedRulePackageVerifier` in
 * `backend/src/web/SignedRulePackageConsumer.ts`. This module performs no
 * signature MATH itself, only the accept/reject/rollback decision around
 * whatever a caller-supplied verifier reports.
 */
interface SignedRulePackageVerifier {
    fun verify(pkg: SignedRulePackage): Boolean
}

/**
 * doc 28: production signature crypto is still gated behind
 * `PRODUCTION_CRYPTO_SUITE` human security review -- this fail-closed
 * default NEVER approves a package, so [SignedRulePackageConsumer] always
 * rejects until a reviewed verifier implementation replaces this one.
 * Mirrors [org.pca.app.security.NotApprovedDeviceKeyPairGenerator]'s
 * fail-closed convention exactly.
 */
class NotApprovedSignedRulePackageVerifier : SignedRulePackageVerifier {
    override fun verify(pkg: SignedRulePackage): Boolean = false
}

sealed class ApplyRulePackageOutcome {
    data class Applied(val ruleCount: Int) : ApplyRulePackageOutcome()
    object RejectedSignatureInvalid : ApplyRulePackageOutcome()
    object RejectedExpired : ApplyRulePackageOutcome()
    data class RejectedStale(val activeVersion: String) : ApplyRulePackageOutcome()
    object RejectedMalformed : ApplyRulePackageOutcome()
}

/**
 * doc 14: "Failed signature verification leaves the last known valid
 * package active, raises a local integrity alert, and never replaces rules
 * with an unverified package." Mirrors `SignedRulePackageConsumer.ts`
 * exactly -- rejection at any stage never mutates
 * [PersistentWebRuleRepository]; the previously-applied SECURITY_DENYLIST
 * rules remain the active LKG on any rejection path.
 */
class SignedRulePackageConsumer(
    private val repository: PersistentWebRuleRepository,
    private val verifier: SignedRulePackageVerifier,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    fun apply(pkg: SignedRulePackage): ApplyRulePackageOutcome {
        if (!isPlausiblePackageVersion(pkg.packageVersion) ||
            !isPlausibleSignature(pkg.signature) ||
            pkg.rules.size > MAX_RULES_PER_PACKAGE
        ) {
            return ApplyRulePackageOutcome.RejectedMalformed
        }

        val canonicalRules = mutableListOf<Pair<CanonicalDomain, WebRuleListType>>()
        for (rule in pkg.rules) {
            val domain = canonicalizeDomain(rule.domain) ?: return ApplyRulePackageOutcome.RejectedMalformed
            canonicalRules.add(domain to rule.listType)
        }

        if (pkg.expiresAtEpochMillis <= now()) return ApplyRulePackageOutcome.RejectedExpired

        if (!verifier.verify(pkg)) return ApplyRulePackageOutcome.RejectedSignatureInvalid

        val webRules = canonicalRules.map { (domain, listType) ->
            WebRule(
                domain = domain,
                listType = listType,
                source = WebRuleSource.SECURITY_DENYLIST,
                familyId = null,
                createdAtEpochMillis = now(),
            )
        }

        return when (val result = repository.replaceSecurityFeedRules(webRules, pkg.packageVersion)) {
            is WebRuleReplaceResult.Applied -> ApplyRulePackageOutcome.Applied(result.ruleCount)
            is WebRuleReplaceResult.RejectedStaleRevision -> ApplyRulePackageOutcome.RejectedStale(result.activeRevisionOrVersion)
            WebRuleReplaceResult.RejectedInvalidDomain, WebRuleReplaceResult.RejectedSourceMismatch -> ApplyRulePackageOutcome.RejectedMalformed
        }
    }
}
