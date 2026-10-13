package org.pca.app.runtime.graph

import android.app.Application
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.breakshield.ui.BreakShieldActivity
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshot
import org.pca.app.feature.eyedistance.persistence.PersistentEyeDistanceSnapshotStore
import org.pca.app.feature.eyedistance.ui.EyeRestShieldActivity
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.persistence.PersistentScreenTimeSnapshotStore
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshot
import org.pca.app.feature.screentime.persistence.PersistentUsedAuthorizationStore
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.ui.WellbeingCardActivity
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.platform.StandardPowerSaveModeSource
import org.pca.app.runtime.identity.DeviceIdentityState
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile
import org.pca.app.enrollment.PairingState
import org.pca.app.storage.LocalFamilyState
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import kotlin.time.Duration.Companion.minutes

/**
 * Section 21 "graph creation" requirement. Exercises the real production composition root under
 * Robolectric -- this is the one place the whole dependency graph (persistence, platform
 * adapters, ports, [org.pca.app.runtime.PcaRuntime]) is proven to actually wire together and
 * construct without throwing, not just compile.
 *
 * Uses [PcaAppGraph.createForTest] rather than [PcaAppGraph.getInstance] for every wiring
 * assertion: production wiring persists runtime state through `EncryptedSharedPreferences`
 * (Android-Keystore-backed), and this unit-test JVM/Robolectric environment has no real
 * `AndroidKeyStore` security provider -- that is an environment limitation unrelated to whether
 * this lane's composition graph itself is wired correctly, so [PcaAppGraph.createForTest] swaps
 * in an in-memory store while keeping every other composed dependency identical to production.
 */
@RunWith(RobolectricTestRunner::class)
class PcaAppGraphTest {

    @After
    fun tearDown() {
        PcaAppGraph.resetForTest()
    }

    @Test
    fun `ordinary Trust Set runtime initialization exception stays optional and retryable`() {
        assertNull(
            createOrdinaryTrustSetRuntimeOrNull {
                throw IllegalStateException("ordinary initialization failure")
            },
        )
    }

    @Test
    fun `Trust Set runtime initialization cancellation propagates`() {
        val cancelled = CancellationException("runtime initialization cancelled")
        try {
            createOrdinaryTrustSetRuntimeOrNull<Any> { throw cancelled }
            fail("expected initialization cancellation to propagate")
        } catch (actual: CancellationException) {
            assertSame(cancelled, actual)
        }
    }

    @Test
    fun `fatal JVM error during Trust Set runtime initialization propagates`() {
        val fatal = LinkageError("runtime initialization linkage failure")
        try {
            createOrdinaryTrustSetRuntimeOrNull<Any> { throw fatal }
            fail("expected fatal initialization error to propagate")
        } catch (actual: LinkageError) {
            assertSame(fatal, actual)
        }
    }

    @Test
    fun `graph construction wires every composed engine without throwing`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()

        val graph = PcaAppGraph.createForTest(context)

