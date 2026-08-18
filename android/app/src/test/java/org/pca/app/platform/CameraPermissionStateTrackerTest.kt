package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraPermissionStateTrackerTest {
    @Test
    fun `initial denial is distinct from revocation after a prior grant`() {
        var granted = false
        val tracker = CameraPermissionStateTracker(hasCameraPermission = { granted })

        assertEquals(TrackedCameraPermissionState.DENIED, tracker.currentState())
        granted = true
        assertEquals(TrackedCameraPermissionState.GRANTED, tracker.currentState())
        granted = false
        assertEquals(TrackedCameraPermissionState.REVOKED, tracker.currentState())
    }

    @Test
    fun `camera unavailability is not misreported as a permission denial`() {
        val tracker = CameraPermissionStateTracker(
            hasCameraPermission = { false },
            cameraAvailable = { false },
        )

        assertEquals(TrackedCameraPermissionState.UNAVAILABLE, tracker.currentState())
    }

    @Test
    fun `state is re-evaluated live after a capability returns`() {
        var granted = true
        val tracker = CameraPermissionStateTracker(hasCameraPermission = { granted })

        assertEquals(TrackedCameraPermissionState.GRANTED, tracker.currentState())
        granted = false
        assertEquals(TrackedCameraPermissionState.REVOKED, tracker.currentState())
        granted = true
        assertEquals(TrackedCameraPermissionState.GRANTED, tracker.currentState())
    }
}
