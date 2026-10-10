package org.pca.app.feature.youtube.engine

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.UsageSource
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageClockBridge
import org.pca.app.platform.UsageClockSample
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageEventType
import org.pca.app.platform.UsageObservationBatch
import org.pca.app.platform.UsageObservationSource
import org.pca.app.platform.UsageObservedEvent
import org.pca.app.platform.UsageQueryStatus
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.pca.app.runtime.usage.UsageAppToken
import org.pca.app.runtime.usage.InMemoryUsageObservationSnapshotStore
import org.pca.app.runtime.usage.UsageSessionRecorder
import org.robolectric.RobolectricTestRunner

private const val FAMILY = "family-1"
private const val PROFILE = "profile-1"
private const val DEVICE = "device-1"

@RunWith(RobolectricTestRunner::class)
class ModeAAndroidUsageAdapterTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var usageSessions: UsageSessionRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        usageSessions = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `sums only YouTube-package usage sessions into an aggregate duration, labeled app usage only`() = runTest {
        usageSessions.record("s1", DEVICE, UsageAppToken.forPackageName(YOUTUBE_APP_PACKAGE_NAME), 0L, 600_000L, 600_000L, SourceConfidence.PLATFORM_API)
        usageSessions.record("s2", DEVICE, UsageAppToken.forPackageName(YOUTUBE_APP_PACKAGE_NAME), 600_000L, 900_000L, 300_000L, SourceConfidence.PLATFORM_API)
        usageSessions.record("s3", DEVICE, "com.other.app", 0L, 5_000_000L, 5_000_000L, SourceConfidence.PLATFORM_API)
        // A raw package string is outside the recorder contract and must never alias the
        // opaque package token used by production capture.
        usageSessions.record("s4", DEVICE, YOUTUBE_APP_PACKAGE_NAME, 0L, 5_000_000L, 5_000_000L, SourceConfidence.PLATFORM_API)

        val adapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.GRANTED })
        val evidence = adapter.buildEvidence(FAMILY, PROFILE, DEVICE)

        assertEquals(900_000L, evidence.durationMs)
        assertEquals("app usage only", evidence.label)
        assertEquals(UsageCapabilityStatus.GRANTED, evidence.capabilityStatus)
        assertEquals(UsageSource.ANDROID_USAGE_STATS, evidence.source)
    }

    @Test
    fun `recorder-produced opaque YouTube token contributes and raw package-name decoy is ignored`() = runTest {
        var elapsedNow = 0L
        var wallNow = 1_000_000L
        var events = listOf(
            UsageEvent(YOUTUBE_APP_PACKAGE_NAME, UsageEventType.FOREGROUND, 100L),
            UsageEvent(YOUTUBE_APP_PACKAGE_NAME, UsageEventType.BACKGROUND, 1_000L),
        )
        val source = object : UsageObservationSource {
            override fun accessState() = UsageAccessState.GRANTED
            override fun queryEventsSince(elapsedRealtimeMillis: Long) = events
            override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
                val sample = UsageClockSample(elapsedNow, wallNow)
                return UsageObservationBatch(
                    events.filter { it.elapsedRealtimeMillis >= elapsedRealtimeMillis }
                        .map { UsageObservedEvent(it, 1_000_000L + it.elapsedRealtimeMillis) },
                    sample,
                    sample,
                    UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis, sample),
                    UsageAccessState.GRANTED,
                    UsageQueryStatus.OBSERVED,
                )
            }
        }
        val monotonic = FakeMonotonicTimeSource(0L)
        val wallClock = FakeWallClockTimeSource(1_000_000L)
        val recorder = UsageSessionRecorder(
            source,
            usageSessions,
            monotonic,
            wallClock,
            InMemoryUsageObservationSnapshotStore(),
            { DEVICE },
            "boot-1",
        )

        // First poll establishes coverage; the second captures and persists the complete session.
        recorder.poll()
        elapsedNow = 1_001L
        wallNow = 1_001_001L
        monotonic.nowNanos = elapsedNow * 1_000_000L
        wallClock.nowMillis = wallNow
        val recorded = recorder.poll()
        assertEquals(1, recorded.recordedSessionCount)

        // This plaintext decoy must not match the canonical persisted token.
        usageSessions.record("raw-decoy", DEVICE, YOUTUBE_APP_PACKAGE_NAME, 0L, 5_000_000L, 5_000_000L, SourceConfidence.PLATFORM_API)

        val evidence = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.GRANTED })
            .buildEvidence(FAMILY, PROFILE, DEVICE)

        assertEquals(900L, evidence.durationMs)
        assertEquals(UsageAppToken.forPackageName(YOUTUBE_APP_PACKAGE_NAME), usageSessions.getForDevice(DEVICE)
            .single { it.durationMillis == 900L }.appOrCategoryToken)
    }

    @Test
    fun `revoked usage access reports a coverage gap, never a fabricated zero duration`() = runTest {
        usageSessions.record("s1", DEVICE, UsageAppToken.forPackageName(YOUTUBE_APP_PACKAGE_NAME), 0L, 600_000L, 600_000L, SourceConfidence.PLATFORM_API)

        val adapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.DENIED })
        val evidence = adapter.buildEvidence(FAMILY, PROFILE, DEVICE)

        assertNull(evidence.durationMs)
        assertEquals(true, evidence.coverageGap)
        assertEquals(UsageCapabilityStatus.REVOKED, evidence.capabilityStatus)
    }

    @Test
    fun `unavailable OS usage-access service reports UNSUPPORTED, not GRANTED`() = runTest {
        val adapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.UNAVAILABLE })
        val evidence = adapter.buildEvidence(FAMILY, PROFILE, DEVICE)

        assertEquals(UsageCapabilityStatus.UNSUPPORTED, evidence.capabilityStatus)
        assertEquals(UsageSource.UNAVAILABLE, evidence.source)
        assertNull(evidence.durationMs)
    }

    @Test
    fun `no video-level history is fabricated or reported -- adapter output carries only aggregate fields`() = runTest {
        usageSessions.record("s1", DEVICE, UsageAppToken.forPackageName(YOUTUBE_APP_PACKAGE_NAME), 0L, 600_000L, 600_000L, SourceConfidence.PLATFORM_API)

        val adapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.GRANTED })
        val evidence = adapter.buildEvidence(FAMILY, PROFILE, DEVICE)

        // UsageSession (the only source this adapter reads from) has no videoId/title/searchQuery
        // field to begin with, and ModeAUsageEvidence has no such field either -- structurally
        // impossible for this adapter to have fabricated or forwarded per-video data.
        val evidenceFields = evidence::class.java.declaredFields.map { it.name }
        assertEquals(false, evidenceFields.any { it.contains("video", ignoreCase = true) })
        assertEquals(false, evidenceFields.any { it.contains("title", ignoreCase = true) })
        assertEquals(false, evidenceFields.any { it.contains("search", ignoreCase = true) })

        val usageSessionFields = org.pca.app.persistence.repository.UsageSession::class.java.declaredFields.map { it.name }
        assertEquals(false, usageSessionFields.any { it.contains("video", ignoreCase = true) })
    }
}
