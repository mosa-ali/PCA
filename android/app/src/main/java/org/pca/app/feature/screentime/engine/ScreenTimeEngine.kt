package org.pca.app.feature.screentime.engine

import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/** Tunable thresholds. Durations only — never wall-clock instants. */
data class ScreenTimeConfig(
    val activeThreshold: Duration = 60.minutes,
    val breakDuration: Duration = 30.minutes,
    /** How long a non-qualifying-activity pause has to last, measured on the monotonic clock,
     * before the continuous-use streak is considered broken and reset to zero. A pause shorter
     * than this preserves the accumulated streak on resume. */
    val meaningfulPause: Duration = 5.minutes,
    /** Remaining-active-time thresholds at which an informational (non-resetting) warning
     * should be surfaced, e.g. "10 minutes left". */
    val warningThresholds: List<Duration> = listOf(10.minutes, 5.minutes, 1.minutes),
) {
    val activeThresholdNanos: Long = activeThreshold.inWholeNanoseconds
    val breakDurationNanos: Long = breakDuration.inWholeNanoseconds
    val meaningfulPauseNanos: Long = meaningfulPause.inWholeNanoseconds

    init {
        require(activeThresholdNanos > 0) { "activeThreshold must be positive" }
        require(breakDurationNanos > 0) { "breakDuration must be positive" }
        require(meaningfulPauseNanos > 0) { "meaningfulPause must be positive" }
        require(warningThresholds.all { it.inWholeNanoseconds > 0 }) { "warningThresholds must be positive" }
    }
}

enum class ScreenTimeMode {
    ACTIVE,
    PAUSED,
    BREAK_SHIELD,
    EMERGENCY_EXCEPTION,
}

/**
 * Fully deterministic engine state. All durations are accumulated in nanoseconds sourced
 * exclusively from [org.pca.app.feature.screentime.clock.MonotonicClock]. Nothing here reads
 * or depends on wall-clock time, so device date/time changes cannot influence enforcement.
 */
data class ScreenTimeState(
    val mode: ScreenTimeMode,
    val activeElapsedNanos: Long,
    val breakElapsedNanos: Long,
    /** How long the current non-qualifying-activity pause has lasted so far. Zero whenever
     * [mode] is not [ScreenTimeMode.PAUSED]. */
    val pauseElapsedNanos: Long,
    val dhikrInteractionCount: Int,
    val completedBreakCount: Int,
    val overriddenBreakCount: Int,
    val lastTickMonotonicNanos: Long,
    val preEmergencyMode: ScreenTimeMode?,
    val preEmergencyActiveElapsedNanos: Long,
    val preEmergencyBreakElapsedNanos: Long,
    val preEmergencyPauseElapsedNanos: Long,
) {
    companion object {
        fun initial(nowNanos: Long): ScreenTimeState = ScreenTimeState(
            mode = ScreenTimeMode.ACTIVE,
            activeElapsedNanos = 0L,
            breakElapsedNanos = 0L,
            pauseElapsedNanos = 0L,
            dhikrInteractionCount = 0,
            completedBreakCount = 0,
            overriddenBreakCount = 0,
            lastTickMonotonicNanos = nowNanos,
            preEmergencyMode = null,
            preEmergencyActiveElapsedNanos = 0L,
            preEmergencyBreakElapsedNanos = 0L,
            preEmergencyPauseElapsedNanos = 0L,
        )
    }
}

/**
 * Note: parent-override requests (skip break / grant extra time) are deliberately *not* part of
 * this event union — they carry authorization metadata and must surface an explicit typed
 * accept/reject result rather than silently no-op, so they go through
 * `ParentOverrideEngine.applySkipBreakRequest` / `ParentOverrideEngine.applyGrantTimeRequest`
 * instead. See `ParentOverride.kt`.
 */
sealed interface ScreenTimeEvent {
    val nowNanos: Long

