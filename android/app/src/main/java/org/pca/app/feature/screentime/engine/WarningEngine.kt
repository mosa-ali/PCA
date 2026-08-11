package org.pca.app.feature.screentime.engine

import kotlin.time.Duration

/**
 * Informational, non-resetting warnings ("10 minutes left", "5 minutes left", "1 minute left")
 * derived purely from engine state — a warning never mutates [ScreenTimeState] or affects the
 * continuous-use streak. Because it is a pure read of the current remaining time rather than a
 * persisted flag, a threshold automatically "un-fires" if a parent grant pushes the remaining
 * time back above it (so it can correctly fire again later) and is inherently duplicate-safe:
 * calling it twice for the same (or an older/duplicate) state yields the same crossed set.
 */
object WarningEngine {

    /** The configured warning thresholds currently at or below the remaining active time,
     * i.e. already "crossed". Empty whenever [ScreenTimeState.mode] isn't
     * [ScreenTimeMode.ACTIVE] — warnings are only meaningful while counting toward the break. */
    fun crossedThresholds(state: ScreenTimeState, config: ScreenTimeConfig = ScreenTimeConfig()): Set<Duration> {
        if (state.mode != ScreenTimeMode.ACTIVE) return emptySet()
        val remainingNanos = ScreenTimeEngine.remainingActiveNanos(state, config)
        return config.warningThresholds.filter { it.inWholeNanoseconds >= remainingNanos }.toSet()
    }

    /**
     * Thresholds crossed in [after] that were not yet crossed in [before] — exactly the set of
     * warnings that should be newly surfaced to the child/parent. Replaying [after] again for
     * the same instant (a duplicate tick) reports the same crossed set as before, so the diff
     * against itself is empty and no duplicate notification is produced.
     */
    fun newlyCrossedThresholds(
        before: ScreenTimeState,
        after: ScreenTimeState,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): Set<Duration> = crossedThresholds(after, config) - crossedThresholds(before, config)
}
