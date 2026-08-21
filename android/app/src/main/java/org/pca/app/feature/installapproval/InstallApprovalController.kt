package org.pca.app.feature.installapproval

import java.util.UUID
import org.json.JSONObject
import org.pca.app.platform.PlatformProtectionCapabilities
import org.pca.app.runtime.schedule.PackageSuspensionExecutor

/**
 * The Android-side "detect -> (maybe quarantine) -> request" half of CAPABILITY_HONEST_INSTALL_APPROVAL
 * (PCA-FR-131). [org.pca.app.runtime.installobserver.InstalledAppEventReceiver] is the only
 * caller; the decision logic lives here, split out so it is unit-testable without Robolectric or
 * a real `BroadcastReceiver`.
 *
 * Reuses the SAME [PlatformProtectionCapabilities]/[PackageSuspensionExecutor] instances the
 * existing schedule-enforcement path already uses (wired once in `PcaAppGraph`) -- this class
 * fabricates no new authority check and no new suspend mechanism.
 *
 * "Enforced" here means exactly what doc 06 Section 4 documents as real: Android provides no
 * mechanism (even under Device Owner authority) to gate the INSTALL action itself, only to
 * suspend an ALREADY-installed package. Genuine "install approval" enforcement therefore means
 * quarantining the package immediately on detection (fail-closed, pending the parent's decision)
 * when -- and only when -- [InstallApprovalCapabilityResolver] resolves [InstallApprovalCapabilityState.ENFORCED].
 * This class never claims the install itself was blocked.
 */
class InstallApprovalController(
    private val protectionCapabilities: PlatformProtectionCapabilities,
    private val packageSuspensionExecutor: PackageSuspensionExecutor,
    private val requestIdFactory: () -> String = { UUID.randomUUID().toString() },
) {
    /** Everything the caller needs to submit the resulting child request -- deliberately carries
     * no dependency on [org.pca.app.runtime.PcaRuntime]/[org.pca.app.runtime.port.FamilySyncRuntimePort]
     * so this class stays a pure decision step; the caller submits via its own already-existing
     * `createChildRequest` path (the SAME one `BONUS_TIME` uses -- see ChildHomeScreen.kt's own
     * doc comment on that reuse). */
    data class DetectionResult(
        val requestId: String,
        val kind: String,
        val detail: String,
        val capabilityState: InstallApprovalCapabilityState,
    )

    /**
     * Called once per genuine new-install broadcast (the receiver has already filtered out
     * updates/malformed broadcasts before this is ever invoked). Resolves the CURRENT capability
     * live (never cached), quarantines the package via [packageSuspensionExecutor] ONLY when that
     * capability is [InstallApprovalCapabilityState.ENFORCED], and always returns a
     * [DetectionResult] the caller can submit as a child request regardless of capability -- a
     * request is still real and still worth a parent's attention even when nothing on-device can
     * enforce it (REQUEST_ONLY is an honest, valid outcome, not a reason to skip the request).
     *
     * The suspend call is best-effort: a platform failure here never blocks the request from being
     * created (the child install already happened; the ONLY thing at stake is whether it can be
     * quarantined pending decision, not whether the parent gets to know about it at all).
     */
    fun handleNewInstall(packageName: String, appLabel: String?, nowEpochMillis: Long): DetectionResult {
        val capabilityState = InstallApprovalCapabilityResolver.resolve(protectionCapabilities.currentMode())
        if (capabilityState == InstallApprovalCapabilityState.ENFORCED) {
            runCatching { packageSuspensionExecutor.setSuspended(packageName, true) }
        }
        return DetectionResult(
            requestId = requestIdFactory(),
            kind = KIND,
            detail = encodeDetail(packageName, appLabel, capabilityState, nowEpochMillis),
            capabilityState = capabilityState,
        )
    }

    companion object {
        /** Matches `backend/src/childrequests/types.ts`'s `ChildRequestType` member verbatim. */
        const val KIND = "INSTALL_APPROVAL"

        /** Minimal, dependency-free JSON encoding of the three request-time fields
         * (`installTargetPackageName`/`installTargetAppLabel`/`installCapabilityState`) --
         * [org.pca.app.runtime.port.ChildRequestPayload.detail] is explicitly documented as opaque
         * content this app never encrypts itself (that belongs to the coordinator's family-sync
         * transport); this is only the plaintext shape that transport will eventually carry. */
        fun encodeDetail(packageName: String, appLabel: String?, capabilityState: InstallApprovalCapabilityState, nowEpochMillis: Long): String =
            JSONObject().apply {
                put("installTargetPackageName", packageName)
                put("installTargetAppLabel", appLabel ?: JSONObject.NULL)
                put("installCapabilityState", capabilityState.name)
                put("detectedAtEpochMillis", nowEpochMillis)
            }.toString()
    }
}
