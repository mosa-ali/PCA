package org.pca.app.feature.youtube.policy

/**
 * Mirrors `backend/src/youtube/types.ts` field-for-field. This is a runtime
 * seam, not a client of the backend module -- Mode A evidence is built
 * entirely on-device from the Android usage-stats capability, so these
 * shapes are a design contract to mirror, matching doc 15's Mode A/Mode B
 * split exactly.
 */

typealias OpaqueFamilyId = String
typealias OpaqueProfileId = String

enum class YouTubeMode { A, B }

/** doc 15's per-source capability state -- "Unavailable" is itself a valid, reportable result. */
enum class UsageCapabilityStatus { GRANTED, REVOKED, UNSUPPORTED }

enum class UsageSource { ANDROID_USAGE_STATS, IOS_FAMILY_CONTROLS, UNAVAILABLE }

/**
 * doc 15 Mode A: "VERIFIED_WITH_LIMITATION... must label this as `app usage
 * only`... cannot fabricate an exact watched-video list from normal-app
 * usage or network traffic." `label` is a fixed literal, never caller-
 * supplied, so nothing downstream can override it into an implied per-video
 * claim. There is deliberately NO field here for a video id, title, or watch
 * list -- Mode A evidence structurally cannot carry one, exactly mirroring
 * the backend type's own design intent.
 * `durationMs = null` with `capabilityStatus != GRANTED` represents doc 5's
 * "missing evidence must never be displayed as zero use."
 */
data class ModeAUsageEvidence(
    val familyId: OpaqueFamilyId,
    val profileId: OpaqueProfileId,
    val source: UsageSource,
    val capabilityStatus: UsageCapabilityStatus,
    val durationMs: Long?,
    /** doc 15: "preserves a `coverage_gap` rather than inventing an end time." */
    val coverageGap: Boolean,
    val observedAtEpochMillis: Long,
) {
    val label: String get() = "app usage only"
}

/**
 * doc 15: Mode B is inert until BOTH `enabled` is true (an explicit owner
 * decision, never a per-family/child toggle) AND `termsReviewedAt` records
 * the required current-terms re-verification. This lane never sets
 * `enabled = true` anywhere -- see [org.pca.app.feature.youtube.policy.isModeBActive]
 * and its test coverage, which exists ONLY to confirm/preserve the
 * BLOCKED_EXTERNAL_POLICY_REVIEW default, never to activate it.
 */
data class ModeBFeatureFlagState(val enabled: Boolean, val termsReviewedAtEpochMillis: Long?)
