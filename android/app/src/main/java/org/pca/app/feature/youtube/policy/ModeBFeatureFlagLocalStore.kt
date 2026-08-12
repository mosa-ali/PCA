package org.pca.app.feature.youtube.policy

import org.pca.app.foundation.PersistentStateStore

/**
 * Local read-only mirror of doc 15's global (not per-family) Mode B feature
 * flag. Per this lane's scope boundary, this class exists ONLY to confirm
 * and preserve the BLOCKED_EXTERNAL_POLICY_REVIEW default -- there is
 * deliberately no [setEnabled]/[recordTermsReview]-style mutator anywhere in
 * this file or called from anywhere in `feature/youtube`. If a future,
 * separately-owned release-gate workflow needs to flip this flag after a
 * documented owner decision + terms re-verification (doc 15), that mutation
 * path belongs in that workflow's own lane, not here.
 */
class ModeBFeatureFlagLocalStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    /** Never throws on corrupt/unparseable stored data -- degrades to [defaultModeBFeatureFlagState] (OFF/unreviewed), the same safe direction as every other store in this codebase. */
    fun load(): ModeBFeatureFlagState {
        val raw = store.getString(key) ?: return defaultModeBFeatureFlagState()
        val parts = raw.split("|")
        if (parts.size != 2) return defaultModeBFeatureFlagState()
        val enabled = parts[0].toBooleanStrictOrNull() ?: return defaultModeBFeatureFlagState()
        val termsReviewedAt = parts[1].takeIf { it != "null" }?.toLongOrNull()
        return ModeBFeatureFlagState(enabled, termsReviewedAt)
    }

    fun isActive(): Boolean = isModeBActive(load())

    private companion object {
        const val KEY = "youtube_mode_b_feature_flag_v1"
    }
}
