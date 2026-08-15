package org.pca.app.security

import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.PersistentStateStore

/**
 * PCA-ADD-ENR-014: rate-limiting/progressive-delay half of the local Admin PIN
 * gate. This is ordinary throttling bookkeeping -- counting failures and
 * computing a monotonic-clock-based lockout window -- not a cryptographic
 * primitive, so it carries none of the CRYPTO_SUITE gate's constraints
 * (doc 09 PCA-SEC-016 is about custom signature/encryption constructions,
 * not failed-attempt counters). Uses [MonotonicTimeSource], never wall-clock
 * time, so an on-device clock rollback cannot be used to skip the lockout
 * (same anti-clock-rollback posture as the rest of doc 06 Section 5).
 *
 * Progressive delay schedule (attempt count -> lockout duration once that
 * many consecutive failures have accumulated): a deliberately gentle then
 * steep curve so a genuine parent who mistypes once or twice is barely
 * inconvenienced, while a sustained guessing attempt is throttled hard.
 * Callers MUST consult [isLockedOut]/[remainingLockoutMillis] before
 * invoking [AdminPinVerifier.verify] with a user-entered candidate --
 * this class does not call the verifier itself, it only tracks outcomes
 * the caller reports via [recordFailure]/[recordSuccess].
 */
class PinAttemptThrottle(
    private val timeSource: MonotonicTimeSource,
    private val stateStore: PinThrottleStateStore,
) {
    companion object {
        /**
         * Consecutive-failure-count -> lockout duration in milliseconds, once
         * that many consecutive failures have been recorded. The first two
         * failures are free (no lockout) so a genuine typo doesn't lock a
         * parent out; from the 3rd failure on, delay grows geometrically.
         */
        private val LOCKOUT_SCHEDULE_MILLIS: List<Long> = listOf(
            0L, // 1st failure
            0L, // 2nd failure
            5_000L, // 3rd failure -- 5s
            15_000L, // 4th failure -- 15s
            30_000L, // 5th failure -- 30s
            60_000L, // 6th failure -- 1m
            300_000L, // 7th failure -- 5m
            900_000L, // 8th failure -- 15m
        )

        /** Beyond the schedule's last entry, every further consecutive failure repeats the max. */
        private val MAX_LOCKOUT_MILLIS = LOCKOUT_SCHEDULE_MILLIS.last()
    }

    /** True if a candidate-PIN check is currently blocked by an active lockout window. */
    fun isLockedOut(): Boolean = remainingLockoutMillis() > 0L

    /** Milliseconds remaining until the current lockout (if any) clears. Zero/negative means not locked out. */
    fun remainingLockoutMillis(): Long {
        val state = stateStore.load() ?: return 0L
        if (state.consecutiveFailures == 0) return 0L
        val lockoutDuration = lockoutDurationForFailureCount(state.consecutiveFailures)
        if (lockoutDuration == 0L) return 0L
        val elapsedSinceLastFailure = timeSource.elapsedRealtimeMillis() - state.lastFailureElapsedRealtimeMillis
        val remaining = lockoutDuration - elapsedSinceLastFailure
        return if (remaining > 0L) remaining else 0L
    }

    /** Consecutive failures recorded so far (reset to 0 by [recordSuccess]). */
    fun consecutiveFailures(): Int = stateStore.load()?.consecutiveFailures ?: 0

    /**
     * Records a failed verification attempt. Callers must call this even
     * while locked out is not expected (defense in depth) -- but the normal
     * flow is: check [isLockedOut] first, refuse to even attempt
     * verification while locked out, and only call this after an actual
     * verification failure.
     */
    fun recordFailure() {
        val previous = stateStore.load()
        val nextCount = (previous?.consecutiveFailures ?: 0) + 1
        stateStore.save(
            PinThrottleState(
                consecutiveFailures = nextCount,
                lastFailureElapsedRealtimeMillis = timeSource.elapsedRealtimeMillis(),
            ),
        )
    }

    /** Records a successful verification, clearing the failure streak and any active lockout. */
    fun recordSuccess() {
        stateStore.clear()
    }

    private fun lockoutDurationForFailureCount(count: Int): Long {
        val index = count - 1
        return if (index < LOCKOUT_SCHEDULE_MILLIS.size) LOCKOUT_SCHEDULE_MILLIS[index] else MAX_LOCKOUT_MILLIS
    }
}

/** Persisted throttle bookkeeping -- deliberately holds no PIN material, only counters/timestamps. */
data class PinThrottleState(
    val consecutiveFailures: Int,
    val lastFailureElapsedRealtimeMillis: Long,
)

/** Durable store for [PinThrottleState], separate from [PersistentStateStore] plumbing so tests can substitute an in-memory fake without pulling in Android storage. */
interface PinThrottleStateStore {
    fun load(): PinThrottleState?
    fun save(state: PinThrottleState)
    fun clear()
}

/** JVM-process-lifetime fake -- for tests only; a real device build must use [PersistentPinThrottleStateStore] so a killed/restarted app cannot be used to bypass the lockout window. */
class InMemoryPinThrottleStateStore : PinThrottleStateStore {
    private var state: PinThrottleState? = null
    override fun load(): PinThrottleState? = state
    override fun save(state: PinThrottleState) { this.state = state }
    override fun clear() { state = null }
}

/**
 * Production store: persists the failure counter/timestamp through
 * [PersistentStateStore] (backed by EncryptedSharedPreferences in the real
 * app graph, doc 09 Section 7's OS-backed key protection) so restarting the
 * process or rebooting the device does not reset the lockout window --
 * otherwise an attacker could force-stop the app to bypass throttling.
 * Known, accepted limitation: [MonotonicTimeSource.elapsedRealtimeMillis]
 * is boot-relative, so a full device reboot (not just an app restart) also
 * clears any in-progress lockout window. This is the same tradeoff
 * [org.pca.app.foundation.MonotonicTimeSource]'s own doc comment accepts
 * elsewhere: wall-clock time would let an attacker skip the lockout by
 * simply changing the device clock backward, which is strictly easier than
 * rebooting, so boot-relative time remains the safer default.
 */
class PersistentPinThrottleStateStore(
    private val stateStore: PersistentStateStore,
    private val key: String = "admin_pin_throttle_state",
) : PinThrottleStateStore {
    override fun load(): PinThrottleState? {
        val raw = stateStore.getString(key) ?: return null
        val parts = raw.split(":")
        if (parts.size != 2) return null
        val count = parts[0].toIntOrNull() ?: return null
        val lastFailure = parts[1].toLongOrNull() ?: return null
        return PinThrottleState(consecutiveFailures = count, lastFailureElapsedRealtimeMillis = lastFailure)
    }

    override fun save(state: PinThrottleState) {
        stateStore.putString(key, "${state.consecutiveFailures}:${state.lastFailureElapsedRealtimeMillis}")
    }

    override fun clear() {
        stateStore.remove(key)
    }
}
