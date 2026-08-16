package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.platform.LocationSample

/** [GeofenceEngine] tests build [LocationSample]s at an EXACT distance from the zone center by
 * offsetting purely in latitude -- for a zero longitude delta, the haversine great-circle formula
 * reduces exactly to `distance = earthRadius * deltaLatitudeRadians`, so these fixtures are exact,
 * not approximate. */
class GeofenceEngineTest {

    private val zone = GeofenceZone(
        zoneId = "zone-1",
        label = "Home",
        centerLatitude = 25.0,
        centerLongitude = 55.0,
        radiusMeters = 100.0,
    )

    private fun sampleAtDistance(meters: Double): LocationSample {
        val deltaLatDegrees = Math.toDegrees(meters / EARTH_RADIUS_METERS)
        return LocationSample(
            latitude = zone.centerLatitude + deltaLatDegrees,
            longitude = zone.centerLongitude,
            accuracyMeters = 5f,
            elapsedRealtimeMillis = 0L,
        )
    }

    private fun freshState() = GeofenceZoneState(zoneId = zone.zoneId)

    @Test
    fun `cold start confirming inside never emits a transition`() {
        var state = freshState()
        val config = GeofenceConfig(requiredConsecutiveSamplesToConfirm = 2)

        val e1 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 1L, config)
        assertNull(e1.transition)
        state = e1.newState

        val e2 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 2L, config)
        assertNull("cold-start baseline confirmation must never itself alert", e2.transition)
        assertEquals(GeofenceMembership.INSIDE, e2.newState.confirmedMembership)
    }

    @Test
    fun `cold start confirming outside never emits a transition`() {
        var state = freshState()
        val config = GeofenceConfig(requiredConsecutiveSamplesToConfirm = 2)

        state = GeofenceEngine.evaluate(zone, state, sampleAtDistance(500.0), 1L, config).newState
        val e2 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(500.0), 2L, config)
        assertNull(e2.transition)
        assertEquals(GeofenceMembership.OUTSIDE, e2.newState.confirmedMembership)
    }

    @Test
    fun `entry is confirmed only after required consecutive samples`() {
        val config = GeofenceConfig(requiredConsecutiveSamplesToConfirm = 3)
        var state = GeofenceZoneState(zoneId = zone.zoneId, confirmedMembership = GeofenceMembership.OUTSIDE)

        val e1 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 1L, config)
        assertNull("1st agreeing sample must not confirm yet", e1.transition)
        state = e1.newState

        val e2 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 2L, config)
        assertNull("2nd agreeing sample must not confirm yet", e2.transition)
        state = e2.newState

        val e3 = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 3L, config)
        assertEquals(GeofenceTransitionType.ENTRY, e3.transition)
        assertEquals(GeofenceMembership.INSIDE, e3.newState.confirmedMembership)
    }

    @Test
    fun `exit requires clearing radius plus hysteresis, not just the radius`() {
        val config = GeofenceConfig(hysteresisMeters = 50.0, requiredConsecutiveSamplesToConfirm = 1)
        val insideState = GeofenceZoneState(zoneId = zone.zoneId, confirmedMembership = GeofenceMembership.INSIDE)

        // 130m > radius(100) but < radius+hysteresis(150) -- must still read as INSIDE.
        val stillInside = GeofenceEngine.evaluate(zone, insideState, sampleAtDistance(130.0), 1L, config)
        assertNull(stillInside.transition)
        assertEquals(GeofenceMembership.INSIDE, stillInside.newState.confirmedMembership)

        // 160m clears radius+hysteresis(150) -- now genuinely outside.
        val exited = GeofenceEngine.evaluate(zone, insideState, sampleAtDistance(160.0), 2L, config)
        assertEquals(GeofenceTransitionType.EXIT, exited.transition)
        assertEquals(GeofenceMembership.OUTSIDE, exited.newState.confirmedMembership)
    }

    @Test
    fun `rapid boundary-crossing jitter does not produce a spurious transition`() {
        val config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 3)
        var state = GeofenceZoneState(zoneId = zone.zoneId, confirmedMembership = GeofenceMembership.INSIDE)

        // Alternates outside/inside/outside/inside around the boundary -- streak keeps resetting,
        // so a transition must never be confirmed no matter how many samples arrive.
        val distances = listOf(150.0, 50.0, 150.0, 50.0, 150.0, 50.0, 150.0, 50.0)
        distances.forEachIndexed { index, meters ->
            val evaluation = GeofenceEngine.evaluate(zone, state, sampleAtDistance(meters), index.toLong(), config)
            assertNull("sample #$index at ${meters}m must not confirm a transition amid jitter", evaluation.transition)
            state = evaluation.newState
        }
        assertEquals(GeofenceMembership.INSIDE, state.confirmedMembership)
    }

    @Test
    fun `an agreeing streak resumes correctly after jitter interrupts it`() {
        val config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 2)
        var state = GeofenceZoneState(zoneId = zone.zoneId, confirmedMembership = GeofenceMembership.INSIDE)

        // One outside sample (streak=1), one inside sample (resets), then two outside samples in a
        // row (streak 1, then 2) -- only the second of THOSE two confirms the exit.
        state = GeofenceEngine.evaluate(zone, state, sampleAtDistance(150.0), 1L, config).newState
        state = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 2L, config).newState
        assertEquals(GeofenceMembership.INSIDE, state.confirmedMembership)

        val third = GeofenceEngine.evaluate(zone, state, sampleAtDistance(150.0), 3L, config)
        assertNull(third.transition)
        state = third.newState

        val fourth = GeofenceEngine.evaluate(zone, state, sampleAtDistance(150.0), 4L, config)
        assertEquals(GeofenceTransitionType.EXIT, fourth.transition)
    }

    @Test
    fun `no-change sample resets a stale candidate streak`() {
        val config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 5)
        var state = GeofenceZoneState(zoneId = zone.zoneId, confirmedMembership = GeofenceMembership.INSIDE)

        state = GeofenceEngine.evaluate(zone, state, sampleAtDistance(150.0), 1L, config).newState
        assertEquals(1, state.candidateStreak)

        // Reconfirms INSIDE -- must fully clear the pending OUTSIDE candidate.
        state = GeofenceEngine.evaluate(zone, state, sampleAtDistance(10.0), 2L, config).newState
        assertEquals(0, state.candidateStreak)
        assertEquals(GeofenceMembership.INSIDE, state.candidateMembership)
    }

    @Test
    fun `evaluate reports the real computed distance`() {
        val evaluation = GeofenceEngine.evaluate(zone, freshState(), sampleAtDistance(250.0), 1L)
        assertEquals(250.0, evaluation.distanceMeters, 0.5)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `mismatched zone and state ids fail fast`() {
        GeofenceEngine.evaluate(zone, GeofenceZoneState(zoneId = "other-zone"), sampleAtDistance(0.0), 1L)
    }

    private companion object {
        const val EARTH_RADIUS_METERS = 6_371_000.0
    }
}
