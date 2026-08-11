package org.pca.app.feature.eyedistance.engine

import org.pca.app.platform.proximity.ProximityReading
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * Doc 13 (Eye-Distance / Proximity Protection) required state machine. This is a pure,
 * deterministic, side-effect-free reducer -- identical construction discipline to PCA-3's
 * [org.pca.app.feature.screentime.engine.ScreenTimeEngine]: all durations are monotonic
 * nanoseconds, the reference timestamp ([EyeDistanceState.lastTickMonotonicNanos]) never
 * regresses, and duplicate/out-of-order events are safe by construction. This engine produces
 * ENFORCEMENT STATE ONLY (when a rest is due/active) -- it does not itself implement any
 * blocking/shield UI; that is PCA-3's existing enforcement ladder (see
 * `org.pca.app.feature.breakshield`), which PCA-8 reuses rather than duplicates.
 */
object EyeDistanceEngine {

    fun reduce(state: EyeDistanceState, event: EyeDistanceEvent, config: EyeDistanceConfig = EyeDistanceConfig()): EyeDistanceState =
        when (event) {
            is EyeDistanceEvent.ExceptionActivate -> applyExceptionActivate(state, event.nowNanos, config)
            is EyeDistanceEvent.ExceptionDeactivate -> applyExceptionDeactivate(state, event.nowNanos)
            is EyeDistanceEvent.Observation -> applyObservation(state, event, config)
        }

    private fun applyExceptionActivate(state: EyeDistanceState, now: Long, config: EyeDistanceConfig): EyeDistanceState {
        if (state.exceptionActive) return state.copy(lastTickMonotonicNanos = maxOf(state.lastTickMonotonicNanos, now))
        // Any REST_ACTIVE progress between the last observation and this activation is real
        // elapsed time and must be credited before freezing -- otherwise it would be silently
        // lost rather than either fabricated or (correctly) frozen going forward.
        val deltaNanos = (now - state.lastTickMonotonicNanos).coerceAtLeast(0L)
        val newLastTick = maxOf(state.lastTickMonotonicNanos, now)
        val advanced = if (state.phase == EyeDistancePhase.REST_ACTIVE) {
            applyRestTick(state, deltaNanos, newLastTick, config)
        } else {
            state.copy(lastTickMonotonicNanos = newLastTick)
        }
        return advanced.copy(
            exceptionActive = true,
            preExceptionPhase = advanced.phase,
        )
    }

    private fun applyExceptionDeactivate(state: EyeDistanceState, now: Long): EyeDistanceState {
        val newLastTick = maxOf(state.lastTickMonotonicNanos, now)
        if (!state.exceptionActive) return state.copy(lastTickMonotonicNanos = newLastTick)
        return state.copy(
            exceptionActive = false,
            preExceptionPhase = null,
            lastTickMonotonicNanos = newLastTick,
        )
    }

    private fun applyObservation(state: EyeDistanceState, event: EyeDistanceEvent.Observation, config: EyeDistanceConfig): EyeDistanceState {
        val now = event.nowNanos
        val newLastTick = maxOf(state.lastTickMonotonicNanos, now)
        val deltaNanos = (now - state.lastTickMonotonicNanos).coerceAtLeast(0L)

        // Doc 13 / task Section 2: an active call/video-call/accessibility/emergency exception
        // freezes ALL accumulation uniformly, exactly like ScreenTimeEngine's EMERGENCY_EXCEPTION
        // mode -- this covers a REST_ACTIVE countdown too (it simply waits out the exception
        // rather than either fabricating extra rest credit or losing/skipping the rest).
        if (state.exceptionActive) return state.copy(lastTickMonotonicNanos = newLastTick)

        return when (state.phase) {
            EyeDistancePhase.REST_DUE ->
                // A rest that has been triggered begins on the very next observation,
                // unconditionally -- REST_DUE is a one-tick announcement phase.
                state.copy(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 0L, lastTickMonotonicNanos = newLastTick)

            EyeDistancePhase.REST_ACTIVE ->
                applyRestTick(state, deltaNanos, newLastTick, config)

            EyeDistancePhase.RECOVERY ->
                // A completed rest fully clears prior near-evidence for a clean slate.
                state.copy(
                    phase = EyeDistancePhase.MONITORING,
                    nearElapsedNanos = 0L,
                    farElapsedNanos = 0L,
                    unknownElapsedNanos = 0L,
                    warningEpisodeTimestampsNanos = emptyList(),
                    preSuspendPhase = null,
                    lastTickMonotonicNanos = newLastTick,
                )

            EyeDistancePhase.UNAVAILABLE, EyeDistancePhase.SUSPENDED, EyeDistancePhase.MONITORING,
            EyeDistancePhase.SUSPECTED_NEAR, EyeDistancePhase.WARNING ->
                if (!event.sourceAvailable) {
                    applySourceUnavailable(state, newLastTick)
                } else {
                    applyEvidence(state, event.reading, deltaNanos, newLastTick, config)
                }
        }
    }

