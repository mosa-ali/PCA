package org.pca.app.runtime.location.geofence

/**
 * Delivery boundary for a confirmed [GeofenceEvent] -- kept as a narrow port (same split as
 * [org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery] vs the pure engines that
 * feed it) so [GeofenceMonitor] stays unit-testable with a fake, and the real Android
 * notification-posting concern lives in its own adapter ([AndroidGeofenceAlertDelivery]).
 */
fun interface GeofenceAlertPort {
    fun deliver(event: GeofenceEvent)
}

/** Records every delivered event in-memory -- real, usable in production for a caller that wants
 * an in-process event log (e.g. a future zone-activity screen), and doubles as the test double. */
class RecordingGeofenceAlertPort : GeofenceAlertPort {
    private val _delivered = mutableListOf<GeofenceEvent>()
    val delivered: List<GeofenceEvent> get() = _delivered

    override fun deliver(event: GeofenceEvent) {
        _delivered += event
    }
}
