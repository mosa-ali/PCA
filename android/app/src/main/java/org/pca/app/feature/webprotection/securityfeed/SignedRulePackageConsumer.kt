package org.pca.app.feature.webprotection.securityfeed

import android.os.SystemClock
import java.util.ArrayList
import java.util.Collections
import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebRuleReplaceResult
import org.pca.app.feature.webprotection.engine.isPlausiblePackageVersion
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.feature.webprotection.policy.canonicalizeDomain

private const val MAX_SIGNATURE_LENGTH = 512
private const val MAX_RULES_PER_PACKAGE = 100_000

private fun isPlausibleSignature(candidate: String): Boolean =
    candidate.isNotEmpty() && candidate.length <= MAX_SIGNATURE_LENGTH

data class WebRulePackageEntry(val domain: String, val listType: WebRuleListType)

/** Mirrors backend `SignedRulePackage` -- the security-feed (malware/phishing/scam) delivery shape only; parent allow/deny entries are never part of a signed package. */
data class SignedRulePackage(
    val packageVersion: String,
    val issuedAtEpochMillis: Long,
    val signature: String,
    val expiresAtEpochMillis: Long,
    val rules: List<WebRulePackageEntry>,
)

/**
 * doc 28's injected verifier boundary for the security-feed package's
 * detached signature -- mirrors `SignedRulePackageVerifier` in
 * `backend/src/web/SignedRulePackageConsumer.ts`. A production verifier must
 * authenticate every package metadata field, including issued/expiry times,
 * plus every canonical DENY rule. This module performs no signature MATH
 * itself, only the accept/reject/rollback decision around whatever a
 * caller-supplied verifier reports.
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
    private val monotonicNowNanos: () -> Long = { SystemClock.elapsedRealtimeNanos() },
) {
    fun apply(pkg: SignedRulePackage): ApplyRulePackageOutcome {
        // Kotlin's `List` is read-only at the type level, but callers can
        // pass a MutableList and change it while a verifier is running. Own
        // one snapshot before validation and use it for verification and
        // application so those three stages cannot see different packages.
        val capturedRules = try {
            Collections.unmodifiableList(ArrayList(pkg.rules))
        } catch (_: Exception) {
            return ApplyRulePackageOutcome.RejectedMalformed
        }
        val captured = pkg.copy(rules = capturedRules)
        if (!isPlausiblePackageVersion(captured.packageVersion) ||
            !isPlausibleSignature(captured.signature) ||
            captured.rules.size > MAX_RULES_PER_PACKAGE
        ) {
            return ApplyRulePackageOutcome.RejectedMalformed
        }

        val canonicalRules = mutableListOf<Pair<CanonicalDomain, WebRuleListType>>()
        val seenDomains = HashSet<CanonicalDomain>()
        for (rule in captured.rules) {
            val domain = canonicalizeDomain(rule.domain) ?: return ApplyRulePackageOutcome.RejectedMalformed
            // The backend verifies and applies exactly the canonical domain
            // supplied by the package. Never normalize signed bytes after
            // verification: doing so could apply a different key than the
            // producer authenticated.
            if (domain != rule.domain || rule.listType != WebRuleListType.DENY || !seenDomains.add(domain)) {
                return ApplyRulePackageOutcome.RejectedMalformed
            }
            canonicalRules.add(domain to rule.listType)
        }

        val receivedAt = now()
        if (captured.issuedAtEpochMillis > receivedAt || captured.issuedAtEpochMillis >= captured.expiresAtEpochMillis) {
            return ApplyRulePackageOutcome.RejectedMalformed
        }
        if (captured.expiresAtEpochMillis <= receivedAt) return ApplyRulePackageOutcome.RejectedExpired
        val remainingLifetimeMillis = try {
            Math.subtractExact(captured.expiresAtEpochMillis, receivedAt)
        } catch (_: ArithmeticException) {
            return ApplyRulePackageOutcome.RejectedMalformed
        }
        val receivedMonotonicNanos = monotonicNowNanos()

        if (!verifier.verify(captured)) return ApplyRulePackageOutcome.RejectedSignatureInvalid

        // Verification may take long enough for a package to expire. Match
        // the signed remaining lifetime against a monotonic clock. Wall time
        // is still checked as a fail-closed guard, but moving it backwards
        // while verification runs cannot extend the package lifetime.
        val commitTime = now()
        if (captured.expiresAtEpochMillis <= commitTime) return ApplyRulePackageOutcome.RejectedExpired
        val elapsedNanos = try {
            Math.subtractExact(monotonicNowNanos(), receivedMonotonicNanos)
        } catch (_: ArithmeticException) {
            return ApplyRulePackageOutcome.RejectedExpired
        }
        if (elapsedNanos < 0L || elapsedNanos / NANOS_PER_MILLI >= remainingLifetimeMillis) {
            return ApplyRulePackageOutcome.RejectedExpired
        }

        val webRules = canonicalRules.map { (domain, listType) ->
            WebRule(
                domain = domain,
                listType = listType,
                source = WebRuleSource.SECURITY_DENYLIST,
                familyId = null,
                createdAtEpochMillis = commitTime,
            )
        }

        return when (val result = repository.replaceSecurityFeedRules(webRules, captured.packageVersion)) {
            is WebRuleReplaceResult.Applied -> ApplyRulePackageOutcome.Applied(result.ruleCount)
            is WebRuleReplaceResult.RejectedStaleRevision -> ApplyRulePackageOutcome.RejectedStale(result.activeRevisionOrVersion)
            WebRuleReplaceResult.RejectedInvalidDomain, WebRuleReplaceResult.RejectedSourceMismatch -> ApplyRulePackageOutcome.RejectedMalformed
        }
    }
}

private const val NANOS_PER_MILLI = 1_000_000L
