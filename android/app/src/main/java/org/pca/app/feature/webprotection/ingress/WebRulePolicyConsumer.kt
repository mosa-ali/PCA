package org.pca.app.feature.webprotection.ingress

import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebRuleReplaceResult
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.WebRule

/**
 * doc 29's narrow Android consumer for an ALREADY authenticated, verified
 * and decrypted family Web Rule payload -- this class does not decrypt or
 * authenticate a family envelope itself (that is the established
 * crypto-layer's job, gated behind `PRODUCTION_CRYPTO_SUITE` human security
 * review; see [org.pca.app.security.NotApprovedDeviceKeyPairGenerator]). It
 * only validates the ALREADY-TRUSTED payload's shape/scope and hands it to
 * [PersistentWebRuleRepository.replaceParentRules] for LKG-durable storage.
 *
 * No production caller wires a real decrypted family transport into this
 * class today (doc 30/31: Agent 27 must not bind an unreviewed real family
 * transport merely to make delivery appear functional) -- the only current
 * caller is the conformance/test injection path (doc 32), proving the full
 * chain end-to-end without any production crypto bypass. See
 * [org.pca.app.runtime.graph.PcaAppGraph] for the `PARENT_WEB_RULE_DELIVERY
 * = SOURCE_READY_WITH_CRYPTO_GATE` composition status.
 */
data class FamilyWebRulePayload(
    val familyId: OpaqueFamilyId,
    val revision: Long,
    val rules: List<WebRule>,
)

sealed class WebRuleIngressOutcome {
    data class Applied(val revision: Long, val ruleCount: Int) : WebRuleIngressOutcome()
    data class RejectedStaleRevision(val activeRevision: String) : WebRuleIngressOutcome()
    object RejectedInvalidDomain : WebRuleIngressOutcome()
    object RejectedForbiddenSource : WebRuleIngressOutcome()
    /** The payload's own `familyId` does not match [expectedFamilyId] -- never applied, regardless of how trusted the transport claimed to be, since a wrong-family payload must never overwrite this device's own family's rules (doc 45 "wrong family -> rejected"). */
    object RejectedWrongFamily : WebRuleIngressOutcome()
    /** Coordinator correction: [expectedFamilyId] itself was blank/whitespace-only -- there is no trusted family authority to apply ANY family-scoped payload under, regardless of what the payload claims. */
    object RejectedNoTrustedFamilyAuthority : WebRuleIngressOutcome()
}

class WebRulePolicyConsumer(private val repository: PersistentWebRuleRepository) {

    /**
     * [expectedFamilyId] must come from [org.pca.app.feature.webprotection.identity.WebProtectionIdentityContextProvider]
     * (this device's own trusted identity), never from the payload itself --
     * a payload claiming to be for a different family is rejected outright.
     * Coordinator correction: a blank [expectedFamilyId] is never trusted
     * authority either -- [org.pca.app.feature.webprotection.identity.RealWebProtectionIdentityContextProvider]
     * already refuses to report [org.pca.app.feature.webprotection.identity.WebProtectionIdentity.Trusted]
     * for a blank familyId, but this consumer does not rely on that alone
     * (defense in depth against a future/misbehaving caller passing one directly).
     */
    fun apply(expectedFamilyId: OpaqueFamilyId, payload: FamilyWebRulePayload): WebRuleIngressOutcome {
        if (expectedFamilyId.isBlank()) return WebRuleIngressOutcome.RejectedNoTrustedFamilyAuthority
        if (payload.familyId != expectedFamilyId) return WebRuleIngressOutcome.RejectedWrongFamily
        for (rule in payload.rules) {
            if (rule.familyId != expectedFamilyId) return WebRuleIngressOutcome.RejectedWrongFamily
        }

        return when (val result = repository.replaceParentRules(expectedFamilyId, payload.rules, payload.revision)) {
            is WebRuleReplaceResult.Applied -> WebRuleIngressOutcome.Applied(payload.revision, result.ruleCount)
            is WebRuleReplaceResult.RejectedStaleRevision -> WebRuleIngressOutcome.RejectedStaleRevision(result.activeRevisionOrVersion)
            WebRuleReplaceResult.RejectedInvalidDomain -> WebRuleIngressOutcome.RejectedInvalidDomain
            WebRuleReplaceResult.RejectedSourceMismatch -> WebRuleIngressOutcome.RejectedForbiddenSource
        }
    }
}
