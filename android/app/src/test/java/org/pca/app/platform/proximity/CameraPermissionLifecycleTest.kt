package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraPermissionLifecycleTest {
    @Test
    fun `boolean adapter distinguishes grant from post-grant revocation`() {
        var granted = false
        val source = BooleanCameraPermissionStateSource { granted }

        assertEquals(CameraPermissionStatus.DENIED, source.currentState())
        granted = true
        assertEquals(CameraPermissionStatus.GRANTED, source.currentState())
        granted = false
        assertEquals(CameraPermissionStatus.REVOKED, source.currentState())
    }
}
