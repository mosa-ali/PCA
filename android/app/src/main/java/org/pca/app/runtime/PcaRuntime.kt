package org.pca.app.runtime

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.pca.app.feature.breakshield.BreakShieldController
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistanceEngine
import org.pca.app.feature.eyedistance.engine.EyeDistanceEvent
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import org.pca.app.feature.eyedistance.persistence.EyeDistanceRestorer
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshot
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshotStore
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.feature.screentime.persistence.ScreenTimeRestorer
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshot
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshotStore
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.ports.NotificationCapabilitySource
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.platform.LocationCapabilitySource
import org.pca.app.platform.PlatformProtectionCapabilities
import org.pca.app.platform.ProtectionMode
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageObservationSource
import org.pca.app.platform.proximity.ProximitySource
import org.pca.app.platform.proximity.ProximitySourceAvailability
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncRuntimePort
import org.pca.app.runtime.port.ScheduleRuntimePort
import org.pca.app.runtime.screenstate.ScreenStateObserver
import org.pca.app.runtime.status.PcaRuntimeStatus
import org.pca.app.runtime.wellbeing.WellbeingRuntimeCoordinator
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The production runtime controller (Section 2). Owns the live [ScreenTimeState] and
 * [EyeDistanceState], drives both pure engines forward on a fixed tick, persists a snapshot after
 * every state-changing event, and exposes one honest [PcaRuntimeStatus] for the child status
 * surface and every other consumer to read.
 *
 * Offline-first by construction (Section 0/10): [tick] and every enforcement path below never
 * reads [NetworkConnectivityObserver] or [FamilySyncRuntimePort] to decide whether to run --
 * those two are consulted ONLY when producing [status] (so the UI can report connectivity
 * honestly) and when opportunistically flushing [childRequestQueue]. A network loss can never
 * reset a timer, stop an engine, or block a locally-eligible child request from being created.
 *
 * [start] is idempotent (Section 13/14: connectivity flapping and process restart must never
 * double-initialize an engine or duplicate a tick loop) -- calling it more than once, or calling
 * it again after a previous [stop], is safe and a no-op beyond the first successful start.
 */
