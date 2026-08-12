package org.pca.app.runtime.graph

import android.content.Context
import android.content.Intent
import android.provider.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshotStore
import org.pca.app.feature.eyedistance.persistence.PersistentEyeDistanceSnapshotStore
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.screentime.persistence.PersistentScreenTimeSnapshotStore
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshotStore
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.ports.StandardNotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.StandardScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.StandardWallClockCalendarSource
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.foundation.SystemMonotonicTimeSource
import org.pca.app.foundation.SystemWallClockTimeSource
import org.pca.app.persistence.PcaLocalPersistence
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
import org.pca.app.runtime.prayer.AlarmManagerPrayerScheduler
import org.pca.app.runtime.wellbeing.RuntimeBreakStateSource
import org.pca.app.runtime.wellbeing.RuntimeEligibleAppSignalSource
import org.pca.app.runtime.wellbeing.RuntimeSuppressionContextSource
import java.util.UUID

/**
 * Single production composition root (Section 2 of the PCA-RUNTIME-ANDROID-1 brief) -- the
 * `PcaLocalPersistence` precedent for "exactly one production instance of each dependency,
 * manually wired, no reflection-based DI framework" (this codebase has none), extended to cover
 * every engine/port this runtime touches. [PcaApplication] holds exactly one [PcaAppGraph] for
 * the process lifetime; nothing else in the app should construct any of these types directly.
 *
 * [scheduleRuntimePort] and [familySyncRuntimePort] default to the conservative NOT_READY/OFFLINE
 * placeholders (Section 8/9) -- the coordinator swaps in Agent 10's and Agent 16's real
 * implementations by constructing this graph with those parameters once those lanes land; nothing
 * else in this graph needs to change for that binding.
 */
class PcaAppGraph private constructor(
    val context: Context,
    val scheduleRuntimePort: ScheduleRuntimePort,
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

    val usageObservationSource = StandardUsageObservationSource(context, monotonicTimeSource, wallClockTimeSource)
    val locationCapabilitySource = StandardLocationCapabilitySource(context)
    val protectionCapabilities = DevicePolicyProtectionCapabilities(StandardDevicePolicyCapabilitySource(context))

    private val hardwareProximitySource = HardwareProximitySource(context, monotonicTimeSource)
    val proximitySource: ProximitySource = PrioritizedProximitySource(listOf(hardwareProximitySource))

    val prayerAlarmScheduler = AlarmManagerPrayerScheduler(context) { prayer -> prayerReminderIntent(prayer) }

    // Wellbeing production ports (Section 4/5/6/7): closes the exact gap
    // `feature/wellbeing/ports/WellbeingPorts.kt` documents as Coordinator-owned.
    private val notificationCapabilitySource = StandardNotificationCapabilitySource(context)
    private val screenLockStateSource = StandardScreenLockStateSource(context)
    private val wallClockCalendarSource = StandardWallClockCalendarSource()

    /** Family-policy predicate for which packages count as wellbeing-eligible. Empty by default
     * (no nudging until a real catalogue/policy source is wired) rather than fabricating a
     * default eligible-app list this lane has no policy authority to invent. */
    private val eligibleAppPackages: () -> Set<String> = { emptySet() }

    val eligibleAppSignalSource = RuntimeEligibleAppSignalSource(usageObservationSource, monotonicTimeSource, eligibleAppPackages)

    val coroutineScope: CoroutineScope = CoroutineScope(SupervisorJob())

    val runtime: PcaRuntime = PcaRuntime(
        monotonicTimeSource = monotonicTimeSource,
        wallClockTimeSource = wallClockTimeSource,
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

        @Volatile private var instance: PcaAppGraph? = null

        /** Process-wide singleton, identical double-checked-lock discipline to
         * [PcaLocalPersistence.getInstance] -- exactly one graph per process. */
        fun getInstance(
            context: Context,
            scheduleRuntimePort: ScheduleRuntimePort = NotReadyScheduleRuntimePort(),
            familySyncRuntimePort: FamilySyncRuntimePort = OfflineFamilySyncRuntimePort(),
        ): PcaAppGraph = instance ?: synchronized(this) {
            instance ?: PcaAppGraph(
                context = context.applicationContext,
                scheduleRuntimePort = scheduleRuntimePort,
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
            scheduleRuntimePort: ScheduleRuntimePort = NotReadyScheduleRuntimePort(),
            familySyncRuntimePort: FamilySyncRuntimePort = OfflineFamilySyncRuntimePort(),
            stateStore: PersistentStateStore = org.pca.app.foundation.InMemoryPersistentStateStore(),
        ): PcaAppGraph = PcaAppGraph(
            context = context.applicationContext,
            scheduleRuntimePort = scheduleRuntimePort,
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
