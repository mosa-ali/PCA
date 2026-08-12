package org.pca.app.feature.screentime.policy

import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/**
 * PCA-SCREEN-BASELINE-1: the single source of truth, on the Android side, for the non-weakenable
 * "60/30" anti-gaming baseline that [org.pca.app.feature.screentime.engine.ScreenTimeEngine]
 * enforces at runtime (60 continuous "active" minutes max, 30-minute Break Shield min).
 *
 * A parent MAY configure a STRICTER (safer) policy than 60/30 -- e.g. 45/30, 30/45, 60/90 -- but
 * MUST NEVER be able to configure a WEAKER one -- e.g. 90/30, 60/15, 180/5 -- through any
 * incoming or stored policy. This object is the one place those bounds are declared; every
 * policy-application path (see [ScreenTimePolicyApplier]) must go through it rather than
 * re-deriving its own thresholds.
 *
 * This check is a pure function of its arguments: no I/O, no clock, no network -- it is safe (and
 * required) to run fully offline, since a device with no connectivity must still be able to
 * validate a policy it already has queued/stored locally.
 */
object ScreenTimeBaselinePolicy {

    /**
     * Continuous-use ("60" side) bounds. [MAX_ACTIVE_THRESHOLD] is the anti-gaming ceiling: an
     * active-use threshold above this defeats the 60/30 rule and must never be applied.
     * [MIN_ACTIVE_THRESHOLD] is *not* part of the anti-gaming invariant itself -- it mirrors the
     * pre-existing supported floor already used by parent-web's ScreenTimePage input
     * (`CONTINUOUS_USE_LIMIT_MIN_MINUTES` in `parent-web/src/domain/screenTimePolicy.ts`), carried
     * over unchanged: this baseline only ever tightens the ceiling, it never raises the floor.
     */
    val MIN_ACTIVE_THRESHOLD: Duration = 15.minutes
    val MAX_ACTIVE_THRESHOLD: Duration = 60.minutes

    /**
     * Break-duration ("30" side) bounds. [MIN_BREAK_DURATION] is the anti-gaming floor: a break
     * shorter than this defeats the 60/30 rule and must never be applied. [MAX_BREAK_DURATION] is
     * a documented, sane operational ceiling (2 hours) so the field stays bounded; it is not
     * itself part of the anti-gaming invariant (any value >= 30 minutes already satisfies that).
     */
    val MIN_BREAK_DURATION: Duration = 30.minutes
    val MAX_BREAK_DURATION: Duration = 120.minutes

    fun isBaselineCompliant(activeThreshold: Duration, breakDuration: Duration): Boolean =
        activeThreshold in MIN_ACTIVE_THRESHOLD..MAX_ACTIVE_THRESHOLD &&
            breakDuration in MIN_BREAK_DURATION..MAX_BREAK_DURATION

    fun isBaselineCompliant(config: ScreenTimeConfig): Boolean =
        isBaselineCompliant(config.activeThreshold, config.breakDuration)
}
