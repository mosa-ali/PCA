package org.pca.app.runtime.schedule

import java.security.MessageDigest

/**
 * PCA-AND-003 (doc 06 Section 8): "The break-enforcement suspension/allowlist set MUST always
 * include the platform emergency-dialer package and any OS-designated emergency/SOS surface; a
 * policy envelope that would remove emergency access from the allowlist MUST be rejected
 * client-side regardless of parent signature validity (a local, non-overridable safety floor,
 * distinct from and in addition to the signature/version checks in doc 05 Section 6)."
 *
 * This floor is enforced inside [ScheduleEvaluator.evaluate] -- the single, final decision
 * function every schedule-driven enforcement decision funnels through (whether reached via
 * [ScheduleRuntime.evaluate], the one production entry point, or called directly, e.g. from a
 * test) -- rather than by rejecting whole policy envelopes earlier at [SchedulePolicyValidator].
 * Rejecting the whole envelope there would be wrong: an ordinary, legitimately-authored
 * bedtime/school-mode window commonly uses [AppScope.All] to lock down every app overnight, and
 * that is a normal, intended policy shape, not an attack. The floor this doc actually requires is
 * narrower: whatever the policy says, the decision returned FOR THE PROTECTED APP TOKEN ITSELF
 * must never be a blocking one. Implementing the floor as an unconditional, first-line override at
 * the per-token decision function makes it impossible for any policy shape -- well-formed or
 * malicious, validly signed or not, currently valid/expired/epoch-stale or not -- to ever produce
 * a blocking decision for a protected token, without having to separately special-case every
 * window kind/precedence rule in [ScheduleEvaluator] (which would need to be kept in sync with any
 * future rule added there).
 *
 * The floor is intentionally independent of policy validity/signature/acceptance state: it is
 * checked before any policy field is even read, so a compromised, malformed, structurally invalid,
 * expired, epoch-stale, or otherwise-untrusted candidate policy has exactly the same (no) effect on
 * protected tokens as a validly-signed, fully-current one. Signature verification itself happens
 * upstream of this package (see `SchedulePolicyPayload`'s doc comment referencing
 * `EnvelopeSignatureVerifier`) and is out of scope here by design -- this floor holds regardless of
 * whatever that layer decided.
 */
object EmergencyAccessFloor {

    /**
     * PCA-AND-003A: package/token resolution belongs to a platform adapter using documented
     * Android roles and capability APIs. The pure enforcement layer receives only these resolved
     * opaque tokens, keeping OEM package names and readable communication identifiers out of the
     * policy contract.
     */
    fun resolveCommunicationSurfaces(
        systemDialerPackage: String? = null,
        incomingCallPackage: String?,
        smsTransportPackage: String?,
        emergencySurfacePackages: Set<String>,
    ): CommunicationSafetySurfaceTokens = CommunicationSafetySurfaceTokens(
        // Android's documented TelecomManager.getSystemDialerPackage() is the only stable
        // platform-provided identity this layer may treat as the system emergency surface.
        // Do not substitute an OEM/AOSP package literal: the API may legitimately return null.
        emergencySurfaceTokens = (systemDialerPackage
            ?.takeIf(String::isNotBlank)
            ?.let(::opaqueToken)
            ?.let(::setOf)
            ?: emptySet()) + emergencySurfacePackages
            .filter(String::isNotBlank)
            .map(::opaqueToken),
        callSurfaceTokens = incomingCallPackage
            ?.takeIf(String::isNotBlank)
            ?.let(::opaqueToken)
            ?.let(::setOf)
            ?: emptySet(),
        smsTransportTokens = smsTransportPackage
            ?.takeIf(String::isNotBlank)
            ?.let(::opaqueToken)
            ?.let(::setOf)
            ?: emptySet(),
    )

    /**
     * Kept empty deliberately. Emergency/system package identities are device-provided by
     * [resolveCommunicationSurfaces]; a hardcoded package would make a false cross-OEM claim.
     * The public value remains for source compatibility with older callers, but no token is
     * protected unless the documented platform resolver supplied it.
     */
    val PROTECTED_APP_TOKENS: Set<OpaqueAppToken> = emptySet()

    /** True if [appToken] is one this floor protects -- i.e. [ScheduleEvaluator.evaluate] MUST
     * return an allowing decision for it no matter what the current policy says. */
    fun isProtectedToken(
        appToken: OpaqueAppToken,
        additionalProtectedTokens: Set<OpaqueAppToken> = emptySet(),
    ): Boolean = appToken in PROTECTED_APP_TOKENS || appToken in additionalProtectedTokens

    /** Stable local mapping shared by schedule evaluation and the platform enforcement consumer. */
    fun opaqueTokenForPackage(packageName: String): OpaqueAppToken = opaqueToken(packageName)

    /**
     * True if [appToken] is currently one of [communicationSurfaces]' protected surfaces --
     * the OS-designated emergency surface, OR the live-resolved incoming-call/default-dialer
     * role, OR the live-resolved SMS transport role. This is the ONE check every caller in this
     * app that can suspend/quarantine a package (not only [ScheduleEvaluator]'s decision path)
     * MUST consult before ever invoking [PackageSuspensionExecutor.setSuspended] with
     * `suspended = true`, so the PCA-AND-003 floor holds regardless of which feature is driving
     * the suspend call. [ScheduleEnforcementConsumer]'s two implementations and
     * [org.pca.app.feature.installapproval.InstallApprovalController]/
     * [org.pca.app.feature.installapproval.InstallApprovalDecisionApplier] (PCA-FR-131) all route
     * through this single function rather than each re-deriving the OR-of-three-sets check, so
     * the floor's definition can never silently drift between call sites.
     */
    fun isProtectedSurfaceToken(
        appToken: OpaqueAppToken,
        communicationSurfaces: CommunicationSafetySurfaceTokens,
    ): Boolean = isProtectedToken(appToken, communicationSurfaces.emergencySurfaceTokens) ||
        appToken in communicationSurfaces.callSurfaceTokens ||
        appToken in communicationSurfaces.smsTransportTokens

    /**
     * The decision unconditionally returned for a protected token. Deliberately reuses the
     * ordinary [ScheduleDecisionKind.ALLOWED] (rather than introducing a new enum case) so every
     * existing caller that already handles ALLOWED keeps behaving correctly with no further
     * changes required anywhere else in the codebase; [ScheduleDecision.reason] still names the
     * floor explicitly for audit/debugging visibility.
     */
    val ALWAYS_ALLOWED_DECISION: ScheduleDecision = ScheduleDecision(
        decision = ScheduleDecisionKind.ALLOWED,
        reason = "PCA-AND-003 emergency-access floor: this app token is a protected emergency " +
            "surface and is never blocked by schedule policy, regardless of policy content, " +
            "structural validity, expiry, epoch state, or signature validity.",
    )

    /** Same hashing scheme as `UsageSessionRecorder`/`RuntimeEligibleAppSignalSource` -- see those
     * files' private `opaqueToken`. Duplicated deliberately (matching this codebase's existing
     * per-file `opaqueToken` pattern) rather than introducing a new shared dependency between
     * `runtime.usage`/`runtime.wellbeing` and `runtime.schedule`. */
    private fun opaqueToken(packageName: String): OpaqueAppToken {
        val digest = MessageDigest.getInstance("SHA-256").digest(packageName.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { "%02x".format(it) }.take(TOKEN_LENGTH)
    }

    private const val TOKEN_LENGTH = 16
}
