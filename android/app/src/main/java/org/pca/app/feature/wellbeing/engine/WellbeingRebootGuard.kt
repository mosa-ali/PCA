package org.pca.app.feature.wellbeing.engine

import org.pca.app.feature.wellbeing.model.NudgeRateState

/**
 * Reboot/process-death handling for [NudgeRateState] (PCA-WELL-011, doc 35). Mirrors PCA-3's
 * `ScreenTimeRestorer` boot-id comparison strategy: a monotonic clock resets at boot, so any
 * stored monotonic instant from a previous boot generation is not comparable to a fresh reading
 * and must never be used to fabricate elapsed time or claim continuity it cannot prove.
 *
 * On a detected reboot this is deliberately conservative in the anti-flood direction: rather than
 * dropping [NudgeRateState.lastNudgeMonotonicNanos] (which would let a nudge fire immediately),
 * it is re-anchored to "now" so the ordinary [org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy.minimumInterval]
 * wait still applies. The daily-count window is re-anchored to now too, but the count itself is
 * preserved rather than reset to zero -- again erring toward *fewer* nudges after a reboot, never
 * a burst. Game-return timestamps and same-suggestion cooldown timestamps are cleared outright:
 * they cannot be safely compared across the boundary, and clearing them only ever produces a less
 * restrictive (not unsafe) outcome for those specific fields.
 *
 * When no [NudgeRateState.lastBootGenerationToken] was previously recorded (fresh install / first
 * run), this is a no-op other than stamping the current token -- there is nothing stale to guard
 * against yet.
 */
object WellbeingRebootGuard {

    fun reconcile(rateState: NudgeRateState, nowMonotonicNanos: Long, currentBootId: String?): NudgeRateState {
        // PCA-RUNTIME-2R1: same-boot continuity must be POSITIVELY confirmed (both tokens known
        // and equal) before trusting the persisted monotonic timestamps -- an unavailable token on
        // either side is NOT evidence of a same-boot restart, and must take the same conservative
        // reboot-reconciliation path as a confirmed reboot, never silently preserved as-is.
        val sameBootConfirmed = rateState.lastBootGenerationToken != null &&
            currentBootId != null &&
            rateState.lastBootGenerationToken == currentBootId

        if (sameBootConfirmed) {
            return rateState.copy(lastBootGenerationToken = currentBootId)
        }
        if (rateState.lastBootGenerationToken == null) {
            // Fresh install / first run -- nothing stale to guard against yet, just stamp the token.
            return rateState.copy(lastBootGenerationToken = currentBootId)
        }

        return rateState.copy(
            lastEligibleExitMonotonicNanos = null,
            lastScreenLockMonotonicNanos = null,
            lastUnlockMonotonicNanos = null,
            lastNudgeMonotonicNanos = nowMonotonicNanos,
            dayWindowAnchorMonotonicNanos = nowMonotonicNanos,
            lastDeliveredAtBySuggestionId = emptyMap(),
            notForMeUntilBySuggestionId = emptyMap(),
            lastReflectionMonotonicNanos = null,
            lastBootGenerationToken = currentBootId,
        )
    }
}