    data class Tick(override val nowNanos: Long) : ScreenTimeEvent
    data class Pause(override val nowNanos: Long) : ScreenTimeEvent
    data class Resume(override val nowNanos: Long) : ScreenTimeEvent
    data class DhikrInteraction(override val nowNanos: Long) : ScreenTimeEvent
    data class EmergencyExceptionActivate(override val nowNanos: Long) : ScreenTimeEvent
    data class EmergencyExceptionDeactivate(override val nowNanos: Long) : ScreenTimeEvent
}

/**
 * Pure, side-effect-free state machine for the 60-minute continuous-use threshold and the
 * 30-minute protective break (Break Shield). Every transition is a deterministic function of
 * (state, event) — replaying the same event twice is a no-op (duplicate-event safe), and
 * applying events out of monotonic order never decreases accumulated progress (clock-backwards
 * resistant), because progress is driven by clamped deltas against the engine's own
 * [ScreenTimeState.lastTickMonotonicNanos] reference, not by absolute wall time.
 */
object ScreenTimeEngine {

    private const val MAX_CYCLE_SPLITS = 100_000

    fun reduce(state: ScreenTimeState, event: ScreenTimeEvent, config: ScreenTimeConfig = ScreenTimeConfig()): ScreenTimeState {
        val advanced = advance(state, event.nowNanos, config)
        return when (event) {
            is ScreenTimeEvent.Tick -> advanced
            is ScreenTimeEvent.Pause -> applyPause(advanced)
            is ScreenTimeEvent.Resume -> applyResume(advanced)
            is ScreenTimeEvent.DhikrInteraction -> applyDhikrInteraction(advanced)
            is ScreenTimeEvent.EmergencyExceptionActivate -> applyEmergencyActivate(advanced)
            is ScreenTimeEvent.EmergencyExceptionDeactivate -> applyEmergencyDeactivate(advanced)
        }
    }

    /**
     * Advances [state] to [nowNanos], splitting the elapsed delta across as many
     * ACTIVE -> BREAK_SHIELD -> ACTIVE cycles as the delta actually spans (e.g. after a long
     * offline period or process restart). The delta itself is clamped to be non-negative so a
     * monotonic clock reading that appears to regress can never subtract accumulated progress.
     */
    internal fun advance(state: ScreenTimeState, nowNanos: Long, config: ScreenTimeConfig): ScreenTimeState {
        var current = state
        var remaining = (nowNanos - state.lastTickMonotonicNanos).coerceAtLeast(0L)
        var splits = 0

        while (remaining > 0 && splits < MAX_CYCLE_SPLITS) {
            splits++
            current = when (current.mode) {
                ScreenTimeMode.ACTIVE -> {
                    val headroom = config.activeThresholdNanos - current.activeElapsedNanos
                    if (remaining < headroom) {
                        val next = current.copy(activeElapsedNanos = current.activeElapsedNanos + remaining)
                        remaining = 0
                        next
                    } else {
                        remaining -= headroom
                        current.copy(
                            mode = ScreenTimeMode.BREAK_SHIELD,
                            activeElapsedNanos = config.activeThresholdNanos,
                            breakElapsedNanos = 0L,
                            dhikrInteractionCount = 0,
                        )
                    }
                }

                ScreenTimeMode.BREAK_SHIELD -> {
                    val headroom = config.breakDurationNanos - current.breakElapsedNanos
                    if (remaining < headroom) {
                        val next = current.copy(breakElapsedNanos = current.breakElapsedNanos + remaining)
                        remaining = 0
                        next
                    } else {
                        remaining -= headroom
                        current.copy(
                            mode = ScreenTimeMode.ACTIVE,
                            activeElapsedNanos = 0L,
                            breakElapsedNanos = 0L,
                            completedBreakCount = current.completedBreakCount + 1,
                        )
                    }
                }

                // A pause (non-qualifying activity) freezes active-time accumulation but tracks
                // its own duration: once it has lasted >= meaningfulPause, the continuous-use
                // streak is broken and reset to zero. A pause shorter than that preserves the
                // streak so it can resume where it left off. This is driven purely by the
                // monotonic delta, never by wall-clock time.
                ScreenTimeMode.PAUSED -> {
                    val newPauseElapsed = current.pauseElapsedNanos + remaining
                    remaining = 0
                    if (newPauseElapsed >= config.meaningfulPauseNanos) {
                        current.copy(pauseElapsedNanos = newPauseElapsed, activeElapsedNanos = 0L)
                    } else {
                        current.copy(pauseElapsedNanos = newPauseElapsed)
                    }
                }

                // EMERGENCY_EXCEPTION freezes all accumulation; elapsed time is discarded.
                ScreenTimeMode.EMERGENCY_EXCEPTION -> {
                    remaining = 0
                    current
                }
            }
        }

        // The reference point never regresses: a stale/duplicate/out-of-order event (or a
        // monotonic clock glitching backwards, which should never happen but is defended
        // against anyway) must not be able to rewind how much time the engine believes has
        // already been observed.
        val newReference = maxOf(state.lastTickMonotonicNanos, nowNanos)
        return current.copy(lastTickMonotonicNanos = newReference)
    }

