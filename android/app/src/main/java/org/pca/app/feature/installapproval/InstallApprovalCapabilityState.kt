package org.pca.app.feature.installapproval

import org.pca.app.platform.ProtectionMode

/**
 * CAPABILITY_HONEST_INSTALL_APPROVAL (PCA-FR-131, cross-referenced from PCA-FR-045): the
 * install-approval-specific honest capability vocabulary. Deliberately its OWN enum, not a reuse
 * of [ProtectionMode] verbatim -- "what protection mode is this device in" and "what can actually
 * happen to THIS newly-installed package" are related but distinct questions (e.g. PROTECTED mode
 * is necessary but not sufficient; the [org.pca.app.runtime.schedule.PackageSuspensionExecutor]
 * call itself can still fail -- see [InstallApprovalDecisionApplier]). Mirrors
 * `backend/src/childrequests/types.ts`'s `InstallApprovalCapabilityState` and iOS's
 * `InstallApprovalCapability` verbatim so the SAME state string means the same thing everywhere.
 *
 * Never a boolean: doc 06 Section 4 documents that Android grants an ordinary (non-Device-Owner)
 * app NO suspend/block authority at all, and that even Device Owner authority's
 * `setPackagesSuspended` only suspends an ALREADY-installed package -- it does not gate the
 * install action itself. "Can this device enforce a decision about this install" therefore has
 * five genuinely different honest answers, never one bit.
 */
enum class InstallApprovalCapabilityState {
    /** Device Owner authority is currently held; the newly-installed package can genuinely be
     * suspended (kept unusable) until the parent decides, via the SAME
     * [org.pca.app.runtime.schedule.PackageSuspensionExecutor] doc 06 Section 4's "Suspend
     * selected packages" row documents for schedule enforcement. Never claims the INSTALL ITSELF
     * was prevented -- only that the package's usability can be gated pending a decision. */
    ENFORCED,

    /** No Device Owner authority: doc 06 Section 4's "Suspend selected packages: UNSUPPORTED (no
     * ordinary-app authority)" row applies. The request can still be created and a parent
     * notified, but nothing on this device can stop the child from using the app before or after
     * the parent decides. */
    REQUEST_ONLY,

    /** Device Owner authority was proven before but is not currently held/verifiable (see
     * [org.pca.app.platform.TrackedDevicePolicyState.DEVICE_OWNER_REVOKED]/
     * [org.pca.app.platform.TrackedDevicePolicyState.DEVICE_OWNER_UNVERIFIABLE]) -- a parent must
     * re-establish Protected Mode authority before enforcement is possible again. Never silently
     * reported as ENFORCED just because it once was (see [InstallApprovalDecisionApplier]'s own
     * re-check-at-apply-time discipline). */
    AUTHORIZATION_REQUIRED,

    /** [org.pca.app.platform.DevicePolicyCapabilitySource] itself is unavailable on this device
     * (no `DevicePolicyManager` system service, or every query failed) -- there is no authority
     * signal to even evaluate, distinct from an authority that is merely absent. */
    NOT_SUPPORTED,

    /** Reserved for a platform whose install-approval capability is real but inherently partial
     * in a way that is neither ENFORCED nor a plain REQUEST_ONLY/NOT_SUPPORTED. This Android
     * module never itself produces PLATFORM_LIMITED (see `InstallApprovalCapabilityResolver`
     * below -- every [ProtectionMode] maps to one of the other four); the member exists only so
     * the shared cross-platform vocabulary stays complete (iOS's `InstallApprovalCapability`
     * reports it categorically -- see `ios/PCA/InstallApproval/InstallApprovalCapability.swift`). */
    PLATFORM_LIMITED,
}

/**
 * Resolves [InstallApprovalCapabilityState] from [ProtectionMode] -- reuses the SAME proven
 * Device Owner authority gate every other real enforcement path in this app already queries live
 * ([org.pca.app.platform.DevicePolicyProtectionCapabilities], consumed identically by
 * [org.pca.app.runtime.schedule.DevicePolicyScheduleEnforcementConsumer] for schedule
 * enforcement). This object never queries `DevicePolicyManager`/`DevicePolicyCapabilitySource`
 * itself -- it is a pure mapping, so it is trivially unit-testable and cannot drift into a second,
 * competing authority check.
 */
object InstallApprovalCapabilityResolver {
    fun resolve(protectionMode: ProtectionMode): InstallApprovalCapabilityState = when (protectionMode) {
        ProtectionMode.PROTECTED -> InstallApprovalCapabilityState.ENFORCED
        ProtectionMode.STANDARD -> InstallApprovalCapabilityState.REQUEST_ONLY
        ProtectionMode.DEGRADED -> InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED
        ProtectionMode.AUTHORIZATION_REQUIRED -> InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED
        ProtectionMode.NOT_SUPPORTED -> InstallApprovalCapabilityState.NOT_SUPPORTED
    }
}
