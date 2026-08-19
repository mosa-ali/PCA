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
 * Read-only authority gate for any future protected provisioning or policy
 * operation. It does not start provisioning, request hidden authority, or
 * register a DeviceAdminReceiver. Callers may proceed only when the live OS
 * reports device-owner authority.
 */
enum class ProtectedModeAuthorityState { PROVEN, NOT_PROVEN, NOT_SUPPORTED }

interface ProtectedModeAuthorityGate {
    fun currentState(): ProtectedModeAuthorityState
}

class DeviceOwnerAuthorityGate(
    private val devicePolicyCapabilitySource: DevicePolicyCapabilitySource,
) : ProtectedModeAuthorityGate {
    override fun currentState(): ProtectedModeAuthorityState {
        val tracker = devicePolicyCapabilitySource as? DevicePolicyAuthorityTracker
        return if (tracker != null) {
            when (tracker.currentState()) {
                TrackedDevicePolicyState.DEVICE_OWNER -> ProtectedModeAuthorityState.PROVEN
                TrackedDevicePolicyState.UNAVAILABLE -> ProtectedModeAuthorityState.NOT_SUPPORTED
                TrackedDevicePolicyState.DEVICE_OWNER_REVOKED,
                TrackedDevicePolicyState.DEVICE_OWNER_UNVERIFIABLE,
                TrackedDevicePolicyState.PROFILE_OWNER,
                TrackedDevicePolicyState.STANDARD,
                -> ProtectedModeAuthorityState.NOT_PROVEN
            }
        } else {
            when (runCatching { devicePolicyCapabilitySource.currentAuthority() }
                .getOrDefault(ManagedDeviceAuthority.UNAVAILABLE)) {
                ManagedDeviceAuthority.DEVICE_OWNER -> ProtectedModeAuthorityState.PROVEN
                ManagedDeviceAuthority.UNAVAILABLE -> ProtectedModeAuthorityState.NOT_SUPPORTED
                ManagedDeviceAuthority.NONE,
                ManagedDeviceAuthority.PROFILE_OWNER,
                -> ProtectedModeAuthorityState.NOT_PROVEN
            }
        }
    }
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
