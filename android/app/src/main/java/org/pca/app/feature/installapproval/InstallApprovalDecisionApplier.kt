package org.pca.app.feature.installapproval

import org.pca.app.platform.ProtectionMode
import org.pca.app.runtime.schedule.PackageSuspensionExecutor

/**
 * PCA-FR-131: the on-device application step a live family-sync client would run once it has
 * received and decrypted a parent's INSTALL_APPROVAL decision (APPROVED/DENIED). Mirrors
 * [org.pca.app.runtime.schedule.BonusGrantSync]'s own scoping precedent EXACTLY: the network/
 * decrypt leg is NOT built here, for the identical pre-existing, repo-wide reason that class's doc
 * comment gives (no live family-sync client exists anywhere in this codebase yet, on either
 * platform -- see `org.pca.app.runtime.port.FamilySyncRuntimePort`'s own "Agent 16" doc comment).
 * This object is the part that genuinely IS this device's own responsibility once a decision's
 * plaintext content is available.
 *
 * The critical honesty property lives here: capability is RE-RESOLVED from the CURRENT
 * [ProtectionMode] at apply time, never trusted from whatever capability state was recorded when
 * the request was originally created ([InstallApprovalController.handleNewInstall] runs at
 * install-detection time, which can be minutes or days before a parent's decision arrives) --
 * Device Owner authority can be lost in between, and this is exactly where that loss must be
 * caught and honestly reported, rather than silently carrying forward a now-stale ENFORCED.
 */
object InstallApprovalDecisionApplier {

    enum class Decision { APPROVED, DENIED }

    /**
     * Applies [decision] to [packageName] exactly as far as the CURRENT capability
     * ([currentProtectionMode], re-resolved by the caller immediately before this call -- never a
     * value cached from request-creation time) genuinely allows, and returns the ACTUAL outcome:
     *
     *  - Capability is [InstallApprovalCapabilityState.ENFORCED]: unsuspends the package on
     *    APPROVED, (re-)suspends it on DENIED, via the real [packageSuspensionExecutor] call. The
     *    returned state is ENFORCED only if that platform call itself reports success --
     *    otherwise [InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED] (the platform operation
     *    itself failed, so enforcement did not actually happen; never claim it did).
     *  - Any other current capability: no suspend/unsuspend call is made at all (there is no
     *    authority to make one with) -- the returned state is exactly the current capability,
     *    never ENFORCED, regardless of what capability existed when the request was created or
     *    what the parent decided.
     */
    fun apply(
        packageSuspensionExecutor: PackageSuspensionExecutor,
        currentProtectionMode: ProtectionMode,
        packageName: String,
        decision: Decision,
    ): InstallApprovalCapabilityState {
        val currentCapability = InstallApprovalCapabilityResolver.resolve(currentProtectionMode)
        if (currentCapability != InstallApprovalCapabilityState.ENFORCED) return currentCapability

        val shouldSuspend = decision == Decision.DENIED
        val applied = runCatching { packageSuspensionExecutor.setSuspended(packageName, shouldSuspend) }.getOrDefault(false)
        return if (applied) InstallApprovalCapabilityState.ENFORCED else InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED
    }
}
