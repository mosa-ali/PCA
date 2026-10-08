package org.pca.app.runtime.location

import org.pca.app.persistence.repository.LocationPoint
import org.pca.app.persistence.repository.LocationPointRepository

/** Honest precision marker carried alongside every synced sample -- mirrors
 * [org.pca.app.persistence.entity.SourceConfidence]'s "never let a downstream consumer assume
 * better provenance than what was actually observed" discipline. A parent-facing surface that
 * receives [LocationPrecisionTier.APPROXIMATE] must never render it as if it were an exact fix. */
enum class LocationPrecisionTier { EXACT, APPROXIMATE }

/**
 * Domain-shaped payload for whichever component (Agent 16 / Coordinator integration) builds the
 * outbound family-sync [org.pca.app.runtime.sync.envelope.FamilyEnvelope] -- same "this lane
 * defines the port, the transport and envelope encryption are out of scope" split as
 * [org.pca.app.runtime.usage.UsageSessionSyncPayload] and
 * [org.pca.app.runtime.port.FamilySyncRuntimePort].
 *
 * IMPORTANT: [latitude]/[longitude] here are still PLAINTEXT domain values (decrypted from this
 * device's own local-at-rest encryption by [LocationPointRepository] so the sync layer has
 * something to encrypt) -- exactly analogous to how [org.pca.app.runtime.sync.envelope.FamilyEnvelope.payload]
 * itself is opaque bytes this module never inspects. A future caller must route every
 * [LocationSampleSyncPayload] through an E2EE envelope before it leaves this device; this port
 * does not construct that envelope or prove a transport path exists. Coordinates MUST NEVER be
 * logged, written to unencrypted storage, or handed to any
 * network/transport call directly. [toString] is overridden to redact the coordinate fields as a
 * defense-in-depth guard against exactly that kind of accidental leak (e.g. a debug log
 * statement) -- see `LocationSyncPortTest` for the runnable proof.
 */
data class LocationSampleSyncPayload(
    val sampleId: String,
    val deviceId: String,
    val timestampEpochMillis: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val precisionTier: LocationPrecisionTier,
) {
    override fun toString(): String = "LocationSampleSyncPayload(" +
        "sampleId=$sampleId, deviceId=$deviceId, timestampEpochMillis=$timestampEpochMillis, " +
        "latitude=$REDACTED, longitude=$REDACTED, accuracyMeters=$accuracyMeters, precisionTier=$precisionTier)"

    private companion object {
        const val REDACTED = "***REDACTED***"
    }
}

/**
 * Clean port boundary for the sync layer: reads local rows whose coordinates are encrypted at
 * rest, then returns [LocationSampleSyncPayload]s with plaintext coordinates in memory for a
 * trusted E2EE envelope builder. The caller must never log these values, store them unencrypted,
 * or send them directly over the network. This port has no transport or envelope construction.
 * A future sync implementation must put each payload into an outbound
 * [org.pca.app.runtime.sync.envelope.FamilyEnvelope] (encrypted there, never here) and hand that
 * envelope to [org.pca.app.runtime.sync.outbox.SyncOutboxPort]. Unknown source values fail closed
 * instead of being promoted to exact precision.
 */
interface LocationSyncPayloadSource {
    /**
     * Returns all rows currently stored for [deviceId], not a pending-delivery queue. The DAO
     * does not evaluate retention cutoffs, so an expired row can remain available until scheduled
     * cleanup deletes it. There is no delivery marker or acknowledgement, so repeated reads can
     * return the same rows. The caller must supply the currently enrolled device identity; this
     * port scopes records to that value but is not an authority boundary.
     */
    suspend fun availableSamplesForSync(deviceId: String): List<LocationSampleSyncPayload>
}

/** Thin, non-mutating adapter over [LocationPointRepository] -- reuses Agent-12's decrypt-on-read
 * path rather than reimplementing it. */
class RepositoryBackedLocationSyncPayloadSource(
    private val repository: LocationPointRepository,
) : LocationSyncPayloadSource {

    override suspend fun availableSamplesForSync(deviceId: String): List<LocationSampleSyncPayload> =
        repository.getForDevice(deviceId).map { sample ->
            check(sample.deviceId == deviceId) {
                "Location point repository returned a row outside the requested device scope"
            }
            sample.toSyncPayload()
        }

    private fun LocationPoint.toSyncPayload() = LocationSampleSyncPayload(
        sampleId = id,
        deviceId = this.deviceId,
        timestampEpochMillis = timestampEpochMillis,
        latitude = latitude,
        longitude = longitude,
        accuracyMeters = accuracyMeters,
        precisionTier = when (source) {
            LocationSampleRecorder.SOURCE_APPROXIMATE -> LocationPrecisionTier.APPROXIMATE
            LocationSampleRecorder.SOURCE_PLATFORM_FIX -> LocationPrecisionTier.EXACT
            else -> throw IllegalStateException("Location point has an unsupported source for sync precision")
        },
    )
}
