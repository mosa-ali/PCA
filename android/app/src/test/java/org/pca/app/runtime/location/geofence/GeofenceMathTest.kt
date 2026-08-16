package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeofenceMathTest {

    @Test
    fun `same point is zero distance`() {
        val distance = GeofenceMath.haversineMeters(51.5, -0.12, 51.5, -0.12)
        assertEquals(0.0, distance, 0.001)
    }

    @Test
    fun `known one-degree-latitude separation is about 111km`() {
        val distance = GeofenceMath.haversineMeters(0.0, 0.0, 1.0, 0.0)
        // ~111.19km per degree of latitude -- generous tolerance, this is a sanity check on the
        // formula/constant, not a geodesy-precision assertion.
        assertTrue("expected ~111km, got ${distance}m", distance in 110_000.0..112_500.0)
    }

    @Test
    fun `small nearby offset yields plausible short distance`() {
        // Roughly 0.0009 degrees latitude at the equator-ish is about 100m.
        val distance = GeofenceMath.haversineMeters(25.0, 55.0, 25.0009, 55.0)
        assertTrue("expected roughly 100m, got ${distance}m", distance in 80.0..120.0)
    }

    @Test
    fun `distance is symmetric`() {
        val a = GeofenceMath.haversineMeters(25.1, 55.2, 25.4, 55.6)
        val b = GeofenceMath.haversineMeters(25.4, 55.6, 25.1, 55.2)
        assertEquals(a, b, 0.0001)
    }
}
