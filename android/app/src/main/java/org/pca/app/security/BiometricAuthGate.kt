package org.pca.app.security

/**
 * PCA-ADD-ENR-013: local biometric-authentication gate for sensitive parent
 * (admin) actions on this device -- e.g. disabling protection, viewing
 * sensitive settings, or opening the removal/disable decision flow (see
 * `org.pca.app.feature.removaldecision`). Deliberately mirrors
 * [AdminPinVerifier]'s framing: this grants no family-wide authority, only
 * a local UI gate confirming "the person holding this device right now is
 * the enrolled owner of this device's biometrics," same as an OS lock
 * screen. Never a substitute for [AdminPinVerifier]/FTS-authorized signing.
 *
 * A concrete implementation wraps `androidx.biometric.BiometricPrompt`
 * (the official Jetpack biometric library) -- not a custom biometric
 * matcher; PCA never touches raw biometric sensor data. This interface
 * exists so calling feature code depends on a testable seam rather than
 * constructing `BiometricPrompt` (which requires a `FragmentActivity` and
 * cannot run in a JVM unit test) directly.
 */
interface BiometricAuthGate {
    /** Whether this device currently has usable biometric enrollment (fingerprint/face) AND a device credential (PIN/pattern/password) available as fallback, per `BiometricManager.canAuthenticate`. Callers should offer the PIN fallback (see [AdminPinVerifier]) whenever this is false, never block the sensitive action entirely. */
    fun isAvailable(): Boolean

    /**
     * Requests biometric (or device-credential-fallback) authentication for
     * one sensitive action and reports the outcome via [callback]. Never
     * blocking/suspending -- `BiometricPrompt` is itself callback-based
     * (the OS owns the prompt UI), so this mirrors that shape rather than
     * wrapping it in a coroutine that could be silently cancelled mid-prompt.
     */
    fun authenticate(reason: BiometricAuthReason, callback: BiometricAuthCallback)
}

/** Why authentication is being requested -- surfaced in the system prompt's subtitle so a parent understands what they're about to authorize before completing the biometric check. */
enum class BiometricAuthReason {
    DISABLE_PROTECTION,
    VIEW_SENSITIVE_SETTINGS,
    OPEN_REMOVAL_DECISION,
}

sealed class BiometricAuthResult {
    data object Success : BiometricAuthResult()

    /** User-cancelled, biometric hardware unavailable mid-flow, lockout from too many OS-level failed attempts, etc. -- callers should fall back to PIN entry, never silently grant access. */
    data class Failed(val reason: String) : BiometricAuthResult()

    /** An unrecoverable error reported by the platform (e.g. hardware error) -- same handling as [Failed] from the caller's point of view (fall back to PIN), kept distinct only for logging/diagnostics. */
    data class Error(val errorCode: Int, val message: String) : BiometricAuthResult()
}

fun interface BiometricAuthCallback {
    fun onResult(result: BiometricAuthResult)
}

/**
 * Reference/test-double gate: never claims biometric availability and
 * always reports [BiometricAuthResult.Failed]. Safe default for any
 * composition context that has no real `FragmentActivity` to host a
 * `BiometricPrompt` (unit tests, previews) -- callers MUST fall back to
 * [AdminPinVerifier] whenever [isAvailable] is false, so this never blocks
 * a genuine admin action, it only means the biometric shortcut isn't
 * offered.
 */
class UnavailableBiometricAuthGate : BiometricAuthGate {
    override fun isAvailable(): Boolean = false
    override fun authenticate(reason: BiometricAuthReason, callback: BiometricAuthCallback) {
        callback.onResult(BiometricAuthResult.Failed("Biometric authentication is not available in this context"))
    }
}
