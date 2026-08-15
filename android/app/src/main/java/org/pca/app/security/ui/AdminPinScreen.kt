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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import org.pca.app.R

/**
 * PCA-ADD-ENR-014 gap item 3: real PIN configuration UI -- setting a PIN,
 * changing a PIN, and verifying a PIN, all through one data-driven
 * composable (mirrors [org.pca.app.feature.settings.ui.DeleteNowScreen]'s
 * shape: this screen has no direct storage access, the actual
 * [org.pca.app.security.ThrottledAdminPinVerifier] call happens in the
 * caller, e.g. an Activity or a small coordinator class).
 * `PasswordVisualTransformation` + `KeyboardType.NumberPassword`: masked
 * entry, numeric keypad -- never a plaintext-visible PIN field.
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
    val errorMessage: String? = null,
)

@Composable
fun AdminPinScreen(
    mode: AdminPinScreenMode,
    state: AdminPinScreenState,
    onSubmitNewPin: (CharArray) -> Unit,
    onVerifyPin: (CharArray) -> Unit,
    onCancel: () -> Unit,
    onUseBiometricInstead: (() -> Unit)? = null,
) {
    var currentPin by remember { mutableStateOf("") }
    var currentPinVerified by remember { mutableStateOf(mode !is AdminPinScreenMode.Change) }
    var newPin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }

    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = titleFor(mode),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )

        if (state.isLockedOut) {
            Text(
                text = stringResource(R.string.admin_pin_locked_out_message, (state.remainingLockoutMillis / 1000).coerceAtLeast(1)),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp),
            )
            return@Column
        }

        state.errorMessage?.let {
            Text(text = it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
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
                ) { Text(stringResource(R.string.admin_pin_confirm_button)) }
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
                    ) { Text(stringResource(R.string.admin_pin_continue_button)) }
                } else {
                    NewPinFields(newPin, { newPin = it }, confirmPin, { confirmPin = it }, onSubmitNewPin)
                }
            }

            is AdminPinScreenMode.Setup -> NewPinFields(newPin, { newPin = it }, confirmPin, { confirmPin = it }, onSubmitNewPin)
        }

        TextButton(onClick = onCancel, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.admin_pin_cancel_button)) }
    }
}

@Composable
private fun NewPinFields(
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
        label = { Text(stringResource(R.string.admin_pin_confirm_field_label)) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.padding(top = 8.dp),
    )
    Button(
        onClick = { if (newPin == confirmPin) onSubmit(newPin.toCharArray()) },
        modifier = Modifier.padding(top = 16.dp),
    ) { Text(stringResource(R.string.admin_pin_save_button)) }
}

@Composable
private fun titleFor(mode: AdminPinScreenMode): String = when (mode) {
    is AdminPinScreenMode.Setup -> stringResource(R.string.admin_pin_setup_title)
    is AdminPinScreenMode.Change -> stringResource(R.string.admin_pin_change_title)
    is AdminPinScreenMode.Verify -> stringResource(R.string.admin_pin_verify_title)
}
