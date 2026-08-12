package org.pca.app.runtime.graph

import android.content.Context
import android.content.Intent
import android.provider.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshotStore
import org.pca.app.feature.eyedistance.persistence.PersistentEyeDistanceSnapshotStore
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.persistence.PersistentScreenTimeSnapshotStore
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshotStore
import org.pca.app.feature.screentime.policy.ScreenTimePolicyApplier
import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.engine.WebFilterEngine
import org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy
import org.pca.app.feature.youtube.engine.ModeAAndroidUsageAdapter
import org.pca.app.feature.youtube.policy.ModeBFeatureFlagLocalStore
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.delivery.WellbeingMessageResolver
import org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore
import org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore
import org.pca.app.feature.wellbeing.ports.StandardNotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.StandardScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.StandardWallClockCalendarSource
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.foundation.SystemMonotonicTimeSource
import org.pca.app.foundation.SystemWallClockTimeSource
import org.pca.app.persistence.PcaLocalPersistence
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.platform.DevicePolicyProtectionCapabilities
import org.pca.app.platform.StandardDevicePolicyCapabilitySource
import org.pca.app.platform.StandardLocationCapabilitySource
import org.pca.app.platform.StandardUsageObservationSource
import org.pca.app.platform.proximity.HardwareProximitySource
import org.pca.app.platform.proximity.PrioritizedProximitySource
import org.pca.app.platform.proximity.ProximitySource
import org.pca.app.runtime.PcaRuntime
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.connectivity.AndroidNetworkConnectivityObserver
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.FamilySyncRuntimePort
import org.pca.app.runtime.port.NotReadyScheduleRuntimePort
import org.pca.app.runtime.port.OfflineFamilySyncRuntimePort
import org.pca.app.runtime.port.ScheduleRuntimePort
import org.pca.app.runtime.location.LocationSampleRecorder
import org.pca.app.runtime.prayer.AlarmManagerPrayerScheduler
import org.pca.app.runtime.schedule.PersistentSchedulePolicyStore
import org.pca.app.runtime.schedule.ProductionScheduleRuntimePort
import org.pca.app.runtime.schedule.ScheduleRuntime
import org.pca.app.runtime.screenstate.AndroidScreenStateObserver
import org.pca.app.runtime.screenstate.ScreenStateObserver
import org.pca.app.runtime.usage.PersistentUsageObservationSnapshotStore
import org.pca.app.runtime.usage.UsageSessionRecorder
import org.pca.app.runtime.wellbeing.RuntimeBreakStateSource
import org.pca.app.runtime.wellbeing.RuntimeEligibleAppSignalSource
import org.pca.app.runtime.wellbeing.RuntimeSuppressionContextSource
import org.pca.app.runtime.wellbeing.RuntimeWellbeingScheduleContextSource
import org.pca.app.runtime.wellbeing.WellbeingRuntimeCoordinator
import java.util.UUID

/**
 * Single production composition root (Section 2 of the PCA-RUNTIME-ANDROID-1 brief) -- the
 * `PcaLocalPersistence` precedent for "exactly one production instance of each dependency,
 * manually wired, no reflection-based DI framework" (this codebase has none), extended to cover
 * every engine/port this runtime touches. [PcaApplication] holds exactly one [PcaAppGraph] for
 * the process lifetime; nothing else in the app should construct any of these types directly.
 *
 * [scheduleRuntimePort] defaults to the real Agent 10 binding ([ProductionScheduleRuntimePort],
 * backed by [ScheduleRuntime]/[PersistentSchedulePolicyStore]) -- pass an explicit override (e.g.
 * [org.pca.app.runtime.port.NotReadyScheduleRuntimePort] in tests) to bypass it.
 * [familySyncRuntimePort] still defaults to the conservative OFFLINE placeholder (Section 9):
 * Agent 16's real transport exists but its crypto verifiers are deliberately fail-closed pending
 * the separate production-crypto human security review (`PRODUCTION_CRYPTO_SUITE`), so binding it
 * here would only wrap an always-failing pipeline -- wiring it is deferred, not silently glued
 * over, until that gate clears.
 */
