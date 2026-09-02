package org.pca.app.feature.settings.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R

sealed class AuditExportUiResult {
    data object Success : AuditExportUiResult()
    data class Failure(val reason: String) : AuditExportUiResult()
}

/**
 * PCA-FR-124: real settings UI for exporting this family's local audit
 * record (policy/role/retention/deletion actions plus tamper events -- see
 * [org.pca.app.persistence.export.AuditRecordExportService.exportFamily]'s
 * own doc comment for exact scope) as a plaintext JSON file the parent saves
 * through the platform's Storage Access Framework picker.
 *
 * [onExportRequested] is owned by the caller: the actual `exportFamily`
 * call, the SAF document-creation request, and the file write all happen
 * outside this composable (same caller-owns-the-effect split already used by
 * [DeleteNowScreen] in this package), so this screen has no direct database
 * or storage access of its own.
 *
 * This is deliberately the plaintext local-export path (PCA-FR-124), not the
 * encrypted family export (PCA-FR-125/PCA-SEC-026,
 * [org.pca.app.persistence.export.AuditRecordExportService.generateEncryptedExport]):
 * that second path's only production [org.pca.app.persistence.export.FamilyExportEncryptor]
 * is the deliberately-rejecting [org.pca.app.persistence.export.RejectingFamilyExportEncryptor]
 * until an approved family E2EE crypto provider exists, so it cannot be wired to a working
 * UI action yet without fabricating a crypto implementation this lane does not own.
 */
@Composable
fun AuditExportScreen(
    onExportRequested: () -> Unit,
    result: AuditExportUiResult?,
    onDismissResult: () -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = stringResource(R.string.audit_export_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        Text(text = stringResource(R.string.audit_export_description), modifier = Modifier.padding(vertical = 8.dp))

        Button(onClick = onExportRequested, modifier = Modifier.padding(top = 8.dp)) {
            Text(text = stringResource(R.string.audit_export_title))
        }
    }

    result?.let { r ->
        AlertDialog(
            onDismissRequest = onDismissResult,
            title = {
                Text(
                    text = stringResource(
                        if (r is AuditExportUiResult.Success) R.string.audit_export_result_title else R.string.audit_export_error_title,
                    ),
                )
            },
            text = {
                Text(
                    text = when (r) {
                        is AuditExportUiResult.Success -> stringResource(R.string.audit_export_result_message)
                        is AuditExportUiResult.Failure -> stringResource(R.string.audit_export_error_message)
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = onDismissResult) { Text(text = stringResource(R.string.audit_export_close_button)) }
            },
        )
    }
}
