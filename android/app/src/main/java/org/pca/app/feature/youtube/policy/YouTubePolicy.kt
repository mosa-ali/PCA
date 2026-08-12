package org.pca.app.feature.youtube.policy

/** doc 15: "MODE_B feature flag = OFF by default." The only zero-argument way to obtain a flag state in this module. */
fun defaultModeBFeatureFlagState(): ModeBFeatureFlagState = ModeBFeatureFlagState(enabled = false, termsReviewedAtEpochMillis = null)

/**
 * doc 15: "REQUIRES_FURTHER_OWNER_DECISION and terms verification before
 * release." Both the owner's enable decision AND a recorded terms review
 * must be present -- this lane never calls anything that would make this
 * return true (no production call site anywhere in `feature/youtube` sets
 * `enabled = true`); it exists purely so a caller/test can confirm Mode B
 * stays inert.
 */
fun isModeBActive(flag: ModeBFeatureFlagState): Boolean = flag.enabled && flag.termsReviewedAtEpochMillis != null

private val MODE_TRANSITIONS: Map<YouTubeMode, Set<YouTubeMode>> = mapOf(
    YouTubeMode.A to setOf(YouTubeMode.B),
    YouTubeMode.B to setOf(YouTubeMode.A),
)

/** doc 15: switching to B is only legal while the feature flag is fully active; switching back to A is always legal. */
fun isLegalModeTransition(from: YouTubeMode, to: YouTubeMode, flag: ModeBFeatureFlagState): Boolean {
    if (to !in MODE_TRANSITIONS.getValue(from)) return false
    return if (to == YouTubeMode.B) isModeBActive(flag) else true
}
