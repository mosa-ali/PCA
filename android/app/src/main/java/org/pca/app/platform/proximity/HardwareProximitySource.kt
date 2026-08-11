package org.pca.app.platform.proximity

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import org.pca.app.foundation.MonotonicTimeSource

/**
 * Tier 1 of the sensor hierarchy (doc 13 Section 4): the platform's low-power hardware proximity
 * sensor (`Sensor.TYPE_PROXIMITY`), preferred over camera estimation whenever present. This
 * sensor requires no runtime permission and, on the overwhelming majority of devices, is
 * genuinely binary (an object is either closer than [Sensor.getMaximumRange] or not) -- this
 * adapter reports NEAR/FAR using exactly that platform-native threshold and never fabricates a
 * finer-grained centimetre reading than the hardware provides.
 *
 * [start]/[stop] control sensor registration explicitly rather than registering in the
 * constructor, so a caller (the eye-distance feature's lifecycle owner) controls exactly when
 * the OS is asked to deliver events -- consistent with this feature never running hidden
 * background monitoring.
 */
class HardwareProximitySource(
    context: Context,
    private val monotonicTimeSource: MonotonicTimeSource,
) : ProximitySource, SensorEventListener {

    private val sensorManager = context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_PROXIMITY)

    @Volatile private var listening = false
    @Volatile private var lastReading: ProximityReading = ProximityReading.UNKNOWN

    override val sourceClass = ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR

    override fun availability(): ProximitySourceAvailability =
        if (sensor != null) ProximitySourceAvailability.AVAILABLE else ProximitySourceAvailability.UNAVAILABLE

    fun start() {
        val s = sensor ?: return
        if (listening) return
        sensorManager?.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL)
        listening = true
    }

    fun stop() {
        if (!listening) return
        sensorManager?.unregisterListener(this)
        listening = false
        lastReading = ProximityReading.UNKNOWN
    }

    override fun onSensorChanged(event: SensorEvent) {
        val distance = event.values.firstOrNull() ?: return
        val maxRange = sensor?.maximumRange ?: Float.MAX_VALUE
        lastReading = classifyProximity(distance, maxRange)
    }

    override fun onAccuracyChanged(changedSensor: Sensor?, accuracy: Int) {
        // Binary-style proximity sensors do not carry a policy-relevant accuracy tier here;
        // nothing to react to.
    }

    override fun currentObservation(): ProximityObservation {
        val avail = availability()
        val reading = if (avail == ProximitySourceAvailability.AVAILABLE && listening) lastReading else ProximityReading.UNKNOWN
        return ProximityObservation(
            reading = reading,
            sourceClass = sourceClass,
            confidence = if (reading == ProximityReading.UNKNOWN) ProximityConfidence.NONE else ProximityConfidence.HIGH,
            availability = avail,
            elapsedRealtimeNanos = monotonicTimeSource.elapsedRealtimeNanos(),
            degraded = false,
        )
    }
}

/**
 * Pure classification, extracted so it is directly unit-testable without an Android/Robolectric
 * test harness (this codebase's established pattern for platform-adapter logic -- see e.g.
 * `org.pca.app.platform.mapAppOpsMode`). Reports the platform's own binary near/far threshold
 * exactly as `Sensor.getMaximumRange` defines it -- never a fabricated finer-grained distance.
 */
internal fun classifyProximity(distance: Float, maxRange: Float): ProximityReading =
    if (distance < maxRange) ProximityReading.NEAR else ProximityReading.FAR