    /** Doc 13 / task Section 2: "source unavailable -> suspend/degrade." [EyeDistancePhase.UNAVAILABLE]
     * is the structural/cold-start absence of any usable source; [EyeDistancePhase.SUSPENDED] is a
     * transient drop-out from an active evidence-gathering flow, remembering where monitoring was
     * so a caller can observe "we were mid-flow" -- but see [applyEvidence]: resuming from either
     * always restarts evidence accrual from zero, never carrying speculative pre-outage progress
     * into a post-outage judgment ("do not punish" / false-positive resistance). */
    private fun applySourceUnavailable(state: EyeDistanceState, newLastTick: Long): EyeDistanceState =
        when (state.phase) {
            EyeDistancePhase.UNAVAILABLE, EyeDistancePhase.SUSPENDED ->
                state.copy(lastTickMonotonicNanos = newLastTick)
            else ->
                state.copy(
                    phase = EyeDistancePhase.SUSPENDED,
                    preSuspendPhase = state.phase,
                    lastTickMonotonicNanos = newLastTick,
                )
        }

    private fun applyEvidence(
        state: EyeDistanceState,
        reading: ProximityReading,
        deltaNanos: Long,
        newLastTick: Long,
        config: EyeDistanceConfig,
    ): EyeDistanceState {
        // Resuming from SUSPENDED/UNAVAILABLE always restarts cleanly at MONITORING with zeroed
        // counters -- never at the pre-outage phase. Restoring into e.g. WARNING with reset
        // counters would leave an inconsistent state (a phase that implies sustained near
        // evidence the counters no longer back), and speculatively carrying pre-outage progress
        // across a source gap would risk punishing the child for evidence that was never
        // actually continuous. [EyeDistanceState.preSuspendPhase] remains purely informational.
        val (logicalPhase, near0, far0, unknown0) = when (state.phase) {
            EyeDistancePhase.SUSPENDED, EyeDistancePhase.UNAVAILABLE -> Baseline(EyeDistancePhase.MONITORING, 0L, 0L, 0L)
            else -> Baseline(state.phase, state.nearElapsedNanos, state.farElapsedNanos, state.unknownElapsedNanos)
        }

        return when (reading) {
            ProximityReading.NEAR -> applyNear(state, logicalPhase, near0, deltaNanos, newLastTick, config)
            ProximityReading.FAR -> applyFar(state, logicalPhase, near0, far0, deltaNanos, newLastTick, config)
            ProximityReading.UNKNOWN -> applyUnknown(state, logicalPhase, near0, far0, unknown0, deltaNanos, newLastTick, config)
        }
    }