    private fun applyPause(state: ScreenTimeState): ScreenTimeState =
        if (state.mode == ScreenTimeMode.ACTIVE) {
            state.copy(mode = ScreenTimeMode.PAUSED, pauseElapsedNanos = 0L)
        } else {
            state
        }

    private fun applyResume(state: ScreenTimeState): ScreenTimeState =
        if (state.mode == ScreenTimeMode.PAUSED) {
            state.copy(mode = ScreenTimeMode.ACTIVE, pauseElapsedNanos = 0L)
        } else {
            state
        }

    private fun applyDhikrInteraction(state: ScreenTimeState): ScreenTimeState =
        if (state.mode == ScreenTimeMode.BREAK_SHIELD) {
            state.copy(dhikrInteractionCount = state.dhikrInteractionCount + 1)
        } else {
            state
        }

    private fun applyEmergencyActivate(state: ScreenTimeState): ScreenTimeState =
        if (state.mode == ScreenTimeMode.EMERGENCY_EXCEPTION) {
            state
        } else {
            state.copy(
                mode = ScreenTimeMode.EMERGENCY_EXCEPTION,
                preEmergencyMode = state.mode,
                preEmergencyActiveElapsedNanos = state.activeElapsedNanos,
                preEmergencyBreakElapsedNanos = state.breakElapsedNanos,
                preEmergencyPauseElapsedNanos = state.pauseElapsedNanos,
            )
        }

    private fun applyEmergencyDeactivate(state: ScreenTimeState): ScreenTimeState =
        if (state.mode == ScreenTimeMode.EMERGENCY_EXCEPTION) {
            state.copy(
                mode = state.preEmergencyMode ?: ScreenTimeMode.ACTIVE,
                activeElapsedNanos = state.preEmergencyActiveElapsedNanos,
                breakElapsedNanos = state.preEmergencyBreakElapsedNanos,
                pauseElapsedNanos = state.preEmergencyPauseElapsedNanos,
                preEmergencyMode = null,
                preEmergencyActiveElapsedNanos = 0L,
                preEmergencyBreakElapsedNanos = 0L,
                preEmergencyPauseElapsedNanos = 0L,
            )
        } else {
            state
        }

    fun remainingActiveNanos(state: ScreenTimeState, config: ScreenTimeConfig = ScreenTimeConfig()): Long =
        (config.activeThresholdNanos - state.activeElapsedNanos).coerceAtLeast(0L)

    fun remainingBreakNanos(state: ScreenTimeState, config: ScreenTimeConfig = ScreenTimeConfig()): Long =
        (config.breakDurationNanos - state.breakElapsedNanos).coerceAtLeast(0L)
}
