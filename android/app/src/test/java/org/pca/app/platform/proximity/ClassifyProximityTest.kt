package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Test

class ClassifyProximityTest {

    @Test
    fun `distance below maximumRange is NEAR`() {
        assertEquals(ProximityReading.NEAR, classifyProximity(distance = 0f, maxRange = 5f))
    }

    @Test
    fun `distance at or above maximumRange is FAR`() {
        assertEquals(ProximityReading.FAR, classifyProximity(distance = 5f, maxRange = 5f))
        assertEquals(ProximityReading.FAR, classifyProximity(distance = 8f, maxRange = 5f))
    }
}