    private fun applyNear(
        state: EyeDistanceState,
        logicalPhase: EyeDistancePhase,
        near0: Long,
        deltaNanos: Long,
        newLastTick: Long,
        config: EyeDistanceConfig,
    ): EyeDistanceState {
        val newNear = near0 + deltaNanos
        val sustained = newNear >= config.nearSustainedNanos
        val enteringWarning = sustained && logicalPhase != EyeDistancePhase.WARNING

        var episodes = state.warningEpisodeTimestampsNanos
        if (enteringWarning) {
            episodes = (episodes + newLastTick).filter { newLastTick - it <= config.persistentNearWindowNanos }
        }
        val persistentNear = sustained && episodes.size >= config.persistentNearEpisodesForRest

        return if (persistentNear) {
            state.copy(
                phase = EyeDistancePhase.REST_DUE,
                nearElapsedNanos = newNear,
                farElapsedNanos = 0L,
                unknownElapsedNanos = 0L,
                warningEpisodeTimestampsNanos = emptyList(),
                preSuspendPhase = null,
                lastTickMonotonicNanos = newLastTick,
            )
        } else {
            state.copy(
                phase = if (sustained) EyeDistancePhase.WARNING else EyeDistancePhase.SUSPECTED_NEAR,
                nearElapsedNanos = newNear,
                farElapsedNanos = 0L,
                unknownElapsedNanos = 0L,
                warningEpisodeTimestampsNanos = episodes,
                preSuspendPhase = null,
                lastTickMonotonicNanos = newLastTick,
            )
        }
    }

    private fun applyFar(
        state: EyeDistanceState,
        logicalPhase: EyeDistancePhase,
        near0: Long,
        far0: Long,
        deltaNanos: Long,
        newLastTick: Long,
        config: EyeDistanceConfig,
    ): EyeDistanceState {
        val newFar = far0 + deltaNanos
        val recovers = (logicalPhase == EyeDistancePhase.SUSPECTED_NEAR || logicalPhase == EyeDistancePhase.WARNING) &&
            newFar >= config.recoveryFarNanos

        return if (recovers) {
            state.copy(
                phase = EyeDistancePhase.MONITORING,
                nearElapsedNanos = 0L,
                farElapsedNanos = 0L,
                unknownElapsedNanos = 0L,
                preSuspendPhase = null,
                lastTickMonotonicNanos = newLastTick,
            )
        } else {
            state.copy(
                phase = logicalPhase,
                nearElapsedNanos = if (logicalPhase == EyeDistancePhase.MONITORING) 0L else near0,
                farElapsedNanos = newFar,
                unknownElapsedNanos = 0L,
                preSuspendPhase = null,
                lastTickMonotonicNanos = newLastTick,
            )
        }
    }

    private fun applyUnknown(
        state: EyeDistanceState,
        logicalPhase: EyeDistancePhase,
        near0: Long,
        far0: Long,
        unknown0: Long,
        deltaNanos: Long,
        newLastTick: Long,
        config: EyeDistanceConfig,
    ): EyeDistanceState {
        val newUnknown = unknown0 + deltaNanos
        // Doc 13 / task Section 4: "unknown/insufficient confidence -> do not punish." A brief
        // UNKNOWN blip neither advances nor resets an in-progress near streak; it is only once
        // UNKNOWN itself becomes sustained (the source has genuinely lost the ability to judge)
        // that monitoring degrades to SUSPENDED, and even then no near-evidence is discarded --
        // it is simply not usable right now, matching applyEvidence's SUSPENDED-resume contract.
        return if (newUnknown >= config.unknownGraceNanos && logicalPhase != EyeDistancePhase.MONITORING) {
            state.copy(
                phase = EyeDistancePhase.SUSPENDED,
                preSuspendPhase = logicalPhase,
                lastTickMonotonicNanos = newLastTick,
            )
        } else {
            state.copy(
                phase = logicalPhase,
                nearElapsedNanos = near0,
                farElapsedNanos = far0,
                unknownElapsedNanos = newUnknown,
                preSuspendPhase = null,
                lastTickMonotonicNanos = newLastTick,
            )
        }
    }

    private fun applyRestTick(state: EyeDistanceState, deltaNanos: Long, newLastTick: Long, config: EyeDistanceConfig): EyeDistanceState {
        val newRest = state.restElapsedNanos + deltaNanos
        return if (newRest >= config.restDurationNanos) {
            state.copy(phase = EyeDistancePhase.RECOVERY, restElapsedNanos = 0L, lastTickMonotonicNanos = newLastTick)
        } else {
            state.copy(restElapsedNanos = newRest, lastTickMonotonicNanos = newLastTick)
        }
    }

