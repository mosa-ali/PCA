package org.pca.app.platform.proximity

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real-device/emulator smoke coverage for [CameraXFrameSource] -- the actual `ProcessCameraProvider`
 * bind/unbind path cannot be exercised under Robolectric (no real camera HAL), so this is the one
 * place that path is touched at all. Deliberately conservative: CI emulators frequently have no
 * usable camera device, so these assertions only cover behavior that must hold regardless of
 * whether real camera hardware is present -- [isAvailable] must never throw, and repeated
 * [CameraXFrameSource.setRunning]`(false)` calls before any camera ever bound must be a safe no-op
 * (never crash), matching this feature's "camera use only while explicitly running" contract even
 * in the worst-case "never started" case.
 *
 * NOTE for the task record: this suite was written and compiles against the CameraX APIs, but was
 * not executed in this pass -- only `testDebugUnitTest`/`compileDebugKotlin`/`lintDebug` were run
 * (no connected device/emulator was available). A future CI run with `connectedDebugAndroidTest`
 * should confirm it passes on a real API 26+ device/emulator.
 */
@RunWith(AndroidJUnit4::class)
class CameraXFrameSourceInstrumentedTest {

    @Test
    fun isAvailableNeverThrowsRegardlessOfCameraHardwarePresence() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = CameraXFrameSource(context)

        // Must return a plain boolean, never throw, whether or not this device/emulator actually
        // has a camera.
        source.isAvailable()
    }

    @Test
    fun settingRunningFalseBeforeEverStartingIsASafeNoOp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = CameraXFrameSource(context)

        source.setRunning(false)
        source.setRunning(false)

        assertFalse("no frame should ever be produced without the camera ever having been started", source.nextFrame() != null)
    }
}