class PcaAppGraph private constructor(
    val context: Context,
    scheduleRuntimePortOverride: ScheduleRuntimePort?,
    val familySyncRuntimePort: FamilySyncRuntimePort,
    runtimeStateStore: PersistentStateStore,
    childRequestStateStore: PersistentStateStore,
) {
    val monotonicTimeSource = SystemMonotonicTimeSource()
    val wallClockTimeSource = SystemWallClockTimeSource()

    val bootId: String? = runCatching {
        Settings.Secure.getString(context.contentResolver, "android_id")
    }.getOrNull()

    val persistence: PcaLocalPersistence = PcaLocalPersistence.getInstance(context)

    val screenTimeSnapshotStore: ScreenTimeSnapshotStore = PersistentScreenTimeSnapshotStore(runtimeStateStore)
    val eyeDistanceSnapshotStore: EyeDistanceSnapshotStore = PersistentEyeDistanceSnapshotStore(runtimeStateStore)
    val childRequestQueue = ChildRequestOfflineQueue(childRequestStateStore)

    val connectivityObserver: NetworkConnectivityObserver = AndroidNetworkConnectivityObserver(context)

    /** Agent 10's real schedule authority, durably backed (mission section 12's offline-restart
     * requirement) -- the single instance both [scheduleRuntimePort]'s status reporting and
     * [buildWellbeingDispatcher]'s WELL-3 closure read from, so they can never disagree. */
    val schedulePolicyStore = PersistentSchedulePolicyStore(runtimeStateStore)
    val scheduleRuntime = ScheduleRuntime(schedulePolicyStore)
    val scheduleRuntimePort: ScheduleRuntimePort = scheduleRuntimePortOverride
        ?: ProductionScheduleRuntimePort(scheduleRuntime, wallClockTimeSource, connectivityObserver)

    val usageObservationSource = StandardUsageObservationSource(context, monotonicTimeSource, wallClockTimeSource)
    val locationCapabilitySource = StandardLocationCapabilitySource(context)
    val protectionCapabilities = DevicePolicyProtectionCapabilities(StandardDevicePolicyCapabilitySource(context))

    /** PCA-RUNTIME-2 Coordinator glue: this device's own stable local identifier, reusing the
     * same `android_id` this graph already resolves as [bootId] -- not a new identity concept.
     * Falls back to a random per-process id only in the (test-only/rooted-device) case where the
     * platform genuinely returns none, so [usageSessionRecorder]/[locationSampleRecorder] always
     * have a stable key to record against. */
    private val localDeviceId: String = bootId ?: UUID.randomUUID().toString()

    /** PCA-ANDROID-USAGE-LOCATION-1 (Agent 18) real production bindings: local-only, offline-safe
     * app-usage and location capture, feeding the same encrypted Room repositories every other
     * local record in this app uses. Neither is wired to a periodic caller by Agent 18 itself
     * (explicitly out of that lane's scope); [start] below drives both on a conservative interval,
     * mirroring [PcaRuntime]'s own tick-loop discipline. Sync-payload wiring into the real E2EE
     * outbox remains a separate follow-up gated on Agent 16's production crypto (see
     * [familySyncRuntimePort]'s own doc comment) -- these recorders only ever write to local,
     * on-device, encrypted-at-rest storage today. */
    val usageObservationSnapshotStore = PersistentUsageObservationSnapshotStore(runtimeStateStore)
    val usageSessionRecorder = UsageSessionRecorder(
        usageObservationSource = usageObservationSource,
        usageSessionRepository = persistence.usageSessionRepository,
        monotonicTimeSource = monotonicTimeSource,
        wallClockTimeSource = wallClockTimeSource,
        snapshotStore = usageObservationSnapshotStore,
        deviceId = localDeviceId,
        currentBootId = bootId,
    )
    val locationSampleRecorder = LocationSampleRecorder(
        locationCapabilitySource = locationCapabilitySource,
        locationPointRepository = persistence.locationPointRepository,
        monotonicTimeSource = monotonicTimeSource,
        wallClockTimeSource = wallClockTimeSource,
    )

    /** PCA-ANDROID-WEB-YOUTUBE-1 (Agent 19) real production bindings: the deterministic,
     * offline-first web-filter/Safe Browser engine and Mode A's aggregate-only YouTube usage
     * adapter. Neither is wired to a live navigation surface (a WebView/VPN integration) or a
     * parent-authored rule-delivery transport by Agent 19 itself (explicitly out of scope, and
     * out of scope for this narrow Coordinator pass too -- building either would be a new
     * subsystem, not glue); both are real, reachable, production-composed objects ready for that
     * follow-up wiring rather than dead code reachable only from tests. */
    val webRuleRepository = PersistentWebRuleRepository(runtimeStateStore)
    val webFilterEngine = WebFilterEngine(webRuleRepository)
    val safeBrowserNavigationPolicy = SafeBrowserNavigationPolicy(webFilterEngine, persistence.webVisitRepository)
    val modeAAndroidUsageAdapter = ModeAAndroidUsageAdapter(
        usageSessions = persistence.usageSessionRepository,
        accessState = { usageObservationSource.accessState() },
    )
    val modeBFeatureFlagLocalStore = ModeBFeatureFlagLocalStore(runtimeStateStore)

    /** PCA-SCREEN-BASELINE-1 (Agent 17) Coordinator glue: [PcaRuntime] is handed the applier's own
     * safe 60/30 default explicitly, rather than relying on [ScreenTimeConfig]'s constructor
     * default matching it by coincidence -- [ScreenTimePolicyApplier] is the single source of
     * truth for "the currently effective, baseline-compliant screen-time config" everywhere in
     * this app (also now enforced structurally by [ScreenTimeConfig]'s own `init` block). A future
     * parent-authored policy-delivery path (gated on the same production-crypto review as every
     * other incoming signed policy) must call [ScreenTimePolicyApplier.apply] and persist its
     * result as the next `lastKnownGoodConfig`, never construct a [ScreenTimeConfig] directly. */
    val screenTimeConfig: ScreenTimeConfig = ScreenTimePolicyApplier.SAFE_DEFAULT_CONFIG

    private val hardwareProximitySource = HardwareProximitySource(context, monotonicTimeSource)
    val proximitySource: ProximitySource = PrioritizedProximitySource(listOf(hardwareProximitySource))

    val prayerAlarmScheduler = AlarmManagerPrayerScheduler(context) { prayer -> prayerReminderIntent(prayer) }

    // Wellbeing production ports (Section 4/5/6/7): closes the exact gap
    // `feature/wellbeing/ports/WellbeingPorts.kt` documents as Coordinator-owned.
    private val notificationCapabilitySource = StandardNotificationCapabilitySource(context)
    private val screenLockStateSource = StandardScreenLockStateSource(context)
    private val wallClockCalendarSource = StandardWallClockCalendarSource()

    /** Correction round Section 2/3: the real device screen-use signal that drives
     * [PcaRuntime.pauseScreenTime]/[PcaRuntime.resumeScreenTime]. */
    val screenStateObserver: ScreenStateObserver = AndroidScreenStateObserver(context, screenLockStateSource)

    /** Family-policy predicate for which packages count as wellbeing-eligible. Empty by default
     * (no nudging until a real catalogue/policy source is wired) rather than fabricating a
     * default eligible-app list this lane has no policy authority to invent. */
    private val eligibleAppPackages: () -> Set<String> = { emptySet() }

    val eligibleAppSignalSource = RuntimeEligibleAppSignalSource(usageObservationSource, monotonicTimeSource, eligibleAppPackages)

    // Correction round Section 10/11: the real production caller of
    // WellbeingTriggerDispatcher.dispatch -- reuses the same encrypted runtimeStateStore as
    // screen-time/eye-distance snapshots (PCA-WELL-011/019's own durable-storage requirement),
    // and the existing accepted WellbeingNotificationDelivery/WellbeingContentCatalogue rather
    // than reimplementing delivery or content selection here.
    private val wellbeingPolicyStore = WellbeingPolicyStore(runtimeStateStore)
    private val wellbeingRateStateStore = WellbeingRateStateStore(runtimeStateStore)
    private val wellbeingMessageResolver = WellbeingMessageResolver(context)
    private val wellbeingNotificationDelivery = WellbeingNotificationDelivery(context, wellbeingMessageResolver)

    val wellbeingCoordinator = WellbeingRuntimeCoordinator(
        dispatcherProvider = { buildWellbeingDispatcher() },
        policyStore = wellbeingPolicyStore,
        rateStateStore = wellbeingRateStateStore,
        monotonicTimeSource = monotonicTimeSource,
        catalogueEntries = WellbeingContentCatalogue.entries,
        deliver = { delivery, suggestions, nowMonotonicNanos ->
            wellbeingNotificationDelivery.deliver(delivery, suggestions, nowMonotonicNanos)
        },
    )

    val coroutineScope: CoroutineScope = CoroutineScope(SupervisorJob())

    val runtime: PcaRuntime = PcaRuntime(
        monotonicTimeSource = monotonicTimeSource,
        wallClockTimeSource = wallClockTimeSource,
        screenTimeConfig = screenTimeConfig,
        screenTimeSnapshotStore = screenTimeSnapshotStore,
        eyeDistanceSnapshotStore = eyeDistanceSnapshotStore,
        currentBootId = bootId,
        connectivityObserver = connectivityObserver,
        scheduleRuntimePort = scheduleRuntimePort,
        familySyncRuntimePort = familySyncRuntimePort,
        protectionCapabilities = protectionCapabilities,
        usageObservationSource = usageObservationSource,
        locationCapabilitySource = locationCapabilitySource,
        notificationCapabilitySource = notificationCapabilitySource,
        proximitySource = proximitySource,
        wellbeingDispatcherProvider = { buildWellbeingDispatcher() },
        wellbeingCoordinator = wellbeingCoordinator,
        screenStateObserver = screenStateObserver,
        childRequestQueue = childRequestQueue,
        externalScope = coroutineScope,
    )

    private fun buildWellbeingDispatcher(): WellbeingTriggerDispatcher = WellbeingTriggerDispatcher(
        monotonicTimeSource = monotonicTimeSource,
        eligibleAppSignalSource = eligibleAppSignalSource,
        screenLockStateSource = screenLockStateSource,
        notificationCapabilitySource = notificationCapabilitySource,
        suppressionContextSource = RuntimeSuppressionContextSource(context) { runtime.screenTimeState.value },
        breakStateSource = RuntimeBreakStateSource { runtime.screenTimeState.value },
        wallClockCalendarSource = wallClockCalendarSource,
        scheduleContextSource = RuntimeWellbeingScheduleContextSource(scheduleRuntime, wallClockTimeSource),
    )

    /**
     * Targets this app's own package only (no explicit receiver component) -- the concrete
     * broadcast receiver that turns this into a user-visible reminder is a separate feature slice
     * this graph does not own (Section 2/3 note: "avoid a huge service locator" / this class only
     * owns OS alarm plumbing, not reminder UI). A future receiver registered for
     * [PRAYER_REMINDER_ACTION] in the manifest starts receiving these without any change here.
     */
    private fun prayerReminderIntent(prayer: PrayerName): Intent =
        Intent(PRAYER_REMINDER_ACTION).apply {
            setPackage(context.packageName)
            putExtra(PRAYER_EXTRA_NAME, prayer.name)
        }

    /** Starts every platform observer this graph owns, plus [runtime] itself. Idempotent (both
     * [runtime.start] and hardware sensor registration are safe to call more than once) -- Section
     * 13/14: process restart or being called again after a configuration change must never
     * double-register a sensor listener or double-launch the tick loop. */
    fun start() {
        hardwareProximitySource.start()
        runtime.start()
        startUsageLocationPolling()
    }

    /** PCA-ANDROID-USAGE-LOCATION-1 Coordinator glue: drives [usageSessionRecorder]/
     * [locationSampleRecorder] on a conservative, battery-appropriate interval -- far slower than
     * [PcaRuntime]'s own screen-time tick, since neither usage-session boundaries nor location
     * need second-level freshness. Safe to call repeatedly (both recorders are internally
     * idempotent against duplicate/out-of-order events); each poll is independent and a failure
     * in one never cancels the loop, matching this app's "never crash the caller" tick discipline. */
    private fun startUsageLocationPolling() {
        coroutineScope.launch {
            while (true) {
                runCatching { usageSessionRecorder.poll() }
                runCatching { locationSampleRecorder.captureSample(localDeviceId, RetentionPolicy.FOURTEEN_DAYS) }
                delay(USAGE_LOCATION_POLL_INTERVAL_MILLIS)
            }
        }
    }

    /** Test/teardown hook only -- the production [PcaApplication] never calls this, since the
     * graph is meant to live for the whole process lifetime (Section 2: composition, not a
     * per-screen object). */
    fun shutdownForTest() {
        runtime.stop()
        hardwareProximitySource.stop()
        coroutineScope.cancel()
    }

    companion object {
        private const val PRAYER_REMINDER_ACTION = "org.pca.app.action.PRAYER_REMINDER"
        private const val PRAYER_EXTRA_NAME = "prayer_name"
        private const val USAGE_LOCATION_POLL_INTERVAL_MILLIS = 5 * 60 * 1000L

        @Volatile private var instance: PcaAppGraph? = null

        /** Process-wide singleton, identical double-checked-lock discipline to
         * [PcaLocalPersistence.getInstance] -- exactly one graph per process. */
        fun getInstance(
            context: Context,
            scheduleRuntimePort: ScheduleRuntimePort? = null,
            familySyncRuntimePort: FamilySyncRuntimePort = OfflineFamilySyncRuntimePort(),
        ): PcaAppGraph = instance ?: synchronized(this) {
            instance ?: PcaAppGraph(
                context = context.applicationContext,
                scheduleRuntimePortOverride = scheduleRuntimePort,
                familySyncRuntimePort = familySyncRuntimePort,
                runtimeStateStore = EncryptedSharedPreferencesStateStore(context.applicationContext, "pca_runtime_state"),
                childRequestStateStore = EncryptedSharedPreferencesStateStore(context.applicationContext, "pca_child_request_queue"),
            ).also { instance = it }
        }

        /**
         * Test-only factory: identical composition to [getInstance], but with the two
         * device-at-rest-encrypted [PersistentStateStore]s swapped for a caller-supplied
         * implementation (an in-memory store in practice) -- unit tests run on a JVM/Robolectric
         * environment that has no real `AndroidKeyStore` provider, so touching
         * `EncryptedSharedPreferences` there fails for reasons that have nothing to do with this
         * lane's own composition logic. Bypasses the process-wide singleton entirely so each test
         * gets its own isolated graph. Never called from production code.
         */
        fun createForTest(
            context: Context,
            scheduleRuntimePort: ScheduleRuntimePort? = NotReadyScheduleRuntimePort(),
            familySyncRuntimePort: FamilySyncRuntimePort = OfflineFamilySyncRuntimePort(),
            stateStore: PersistentStateStore = org.pca.app.foundation.InMemoryPersistentStateStore(),
        ): PcaAppGraph = PcaAppGraph(
            context = context.applicationContext,
            scheduleRuntimePortOverride = scheduleRuntimePort,
            familySyncRuntimePort = familySyncRuntimePort,
            runtimeStateStore = stateStore,
            childRequestStateStore = stateStore,
        )

        /** Test-only reset so each test gets a fresh graph/singleton instead of leaking state
         * (and a live coroutine scope) across test cases. Never called from production code. */
        fun resetForTest() {
            instance?.shutdownForTest()
            instance = null
        }
    }
}

/** Stable, collision-resistant id generator for locally-created records (child requests, etc.) --
 * kept here rather than inline `UUID.randomUUID()` calls so every call site is visibly using the
 * same convention. */
fun newLocalRequestId(): String = UUID.randomUUID().toString()
