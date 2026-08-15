package org.pca.app.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * PCA-ADD-ENR-013: real `androidx.biometric.BiometricPrompt` integration --
 * the official Jetpack biometric library, never a custom biometric matcher
 * or raw sensor access. Requires a [FragmentActivity] (a
 * `BiometricPrompt` constructor requirement of the library itself, not a
 * choice made here) -- see this class's own construction site for which
 * host Activity supplies it.
 *
 * `BIOMETRIC_WEAK or DEVICE_CREDENTIAL` authenticator combination: allows
 * fingerprint/face (class 2/weak-or-stronger) OR the device's own
 * PIN/pattern/password as a fallback, matching the framing in
 * [BiometricAuthGate]'s doc comment ("same as an OS lock screen"). Not
 * `BIOMETRIC_STRONG`-only, so a device with only weak biometric hardware
 * (or none, credential-only) is still not needlessly excluded from ever
 * offering the shortcut -- [AdminPinVerifier] remains the guaranteed
 * fallback regardless.
 */
class RealBiometricAuthGate(
    private val activity: FragmentActivity,
) : BiometricAuthGate {
    private val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL

    override fun isAvailable(): Boolean {
        val manager = BiometricManager.from(activity)
        return manager.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    override fun authenticate(reason: BiometricAuthReason, callback: BiometricAuthCallback) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    callback.onResult(BiometricAuthResult.Success)
                }

                override fun onAuthenticationFailed() {
                    // A single non-matching attempt (e.g. wrong finger) -- the prompt itself stays
                    // open for a retry, so this is NOT terminal; only surface a definitive Failed
                    // once the OS calls onAuthenticationError (user cancel, lockout, etc.) below.
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    callback.onResult(BiometricAuthResult.Error(errorCode, errString.toString()))
                }
            },
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(promptTitleFor(reason))
            .setAllowedAuthenticators(authenticators)
            .build()

        prompt.authenticate(promptInfo)
    }

    private fun promptTitleFor(reason: BiometricAuthReason): String = when (reason) {
        BiometricAuthReason.DISABLE_PROTECTION -> "Confirm it's you to disable protection"
        BiometricAuthReason.VIEW_SENSITIVE_SETTINGS -> "Confirm it's you to view sensitive settings"
        BiometricAuthReason.OPEN_REMOVAL_DECISION -> "Confirm it's you to manage device protection"
    }
}
