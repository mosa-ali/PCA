package org.pca.app.security.ui

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.pca.app.PcaApplication
import org.pca.app.feature.removaldecision.PersistentRemovalDecisionRepository
import org.pca.app.feature.removaldecision.RemovalDecisionAuditRecorder
import org.pca.app.feature.removaldecision.RemovalDecisionCoordinator
import org.pca.app.feature.removaldecision.RemovalDecisionOutcome
import org.pca.app.feature.removaldecision.RemovalDecisionRecord
import org.pca.app.feature.removaldecision.RemovalDecisionStateMachine
import org.pca.app.feature.removaldecision.ui.RemovalDecisionScreen
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore
import org.pca.app.foundation.SystemMonotonicTimeSource
import org.pca.app.foundation.SystemWallClockTimeSource
import org.pca.app.persistence.PcaLocalPersistence
import org.pca.app.runtime.identity.DeviceIdentityState
import org.pca.app.security.BiometricAuthReason
import org.pca.app.security.BiometricAuthResult
import org.pca.app.security.Pbkdf2AdminPinVerifier
import org.pca.app.security.PersistentPinThrottleStateStore
import org.pca.app.security.PinAttemptThrottle
import org.pca.app.security.RealBiometricAuthGate
import org.pca.app.security.ThrottledAdminPinVerifier

/**
 * PCA-ADD-ENR-013/014, gap items 2-4: the real, PIN/biometric-gated entry
 * point into (a) admin PIN setup/verify and (b) the removal/disable
 * decision subsystem -- the concrete "reachable from the app" host for
 * both. `FragmentActivity`, not `ComponentActivity`: required by
 * `androidx.biometric.BiometricPrompt`'s constructor (see
 * [RealBiometricAuthGate]'s doc comment) -- this app's other Activities
 * (`MainActivity`, `EnrollmentActivity`, `SafeBrowserActivity`) all extend
 * plain `ComponentActivity`, none of which can host a real
 * `BiometricPrompt`, which is exactly why this is a distinct Activity
 * rather than added to one of theirs.
 *
 * NOT YET registered in `AndroidManifest.xml` or linked from any existing
 * screen -- both are owned outside this lane's exclusive file list (see
 * this lane's INTERFACE_CHANGE_REQUEST). Every class this Activity uses is
 * itself fully real and independently unit-tested; only the final
 * manifest registration + a launcher entry point elsewhere in the app
 * remain for a user to actually reach this screen.
 *
 * Composition here is intentionally constructed directly (not read off
 * [org.pca.app.runtime.graph.PcaAppGraph], which this lane does not own)
 * except for the two pieces [PcaLocalPersistence] and
 * `(application as PcaApplication).graph.deviceIdentityProvider` already
 * expose as a stable, documented "single production wiring point" /
 * public graph field respectively -- reading those is not the same as
 * editing the graph itself.
 */
class AdminSecurityActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pinStateStore = EncryptedSharedPreferencesStateStore(this, "admin_pin_store")
        val pbkdf2Verifier = Pbkdf2AdminPinVerifier(pinStateStore)
        val throttle = PinAttemptThrottle(SystemMonotonicTimeSource(), PersistentPinThrottleStateStore(pinStateStore))
        val pinVerifier = ThrottledAdminPinVerifier(pbkdf2Verifier, throttle)
        val biometricGate = RealBiometricAuthGate(this)

        val removalDecisionStateStore = EncryptedSharedPreferencesStateStore(this, "removal_decision_store")
        val removalDecisionRepository = PersistentRemovalDecisionRepository(removalDecisionStateStore)
        val tamperEventRepository = PcaLocalPersistence.getInstance(applicationContext).tamperEventRepository
        val auditRecorder = RemovalDecisionAuditRecorder(tamperEventRepository)
        val coordinator = RemovalDecisionCoordinator(
            repository = removalDecisionRepository,
            stateMachine = RemovalDecisionStateMachine(),
            auditRecorder = auditRecorder,
            wallClock = SystemWallClockTimeSource(),
            deviceIdProvider = {
                val identity = (application as PcaApplication).graph.deviceIdentityProvider.currentIdentity()
                (identity as? DeviceIdentityState.Enrolled)?.deviceId
            },
        )

        setContent {
            MaterialTheme {
                var isAuthenticated by remember { mutableStateOf(false) }
                var pinErrorMessage by remember { mutableStateOf<String?>(null) }
                var record by remember { mutableStateOf(coordinator.currentRecord()) }

                if (!isAuthenticated) {
                    val mode = if (pinVerifier.isPinSet()) AdminPinScreenMode.Verify else AdminPinScreenMode.Setup
                    AdminPinScreen(
                        mode = mode,
                        state = AdminPinScreenState(
                            isLockedOut = pinVerifier.isLockedOut(),
                            remainingLockoutMillis = pinVerifier.remainingLockoutMillis(),
                            errorMessage = pinErrorMessage,
                        ),
                        onSubmitNewPin = { newPin ->
                            pinVerifier.setPin(newPin)
                            isAuthenticated = true
                        },
                        onVerifyPin = { candidate ->
                            if (pinVerifier.verify(candidate)) {
                                pinErrorMessage = null
                                isAuthenticated = true
                            } else {
                                pinErrorMessage = "Incorrect PIN"
                            }
                        },
                        onCancel = { finish() },
                        onUseBiometricInstead = if (biometricGate.isAvailable()) {
                            {
                                biometricGate.authenticate(BiometricAuthReason.OPEN_REMOVAL_DECISION) { result ->
                                    if (result is BiometricAuthResult.Success) isAuthenticated = true
                                }
                            }
                        } else null,
                    )
                } else {
                    RemovalDecisionScreen(
                        record = record,
                        onKeepActive = {
                            applyOutcome(coordinator.decideKeepActive(isAuthenticated = true)) { record = it }
                        },
                        onTemporarilyDisable = { until ->
                            applyOutcome(coordinator.decideTemporarilyDisable(isAuthenticated = true, untilEpochMillis = until)) { record = it }
                        },
                        onAllowRemoval = {
                            lifecycleScope.launch {
                                applyOutcome(coordinator.decideAllowRemoval(isAuthenticated = true)) { record = it }
                            }
                        },
                    )
                }
            }
        }
    }

    private fun applyOutcome(outcome: RemovalDecisionOutcome, onApplied: (RemovalDecisionRecord) -> Unit) {
        if (outcome is RemovalDecisionOutcome.Applied) onApplied(outcome.record)
        // AuthenticationRequired/Rejected are not expected here (isAuthenticated is always true
        // on this path, and the UI only exposes buttons legal from the current state) -- if they
        // ever occur it indicates a real flow bug, silently no-op-ing the UI update is the safe
        // (fail-closed, never fake-succeed) response rather than guessing a resulting state.
    }
}
