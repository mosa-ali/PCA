package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.foundation.MonotonicTimeSource

private class FakeMonotonicTimeSource(private var nowNanos: Long = 0L) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nowNanos / 1_000_000
    override fun elapsedRealtimeNanos(): Long = nowNanos
}

/** Doc 13 / task Section 3 camera safety lifecycle -- these tests exercise the ONLY code path
 * that may invoke [FaceProximityEstimator], verifying it is unreachable unless both foreground
 * eligibility and camera permission are true at the exact moment of the call. */
class CameraProximitySourceTest {

    private var estimateCallCount = 0
    private val estimator = FaceProximityEstimator {
        estimateCallCount++
        ProximityReading.NEAR
    }

    @Test
    fun `estimation never runs without camera permission, even if foreground-eligible`() {
        val source = CameraProximitySource(estimator, hasCameraPermission = { false }, FakeMonotonicTimeSource())
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(0, estimateCallCount)
        assertEquals(ProximitySourceAvailability.PERMISSION_DENIED, observation.availability)
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
    }

    @Test
    fun `estimation never runs while backgrounded, even with permission granted`() {
        val source = CameraProximitySource(estimator, hasCameraPermission = { true }, FakeMonotonicTimeSource())
        source.setForegroundEligible(false)

        val observation = source.currentObservation()

        assertEquals(0, estimateCallCount)
        assertEquals(ProximitySourceAvailability.UNAVAILABLE, observation.availability)
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
    }

    @Test
    fun `estimation runs only when both foreground-eligible and permitted`() {
        val source = CameraProximitySource(estimator, hasCameraPermission = { true }, FakeMonotonicTimeSource())
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(1, estimateCallCount)
        assertEquals(ProximitySourceAvailability.AVAILABLE, observation.availability)
        assertEquals(ProximityReading.NEAR, observation.reading)
    }

    @Test
    fun `revoking permission stops estimation on the very next call, no grace period`() {
        var granted = true
        val source = CameraProximitySource(estimator, hasCameraPermission = { granted }, FakeMonotonicTimeSource())
        source.setForegroundEligible(true)
        source.currentObservation()
        assertEquals(1, estimateCallCount)

        granted = false
        val afterRevoke = source.currentObservation()

        assertEquals(1, estimateCallCount)
        assertEquals(ProximitySourceAvailability.PERMISSION_DENIED, afterRevoke.availability)
    }

    @Test
    fun `backgrounding the app stops estimation on the very next call, no grace period`() {
        val source = CameraProximitySource(estimator, hasCameraPermission = { true }, FakeMonotonicTimeSource())
        source.setForegroundEligible(true)
        source.currentObservation()
        assertEquals(1, estimateCallCount)

        source.setForegroundEligible(false)
        val afterBackground = source.currentObservation()

        assertEquals(1, estimateCallCount)
        assertEquals(ProximitySourceAvailability.UNAVAILABLE, afterBackground.availability)
    }

    @Test
    fun `an estimator exception degrades to UNKNOWN rather than propagating`() {
        val throwingEstimator = FaceProximityEstimator { throw IllegalStateException("camera pipeline error") }
        val source = CameraProximitySource(throwingEstimator, hasCameraPermission = { true }, FakeMonotonicTimeSource())
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(ProximityReading.UNKNOWN, observation.reading)
    }

    @Test
    fun `permission revocation propagates to a session-owning estimator`() {
        var granted = true
        val estimator = RecordingForegroundAwareEstimator()
        val source = CameraProximitySource(estimator, hasCameraPermission = { granted }, FakeMonotonicTimeSource())

        source.setForegroundEligible(true)
        source.currentObservation()
        assertEquals(true, estimator.lastForegroundEligible)

        granted = false
        assertEquals(ProximitySourceAvailability.PERMISSION_DENIED, source.availability())
        assertEquals(false, estimator.lastForegroundEligible)
    }

    @Test
    fun `richer permission lifecycle keeps not-requested distinct from denied`() {
        val source = CameraProximitySource(
            estimator = estimator,
            hasCameraPermission = { false },
            monotonicTimeSource = FakeMonotonicTimeSource(),
            permissionStateSource = CameraPermissionStateSource { CameraPermissionStatus.NOT_REQUESTED },
        )
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(0, estimateCallCount)
        assertEquals(ProximitySourceAvailability.PERMISSION_REQUIRED, observation.availability)
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
    }

    @Test
    fun `permission lifecycle query failure fails closed as unavailable`() {
        val source = CameraProximitySource(
            estimator = estimator,
            hasCameraPermission = { true },
            monotonicTimeSource = FakeMonotonicTimeSource(),
            permissionStateSource = CameraPermissionStateSource { error("permission query failed") },
        )
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(0, estimateCallCount)
        assertEquals(ProximitySourceAvailability.UNAVAILABLE, observation.availability)
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
    }

    private class RecordingForegroundAwareEstimator : ForegroundAwareFaceProximityEstimator {
        var lastForegroundEligible = false

        override fun setForegroundEligible(eligible: Boolean) {
            lastForegroundEligible = eligible
        }

        override fun isAvailable(): Boolean = true

        override fun estimate(): ProximityReading = ProximityReading.NEAR
    }
}
