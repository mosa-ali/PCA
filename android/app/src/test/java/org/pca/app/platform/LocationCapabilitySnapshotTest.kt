package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class LocationCapabilitySnapshotTest {
    private fun snapshot(
        permissionState: LocationPermissionState = LocationPermissionState.FINE,
        backgroundState: BackgroundLocationState = BackgroundLocationState.GRANTED,
        servicesState: LocationServicesState = LocationServicesState.ENABLED,
        providerAvailability: LocationProviderAvailability = LocationProviderAvailability(gpsProviderEnabled = true, networkProviderEnabled = true),
        backgroundExecutionUnrestricted: Boolean = true,
    ) = LocationCapabilitySnapshot(permissionState, backgroundState, servicesState, providerAvailability, backgroundExecutionUnrestricted)

    // --- NF-001: background permission distinctions -------------------

    @Test
    fun `foreground denied is reported as NOT_APPLICABLE, never a false NOT_GRANTED background claim`() {
        val snap = snapshot(permissionState = LocationPermissionState.DENIED, backgroundState = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED)
        assertEquals(BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED, snap.backgroundState)
        assertEquals(LocationCapabilityLevel.UNUSABLE, snap.overallLevel)
    }

    @Test
    fun `foreground granted, background NOT_GRANTED is LIMITED, not USABLE or UNUSABLE`() {
        val snap = snapshot(backgroundState = BackgroundLocationState.NOT_GRANTED)
        assertEquals(LocationCapabilityLevel.LIMITED, snap.overallLevel)
    }

    @Test
    fun `foreground and background both granted is USABLE when every other signal is nominal`() {
        val snap = snapshot(backgroundState = BackgroundLocationState.GRANTED)
        assertEquals(LocationCapabilityLevel.USABLE, snap.overallLevel)
    }

    @Test
    fun `pre-Q implicit background coverage is treated as usable, not as a missing grant`() {
        val snap = snapshot(backgroundState = BackgroundLocationState.IMPLICIT_VIA_FOREGROUND_PRE_Q)
        assertEquals(LocationCapabilityLevel.USABLE, snap.overallLevel)
    }

    // --- permission transitions / coarse-only ---------------------------

    @Test
    fun `permission transition from FINE to DENIED moves overall level from USABLE to UNUSABLE`() {
        val before = snapshot(permissionState = LocationPermissionState.FINE)
        val after = snapshot(permissionState = LocationPermissionState.DENIED, backgroundState = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED)
        assertEquals(LocationCapabilityLevel.USABLE, before.overallLevel)
        assertEquals(LocationCapabilityLevel.UNUSABLE, after.overallLevel)
    }

    @Test
    fun `COARSE_ONLY permission is LIMITED, never silently treated as full precision`() {
        val snap = snapshot(permissionState = LocationPermissionState.COARSE_ONLY)
        assertEquals(LocationCapabilityLevel.LIMITED, snap.overallLevel)
    }

    // --- location services disabled -------------------------------------

    @Test
    fun `location services disabled is UNUSABLE regardless of permission state`() {
        val snap = snapshot(servicesState = LocationServicesState.DISABLED)
        assertEquals(LocationCapabilityLevel.UNUSABLE, snap.overallLevel)
    }

    // --- provider / battery-restriction degraded cases -------------------

    @Test
    fun `both providers disabled is UNUSABLE`() {
        val snap = snapshot(providerAvailability = LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = false))
        assertEquals(LocationCapabilityLevel.UNUSABLE, snap.overallLevel)
    }

    @Test
    fun `exactly one provider disabled is LIMITED, not UNUSABLE -- a fix may still be obtainable via the other`() {
        val snap = snapshot(providerAvailability = LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = true))
        assertEquals(LocationCapabilityLevel.LIMITED, snap.overallLevel)
    }

    @Test
    fun `battery-restricted background execution is LIMITED, not silently ignored`() {
        val snap = snapshot(backgroundExecutionUnrestricted = false)
        assertEquals(LocationCapabilityLevel.LIMITED, snap.overallLevel)
    }
}
