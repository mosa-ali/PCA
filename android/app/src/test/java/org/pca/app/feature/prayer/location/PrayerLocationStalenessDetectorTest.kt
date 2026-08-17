package org.pca.app.feature.prayer.location

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class PrayerLocationStalenessDetectorTest {
    @Test
    fun `first offline sample establishes an anchor without a notice`() {
        val detector = PrayerLocationStalenessDetector(InMemoryPersistentStateStore())

        assertFalse(detector.shouldNotify("device-1", 24.7136, 46.6753, isOnline = false))
    }

    @Test
    fun `material offline travel requests one notice until delivery is acknowledged`() {
        val detector = PrayerLocationStalenessDetector(InMemoryPersistentStateStore())
        detector.shouldNotify("device-1", 24.7136, 46.6753, isOnline = false)

        assertTrue(detector.shouldNotify("device-1", 25.2048, 55.2708, isOnline = false))
        detector.markDelivered("device-1")
        assertFalse(detector.shouldNotify("device-1", 25.2048, 55.2708, isOnline = false))
    }

    @Test
    fun `online observation clears the episode so a later offline trip can notify again`() {
        val detector = PrayerLocationStalenessDetector(InMemoryPersistentStateStore())
        detector.shouldNotify("device-1", 24.7136, 46.6753, isOnline = false)
        assertTrue(detector.shouldNotify("device-1", 25.2048, 55.2708, isOnline = false))
        detector.markDelivered("device-1")
        assertFalse(detector.shouldNotify("device-1", 25.2048, 55.2708, isOnline = true))
        assertFalse(detector.shouldNotify("device-1", 25.2048, 55.2708, isOnline = false))
    }

    @Test
    fun `movement below material threshold does not request a notice`() {
        val detector = PrayerLocationStalenessDetector(InMemoryPersistentStateStore())
        detector.shouldNotify("device-1", 24.7136, 46.6753, isOnline = false)

        assertFalse(detector.shouldNotify("device-1", 24.75, 46.70, isOnline = false))
    }
}
