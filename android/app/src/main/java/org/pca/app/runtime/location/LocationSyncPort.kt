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
 * itself is opaque bytes this module never inspects. A caller MUST route every
 * [LocationSampleSyncPayload] through the established E2EE envelope construction before it leaves
 * this device; it MUST NEVER be logged, written to unencrypted storage, or handed to any
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
 * Clean port boundary for the sync layer: exposes locally-recorded, still-encrypted-at-rest
 * location samples as [LocationSampleSyncPayload]s, and nothing else -- no transport, no envelope
 * construction, no direct network path. A concrete sync implementation is expected to map each
 * payload into an outbound [org.pca.app.runtime.sync.envelope.FamilyEnvelope] (E2EE-encrypted
 * there, never here) and hand that envelope to [org.pca.app.runtime.sync.outbox.SyncOutboxPort].
 */
interface LocationSyncPayloadSource {
    suspend fun pendingSamplesForSync(deviceId: String): List<LocationSampleSyncPayload>
}

/** Thin, non-mutating adapter over [LocationPointRepository] -- reuses Agent-12's decrypt-on-read
 * path rather than reimplementing it. */
class RepositoryBackedLocationSyncPayloadSource(
    private val repository: LocationPointRepository,
) : LocationSyncPayloadSource {

    override suspend fun pendingSamplesForSync(deviceId: String): List<LocationSampleSyncPayload> =
        repository.getForDevice(deviceId).map { it.toSyncPayload() }

    private fun LocationPoint.toSyncPayload() = LocationSampleSyncPayload(
        sampleId = id,
        deviceId = deviceId,
        timestampEpochMillis = timestampEpochMillis,
        latitude = latitude,
        longitude = longitude,
        accuracyMeters = accuracyMeters,
        precisionTier = if (source == LocationSampleRecorder.SOURCE_APPROXIMATE) {
            LocationPrecisionTier.APPROXIMATE
        } else {
            LocationPrecisionTier.EXACT
        },
    )
}
