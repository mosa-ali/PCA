package org.pca.app.runtime.location

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.platform.BackgroundLocationState
import org.pca.app.platform.LocationCapabilitySnapshot
import org.pca.app.platform.LocationPermissionState
import org.pca.app.platform.LocationProviderAvailability
import org.pca.app.platform.LocationServicesState

class LocationSampleStatusTest {

    private fun snapshot(
        permission: LocationPermissionState = LocationPermissionState.FINE,
        background: BackgroundLocationState = BackgroundLocationState.GRANTED,
        services: LocationServicesState = LocationServicesState.ENABLED,
        gps: Boolean = true,
        network: Boolean = true,
    ) = LocationCapabilitySnapshot(
        permissionState = permission,
        backgroundState = background,
        servicesState = services,
        providerAvailability = LocationProviderAvailability(gpsProviderEnabled = gps, networkProviderEnabled = network),
        backgroundExecutionUnrestricted = true,
    )

    @Test
    fun `full fine-permission, services-on, provider-available snapshot resolves to AVAILABLE`() {
        assertEquals(LocationSampleStatus.AVAILABLE, LocationSampleStatusResolver.resolve(snapshot()))
    }

    @Test
    fun `denied permission resolves to PERMISSION_REQUIRED regardless of other fields`() {
        val snap = snapshot(permission = LocationPermissionState.DENIED, services = LocationServicesState.DISABLED)
        assertEquals(LocationSampleStatus.PERMISSION_REQUIRED, LocationSampleStatusResolver.resolve(snap))
    }

    @Test
    fun `coarse-only permission resolves to APPROXIMATE_ONLY`() {
        val snap = snapshot(permission = LocationPermissionState.COARSE_ONLY, background = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED)
        assertEquals(LocationSampleStatus.APPROXIMATE_ONLY, LocationSampleStatusResolver.resolve(snap))
    }

    @Test
    fun `system-wide services disabled resolves to LOCATION_DISABLED even with fine permission`() {
        val snap = snapshot(services = LocationServicesState.DISABLED)
        assertEquals(LocationSampleStatus.LOCATION_DISABLED, LocationSampleStatusResolver.resolve(snap))
    }

    @Test
    fun `no provider enabled at all resolves to UNAVAILABLE`() {
        val snap = snapshot(gps = false, network = false)
        assertEquals(LocationSampleStatus.UNAVAILABLE, LocationSampleStatusResolver.resolve(snap))
    }

    @Test
    fun `fine permission but background not granted resolves to BACKGROUND_LIMITED`() {
        val snap = snapshot(background = BackgroundLocationState.NOT_GRANTED)
        assertEquals(LocationSampleStatus.BACKGROUND_LIMITED, LocationSampleStatusResolver.resolve(snap))
    }

    @Test
    fun `permission denial takes precedence over a disabled provider`() {
        val snap = snapshot(permission = LocationPermissionState.DENIED, gps = false, network = false)
        assertEquals(LocationSampleStatus.PERMISSION_REQUIRED, LocationSampleStatusResolver.resolve(snap))
    }
}
