package org.pca.app.feature.eyedistance.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class EyeDistanceCameraPermissionUiStateResolverTest {

    @Test
    fun `feature unavailable wins regardless of permission state`() {
        assertEquals(
            EyeDistanceCameraPermissionUiState.FEATURE_UNAVAILABLE,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = false, hasCameraPermission = true, permissionExplicitlyDenied = true,
            ),
        )
        assertEquals(
            EyeDistanceCameraPermissionUiState.FEATURE_UNAVAILABLE,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = false, hasCameraPermission = false, permissionExplicitlyDenied = false,
            ),
        )
    }

    @Test
    fun `granted permission reads GRANTED when feature is available`() {
        assertEquals(
            EyeDistanceCameraPermissionUiState.GRANTED,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = true, hasCameraPermission = true, permissionExplicitlyDenied = false,
            ),
        )
    }

    @Test
    fun `granted wins over a stale denied flag`() {
        assertEquals(
            EyeDistanceCameraPermissionUiState.GRANTED,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = true, hasCameraPermission = true, permissionExplicitlyDenied = true,
            ),
        )
    }

    @Test
    fun `explicit denial reads DENIED`() {
        assertEquals(
            EyeDistanceCameraPermissionUiState.DENIED,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = true, hasCameraPermission = false, permissionExplicitlyDenied = true,
            ),
        )
    }

    @Test
    fun `never asked reads NOT_REQUESTED`() {
        assertEquals(
            EyeDistanceCameraPermissionUiState.NOT_REQUESTED,
            EyeDistanceCameraPermissionUiStateResolver.resolve(
                featureAvailable = true, hasCameraPermission = false, permissionExplicitlyDenied = false,
            ),
        )
    }

    @Test
    fun `today's real availability constant is true -- PCA-FR-024 closure wired a real CameraProximitySource`() {
        assertEquals(true, EyeDistanceCameraFeatureAvailability.CAMERA_PROXIMITY_ESTIMATION_AVAILABLE)
    }
}
