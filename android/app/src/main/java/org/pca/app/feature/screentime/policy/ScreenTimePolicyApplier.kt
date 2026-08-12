package org.pca.app.feature.screentime.policy

import kotlin.time.Duration.Companion.minutes
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/**
 * The wire/storage-level representation of an incoming screen-time policy -- e.g. as decoded
 * from a parent-authored, signed policy payload once its envelope has already been verified and
 * decrypted (see `org.pca.app.runtime.sync.envelope.EnvelopeSignatureVerifier`, which this
 * package does not touch), or as read back from a locally persisted (possibly legacy) record.
 *
 * Deliberately separate from [ScreenTimeConfig]: a [ScreenTimeConfig] is only ever constructed
 * by [ScreenTimePolicyApplier] for a payload that has already passed [ScreenTimeBaselinePolicy],
 * so a caller can never end up running the engine on an unvalidated config by accident.
 */
data class ScreenTimePolicyPayload(
    val continuousUseLimitMinutes: Int,
    val breakDurationMinutes: Int,
)

enum class ScreenTimePolicyApplicationStatus {
    APPLIED,
    INVALID_POLICY_BASELINE,
}

/**
 * Explicit typed outcome of applying an incoming/stored [ScreenTimePolicyPayload]. Deliberately
 * not a bare [ScreenTimeConfig], so a caller can never mistake a rejected policy for one that was
 * actually applied.
 */
sealed interface ScreenTimePolicyApplicationResult {
    val status: ScreenTimePolicyApplicationStatus

    /** The [ScreenTimeConfig] that is now in effect -- the newly applied one on success, or the
     * preserved last-known-good one on rejection. Never derived from the rejected payload. */
    val effectiveConfig: ScreenTimeConfig

    data class Applied(override val effectiveConfig: ScreenTimeConfig) : ScreenTimePolicyApplicationResult {
        override val status: ScreenTimePolicyApplicationStatus = ScreenTimePolicyApplicationStatus.APPLIED
    }

    data class RejectedInvalidBaseline(
        val rejectedPayload: ScreenTimePolicyPayload,
        override val effectiveConfig: ScreenTimeConfig,
    ) : ScreenTimePolicyApplicationResult {
        override val status: ScreenTimePolicyApplicationStatus =
            ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE
    }
}

/**
 * PCA-SCREEN-BASELINE-1: the single policy-application entry point for incoming or stored
 * screen-time policies. A payload that violates [ScreenTimeBaselinePolicy] is rejected in its
 * *entirety* -- never "fixed in place" by clamping its fields to the nearest legal value -- because
 * a clamped policy is not the policy a parent actually authored/signed, and silently substituting
 * one would misrepresent what was applied. This function never mutates a payload's fields; it only
 * ever chooses between the payload as a whole (converted into a [ScreenTimeConfig]) or the
 * unmodified last-known-good [ScreenTimeConfig].
 *
 * On rejection, [ScreenTimePolicyApplicationResult.RejectedInvalidBaseline.effectiveConfig] is
 * whatever [lastKnownGoodConfig] the caller supplied. That value is itself always
 * baseline-compliant, since the only ways to have obtained it are: (a) it is the hardcoded
 * [ScreenTimeConfig] default (60/30, itself compliant), or (b) it is the [effectiveConfig] from a
 * *previous* call to this same function, which by induction was compliant. A caller MUST persist
 * and reuse the returned [ScreenTimePolicyApplicationResult.effectiveConfig] as the next
 * [lastKnownGoodConfig] rather than re-deriving one from an untrusted source, or this invariant
 * breaks.
 *
 * Legacy/pre-existing policies (e.g. old fixture or demo data created before this rule existed)
 * are handled the same way as any other incoming payload: rejected as a whole rather than
 * silently applied, with [lastKnownGoodConfig] (or the safe 60/30 default, if none exists yet)
 * remaining in effect. This is a deliberate fail-closed choice over normalizing/clamping the
 * legacy values in place, for the same "never fix a policy in place" reasoning above.
 *
 * Pure and synchronous: no I/O, no clock reads, no network access. Safe -- and required -- to run
 * fully offline, since a device with no connectivity must still be able to validate whatever
 * policy it already has queued or stored locally.
 */
object ScreenTimePolicyApplier {

    /** The config applied when there is no prior last-known-good policy at all (e.g. first-ever
     * launch encountering an already-invalid stored/legacy record) -- the hardcoded 60/30
     * baseline itself, which is always compliant by construction. */
    val SAFE_DEFAULT_CONFIG: ScreenTimeConfig = ScreenTimeConfig()

    fun apply(
        payload: ScreenTimePolicyPayload,
        lastKnownGoodConfig: ScreenTimeConfig = SAFE_DEFAULT_CONFIG,
    ): ScreenTimePolicyApplicationResult {
        val activeThreshold = payload.continuousUseLimitMinutes.minutes
        val breakDuration = payload.breakDurationMinutes.minutes
        return if (ScreenTimeBaselinePolicy.isBaselineCompliant(activeThreshold, breakDuration)) {
            ScreenTimePolicyApplicationResult.Applied(
                ScreenTimeConfig(activeThreshold = activeThreshold, breakDuration = breakDuration),
            )
        } else {
            ScreenTimePolicyApplicationResult.RejectedInvalidBaseline(payload, lastKnownGoodConfig)
        }
    }
}