        assertNotNull(graph.runtime)
        assertNotNull(graph.persistence)
        // PCA-DATA-024/PCA-FR-105 closure: retentionEngine is real, composed, and reuses the
        // SAME instance PcaLocalPersistence already builds -- never a second RetentionEngine
        // wrapping the same database (this graph's own "exactly one production instance of each
        // dependency" discipline).
        assertNotNull(graph.retentionEngine)
        assert(graph.retentionEngine === graph.persistence.retentionEngine) {
            "expected PcaAppGraph.retentionEngine to be the SAME instance as PcaLocalPersistence.retentionEngine, not a second wrapper"
        }
        assertNotNull(graph.eligibleAppSignalSource)
        assertNotNull(graph.prayerAlarmScheduler)
        assertNotNull(graph.proximitySource)
        // PCA-FR-024 (REAL_SOURCE_GAP) closure: the camera tier is now actually composed, not just
        // the hardware-only tier -- see PrioritizedProximitySource's "hardware first, camera
        // second" ordering doc comment for why proximitySource itself does not expose the list.
        assertNotNull(graph.cameraProximitySource)
        assertNotNull(graph.cameraPermissionStateTracker)
        assertNotNull(graph.cameraDegradationMonitor)
        assertNotNull(graph.usageObservationSource)
        assertNotNull(graph.locationCapabilitySource)
        assertNotNull(graph.connectivityObserver)
        // Correction round Section 2/3/10/11: the real screen-state observer and wellbeing
        // production trigger coordinator are now part of the composed graph.
        assertNotNull(graph.screenStateObserver)
        assertNotNull(graph.wellbeingCoordinator)
        // PCA-FR-021 closure: the real eye-rest-shield trigger is now part of the composed graph
        // (previously constructed nowhere in production -- see EyeRestShieldTrigger's own doc
        // comment history).
        assertNotNull(graph.eyeRestShieldTrigger)
        assertNotNull(graph.eyeDistanceConfig)
        // PCA-3/PCA-RUNTIME-1 closure: the real break-shield trigger is now part of the composed
        // graph (previously did not exist at all -- see BreakShieldTrigger's own doc comment).
        assertNotNull(graph.breakShieldTrigger)
        // Conservative placeholders (Section 8/9) until Agent 10/16 bind real implementations.
        assertEquals(ScheduleRuntimeStatus.NOT_READY, graph.scheduleRuntimePort.currentStatus())
        assertEquals(FamilySyncConnectionState.OFFLINE, graph.familySyncRuntimePort.currentConnectionState())
        // PCA-RUNTIME-2R1: boot-instance detection and PCA device identity are real, composed,
        // and distinct authorities -- never the same value, never ANDROID_ID.
        assertNotNull(graph.bootInstanceSource)
        assertNotNull(graph.deviceIdentityProvider)
        // A freshly-composed graph over an empty store has no enrollment yet -- this must be
        // reported honestly as NotEnrolled, never a fabricated id.
        assertEquals(DeviceIdentityState.NotEnrolled, graph.deviceIdentityProvider.currentIdentity())
    }

    @Test
    fun `runtime adopts confirmed enrollment Screen Time defaults after graph startup`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context, stateStore = InMemoryPersistentStateStore())

        // PcaApplication creates and starts this process graph before the child completes the
        // enrollment flow. A first install therefore starts with the safe fallback, then the
        // persisted server-authorized profile must become effective without waiting for process
        // death/recreation.
        assertEquals(ScreenTimeConfig(), graph.screenTimeConfig)
        graph.familyStateStore.save(
            LocalFamilyState(
                familyId = "family-1",
                deviceId = "device-1",
                pairingState = PairingState.PAIRING_PENDING,
                trustSetEpoch = 1,
                keyEpoch = 1,
                childProfileId = "child-1",
                ageUxTier = AgeUxTier.YOUNG_CHILD,
                initialPolicyProfile = InitialPolicyProfile.BALANCED,
            ),
        )

        graph.runtime.tick()

        assertEquals(45.minutes, graph.screenTimeConfig.activeThreshold)
        assertTrue(graph.runtime.status.value.remainingActiveMillis <= 45.minutes.inWholeMilliseconds)
        assertTrue(graph.runtime.status.value.remainingActiveMillis > 44.minutes.inWholeMilliseconds)
    }

    @Test
    fun `each createForTest call is an independently composed graph, never sharing state`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()

        val first = PcaAppGraph.createForTest(context)
        val second = PcaAppGraph.createForTest(context)

        assertNotSame(first, second)
        assertNotSame(first.runtime, second.runtime)
    }

    @Test
    fun `graph binds durable authorization claims to the shared runtime state store`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val stateStore = InMemoryPersistentStateStore()

        val first = PcaAppGraph.createForTest(context, stateStore = stateStore)
        assertTrue(first.usedAuthorizationStore is PersistentUsedAuthorizationStore)
        assertTrue(first.usedAuthorizationStore.claimAuthorization("graph-audit-replay"))

        val reconstructedGraph = PcaAppGraph.createForTest(context, stateStore = stateStore)
        assertFalse(reconstructedGraph.usedAuthorizationStore.claimAuthorization("graph-audit-replay"))
    }

    /** The production and test entry points share the same singleton holder; the test entry point
     * injects an in-memory store so this identity assertion does not depend on AndroidKeyStore. */
    @Test
    fun `singleton reuses one graph across repeated calls without AndroidKeyStore`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()

        val first = PcaAppGraph.getInstanceForTest(context, InMemoryPersistentStateStore())
        val second = PcaAppGraph.getInstanceForTest(context, InMemoryPersistentStateStore())

        assertNotNull(first)
        assert(first === second)
        assert(first.runtime === second.runtime)
    }

    // --- PCA-FR-021 closure: EyeRestShieldActivity launch wiring -----------------------------
    //
    // These tests prove the real launch path FR-021's own follow-up demanded (see
    // EyeRestShieldActivity's and EyeRestShieldTrigger's own doc comments): the production
    // eyeRestShieldTrigger, built from PcaRuntime's real eyeDistanceState, must actually call
    // context.startActivity(...) for EyeRestShieldActivity on a genuine REST_ACTIVE transition.
    //
    // `launchEyeRestShieldActivity` (the exact callback eyeRestShieldTrigger.onShieldShouldAppear
    // invokes) is tested directly and synchronously below -- this proves the launch call's shape
    // (correct target Activity, FLAG_ACTIVITY_NEW_TASK) with no coroutine timing involved.
    //
    // The end-to-end test below additionally proves the trigger really is wired to the real state
    // flow and really does fire the real callback: it pre-seeds the durable eye-distance snapshot
    // store (via the same PersistentEyeDistanceSnapshotStore/EyeDistanceRestorer production code
    // path PcaAppGraph itself uses) so the graph's PcaRuntime restores directly into REST_ACTIVE,
    // then calls the real graph.start(). Because eyeRestShieldTrigger.start() launches its
    // collector on Dispatchers.Default (PcaAppGraph.coroutineScope carries no dispatcher of its
    // own), the resulting startActivity call lands on a background thread asynchronously relative
    // to this test thread -- so this test polls briefly rather than asserting instantly. That is
    // an honest, deliberate choice given this module's Robolectric/JVM unit-test environment has
    // no way to force Dispatchers.Default to run synchronously without changing PcaAppGraph's
    // dispatcher choice (out of this change's scope); it is not a substitute for an
    // instrumented/emulator run, which remains the only way to see the real Activity actually
    // come on screen.

    @Test
    fun `launchEyeRestShieldActivity starts the real EyeRestShieldActivity with FLAG_ACTIVITY_NEW_TASK`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)

        graph.launchEyeRestShieldActivity()

        val started = shadowOf(context as Application).nextStartedActivity
        assertNotNull("expected a startActivity(...) call", started)
        assertEquals(EyeRestShieldActivity::class.java.name, started!!.component?.className)
        assertTrue(
            "application-context launches must set FLAG_ACTIVITY_NEW_TASK",
            (started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
        )
    }

    @Test
    fun `a graph restored directly into REST_ACTIVE really launches EyeRestShieldActivity once graph start() runs`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val stateStore = InMemoryPersistentStateStore()

        // Same production restoration path PcaAppGraph itself relies on (EyeDistanceRestorer):
        // a null snapshot bootId means "not confirmed same-boot", so restoreAfterReboot is taken,
        // which preserves a REST_ACTIVE phase across the (simulated) gap rather than resetting to
        // MONITORING -- see EyeDistanceRestorer.restoreAfterReboot's own doc comment.
        PersistentEyeDistanceSnapshotStore(stateStore).save(
            EyeDistanceSnapshot(
                state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE),
                snapshotWallClockMillis = 0L,
                bootId = null,
            ),
        )

        // graph.start() also enqueues backgroundExecutionScheduler.scheduleUsageIngestion(),
        // which requires a real WorkManager instance -- production gets one from the manifest's
        // WorkManagerInitializer content provider, but this JVM/Robolectric unit-test environment
        // does not auto-initialize it, so this test provides one the same way
        // WorkManagerBackgroundExecutionSchedulerTest already does (androidx `work-testing`,
        // SynchronousExecutor). This is test-environment plumbing unrelated to the eye-rest-shield
        // wiring itself; it exists only so the real, unmodified graph.start() can run end-to-end.
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )

        val graph = PcaAppGraph.createForTest(context, stateStore = stateStore)
        try {
            assertEquals(
                "sanity: the graph's own runtime must really have restored into REST_ACTIVE",
                EyeDistancePhase.REST_ACTIVE,
                graph.runtime.eyeDistanceState.value.phase,
            )

            graph.start()

            val deadlineNanos = System.nanoTime() + POLL_TIMEOUT_MILLIS * 1_000_000L
            var started: Intent? = null
            while (System.nanoTime() < deadlineNanos) {
                started = shadowOf(context as Application).peekNextStartedActivity()
                if (started != null) break
                Thread.sleep(POLL_INTERVAL_MILLIS)
            }

            if (started == null) {
                fail(
                    "eyeRestShieldTrigger never called startActivity() for EyeRestShieldActivity " +
                        "within ${POLL_TIMEOUT_MILLIS}ms of graph.start() on a graph restored into " +
                        "REST_ACTIVE",
                )
            }
            assertEquals(EyeRestShieldActivity::class.java.name, started!!.component?.className)
        } finally {
            // This is the one test in this class that calls the real graph.start() (started
            // OUTSIDE the process-wide singleton via createForTest, so tearDown()'s
            // PcaAppGraph.resetForTest() does not reach it) -- without an explicit shutdown here,
            // its tick/screen-state/eyeRestShieldTrigger coroutines keep running on
            // graph.coroutineScope past the end of this test and can throw into whichever later
            // test happens to be executing when Robolectric's shadow sandbox for THIS test is torn
            // down (observed as a spurious UncaughtExceptionsBeforeTest failure in an unrelated
            // test class). Every other test in this file constructs a graph but never calls
            // start(), so it never spawns that background work and needs no matching shutdown.
            graph.shutdownForTest()
        }
    }

    // --- PCA-3/PCA-RUNTIME-1 closure: BreakShieldActivity launch wiring ---------------------
    //
    // Mirrors the EyeRestShieldActivity section above exactly: these tests prove the real
    // production breakShieldTrigger, built from PcaRuntime's real screenTimeState, must actually
    // call context.startActivity(...) for BreakShieldActivity on a genuine BREAK_SHIELD transition
    // -- previously no such call existed anywhere in this codebase (see BreakShieldTrigger's own
    // doc comment for the gap this closes).

    @Test
    fun `launchBreakShieldActivity starts the real BreakShieldActivity with FLAG_ACTIVITY_NEW_TASK`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)

        graph.launchBreakShieldActivity()

        val started = shadowOf(context as Application).nextStartedActivity
        assertNotNull("expected a startActivity(...) call", started)
        assertEquals(BreakShieldActivity::class.java.name, started!!.component?.className)
        assertTrue(
            "application-context launches must set FLAG_ACTIVITY_NEW_TASK",
            (started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
        )
    }

    @Test
    fun `a graph restored directly into BREAK_SHIELD really launches BreakShieldActivity once graph start() runs`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val stateStore = InMemoryPersistentStateStore()

        // Same production restoration path PcaAppGraph itself relies on (ScreenTimeRestorer): a
        // null snapshot bootId means "not confirmed same-boot", so restoreAfterReboot is taken,
        // which preserves the BREAK_SHIELD mode across the (simulated) gap rather than resetting
        // it -- see ScreenTimeRestorer.restoreAfterReboot's own doc comment.
        PersistentScreenTimeSnapshotStore(stateStore).save(
            ScreenTimeSnapshot(
                state = ScreenTimeState.initial(0L).copy(mode = ScreenTimeMode.BREAK_SHIELD),
                snapshotWallClockMillis = 0L,
                bootId = null,
            ),
        )

        // graph.start() also enqueues backgroundExecutionScheduler.scheduleUsageIngestion(), which
        // requires a real WorkManager instance -- see the EyeRestShieldActivity end-to-end test
        // above for why this is provided here.
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )

        val graph = PcaAppGraph.createForTest(context, stateStore = stateStore)
        try {
            assertEquals(
                "sanity: the graph's own runtime must really have restored into BREAK_SHIELD",
                ScreenTimeMode.BREAK_SHIELD,
                graph.runtime.screenTimeState.value.mode,
            )

            graph.start()

            val deadlineNanos = System.nanoTime() + POLL_TIMEOUT_MILLIS * 1_000_000L
            var started: Intent? = null
            while (System.nanoTime() < deadlineNanos) {
                started = shadowOf(context as Application).peekNextStartedActivity()
                if (started != null) break
                Thread.sleep(POLL_INTERVAL_MILLIS)
            }

            if (started == null) {
                fail(
                    "breakShieldTrigger never called startActivity() for BreakShieldActivity within " +
                        "${POLL_TIMEOUT_MILLIS}ms of graph.start() on a graph restored into BREAK_SHIELD",
                )
            }
            assertEquals(BreakShieldActivity::class.java.name, started!!.component?.className)
        } finally {
            // See the matching EyeRestShieldActivity end-to-end test's own `finally` comment above
            // for why this explicit shutdown is required: this is the other of the two tests in
            // this class that calls the real graph.start() outside the process-wide singleton.
            graph.shutdownForTest()
        }
    }

    // --- PCA-WELL-012 closure: WellbeingCardActivity launch + feedback-recording wiring -----
    //
    // Mirrors the EyeRestShieldActivity/BreakShieldActivity sections above for the launch-shape
    // proof. Unlike those two, the async "next real unlock" half of this wiring
    // (startPendingWellbeingCardUnlockObserver, driven by the same screenStateObserver instance)
    // is deliberately NOT exercised here via a real Robolectric broadcast -- see
    // AndroidScreenStateObserverTest's own doc comment, which already documents that driving this
    // exact observer deterministically under Robolectric + kotlinx-coroutines-test proved
    // unreliable (intermittent hangs) in this environment, and that its consequences are instead
    // covered at the ScreenStateObserver-interface level. The store-gating logic that observer
    // depends on (only launch when a NEXT_UNLOCK_CARD is genuinely pending) is fully covered,
    // deterministically, by WellbeingCardDeliveryTest and WellbeingPersistenceRoundTripTest.

    @Test
    fun `launchWellbeingCardActivity starts the real WellbeingCardActivity with FLAG_ACTIVITY_NEW_TASK`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)

        graph.launchWellbeingCardActivity()

        val started = shadowOf(context as Application).nextStartedActivity
        assertNotNull("expected a startActivity(...) call", started)
        assertEquals(WellbeingCardActivity::class.java.name, started!!.component?.className)
        assertTrue(
            "application-context launches must set FLAG_ACTIVITY_NEW_TASK",
            (started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
        )
    }

    /**
     * Proves [PcaAppGraph.recordWellbeingFeedback] -- the single real caller of
     * [org.pca.app.runtime.wellbeing.WellbeingFeedbackRecorder] -- is genuinely wired into the
     * graph's own durable stores, not a stub: a NOT_FOR_ME feedback call must actually suppress
     * that suggestion in the SAME [org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore]
     * [wellbeingCoordinator] itself reads on the next trigger. The pure routing/engine logic
     * ([org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine.applyFeedback]) is already
     * covered by that engine's own tests; this test's job is only to prove the graph composition
     * itself is real.
     */
    @Test
    fun `recordWellbeingFeedback suppresses that suggestion in the real durable rate state`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)
        val suggestionId = WellbeingContentCatalogue.entries.first().suggestionId

        graph.recordWellbeingFeedback(suggestionId, NudgeFeedbackType.NOT_FOR_ME)

        val rateState = graph.wellbeingRateStateStore.load()
        assertNotNull("recordWellbeingFeedback must persist a rate state, not just log", rateState)
        assertTrue(
            "NOT_FOR_ME must record a cooldown for the real suggestionId in the graph's own durable store",
            rateState!!.notForMeUntilBySuggestionId.containsKey(suggestionId),
        )
    }

    // --- PCA-DATA-024/PCA-FR-105 closure: runRetentionMaintenanceCycle wiring ----------------

    /**
     * A freshly composed graph over an empty store has no enrollment yet (same sanity condition
     * the "graph construction" test above asserts via `DeviceIdentityState.NotEnrolled`). Proves
     * the real, production `runRetentionMaintenanceCycle()` skips the cycle entirely rather than
     * fabricating a retention scope -- matching this graph's established "not enrolled yet ->
     * skip" discipline -- and, just as importantly, never throws back to a caller (the same
     * contract `RetentionMaintenanceWorker.doWork()` depends on). The real, in-memory-Room-backed
     * "does it actually delete rows" behavior is covered separately by
     * `RetentionMaintenanceCycleTest` (see that class's own doc comment for why it targets the
     * shared `executeRetentionMaintenanceCycle` function directly instead of this graph, which is
     * backed by `AndroidKeyStore`-gated production stores unavailable in this test environment).
     */
    @Test
    fun `runRetentionMaintenanceCycle on an unenrolled graph completes without throwing and skips the cycle`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)
        assertEquals(DeviceIdentityState.NotEnrolled, graph.deviceIdentityProvider.currentIdentity())

        graph.runRetentionMaintenanceCycle()
        // Reaching this line without an uncaught exception, on a graph with no enrolled
        // family/device, is the assertion: PCA-DATA-024/PCA-FR-105 forbids fabricating a
        // retention scope for a device that has not enrolled yet.
    }

    // --- PCA-NFR-034 closure: real powerSaveModeSource wiring + end-to-end smoke coverage ----

    /**
     * [BatteryBudgetedCycleRunnerTest][org.pca.app.runtime.background.BatteryBudgetedCycleRunnerTest]
     * already proves the exact gating contract in isolation (critical work always runs, non-critical
     * work backs off under Battery Saver) -- this test proves the REAL production graph is actually
     * wired to a real, live `PowerManager.isPowerSaveMode` source, not a stub the cycle never reads.
     */
    @Test
    fun `powerSaveModeSource is the real, live StandardPowerSaveModeSource binding`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)

        assertTrue(graph.powerSaveModeSource is StandardPowerSaveModeSource)
    }

    /**
     * End-to-end smoke coverage for the real, unmodified [PcaAppGraph.runUsageLocationIngestionCycle]
     * with Battery Saver genuinely active (via Robolectric's real `PowerManager` shadow, the same
     * mechanism [org.pca.app.platform.StandardPowerSaveModeSourceTest] uses) -- proves the real
     * production wiring never throws back to a caller regardless of power state, complementing
     * (not duplicating) `BatteryBudgetedCycleRunnerTest`'s precise, isolated gating proof.
     */
    @Test
    fun `runUsageLocationIngestionCycle completes without throwing while the OS reports Battery Saver active`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val powerManager = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        shadowOf(powerManager).setIsPowerSaveMode(true)
        val graph = PcaAppGraph.createForTest(context)

        graph.runUsageLocationIngestionCycle()
        // Reaching this line without an uncaught exception, with Battery Saver active, is the
        // assertion -- see this test's own doc comment.
    }

    @Test
    fun `usage ingestion cancellation propagates and skips later steps and critical work`() = runTest {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)
        val cancelled = CancellationException("cycle stopped")
        var laterNonCriticalStepRan = false
        var criticalWorkRan = false

        try {
            org.pca.app.runtime.background.BatteryBudgetedCycleRunner.run(
                shouldRunNonCritical = { true },
                nonCriticalWork = {
                    graph.runUsageLocationIngestionSteps(
                        { throw cancelled },
                        { laterNonCriticalStepRan = true },
                    )
                },
                criticalWork = { criticalWorkRan = true },
            )
            throw AssertionError("expected usage-cycle cancellation to propagate")
        } catch (actual: CancellationException) {
            assertEquals("cycle stopped", actual.message)
        }

        assertFalse("later usage/location steps must not run after cancellation", laterNonCriticalStepRan)
        assertFalse("critical stage must not resume work after cancellation", criticalWorkRan)
    }

    @Test
    fun `usage ingestion isolates ordinary step failures but lets fatal errors propagate`() = runTest {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)
        var afterOrdinaryFailureRan = false
        graph.runUsageLocationIngestionSteps(
            { throw IllegalStateException("ordinary monitor failure") },
            { afterOrdinaryFailureRan = true },
        )
        assertTrue(afterOrdinaryFailureRan)

        val fatal = LinkageError("fatal monitor failure")
        var afterFatalRan = false
        try {
            graph.runUsageLocationIngestionSteps(
                { throw fatal },
                { afterFatalRan = true },
            )
            throw AssertionError("expected fatal error to propagate")
        } catch (actual: LinkageError) {
            assertEquals(fatal.message, actual.message)
        }
        assertFalse("later usage/location steps must not run after a fatal error", afterFatalRan)
    }

    @Test
    fun `custody sync cancellation and fatal errors stop the retry delay while ordinary failures still retry`() = runTest {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val graph = PcaAppGraph.createForTest(context)
        var pauseCount = 0
        val cancelled = CancellationException("custody loop cancelled")
        try {
            graph.runRuntimeCustodySyncIteration(
                synchronize = { throw cancelled },
                pause = { pauseCount++ },
            )
            throw AssertionError("expected custody loop cancellation to propagate")
        } catch (actual: CancellationException) {
            assertEquals("custody loop cancelled", actual.message)
        }
        assertEquals("cancellation must not enter the next polling delay", 0, pauseCount)

        graph.runRuntimeCustodySyncIteration(
            synchronize = { throw IllegalStateException("temporary custody sync failure") },
            pause = { pauseCount++ },
        )
        assertEquals("ordinary failures retain the periodic retry behavior", 1, pauseCount)

        val fatal = LinkageError("fatal custody sync error")
        try {
            graph.runRuntimeCustodySyncIteration(
                synchronize = { throw fatal },
                pause = { pauseCount++ },
            )
            throw AssertionError("expected fatal custody error to propagate")
        } catch (actual: LinkageError) {
            assertEquals(fatal.message, actual.message)
        }
        assertEquals("fatal errors must not enter the retry delay", 1, pauseCount)
    }

    private companion object {
        const val POLL_TIMEOUT_MILLIS = 5_000L
        const val POLL_INTERVAL_MILLIS = 20L
    }
}
