package org.pca.app.persistence.retention

import java.time.Instant
import java.time.ZoneId
import org.pca.app.persistence.entity.RetentionPolicy

/**
 * PCA-DATA-024/PCA-FR-105 closure: the one real periodic-maintenance cycle that turns
 * [RetentionEngine] from "correct, unit-tested, and never invoked" into an actually-running
 * on-device deletion pipeline. A repo-wide audit found [RetentionEngine] constructed exactly
 * once in production (as [org.pca.app.persistence.PcaLocalPersistence.retentionEngine]) but
 * called by NOTHING -- on-device data was never actually pruned per retention policy before
 * this wiring, regardless of how correct the engine's own three methods are in isolation.
 *
 * Deliberately a small, standalone, dependency-injected function (rather than logic inlined
 * only inside [org.pca.app.runtime.graph.PcaAppGraph.runRetentionMaintenanceCycle]) so it can
 * be exercised directly against a real, in-memory Room [org.pca.app.persistence.PcaLocalDatabase]-backed
 * [RetentionEngine] in a plain unit test (see `RetentionMaintenanceCycleTest`, which reuses
 * `RetentionEngineTest`'s own in-memory-database setup) without needing this repo's full
 * production composition root or its `AndroidKeyStore`-backed stores, which are unavailable
 * under the plain-JVM Robolectric unit-test environment this module's `testDebugUnitTest` runs
 * in. [PcaAppGraph.runRetentionMaintenanceCycle] is a thin production wrapper that resolves the
 * live enrollment state and delegates here -- one real implementation, never two copies that
 * could drift.
 *
 * [familyId]/[deviceId] are nullable because the production caller resolves them from live,
 * possibly-absent enrollment state (`familyStateStore.currentState()?.familyId` /
 * `enrolledDeviceIdOrNull()`) -- either being null means "not enrolled yet," and this function
 * does nothing rather than fabricate a retention scope, matching this app's established
 * "not enrolled -> skip the cycle" discipline used elsewhere in the composition root (e.g.
 * [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle]'s own
 * `enrolledDeviceIdOrNull() == null` guard).
 *
 * A single [nowUtc] snapshot is threaded through all three engine calls (never three independent
 * `Instant.now()` reads) so the whole cycle judges every table against the exact same instant --
 * the same discipline [DeleteNowCoordinator] already uses for its own multi-step deletion calls,
 * and the only way to avoid a record landing on different sides of the retention cutoff in
 * different steps purely because of clock drift between calls.
 *
 * Each of the three [RetentionEngine] calls is independently [runCatching]-guarded: a failure in
 * one (e.g. [RetentionEngine.runGeneralCycle]'s own scope validation rejecting a device that is
 * not yet a recognized family member) must never skip the other two, and this function itself
 * must never throw back to its caller -- the same "never crash the caller" tick discipline
 * [PcaAppGraph.runUsageLocationIngestionCycle] documents for its own steps.
 *
 * [generalRetentionPolicy]/[locationRetentionPolicy] both default to the conservative
 * [RetentionPolicy.FOURTEEN_DAYS]. There is no signed, parent-authored retention policy delivery
 * path in this codebase yet -- it is gated behind the same `PRODUCTION_CRYPTO_SUITE` human
 * security review as [org.pca.app.runtime.port.FamilySyncRuntimePort]/
 * [org.pca.app.security.DeviceKeyPairGenerator] (see [PcaAppGraph]'s own doc comments on those
 * fields). Until that review clears and a real policy-application layer exists, this reuses the
 * exact same conservative default [org.pca.app.runtime.location.LocationSampleRecorder] already
 * established for the analogous "no real policy signal yet" location-retention gap
 * ([PcaAppGraph.runUsageLocationIngestionCycle] passes `RetentionPolicy.FOURTEEN_DAYS` to
 * `locationSampleRecorder.captureSample` for the same reason), rather than inventing a second,
 * differently-chosen conservative default.
 */
suspend fun executeRetentionMaintenanceCycle(
    engine: RetentionEngine,
    familyId: String?,
    deviceId: String?,
    zoneId: ZoneId,
    nowUtc: Instant = Instant.now(),
    generalRetentionPolicy: RetentionPolicy = RetentionPolicy.FOURTEEN_DAYS,
    locationRetentionPolicy: RetentionPolicy = RetentionPolicy.FOURTEEN_DAYS,
) {
    if (familyId.isNullOrBlank() || deviceId.isNullOrBlank()) return

    val ctx = DeviceRetentionContext(
        deviceId = deviceId,
        generalRetentionPolicy = generalRetentionPolicy,
        locationRetentionPolicy = locationRetentionPolicy,
        zoneId = zoneId,
    )
    runCatching { engine.runGeneralCycle(familyId, nowUtc, listOf(ctx)) }
    runCatching { engine.runAuditFloorCycle(familyId, nowUtc, generalRetentionPolicy, zoneId) }
    runCatching { engine.pruneTombstones(nowUtc, zoneId) }
}
