package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FaceProximityClassifierTest {

    @Test
    fun `no face detected is UNKNOWN, never fabricated as FAR`() {
        assertEquals(ProximityReading.UNKNOWN, FaceProximityClassifier.classify(null))
    }

    @Test
    fun `large bounding box fraction reads NEAR`() {
        assertEquals(ProximityReading.NEAR, FaceProximityClassifier.classify(0.5))
    }

    @Test
    fun `exactly at the near threshold reads NEAR`() {
        val config = FaceProximityClassifierConfig(nearFractionThreshold = 0.35, farFractionThreshold = 0.15)
        assertEquals(ProximityReading.NEAR, FaceProximityClassifier.classify(0.35, config))
    }

    @Test
    fun `small bounding box fraction reads FAR`() {
        assertEquals(ProximityReading.FAR, FaceProximityClassifier.classify(0.05))
    }

    @Test
    fun `exactly at the far threshold reads FAR`() {
        val config = FaceProximityClassifierConfig(nearFractionThreshold = 0.35, farFractionThreshold = 0.15)
        assertEquals(ProximityReading.FAR, FaceProximityClassifier.classify(0.15, config))
    }

    @Test
    fun `mid-band fraction is UNKNOWN rather than a guess`() {
        assertEquals(ProximityReading.UNKNOWN, FaceProximityClassifier.classify(0.25))
    }

    @Test
    fun `zero fraction reads FAR (a technically-detected but vanishingly small face)`() {
        assertEquals(ProximityReading.FAR, FaceProximityClassifier.classify(0.0))
    }

    @Test
    fun `negative fraction is rejected rather than silently classified`() {
        assertThrows(IllegalArgumentException::class.java) {
            FaceProximityClassifier.classify(-0.1)
        }
    }

    @Test
    fun `non-finite fraction is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            FaceProximityClassifier.classify(Double.NaN)
        }
    }

    @Test
    fun `config rejects an inverted threshold pair`() {
        assertThrows(IllegalArgumentException::class.java) {
            FaceProximityClassifierConfig(nearFractionThreshold = 0.1, farFractionThreshold = 0.2)
        }
    }

    @Test
    fun `config rejects equal thresholds (would leave no UNKNOWN band)`() {
        assertThrows(IllegalArgumentException::class.java) {
            FaceProximityClassifierConfig(nearFractionThreshold = 0.2, farFractionThreshold = 0.2)
        }
    }
}
