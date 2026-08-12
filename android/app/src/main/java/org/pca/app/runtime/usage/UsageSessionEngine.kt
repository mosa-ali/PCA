package org.pca.app.runtime.usage

import org.pca.app.platform.UsageEventType

/**
 * One in-progress app-usage interval, tracked on the MONOTONIC (elapsed-realtime) timeline for
 * ordering/idempotency, plus the WALL-CLOCK (epoch) timeline [org.pca.app.persistence.repository.UsageSessionRepository]
 * actually persists (doc 10 Section 4.1 stores `startedAtEpochMillis`/`endedAtEpochMillis`).
 * [appToken] is already opaque (SHA-256, never a raw package name) by the time it reaches this
 * engine -- see [UsageSessionRecorder].
 */
data class OpenUsageSession(
    val appToken: String,
    val startedAtElapsedMillis: Long,
    val startedAtEpochMillis: Long,
)

/** A closed session, ready to hand to [org.pca.app.persistence.repository.UsageSessionRepository.record]. */
data class CompletedUsageSession(
    val appToken: String,
    val startedAtElapsedMillis: Long,
    val endedAtElapsedMillis: Long,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
) {
    val durationMillis: Long get() = (endedAtEpochMillis - startedAtEpochMillis).coerceAtLeast(0L)
}

/**
 * One already-tokenized, already-timestamped platform usage event. [elapsedRealtimeMillis] is the
 * real value [org.pca.app.platform.UsageObservationSource] reported (never fabricated);
 * [epochMillis] is the wall-clock projection of that same instant, computed once per poll using a
 * single elapsed/wall-clock bridge sample (same technique
 * [org.pca.app.platform.StandardUsageObservationSource] itself uses internally) so every event in
 * one batch is bridged consistently.
 */
data class TimestampedUsageEvent(
    val appToken: String,
    val eventType: UsageEventType,
    val elapsedRealtimeMillis: Long,
    val epochMillis: Long,
)

/**
 * Durable-across-restart engine state: the currently-open session (if any) plus the monotonic
 * cursor of the last event this engine has already applied. [lastProcessedElapsedMillis] is what
 * makes duplicate/out-of-order re-delivery of the same event a safe no-op (see [UsageSessionEngine.apply]).
 */
data class UsageSessionEngineState(
    val openSession: OpenUsageSession?,
    val lastProcessedElapsedMillis: Long,
) {
    companion object {
        /** [UNSET_CURSOR] (never a real elapsed-realtime value, which is always >= 0) so the
         * very first poll's events -- which may legitimately sit at elapsed millis 0 -- are never
         * mistaken for already-processed history. See [UsageSessionEngine.apply]'s strict `>`
         * filter, which relies on this sentinel rather than 0 to avoid an off-by-one on the first
         * call. */
        const val UNSET_CURSOR = -1L
        val INITIAL = UsageSessionEngineState(openSession = null, lastProcessedElapsedMillis = UNSET_CURSOR)
    }
}

data class UsageSessionEngineResult(
    val state: UsageSessionEngineState,
    val completedSessions: List<CompletedUsageSession>,
)

/**
 * Pure, side-effect-free session-boundary reducer over real platform-reported FOREGROUND/
 * BACKGROUND events -- never fabricates a transition the platform did not report (mirrors
 * [org.pca.app.feature.screentime.engine.ScreenTimeEngine]'s own discipline: deterministic
 * function of (state, events), safe to replay).
 *
 * Duplicate-safe: any event at or before [UsageSessionEngineState.lastProcessedElapsedMillis] is
 * ignored (strictly -- an event exactly AT the cursor was already the one that advanced it, so it
 * is excluded too), so re-delivering the same platform event (a duplicate producer tick, or a
 * query window that overlaps a previous one) never reopens or re-closes a session that was
 * already processed.
 * Out-of-order-safe: the batch is sorted by [TimestampedUsageEvent.elapsedRealtimeMillis] before
 * being applied, and the cursor only ever advances (`maxOf`), never regresses.
 *
 * Deliberately independent of [org.pca.app.feature.screentime.engine.ScreenTimeEngine] -- this
 * engine tracks WHICH app is in the foreground; it has no concept of, and never touches, the
 * 60-minute continuous-use debt or the Break Shield state machine. An app switch is invisible to
 * that engine by construction: nothing in this file calls into it, and
 * [org.pca.app.feature.screentime.engine.ScreenTimeEngine] exposes no API this file could even
 * call to reset it. See `AppSwitchScreenTimeDebtIndependenceTest` for the runnable proof.
 */
object UsageSessionEngine {

    fun apply(state: UsageSessionEngineState, rawEvents: List<TimestampedUsageEvent>): UsageSessionEngineResult {
        val ordered = rawEvents
            .filter { it.elapsedRealtimeMillis > state.lastProcessedElapsedMillis }
            .sortedBy { it.elapsedRealtimeMillis }

        var current = state
        val completed = mutableListOf<CompletedUsageSession>()

        for (event in ordered) {
            when (event.eventType) {
                UsageEventType.FOREGROUND -> {
                    val open = current.openSession
                    when {
                        open == null ->
                            current = current.copy(
                                openSession = OpenUsageSession(event.appToken, event.elapsedRealtimeMillis, event.epochMillis),
                            )
                        // A FOREGROUND for a DIFFERENT app while one is already open closes the
                        // previous session (the platform did not report an explicit BACKGROUND for
                        // it -- e.g. the app was killed rather than backgrounded -- but a fresh
                        // FOREGROUND is itself proof it is no longer frontmost) and opens the new one.
                        open.appToken != event.appToken -> {
                            completed += open.close(event.elapsedRealtimeMillis, event.epochMillis)
                            current = current.copy(
                                openSession = OpenUsageSession(event.appToken, event.elapsedRealtimeMillis, event.epochMillis),
                            )
                        }
                        // open.appToken == event.appToken: duplicate/replayed FOREGROUND -- no-op.
                        else -> Unit
                    }
                }

                UsageEventType.BACKGROUND -> {
                    val open = current.openSession
                    if (open != null && open.appToken == event.appToken) {
                        completed += open.close(event.elapsedRealtimeMillis, event.epochMillis)
                        current = current.copy(openSession = null)
                    }
                    // else: BACKGROUND for an app that is not the tracked open session (duplicate,
                    // or an app this engine never observed entering the foreground) -- nothing to
                    // close, ignored rather than guessed at.
                }
            }
            current = current.copy(
                lastProcessedElapsedMillis = maxOf(current.lastProcessedElapsedMillis, event.elapsedRealtimeMillis),
            )
        }

        return UsageSessionEngineResult(current, completed)
    }

    private fun OpenUsageSession.close(endedAtElapsedMillis: Long, endedAtEpochMillis: Long) = CompletedUsageSession(
        appToken = appToken,
        startedAtElapsedMillis = startedAtElapsedMillis,
        endedAtElapsedMillis = endedAtElapsedMillis,
        startedAtEpochMillis = startedAtEpochMillis,
        endedAtEpochMillis = endedAtEpochMillis,
    )
}
