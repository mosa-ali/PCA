package org.pca.app.security.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.ReadingLevel
import org.pca.app.enrollment.readingLevel

/**
 * PCA-ADD-ENR-014 gap item 3: real PIN configuration UI -- setting a PIN,
 * changing a PIN, and verifying a PIN, all through one data-driven
 * composable (mirrors [org.pca.app.feature.settings.ui.DeleteNowScreen]'s
 * shape: this screen has no direct storage access, the actual
 * [org.pca.app.security.ThrottledAdminPinVerifier] call happens in the
 * caller, e.g. an Activity or a small coordinator class).
 * `PasswordVisualTransformation` + `KeyboardType.NumberPassword`: masked
 * entry, numeric keypad -- never a plaintext-visible PIN field.
 *
 * PCA-NFR-044: this is one of the entry points [org.pca.app.runtime.ui.ChildHomeScreen]'s
 * `AdminSecurityEntryCard` reaches, so a child (not just a parent) can land here -- the
 * title/primary-action/error copy therefore reads the real, persisted [AgeUxTier] and selects a
 * SIMPLE/YOUNG_CHILD or CLEAR/TEEN string set via [adminPinCopyForTier], mirroring
 * [org.pca.app.feature.breakshield.BreakShieldScreen]'s `resolveDeviceAgeUxTier()`/
 * `breakShieldCopyForTier()` pattern exactly. This is presentation only: the PIN itself is never
 * simplified, weakened, or bypassed for either tier -- verification still happens byte-for-byte
 * the same way in the caller regardless of which copy set is shown.
 */
sealed class AdminPinScreenMode {
    /** No PIN exists yet on this device -- single entry + confirm entry, no "current PIN" step. */
    data object Setup : AdminPinScreenMode()

    /** A PIN already exists and must be re-entered correctly before a NEW pin (entry + confirm) is accepted. */
    data class Change(val onVerifyCurrentPin: (CharArray) -> Boolean) : AdminPinScreenMode()

    /** Just verifying an existing PIN to unlock a sensitive action -- no "new PIN" fields at all. */
    data object Verify : AdminPinScreenMode()
}

data class AdminPinScreenState(
    val isLockedOut: Boolean = false,
    val remainingLockoutMillis: Long = 0L,
    /** PCA-NFR-044: a flag, not a pre-formatted message -- the tier-appropriate copy is selected here, not by the caller (mirrors every other AgeUxTier-aware surface owning its own copy selection). */
    val hasIncorrectPinError: Boolean = false,
)

@Composable
fun AdminPinScreen(
    mode: AdminPinScreenMode,
    state: AdminPinScreenState,
    onSubmitNewPin: (CharArray) -> Unit,
    onVerifyPin: (CharArray) -> Unit,
    onCancel: () -> Unit,
    onUseBiometricInstead: (() -> Unit)? = null,
    ageUxTier: AgeUxTier? = null,
) {
    var currentPin by remember { mutableStateOf("") }
    var currentPinVerified by remember { mutableStateOf(mode !is AdminPinScreenMode.Change) }
    var newPin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }

    // PCA-NFR-044: the real, currently-enrolled age tier is read from the same persisted
    // FamilyStateStore the rest of the runtime graph already uses -- never a hardcoded default --
    // mirroring BreakShieldScreen.kt's resolveDeviceAgeUxTier(). A caller may still pass
    // [ageUxTier] explicitly (previews/tests); when omitted the real device state is resolved here.
    val resolvedAgeUxTier = ageUxTier ?: resolveDeviceAgeUxTier()
    val copy = adminPinCopyForTier(resolvedAgeUxTier)

    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = stringResource(titleResFor(mode, copy)),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )

        if (state.isLockedOut) {
            Text(
                text = stringResource(copy.lockedOutMessageRes, (state.remainingLockoutMillis / 1000).coerceAtLeast(1)),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp),
            )
            return@Column
        }

        if (state.hasIncorrectPinError) {
            Text(
                text = stringResource(copy.incorrectPinMessageRes),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        when (mode) {
            is AdminPinScreenMode.Verify -> {
                OutlinedTextField(
                    value = currentPin,
                    onValueChange = { currentPin = it },
                    label = { Text(stringResource(R.string.admin_pin_field_label)) },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.padding(top = 16.dp),
                )
                Button(
                    onClick = { onVerifyPin(currentPin.toCharArray()) },
                    modifier = Modifier.padding(top = 16.dp),
                ) { Text(stringResource(copy.confirmButtonRes)) }
                onUseBiometricInstead?.let { onBio ->
                    TextButton(onClick = onBio, modifier = Modifier.padding(top = 8.dp)) {
                        Text(stringResource(R.string.admin_pin_use_biometric_instead_button))
                    }
                }
            }

            is AdminPinScreenMode.Change -> {
                if (!currentPinVerified) {
                    OutlinedTextField(
                        value = currentPin,
                        onValueChange = { currentPin = it },
                        label = { Text(stringResource(R.string.admin_pin_current_field_label)) },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.padding(top = 16.dp),
                    )
                    Button(
                        onClick = {
                            if (mode.onVerifyCurrentPin(currentPin.toCharArray())) currentPinVerified = true
                        },
                        modifier = Modifier.padding(top = 16.dp),
                    ) { Text(stringResource(copy.continueButtonRes)) }
                } else {
                    NewPinFields(copy, newPin, { newPin = it }, confirmPin, { confirmPin = it }, onSubmitNewPin)
                }
            }

            is AdminPinScreenMode.Setup -> NewPinFields(copy, newPin, { newPin = it }, confirmPin, { confirmPin = it }, onSubmitNewPin)
        }

        TextButton(onClick = onCancel, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.admin_pin_cancel_button)) }
    }
}

