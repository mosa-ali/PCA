package org.pca.app.security.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.feature.eyedistance.ui.EyeDistanceCameraPermissionActivity
import org.pca.app.feature.removaldecision.PersistentRemovalDecisionRepository
import org.pca.app.feature.removaldecision.RemovalDecisionAuditRecorder
import org.pca.app.feature.removaldecision.RemovalDecisionCoordinator
import org.pca.app.feature.removaldecision.RemovalDecisionOutcome
import org.pca.app.feature.removaldecision.RemovalDecisionRecord
import org.pca.app.feature.removaldecision.RemovalDecisionStateMachine
import org.pca.app.feature.removaldecision.ui.RemovalDecisionScreen
import org.pca.app.feature.settings.data.DeleteNowResult
import org.pca.app.feature.settings.data.DeleteNowScope
import org.pca.app.feature.settings.data.DeleteNowUseCase
import org.pca.app.feature.settings.ui.AuditExportScreen
import org.pca.app.feature.settings.ui.AuditExportUiResult
import org.pca.app.feature.settings.ui.DeleteNowScopeOption
import org.pca.app.feature.settings.ui.DeleteNowScreen
import org.pca.app.feature.settings.ui.DeleteNowUiResult
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore
import org.pca.app.foundation.SystemMonotonicTimeSource
import org.pca.app.foundation.SystemWallClockTimeSource
import org.pca.app.persistence.PcaLocalPersistence
import org.pca.app.persistence.retention.DeleteNowCoordinator
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
 * Registered in `AndroidManifest.xml` and reachable in production: launched
 * from [org.pca.app.MainActivity] via the `AdminSecurityEntryCard` entry
 * point wired into [org.pca.app.runtime.ui.ChildHomeScreen] (see that
 * screen's own doc comment for why the card itself gates nothing -- this
 * Activity performs its own PIN/biometric authentication on launch).
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

        // PCA-FR-065/103/104 closure: the reachable entry point for the Delete Now screen and
        // use case, which previously had no real production caller anywhere in the app (compiled
        // and unit-tested, but never rendered) -- same PIN/biometric-gated admin surface as
        // RemovalDecisionScreen below, following this Activity's own documented pattern for
        // screens that have no shared NavHost to attach to.
        val deleteNowUseCase = DeleteNowUseCase(DeleteNowCoordinator(PcaLocalPersistence.getInstance(applicationContext).database))

        // PCA-FR-124 closure: the reachable entry point for AuditRecordExportService.exportFamily,
        // which previously had no real production caller anywhere in the app (compiled and
        // unit-tested, but never rendered) -- same PIN/biometric-gated admin surface, following
        // this Activity's own documented pattern for screens with no shared NavHost to attach to.
        // registerForActivityResult must be called unconditionally before this Activity reaches
        // STARTED (i.e. here in onCreate, not inside the authenticated Composable branch below) --
        // the launch() call itself only ever happens from the post-authentication UI.
        val auditExportResultState = mutableStateOf<AuditExportUiResult?>(null)
        var pendingAuditExportFamilyId: String? = null
        val auditExportDocumentLauncher = registerForActivityResult(
            ActivityResultContracts.CreateDocument("application/json"),
        ) { uri ->
            val familyId = pendingAuditExportFamilyId
            if (uri == null || familyId == null) return@registerForActivityResult
            lifecycleScope.launch {
                auditExportResultState.value = try {
                    val json = PcaLocalPersistence.getInstance(applicationContext).auditRecordExportService
                        .exportFamily(familyId, System.currentTimeMillis())
                    withContext(Dispatchers.IO) {
                        contentResolver.openOutputStream(uri)?.use { output ->
                            output.write(json.toByteArray(Charsets.UTF_8))
                        } ?: throw IllegalStateException("no writable output stream for export destination")
                    }
                    AuditExportUiResult.Success
                } catch (e: Exception) {
                    AuditExportUiResult.Failure(e.message ?: "unknown_error")
                }
            }
        }

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
            PcaAccessibilityContent {
                MaterialTheme {
                    var isAuthenticated by remember { mutableStateOf(false) }
                    // PCA-NFR-044: a flag, not a pre-formatted string -- AdminPinScreen itself
                    // selects the tier-appropriate "incorrect PIN" copy (see AdminPinScreen.kt's
                    // AdminPinCopy/adminPinCopyForTier), so this caller no longer hardcodes
                    // English error text.
                    var pinHasIncorrectError by remember { mutableStateOf(false) }
                    var record by remember { mutableStateOf(coordinator.currentRecord()) }

                    if (!isAuthenticated) {
                        val mode = if (pinVerifier.isPinSet()) AdminPinScreenMode.Verify else AdminPinScreenMode.Setup
                        AdminPinScreen(
                            mode = mode,
                            state = AdminPinScreenState(
                                isLockedOut = pinVerifier.isLockedOut(),
                                remainingLockoutMillis = pinVerifier.remainingLockoutMillis(),
                                hasIncorrectPinError = pinHasIncorrectError,
                            ),
                            onSubmitNewPin = { newPin ->
                                pinVerifier.setPin(newPin)
                                isAuthenticated = true
                            },
                            onVerifyPin = { candidate ->
                                if (pinVerifier.verify(candidate)) {
                                    pinHasIncorrectError = false
                                    isAuthenticated = true
                                } else {
                                    pinHasIncorrectError = true
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
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(16.dp)) {
                            // PCA-PRIV-001 / PCA-FR-023/024 closure: the reachable entry point into
                            // EyeDistanceCameraPermissionActivity's disclosure + real CAMERA
                            // permission-request flow -- this app has no shared NavHost (see that
                            // Activity's own doc comment), so this PIN/biometric-authenticated
                            // parent settings surface is the chosen, real launch site.
                            OutlinedButton(onClick = {
                                startActivity(Intent(this@AdminSecurityActivity, EyeDistanceCameraPermissionActivity::class.java))
                            }) {
                                Text("Eye-distance camera permission")
                            }
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

                            val enrolledIdentity = (application as PcaApplication).graph.deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled
                            val currentFamilyId = (application as PcaApplication).graph.familyStateStore.currentState()?.familyId
                            if (enrolledIdentity != null && currentFamilyId != null) {
                                var deleteNowResult by remember { mutableStateOf<DeleteNowUiResult?>(null) }
                                DeleteNowScreen(
                                    scopeOptions = listOf(
                                        DeleteNowScopeOption(
                                            label = stringResource(R.string.delete_now_scope_device),
                                            scope = DeleteNowScope.Device(currentFamilyId, enrolledIdentity.deviceId),
                                        ),
                                    ),
                                    onConfirmDelete = { scope ->
                                        lifecycleScope.launch {
                                            deleteNowResult = when (val outcome = deleteNowUseCase.execute(scope)) {
                                                is DeleteNowResult.Success -> DeleteNowUiResult.Success(outcome.receipt.deletedCount, outcome.receipt.id)
                                                is DeleteNowResult.Failure -> DeleteNowUiResult.Failure(outcome.reason)
                                            }
                                        }
                                    },
                                    result = deleteNowResult,
                                    onDismissResult = { deleteNowResult = null },
                                )
                            }

                            if (currentFamilyId != null) {
                                val auditExportResult by auditExportResultState
                                AuditExportScreen(
                                    onExportRequested = {
                                        pendingAuditExportFamilyId = currentFamilyId
                                        auditExportDocumentLauncher.launch("pca-audit-export-${System.currentTimeMillis()}.json")
                                    },
                                    result = auditExportResult,
                                    onDismissResult = { auditExportResultState.value = null },
                                )
                            }
                        }
                    }
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
