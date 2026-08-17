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
        incomingCallPackage: String?,
        smsTransportPackage: String?,
        emergencySurfacePackages: Set<String>,
    ): CommunicationSafetySurfaceTokens = CommunicationSafetySurfaceTokens(
        emergencySurfaceTokens = PROTECTED_APP_TOKENS + emergencySurfacePackages
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
     * AOSP telephony/emergency-dialer system package -- present on every Android device with
     * telephony hardware, and the process that actually places emergency calls at the framework
     * level (distinct from any OEM-branded dialer UI app, whose package name is not guaranteed
     * across vendors). Kept as the durable, platform-guaranteed floor baseline; a caller MAY widen
     * [PROTECTED_APP_TOKENS] with the device's actual default/system-dialer package (e.g. resolved
     * via `TelecomManager.getSystemDialerPackage()`, a platform-adapter concern out of scope for
     * this pure module) for extra coverage, but this baseline alone already satisfies PCA-AND-003's
     * "platform emergency-dialer package" floor on every telephony-capable Android device.
     */
    const val TELEPHONY_SYSTEM_PACKAGE = "com.android.phone"

    /**
     * [OpaqueAppToken]s this floor always protects, computed with the exact same
     * package-name -> token hashing scheme production usage-ingestion code uses (see
     * `UsageSessionRecorder.opaqueToken` / `RuntimeEligibleAppSignalSource.opaqueToken`), so a
     * protected token here matches the token real enforcement code would compute for the same
     * package name at runtime.
     */
    val PROTECTED_APP_TOKENS: Set<OpaqueAppToken> = setOf(opaqueToken(TELEPHONY_SYSTEM_PACKAGE))

    /** True if [appToken] is one this floor protects -- i.e. [ScheduleEvaluator.evaluate] MUST
     * return an allowing decision for it no matter what the current policy says. */
    fun isProtectedToken(
        appToken: OpaqueAppToken,
        additionalProtectedTokens: Set<OpaqueAppToken> = emptySet(),
    ): Boolean = appToken in PROTECTED_APP_TOKENS || appToken in additionalProtectedTokens

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