@Composable
private fun NewPinFields(
    copy: AdminPinCopy,
    newPin: String,
    onNewPinChange: (String) -> Unit,
    confirmPin: String,
    onConfirmPinChange: (String) -> Unit,
    onSubmit: (CharArray) -> Unit,
) {
    OutlinedTextField(
        value = newPin,
        onValueChange = onNewPinChange,
        label = { Text(stringResource(R.string.admin_pin_new_field_label)) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.padding(top = 16.dp),
    )
    OutlinedTextField(
        value = confirmPin,
        onValueChange = onConfirmPinChange,
        label = { Text(stringResource(copy.confirmPinFieldLabelRes)) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.padding(top = 8.dp),
    )
    Button(
        onClick = { if (newPin == confirmPin) onSubmit(newPin.toCharArray()) },
        modifier = Modifier.padding(top = 16.dp),
    ) { Text(stringResource(copy.saveButtonRes)) }
}

private fun titleResFor(mode: AdminPinScreenMode, copy: AdminPinCopy): Int = when (mode) {
    is AdminPinScreenMode.Setup -> copy.setupTitleRes
    is AdminPinScreenMode.Change -> copy.changeTitleRes
    is AdminPinScreenMode.Verify -> copy.verifyTitleRes
}

/**
 * PCA-NFR-044: resolves the real, persisted [AgeUxTier] for this device from the same composition
 * root ([PcaApplication.graph]) the rest of the runtime already uses, mirroring
 * [org.pca.app.runtime.ui.ChildHomeScreen]'s `resolveDeviceAgeUxTier()`. Falls back to
 * [AgeUxTier.YOUNG_CHILD] (the stricter tier) only when no enrolled family state exists yet or
 * the hosting context isn't [PcaApplication] (e.g. a Preview/test harness).
 */
@Composable
private fun resolveDeviceAgeUxTier(): AgeUxTier {
    val context = LocalContext.current
    return (context.applicationContext as? PcaApplication)
        ?.graph
        ?.familyStateStore
        ?.currentState()
        ?.ageUxTier
        ?: AgeUxTier.YOUNG_CHILD
}

/**
 * PCA-NFR-044: reading-level string set for the admin PIN entry/setup/change surface, mirroring
 * [org.pca.app.enrollment.ui.EnrollmentScreen]'s `EnrollmentDisclosureCopy`/`disclosureCopyForTier`
 * pattern. Only wording complexity changes between tiers -- the PIN value, verification result,
 * and lockout timing are identical in both variants. Some fields (e.g. the "PIN"/"Current PIN"/
 * "New PIN" field labels, the Cancel and biometric-fallback actions) have no separate `_simple`
 * resource: they are already as simple as `eye_rest_shield_title`'s documented shared-title
 * precedent, so a distinct SIMPLE-tier key would just duplicate the same text.
 */
private data class AdminPinCopy(
    val readingLevel: ReadingLevel,
    @androidx.annotation.StringRes val setupTitleRes: Int,
    @androidx.annotation.StringRes val changeTitleRes: Int,
    @androidx.annotation.StringRes val verifyTitleRes: Int,
    @androidx.annotation.StringRes val confirmPinFieldLabelRes: Int,
    @androidx.annotation.StringRes val confirmButtonRes: Int,
    @androidx.annotation.StringRes val continueButtonRes: Int,
    @androidx.annotation.StringRes val saveButtonRes: Int,
    @androidx.annotation.StringRes val incorrectPinMessageRes: Int,
    @androidx.annotation.StringRes val lockedOutMessageRes: Int,
)

private fun adminPinCopyForTier(ageUxTier: AgeUxTier): AdminPinCopy = when (ageUxTier) {
    AgeUxTier.YOUNG_CHILD -> AdminPinCopy(
        readingLevel = ageUxTier.readingLevel,
        setupTitleRes = R.string.admin_pin_setup_title_simple,
        changeTitleRes = R.string.admin_pin_change_title_simple,
        verifyTitleRes = R.string.admin_pin_verify_title_simple,
        confirmPinFieldLabelRes = R.string.admin_pin_confirm_field_label_simple,
        confirmButtonRes = R.string.admin_pin_confirm_button_simple,
        continueButtonRes = R.string.admin_pin_continue_button_simple,
        saveButtonRes = R.string.admin_pin_save_button_simple,
        incorrectPinMessageRes = R.string.admin_pin_incorrect_message_simple,
        lockedOutMessageRes = R.string.admin_pin_locked_out_message_simple,
    )
    AgeUxTier.TEEN -> AdminPinCopy(
        readingLevel = ageUxTier.readingLevel,
        setupTitleRes = R.string.admin_pin_setup_title,
        changeTitleRes = R.string.admin_pin_change_title,
        verifyTitleRes = R.string.admin_pin_verify_title,
        confirmPinFieldLabelRes = R.string.admin_pin_confirm_field_label,
        confirmButtonRes = R.string.admin_pin_confirm_button,
        continueButtonRes = R.string.admin_pin_continue_button,
        saveButtonRes = R.string.admin_pin_save_button,
        incorrectPinMessageRes = R.string.admin_pin_incorrect_message,
        lockedOutMessageRes = R.string.admin_pin_locked_out_message,
    )
}
