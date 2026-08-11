package org.pca.app.platform

/**
 * Protected Mode provisioning feasibility gate (doc 06 Section 7).
 * Protected Mode requires device-owner status on a fully-managed device;
 * which provisioning path is production-authorized (QR-code
 * PROVISION_MANAGED_DEVICE vs. ADB pilot-only `dpm set-device-owner`) is
 * explicitly gated behind unresolved owner decisions:
 *  - PCA-DEC-002 (doc 01)
 *  - PCA-DEC-014 / PCA-DEC-015 (doc 06 Section 15)
 * This gate exists so feature code can check feasibility WITHOUT embedding
 * a premature assumption about which path is authorized -- it must never
 * silently proceed with a provisioning flow while these decisions remain
 * PROPOSED, not DECIDED.
 */
enum class ProtectedModeFeasibility {
    /** The unresolved owner decisions block any Protected Mode provisioning offer to a real user. This is the only value the current baseline implementation may report. */
    PENDING_OWNER_DECISION,
    /** Reserved for once PCA-DEC-002/014/015 are resolved DECIDED and a concrete provisioning path is authorized -- not reachable by this baseline. */
    AVAILABLE,
}

interface ProtectedModeProvisioningGate {
    fun feasibility(): ProtectedModeFeasibility
}

/**
 * Baseline implementation: unconditionally reports PENDING_OWNER_DECISION.
 * This is not a placeholder bug -- it is the CORRECT behavior until a
 * human owner resolves PCA-DEC-002/014/015, at which point THIS CLASS
 * (not the interface) is updated to reflect the decided path. No feature
 * code may bypass this gate to attempt device-owner provisioning
 * directly.
 */
class UnresolvedProtectedModeProvisioningGate : ProtectedModeProvisioningGate {
    override fun feasibility(): ProtectedModeFeasibility = ProtectedModeFeasibility.PENDING_OWNER_DECISION
}
