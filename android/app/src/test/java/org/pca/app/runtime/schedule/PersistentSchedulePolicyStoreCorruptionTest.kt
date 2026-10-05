package org.pca.app.runtime.schedule

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ScheduleEnforcementOutcome
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import java.time.Instant

class PersistentSchedulePolicyStoreCorruptionTest {
    private fun emptySnapshot() = SchedulePolicySnapshot(
        candidatePolicy = null,
        lastKnownGoodPolicy = null,
        lastPolicySyncAtUtc = null,
        deviceTrustSetEpoch = 0,
        deviceKeyEpoch = 0,
    )

    private fun snapshotJson() = SchedulePolicyJson.encodeSnapshot(emptySnapshot())

    private fun samplePolicy() = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = 1,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "UTC",
        windows = emptyList(),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-10-05T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-10-05T00:00:00Z"),
    )

    @Test
    fun `read distinguishes absent and valid persisted snapshots`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentSchedulePolicyStore(backing)

        assertSame(SchedulePolicyStoreRead.Absent, store.read())

        val snapshot = emptySnapshot()
        store.save(snapshot)

        assertEquals(SchedulePolicyStoreRead.Present(snapshot), store.read())

        val populatedSnapshot = emptySnapshot().copy(
            candidatePolicy = samplePolicy().copy(expiresAt = Instant.parse("2026-11-05T00:00:00Z")),
            lastPolicySyncAtUtc = Instant.parse("2026-10-05T01:00:00Z"),
        )
        store.save(populatedSnapshot)

        assertEquals(SchedulePolicyStoreRead.Present(populatedSnapshot), store.read())
    }

    @Test
    fun `decode corruption is reported without modifying the persisted bytes`() {
        assertCorruptWithoutRewrite("{}")
    }

    @Test
    fun `wrong type or missing required nullable snapshot and candidate fields are corrupt and retained`() {
        val missingCandidate = snapshotJson().apply { remove("candidatePolicy") }.toString()
        val wrongTypeCandidate = snapshotJson().put("candidatePolicy", "none").toString()
        val missingLastKnownGood = snapshotJson().apply { remove("lastKnownGoodPolicy") }.toString()
        val wrongTypeLastKnownGood = snapshotJson().put("lastKnownGoodPolicy", JSONArray()).toString()
        val lastKnownGoodMissingVersion = snapshotJson().put("lastKnownGoodPolicy", JSONObject()).toString()
        val lastKnownGoodUnsupportedVersion = snapshotJson().put(
            "lastKnownGoodPolicy",
            JSONObject().put("version", "2"),
        ).toString()
        val missingSyncTimestamp = snapshotJson().apply { remove("lastPolicySyncAtUtc") }.toString()
        val wrongTypeSyncTimestamp = snapshotJson().put("lastPolicySyncAtUtc", 42).toString()
        val candidateMissingVersion = snapshotJson().put("candidatePolicy", JSONObject()).toString()
        val candidateUnsupportedVersion = snapshotJson().put(
            "candidatePolicy",
            JSONObject().put("version", "2"),
        ).toString()
        val wrongTypePolicyExpiry = SchedulePolicyJson.encodeSnapshot(
            emptySnapshot().copy(candidatePolicy = samplePolicy()),
        ).apply {
            getJSONObject("candidatePolicy").put("expiresAt", 42)
        }.toString()

        listOf(
            missingCandidate,
            wrongTypeCandidate,
            missingLastKnownGood,
            wrongTypeLastKnownGood,
            lastKnownGoodMissingVersion,
            lastKnownGoodUnsupportedVersion,
            missingSyncTimestamp,
            wrongTypeSyncTimestamp,
            candidateMissingVersion,
            candidateUnsupportedVersion,
            wrongTypePolicyExpiry,
        ).forEach(::assertCorruptWithoutRewrite)
    }

    @Test
    fun `corruption makes runtime unavailable while genuine absence keeps never-accepted behavior`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentSchedulePolicyStore(backing)
        val now = Instant.parse("2026-10-05T12:00:00Z")
        val runtime = ScheduleRuntime(store)
        val appToken = "com.example.game"
        val capability = EnforcementCapabilityState.ENFORCED
        var enforcementCalls = 0
        val port = ProductionScheduleRuntimePort(
            scheduleRuntime = runtime,
            wallClockTimeSource = object : WallClockTimeSource {
                override fun currentTimeMillis(): Long = now.toEpochMilli()
            },
            connectivityObserver = object : NetworkConnectivityObserver {
                override fun observe(): Flow<Boolean> = emptyFlow()
                override fun isCurrentlyOnline(): Boolean = false
            },
            enforcementConsumer = object : ScheduleEnforcementConsumer {
                override fun apply(
                    packageName: String,
                    appToken: OpaqueAppToken,
                    decision: ScheduleDecision,
                    communicationSurfaces: CommunicationSafetySurfaceTokens,
                ): ScheduleEnforcementOutcome {
                    enforcementCalls++
                    return ScheduleEnforcementOutcome.APPLIED
                }
            },
        )

        val absent = runtime.evaluate(now, appToken, capability, Connectivity.OFFLINE)
        assertEquals(ScheduleRuntimeState.NO_ACCEPTED_POLICY, absent.runtimeState)
        assertEquals(ScheduleDecisionKind.ALLOWED, absent.decision.decision)
        assertEquals(ScheduleRuntimeStatus.NOT_READY, port.currentStatus())
        assertFalse(runtime.isPcaBedtimeActive(now))
        assertFalse(runtime.isScheduledQuietContext(now))

        val raw = "{\"candidatePolicy\":null,\"deviceTrustSetEpoch\":-1}"
        backing.putString(STORE_KEY, raw)
        val corrupt = runtime.evaluate(now, appToken, capability, Connectivity.OFFLINE)
        assertEquals(ScheduleRuntimeState.CORRUPT_LOCAL_STATE, corrupt.runtimeState)
        assertEquals(ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE, corrupt.decision.decision)
        assertTrue(runtime.isPcaBedtimeActive(now))
        assertTrue(runtime.isScheduledQuietContext(now))
        assertEquals(raw, backing.getString(STORE_KEY))

        assertEquals(ScheduleRuntimeStatus.UNAVAILABLE, port.currentStatus())
        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, port.enforce("com.example.game"))
        assertEquals(0, enforcementCalls)
        assertEquals(raw, backing.getString(STORE_KEY))
    }

    private companion object {
        const val STORE_KEY = "schedule_policy_snapshot_v1"
    }

    private fun assertCorruptWithoutRewrite(raw: String) {
        val backing = InMemoryPersistentStateStore()
        backing.putString(STORE_KEY, raw)
        val store = PersistentSchedulePolicyStore(backing)

        assertSame(SchedulePolicyStoreRead.Corrupt, store.read())
        assertNull(store.load())
        assertEquals(raw, backing.getString(STORE_KEY))
    }
}
