package org.pca.app.platform

/**
 * A raw platform observation ready for PCA-4 consumption -- one
 * foreground session per package, paired from raw [UsageEvent]s. This is
 * data TRANSLATION, not policy: it says nothing about whether a session
 * "counts" toward any screen-time rule.
 */
data class RawUsageObservation(
    val packageName: String,
    val startElapsedRealtimeMillis: Long,
    /**
     * Null if this session has not been closed by a matching BACKGROUND
     * event within the queried window (e.g. the app is still in the
     * foreground as of the query, or the closing event fell outside the
     * window). Never guessed/estimated -- a caller must treat a null end
     * as "ongoing or unknown," never assume a duration from it.
     */
    val endElapsedRealtimeMillis: Long?,
)

/**
 * Deterministically pairs raw FOREGROUND/BACKGROUND [UsageEvent]s into
 * session spans, per package, in event order. Platform DATA TRANSLATION
 * only -- decides nothing about whether a session counts toward any
 * policy; it only interprets the raw OS event stream's own start/stop
 * semantics.
 *
 * Pairing rule, applied in the order [events] is given (already
 * chronological per `UsageStatsManager`'s own contract -- this function
 * does not itself sort):
 *  - A FOREGROUND event opens a session for that package if none is
 *    currently open.
 *  - A FOREGROUND event while a session is ALREADY open for that package
 *    (duplicate/out-of-order platform data) is a no-op for pairing
 *    purposes -- the existing open session's start time is preserved,
 *    never overwritten by a later, spurious FOREGROUND event.
 *  - A BACKGROUND event closes the currently-open session for that
 *    package, if any.
 *  - A BACKGROUND event with NO open session for that package (e.g. the
 *    query window started mid-session, so the opening FOREGROUND event
 *    fell outside it) is DROPPED, never fabricated into a session with a
 *    guessed start time -- doc 06's "events are NOT assumed gapless"
 *    applies here too: incomplete evidence must never be upgraded into a
 *    confident observation.
 *  - Any session still open once every event has been processed is
 *    reported with `endElapsedRealtimeMillis = null` -- genuinely
 *    ongoing or unknown, never guessed at.
 */
object UsageEventSessionPairer {
    fun pairSessions(events: List<UsageEvent>): List<RawUsageObservation> {
        val openSessions = LinkedHashMap<String, Long>() // packageName -> startElapsedRealtimeMillis, insertion order preserved for deterministic output
        val completed = mutableListOf<RawUsageObservation>()

        for (event in events) {
            when (event.eventType) {
                UsageEventType.FOREGROUND -> {
                    openSessions.putIfAbsent(event.packageName, event.elapsedRealtimeMillis)
                }
                UsageEventType.BACKGROUND -> {
                    val start = openSessions.remove(event.packageName)
                    if (start != null) {
                        completed.add(RawUsageObservation(event.packageName, start, event.elapsedRealtimeMillis))
                    }
                    // else: BACKGROUND with no matching open session -- dropped, never fabricated.
                }
            }
        }

        for ((packageName, start) in openSessions) {
            completed.add(RawUsageObservation(packageName, start, null))
        }
        return completed
    }
}
