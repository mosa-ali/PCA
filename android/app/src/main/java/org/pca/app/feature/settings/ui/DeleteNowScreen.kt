package org.pca.app.feature.settings.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.settings.data.DeleteNowScope

/** One selectable scope choice with its parent-facing label (Section 20). */
data class DeleteNowScopeOption(val label: String, val scope: DeleteNowScope)

sealed class DeleteNowUiResult {
    data class Success(val deletedCount: Int, val receiptId: String) : DeleteNowUiResult()
    data class Failure(val reason: String) : DeleteNowUiResult()
}

/**
 * PCA-RUNTIME-PERSIST-1 Section 20: real settings UI for "Delete Now" --
 * scope selection, an explicit confirmation step (parent-authorized local
 * deletion only), and a result/receipt display. [result] is owned by the
 * caller (the actual coordinator call happens outside this composable, via
 * [org.pca.app.feature.settings.data.DeleteNowUseCase]) so this screen has
 * no direct database access.
 */
@Composable
fun DeleteNowScreen(
    scopeOptions: List<DeleteNowScopeOption>,
    onConfirmDelete: (DeleteNowScope) -> Unit,
    result: DeleteNowUiResult?,
    onDismissResult: () -> Unit,
) {
    var selectedIndex by remember { mutableStateOf(0) }
    var pendingScope by remember { mutableStateOf<DeleteNowScope?>(null) }

    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = stringResource(R.string.delete_now_title), style = MaterialTheme.typography.titleLarge)
        Text(text = stringResource(R.string.delete_now_description), modifier = Modifier.padding(vertical = 8.dp))

        Text(text = stringResource(R.string.delete_now_scope_label), style = MaterialTheme.typography.titleMedium)
        scopeOptions.forEachIndexed { index, option ->
            Row(
                modifier = Modifier
                    .selectable(selected = index == selectedIndex, onClick = { selectedIndex = index })
                    .padding(vertical = 4.dp),
            ) {
                RadioButton(selected = index == selectedIndex, onClick = { selectedIndex = index })
                Text(text = option.label, modifier = Modifier.padding(start = 8.dp))
            }
        }

        Button(
            onClick = { scopeOptions.getOrNull(selectedIndex)?.let { pendingScope = it.scope } },
            modifier = Modifier.padding(top = 16.dp),
        ) {
            Text(text = stringResource(R.string.delete_now_title))
        }
    }

    pendingScope?.let { scope ->
        AlertDialog(
            onDismissRequest = { pendingScope = null },
            title = { Text(text = stringResource(R.string.delete_now_confirm_title)) },
            text = { Text(text = stringResource(R.string.delete_now_confirm_message)) },
            confirmButton = {
                TextButton(onClick = {
                    pendingScope = null
                    onConfirmDelete(scope)
                }) { Text(text = stringResource(R.string.delete_now_confirm_button)) }
            },
            dismissButton = {
                TextButton(onClick = { pendingScope = null }) { Text(text = stringResource(R.string.delete_now_cancel_button)) }
            },
        )
    }

    result?.let { r ->
        AlertDialog(
            onDismissRequest = onDismissResult,
            title = {
                Text(
                    text = stringResource(
                        if (r is DeleteNowUiResult.Success) R.string.delete_now_result_title else R.string.delete_now_error_title,
                    ),
                )
            },
            text = {
                Text(
                    text = when (r) {
                        is DeleteNowUiResult.Success -> stringResource(R.string.delete_now_result_message, r.deletedCount, r.receiptId)
                        is DeleteNowUiResult.Failure -> stringResource(R.string.delete_now_error_message)
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = onDismissResult) { Text(text = stringResource(R.string.delete_now_close_button)) }
            },
        )
    }
}
