package org.pca.app.feature.eyedistance.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R

/**
 * PCA-PRIV-001 / PCA-FR-023/024: the honest camera-permission disclosure screen for the
 * camera-based eye-distance tier. Every state this renders reflects
 * [EyeDistanceCameraPermissionUiState] exactly -- there is no branch here that asks for camera
 * permission while implying face recognition, image storage, or upload; the explainer text always
 * states plainly that only a coarse near/far reading is produced, no image is ever kept, and each
 * camera frame is discarded immediately after use (see
 * [org.pca.app.platform.proximity.FaceProximityEstimator]'s own hard requirements, which this copy
 * is written to describe accurately regardless of whether a concrete estimator is wired up yet).
 */
@Composable
fun EyeDistanceCameraPermissionScreen(
    state: EyeDistanceCameraPermissionUiState,
    onAllowClick: () -> Unit,
    onNotNowClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            stringResource(R.string.eye_distance_camera_permission_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )

        when (state) {
            EyeDistanceCameraPermissionUiState.FEATURE_UNAVAILABLE -> {
                Text(stringResource(R.string.eye_distance_camera_unavailable_notice))
            }

            EyeDistanceCameraPermissionUiState.NOT_REQUESTED -> {
                Text(stringResource(R.string.eye_distance_camera_permission_explainer))
                Button(onClick = onAllowClick) {
                    Text(stringResource(R.string.eye_distance_camera_permission_allow_button))
                }
                OutlinedButton(onClick = onNotNowClick) {
                    Text(stringResource(R.string.eye_distance_camera_permission_not_now_button))
                }
            }

            EyeDistanceCameraPermissionUiState.DENIED -> {
                Text(stringResource(R.string.eye_distance_camera_permission_explainer))
                Text(stringResource(R.string.eye_distance_camera_permission_denied_notice))
            }

            EyeDistanceCameraPermissionUiState.GRANTED -> {
                Text(stringResource(R.string.eye_distance_camera_permission_explainer))
            }
        }
    }
}