    fun remainingRestNanos(state: EyeDistanceState, config: EyeDistanceConfig = EyeDistanceConfig()): Long =
        (config.restDurationNanos - state.restElapsedNanos).coerceAtLeast(0L)

    private data class Baseline(val phase: EyeDistancePhase, val near: Long, val far: Long, val unknown: Long)
}

enum class EyeDistancePhase {
    UNAVAILABLE,
    MONITORING,
    SUSPECTED_NEAR,
    WARNING,
    REST_DUE,
    REST_ACTIVE,
    SUSPENDED,
    RECOVERY,
}

/**
 * Product-safe defaults per doc 13: near evidence sustained ~5-10s before a warning, persistent
 * (repeated) near triggers a ~60s rest. Final tuned values remain config/release-validated, not
 * hardcoded product policy -- identical philosophy to [org.pca.app.feature.screentime.engine.ScreenTimeConfig].
 */
data class EyeDistanceConfig(
    val nearSustainedThreshold: Duration = 7.seconds,
    val restDuration: Duration = 60.seconds,
    val persistentNearEpisodesForRest: Int = 3,
    val persistentNearWindow: Duration = 10.minutes,
    val recoveryFarThreshold: Duration = 3.seconds,
    val unknownGraceBeforeSuspend: Duration = 5.seconds,
) {
    init {
        require(nearSustainedThreshold.inWholeNanoseconds in 5.seconds.inWholeNanoseconds..10.seconds.inWholeNanoseconds) {
            "nearSustainedThreshold must stay within doc 13's product-safe 5-10s range"
        }
        require(restDuration.isPositive()) { "restDuration must be positive" }
        require(persistentNearEpisodesForRest > 0) { "persistentNearEpisodesForRest must be positive" }
        require(persistentNearWindow.isPositive()) { "persistentNearWindow must be positive" }
        require(recoveryFarThreshold.isPositive()) { "recoveryFarThreshold must be positive" }
        require(unknownGraceBeforeSuspend.isPositive()) { "unknownGraceBeforeSuspend must be positive" }
    }

    val nearSustainedNanos: Long get() = nearSustainedThreshold.inWholeNanoseconds
    val restDurationNanos: Long get() = restDuration.inWholeNanoseconds
    val persistentNearWindowNanos: Long get() = persistentNearWindow.inWholeNanoseconds
    val recoveryFarNanos: Long get() = recoveryFarThreshold.inWholeNanoseconds
    val unknownGraceNanos: Long get() = unknownGraceBeforeSuspend.inWholeNanoseconds
}

data class EyeDistanceState(
    val phase: EyeDistancePhase = EyeDistancePhase.UNAVAILABLE,
    val nearElapsedNanos: Long = 0L,
    val farElapsedNanos: Long = 0L,
    val unknownElapsedNanos: Long = 0L,
    val restElapsedNanos: Long = 0L,
    /** Monotonic timestamps of each WARNING-entry within the current rolling window --
     * "persistent/repeated near" bookkeeping. Never persisted with finer detail than this. */
    val warningEpisodeTimestampsNanos: List<Long> = emptyList(),
    val lastTickMonotonicNanos: Long = 0L,
    val preSuspendPhase: EyeDistancePhase? = null,
    val exceptionActive: Boolean = false,
    val preExceptionPhase: EyeDistancePhase? = null,
)

sealed interface EyeDistanceEvent {
    val nowNanos: Long

    /** A single classified proximity reading, or a source-unavailable signal
     * ([sourceAvailable] false; [reading] is expected to be [ProximityReading.UNKNOWN] in that
     * case, since an unavailable source has nothing to report). */
    data class Observation(
        override val nowNanos: Long,
        val reading: ProximityReading,
        val sourceAvailable: Boolean,
    ) : EyeDistanceEvent

    /** Emergency calling, an active ordinary/video call, or an approved accessibility exception
     * -- the engine treats all three identically (freeze, never punish, never discard progress);
     * distinguishing WHICH exception is active is the caller's concern, not the engine's. */
    data class ExceptionActivate(override val nowNanos: Long) : EyeDistanceEvent
    data class ExceptionDeactivate(override val nowNanos: Long) : EyeDistanceEvent
}