class PcaRuntime(
    private val monotonicTimeSource: MonotonicTimeSource,
    private val wallClockTimeSource: WallClockTimeSource,
    private val screenTimeSnapshotStore: ScreenTimeSnapshotStore,
    private val eyeDistanceSnapshotStore: EyeDistanceSnapshotStore,
    private val currentBootId: String?,
    private val connectivityObserver: NetworkConnectivityObserver,
    private val scheduleRuntimePort: ScheduleRuntimePort,
    private val familySyncRuntimePort: FamilySyncRuntimePort,
    private val protectionCapabilities: PlatformProtectionCapabilities,
    private val usageObservationSource: UsageObservationSource,
    private val locationCapabilitySource: LocationCapabilitySource,
    private val notificationCapabilitySource: NotificationCapabilitySource,
    private val proximitySource: ProximitySource,
    private val wellbeingDispatcherProvider: () -> WellbeingTriggerDispatcher,
    private val wellbeingCoordinator: WellbeingRuntimeCoordinator,
    private val screenStateObserver: ScreenStateObserver,
    private val childRequestQueue: ChildRequestOfflineQueue,
    private val externalScope: CoroutineScope,
    private val screenTimeConfig: ScreenTimeConfig = ScreenTimeConfig(),
    private val eyeDistanceConfig: EyeDistanceConfig = EyeDistanceConfig(),
    private val tickIntervalMillis: Long = DEFAULT_TICK_INTERVAL_MILLIS,
) {
    private val startedOnce = AtomicBoolean(false)
    private var tickJob: Job? = null
    private var connectivityJob: Job? = null
    private var screenStateJob: Job? = null

    private val nowNanos: Long get() = monotonicTimeSource.elapsedRealtimeNanos()

    private val screenTimeStateFlow = MutableStateFlow(restoreScreenTimeState())
    private val eyeDistanceStateFlow = MutableStateFlow(restoreEyeDistanceState())
    private val isDeviceOnlineFlow = MutableStateFlow(connectivityObserver.isCurrentlyOnline())

    val screenTimeState: StateFlow<ScreenTimeState> = screenTimeStateFlow.asStateFlow()
    val eyeDistanceState: StateFlow<EyeDistanceState> = eyeDistanceStateFlow.asStateFlow()
    val isDeviceOnline: StateFlow<Boolean> = isDeviceOnlineFlow.asStateFlow()

    private val statusFlow = MutableStateFlow(buildStatus())
    val status: StateFlow<PcaRuntimeStatus> = statusFlow.asStateFlow()

    private fun restoreScreenTimeState(): ScreenTimeState {
        val snapshot = screenTimeSnapshotStore.load()
            ?: return ScreenTimeState.initial(nowNanos)
        return ScreenTimeRestorer.restore(snapshot, nowNanos, currentBootId, screenTimeConfig)
    }

    private fun restoreEyeDistanceState(): EyeDistanceState {
        val snapshot = eyeDistanceSnapshotStore.load() ?: return EyeDistanceState()
        return EyeDistanceRestorer.restore(snapshot, nowNanos, currentBootId, eyeDistanceConfig)
    }

    /** Starts the tick loop and connectivity observation. Safe to call multiple times (e.g. once
     * per Activity/process recreation while the underlying [PcaRuntime] instance itself survives
     * in [org.pca.app.runtime.graph.PcaAppGraph]) -- only the first call has any effect. */
    fun start() {
        if (!startedOnce.compareAndSet(false, true)) return

        tickJob = externalScope.launch {
            while (true) {
                tick()
                delay(tickIntervalMillis)
            }
        }

        connectivityJob = externalScope.launch {
            connectivityObserver.observe().collect { online ->
                isDeviceOnlineFlow.value = online
                statusFlow.update { buildStatus() }
                attemptChildRequestFlush()
            }
        }

        // Section 2/3 (correction round): the real device screen-use signal now actually drives
        // pause/resume, closing the "Pause/Resume exist but have no production caller" defect.
        // Each transition also feeds a bounded, real wellbeing trigger (Section 10/11) -- never a
        // spamming timer, only genuine screen-state transitions.
        screenStateJob = externalScope.launch {
            screenStateObserver.observe().collect { active ->
                if (active) {
                    resumeScreenTime()
                    wellbeingCoordinator.onTrigger(NudgeTrigger.AFTER_SCREEN_UNLOCK)
                } else {
                    pauseScreenTime()
                    wellbeingCoordinator.onTrigger(NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT)
                }
            }
        }
    }

    fun stop() {
        tickJob?.cancel()
        connectivityJob?.cancel()
        screenStateJob?.cancel()
        tickJob = null
        connectivityJob = null
        screenStateJob = null
        startedOnce.set(false)
    }

    /** Advances both engines to "now" and persists the result. Called by the tick loop, and safe
     * to call directly (e.g. from a test, or a foreground-app-observation callback) since it is
     * itself idempotent for a duplicate/near-duplicate timestamp (the underlying engines are). */
    fun tick() {
        applyScreenTimeEvent(ScreenTimeEvent.Tick(nowNanos))
        applyEyeDistanceObservation()
        statusFlow.update { buildStatus() }
    }

    fun pauseScreenTime() = applyScreenTimeEvent(ScreenTimeEvent.Pause(nowNanos))
    fun resumeScreenTime() = applyScreenTimeEvent(ScreenTimeEvent.Resume(nowNanos))
    fun recordDhikrInteraction() = applyScreenTimeEvent(ScreenTimeEvent.DhikrInteraction(nowNanos))

    fun activateEmergencyException() {
        applyScreenTimeEvent(ScreenTimeEvent.EmergencyExceptionActivate(nowNanos))
        applyEyeDistanceEvent(EyeDistanceEvent.ExceptionActivate(nowNanos))
    }

    fun deactivateEmergencyException() {
        applyScreenTimeEvent(ScreenTimeEvent.EmergencyExceptionDeactivate(nowNanos))
        applyEyeDistanceEvent(EyeDistanceEvent.ExceptionDeactivate(nowNanos))
    }

    private fun applyScreenTimeEvent(event: ScreenTimeEvent) {
        val previous = screenTimeStateFlow.value
        val next = ScreenTimeEngine.reduce(previous, event, screenTimeConfig)
        screenTimeStateFlow.value = next
        screenTimeSnapshotStore.save(
            ScreenTimeSnapshot(state = next, snapshotWallClockMillis = wallClockTimeSource.currentTimeMillis(), bootId = currentBootId),
        )
        statusFlow.update { buildStatus() }
        notifyWellbeingOfScreenTimeTransition(previous.mode, next.mode)
    }

    /** Section 10/11 (correction round): the second of this runtime's two real, bounded wellbeing
     * trigger sources (the first is the screen-state transition in [start]). Fires only on an
     * actual mode change, never once per [tick] -- a 60-minute-long ACTIVE session produces
     * exactly one BREAK_STARTED, not one per tick. */
    private fun notifyWellbeingOfScreenTimeTransition(previousMode: ScreenTimeMode, nextMode: ScreenTimeMode) {
        if (previousMode == nextMode) return
        when {
            nextMode == ScreenTimeMode.BREAK_SHIELD -> wellbeingCoordinator.onTrigger(NudgeTrigger.BREAK_STARTED)
            previousMode == ScreenTimeMode.BREAK_SHIELD && nextMode == ScreenTimeMode.ACTIVE ->
                wellbeingCoordinator.onTrigger(NudgeTrigger.BREAK_COMPLETED)
        }
    }

    private fun applyEyeDistanceEvent(event: EyeDistanceEvent) {
        val next = EyeDistanceEngine.reduce(eyeDistanceStateFlow.value, event, eyeDistanceConfig)
        eyeDistanceStateFlow.value = next
        persistEyeDistanceState(next)
    }

    private fun applyEyeDistanceObservation() {
        val availability = proximitySource.availability()
        val sourceAvailable = availability == ProximitySourceAvailability.AVAILABLE
        val observation = proximitySource.currentObservation()
        applyEyeDistanceEvent(
            EyeDistanceEvent.Observation(nowNanos = nowNanos, reading = observation.reading, sourceAvailable = sourceAvailable),
        )
    }

    private fun persistEyeDistanceState(state: EyeDistanceState) {
        eyeDistanceSnapshotStore.save(
            EyeDistanceSnapshot(state = state, snapshotWallClockMillis = wallClockTimeSource.currentTimeMillis(), bootId = currentBootId),
        )
    }

    /**
     * Section 12: create a locally-eligible child request. Always succeeds locally (queued as
     * PENDING_SYNC_LOCAL) regardless of connectivity -- the child can never self-approve, and
     * delivery to the family channel is attempted opportunistically once the sync port reports
     * LIVE (see [attemptChildRequestFlush]), never synchronously here.
     */
    fun createChildRequest(requestId: String, kind: String, detail: String): ChildRequestPayload {
        val payload = ChildRequestPayload(
            requestId = requestId,
            kind = kind,
            detail = detail,
            createdAtEpochMillis = wallClockTimeSource.currentTimeMillis(),
        )
        childRequestQueue.enqueue(payload)
        statusFlow.update { buildStatus() }
        externalScope.launch { attemptChildRequestFlush() }
        return payload
    }

    private suspend fun attemptChildRequestFlush() {
        val submitted = childRequestQueue.flush(familySyncRuntimePort)
        if (submitted > 0) {
            statusFlow.update { buildStatus() }
        }
    }

    /** Real, permission-aware foreground-app handling entry point (Section 5) -- the composition
     * root wires the platform's foreground-app callback to call this, which in turn drives the
     * production [WellbeingTriggerDispatcher] built by [wellbeingDispatcherProvider]. Kept as a
     * thin pass-through rather than duplicating WELL-1's own dispatch logic. */
    fun currentWellbeingDispatcher(): WellbeingTriggerDispatcher = wellbeingDispatcherProvider()

    /** The child's own explicit "give me an idea" pull -- CHILD_REQUESTED_IDEA (doc 35), one of
     * the legitimate WELL-1-supported trigger sources (Section 10). A UI entry point calls this
     * directly rather than the dispatcher, so the anti-spam persist-before-next-call contract
     * stays entirely inside [WellbeingRuntimeCoordinator]. */
    fun requestWellbeingIdea() {
        wellbeingCoordinator.onTrigger(NudgeTrigger.CHILD_REQUESTED_IDEA)
    }

    fun buildStatus(): PcaRuntimeStatus {
        val screenTime = screenTimeStateFlow.value
        val breakShieldView = BreakShieldController.viewState(screenTime, screenTimeConfig)
        return PcaRuntimeStatus(
            protectionMode = runCatching { protectionCapabilities.currentMode() }.getOrDefault(ProtectionMode.STANDARD),
            screenTimeMode = screenTime.mode,
            remainingActiveMillis = ScreenTimeEngine.remainingActiveNanos(screenTime, screenTimeConfig) / 1_000_000L,
            isBreakShieldActive = breakShieldView.isShieldVisible,
            remainingBreakMillis = ScreenTimeEngine.remainingBreakNanos(screenTime, screenTimeConfig) / 1_000_000L,
            isEmergencyExceptionActive = screenTime.mode == ScreenTimeMode.EMERGENCY_EXCEPTION,
            scheduleStatus = scheduleRuntimePort.currentStatus(),
            syncConnectionState = familySyncRuntimePort.currentConnectionState(),
            lastSuccessfulSyncEpochMillis = familySyncRuntimePort.lastSuccessfulSyncEpochMillis(),
            isDeviceOnline = isDeviceOnlineFlow.value,
            usageAccessState = runCatching { usageObservationSource.accessState() }.getOrDefault(UsageAccessState.UNAVAILABLE),
            locationCapabilityLevel = runCatching { locationCapabilitySource.currentCapability().overallLevel }
                .getOrDefault(org.pca.app.platform.LocationCapabilityLevel.UNUSABLE),
            wellbeingNotificationsAvailable = runCatching { notificationCapabilitySource.notificationsEnabled() }.getOrDefault(false),
            pendingChildRequestCount = childRequestQueue.outboxPendingCount(),
        )
    }

    private companion object {
        const val DEFAULT_TICK_INTERVAL_MILLIS = 15_000L
    }
}
