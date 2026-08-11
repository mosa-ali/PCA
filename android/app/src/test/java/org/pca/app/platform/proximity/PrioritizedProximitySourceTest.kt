package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeSource(
    override val sourceClass: ProximitySourceClass,
    private var availabilityValue: ProximitySourceAvailability,
    private var readingValue: ProximityReading = ProximityReading.UNKNOWN,
) : ProximitySource {
    override fun availability(): ProximitySourceAvailability = availabilityValue
    override fun currentObservation(): ProximityObservation = ProximityObservation(
        reading = readingValue,
        sourceClass = sourceClass,
        confidence = ProximityConfidence.HIGH,
        availability = availabilityValue,
        elapsedRealtimeNanos = 0L,
        degraded = false,
    )

    fun setAvailability(value: ProximitySourceAvailability) { availabilityValue = value }
    fun setReading(value: ProximityReading) { readingValue = value }
}

class PrioritizedProximitySourceTest {

    @Test
    fun `prefers the higher-priority hardware source when both are available`() {
        val hardware = FakeSource(ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR, ProximitySourceAvailability.AVAILABLE, ProximityReading.NEAR)
        val camera = FakeSource(ProximitySourceClass.CAMERA_FACE_GEOMETRY, ProximitySourceAvailability.AVAILABLE, ProximityReading.FAR)
        val composite = PrioritizedProximitySource(listOf(hardware, camera))

        assertEquals(ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR, composite.sourceClass)
        assertEquals(ProximityReading.NEAR, composite.currentObservation().reading)
    }

    @Test
    fun `falls back to camera when hardware is unavailable`() {
        val hardware = FakeSource(ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR, ProximitySourceAvailability.UNAVAILABLE)
        val camera = FakeSource(ProximitySourceClass.CAMERA_FACE_GEOMETRY, ProximitySourceAvailability.AVAILABLE, ProximityReading.NEAR)
        val composite = PrioritizedProximitySource(listOf(hardware, camera))

        assertEquals(ProximitySourceClass.CAMERA_FACE_GEOMETRY, composite.sourceClass)
        assertEquals(ProximityReading.NEAR, composite.currentObservation().reading)
    }

    @Test
    fun `never fabricates a reading when every source is unavailable`() {
        val hardware = FakeSource(ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR, ProximitySourceAvailability.UNAVAILABLE)
        val camera = FakeSource(ProximitySourceClass.CAMERA_FACE_GEOMETRY, ProximitySourceAvailability.PERMISSION_DENIED)
        val composite = PrioritizedProximitySource(listOf(hardware, camera))

        val observation = composite.currentObservation()
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
        assertEquals(ProximitySourceAvailability.UNAVAILABLE, composite.availability())
    }

    @Test
    fun `a lower-priority source is never consulted while a higher-priority one is available`() {
        val hardware = FakeSource(ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR, ProximitySourceAvailability.AVAILABLE, ProximityReading.FAR)
        var cameraQueried = false
        val camera = object : ProximitySource {
            override val sourceClass = ProximitySourceClass.CAMERA_FACE_GEOMETRY
            override fun availability(): ProximitySourceAvailability {
                cameraQueried = true
                return ProximitySourceAvailability.AVAILABLE
            }
            override fun currentObservation(): ProximityObservation {
                cameraQueried = true
                throw AssertionError("camera source must not be queried while hardware is available")
            }
        }
        val composite = PrioritizedProximitySource(listOf(hardware, camera))

        // Short-circuits on the first AVAILABLE source, so the camera's availability()/
        // currentObservation() (which would throw) are never reached at all.
        assertEquals(ProximityReading.FAR, composite.currentObservation().reading)
        assertEquals(false, cameraQueried)
    }
}
