package org.pca.app.security

/**
 * PCA-ADD-ENR-014: decorates a real [AdminPinVerifier] (e.g.
 * [Pbkdf2AdminPinVerifier]) with [PinAttemptThrottle]'s rate-limiting and
 * progressive delay, without either concern needing to know about the
 * other. This is the class production code and UI should actually depend
 * on -- calling [Pbkdf2AdminPinVerifier] directly would skip throttling
 * entirely.
 *
 * While locked out, [verify] returns `false` WITHOUT invoking the inner
 * verifier at all and WITHOUT recording an additional failure -- so a
 * scripted rapid-retry attempt cannot extend its own lockout window by
 * hammering the gate, and the inner (comparatively expensive, PBKDF2)
 * verify path is never even reached during an active lockout.
 */
class ThrottledAdminPinVerifier(
    private val delegate: AdminPinVerifier,
    private val throttle: PinAttemptThrottle,
) : AdminPinVerifier {
    override fun isPinSet(): Boolean = delegate.isPinSet()

    /** True if a candidate PIN would currently be refused purely due to an active lockout, independent of whether the candidate is correct. UI should surface this (with [remainingLockoutMillis]) instead of a generic "wrong PIN" message. */
    fun isLockedOut(): Boolean = throttle.isLockedOut()

    /** Milliseconds until the current lockout clears; zero if not locked out. */
    fun remainingLockoutMillis(): Long = throttle.remainingLockoutMillis()

    override fun verify(candidatePin: CharArray): Boolean {
        if (throttle.isLockedOut()) {
            candidatePin.fill(' ')
            return false
        }
        val ok = delegate.verify(candidatePin)
        if (ok) {
            throttle.recordSuccess()
        } else {
            throttle.recordFailure()
        }
        return ok
    }

    override fun setPin(newPin: CharArray) {
        delegate.setPin(newPin)
        // A fresh PIN set (initial setup or a parent-authorized change) must not inherit a
        // stale failure streak from before -- otherwise a parent who just set a brand-new PIN
        // could find themselves immediately locked out from an unrelated earlier lockout window.
        throttle.recordSuccess()
    }

    override fun clearPin() {
        delegate.clearPin()
        throttle.recordSuccess()
    }
}
