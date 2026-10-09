package org.pca.app.runtime.location.geofence

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentLinkedQueue

class GeofenceDurabilityTest {
    private val scope = GeofenceStorageScope("family-a", "child-a")
    private fun zones(backing: PersistentStateStore) = GeofenceZoneStore(backing, scopeProvider = { scope })
    private fun states(backing: PersistentStateStore) = GeofenceZoneStateStore(backing, scopeProvider = { scope })
    private fun zone(id: String = "home", revision: Long = 1L) = GeofenceZone(id, "Home", 25.0, 55.0, 100.0, revision = revision)
    private val baseline = GeofenceZoneState("home", confirmedMembership = GeofenceMembership.INSIDE)

    @Test fun `zone and debounce state writes survive disk only restart and durable removal`() {
        val zoneBacking = DiskStore(); val stateBacking = DiskStore()
        zones(zoneBacking).addOrReplace(zone()); states(stateBacking).save(baseline)
        assertEquals(listOf(zone()), zones(DiskStore(zoneBacking.disk)).loadZones())
        assertEquals(baseline, states(DiskStore(stateBacking.disk)).load("home"))
        zones(zoneBacking).remove("home"); states(stateBacking).clear("home")
        assertTrue(zones(DiskStore(zoneBacking.disk)).loadZones().isEmpty())
        assertNull(states(DiskStore(stateBacking.disk)).load("home"))
        assertTrue(zoneBacking.markedBeforeCandidate && stateBacking.markedBeforeCandidate)
    }

    @Test fun `candidate flush and readback failures restore prior durable zone and state`() {
        for (readbackFailure in listOf(false, true)) {
            val backing = DiskStore(); val repo = zones(backing)
            repo.addOrReplace(zone()); backing.reset()
            if (readbackFailure) backing.mismatchAtFlush = 2 else backing.failFlushAt = setOf(2)
            assertThrows(GeofencePersistenceException::class.java) { repo.addOrReplace(zone(revision = 2)) }
            assertEquals(listOf(zone()), repo.loadZones())
            assertEquals(listOf(zone()), zones(DiskStore(backing.disk)).loadZones())
            val stateBacking = DiskStore(); val stateStore = states(stateBacking)
            stateStore.save(baseline); stateBacking.reset(); stateBacking.failFlushAt = setOf(2)
            assertThrows(GeofencePersistenceException::class.java) { stateStore.clear("home") }
            assertEquals(baseline, stateStore.load("home"))
            assertEquals(baseline, states(DiskStore(stateBacking.disk)).load("home"))
        }
    }

    @Test fun `unconfirmed rollback marker blocks policy enforcement across process death`() {
        val backing = DiskStore(); val repo = zones(backing)
        repo.addOrReplace(zone()); backing.reset()
        backing.throwAfterFlushAt = setOf(2); backing.failFlushAt = setOf(3)
        assertThrows(GeofencePersistenceException::class.java) { repo.addOrReplace(zone(revision = 2)) }
        assertThrows(CorruptGeofenceZoneStoreException::class.java) { repo.loadZones() }
        val restarted = zones(DiskStore(backing.disk))
        assertThrows(CorruptGeofenceZoneStoreException::class.java) { restarted.loadZones() }
        assertThrows(CorruptGeofenceZoneStoreException::class.java) { restarted.addOrReplace(zone("school")) }
    }

    @Test fun `uncertain debounce state is never a trusted baseline after restart`() {
        val backing = DiskStore(); val repo = states(backing)
        repo.save(baseline); backing.reset()
        backing.throwAfterFlushAt = setOf(2); backing.failFlushAt = setOf(3)
        assertThrows(GeofencePersistenceException::class.java) { repo.clear("home") }
        assertNull(repo.load("home"))
        val restarted = states(DiskStore(backing.disk))
        assertNull(restarted.load("home"))
        assertThrows(GeofencePersistenceException::class.java) { restarted.save(baseline) }
        assertThrows(GeofencePersistenceException::class.java) { restarted.clear("home") }
    }

    @Test fun `marker write readback failure cannot stage policy bytes`() {
        val backing = DiskStore(); backing.mismatchAtFlush = 1
        assertThrows(GeofencePersistenceException::class.java) { zones(backing).addOrReplace(zone()) }
        assertEquals(0, backing.candidateWrites)
        assertTrue(zones(DiskStore(backing.disk)).loadZones().isEmpty())
    }

    @Test fun `marker removal failure does not rollback a verified candidate`() {
        for (durablyRemoved in listOf(false, true)) {
            val backing = DiskStore(); val repo = zones(backing)
            repo.addOrReplace(zone()); backing.reset()
            if (durablyRemoved) backing.throwAfterFlushAt = setOf(3) else backing.failMarkerRemove = true
            assertThrows(GeofencePersistenceException::class.java) { repo.addOrReplace(zone(revision = 2)) }
            assertEquals(1, backing.candidateWrites)
            assertThrows(CorruptGeofenceZoneStoreException::class.java) { repo.loadZones() }
            val restarted = zones(DiskStore(backing.disk))
            if (durablyRemoved) assertEquals(listOf(zone(revision = 2)), restarted.loadZones())
            else assertThrows(CorruptGeofenceZoneStoreException::class.java) { restarted.loadZones() }
        }
    }

    @Test fun `receiver confirms state clear on separate file before replacing geometry`() = runTest {
        for (clearFailure in listOf(false, true)) {
            val zoneBacking = DiskStore(); val stateBacking = DiskStore()
            val zoneStore = zones(zoneBacking); val stateStore = states(stateBacking)
            zoneStore.addOrReplace(zone()); stateStore.save(baseline); stateBacking.reset()
            if (clearFailure) stateBacking.failFlushAt = setOf(2)
            zoneBacking.beforeCandidate = {
                assertNull(stateBacking.disk[scope.zoneStateStoreKey("geofence_zone_state_v2", "home")])
            }
            val payload = SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "home", 2, 3, zone(revision = 2)))
            val receiver = SafeZonePolicyReceiver("family-a", "child-a",
                object : SafeZoneFamilyAuthority {
                    override suspend fun isRecipientAuthorized(familyId: String, recipientEndpointId: String, trustSetEpoch: Long, keyEpoch: Long) = true
                    override suspend fun resolveAuthorizedSender(familyId: String, senderDeviceId: String, senderKeyId: String, trustSetEpoch: Long, keyEpoch: Long) = SafeZoneAuthorizedSender(SafeZoneFamilyRole.OWNER, "key")
                }, object : SafeZoneEnvelopeSignatureVerifier {
                    override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) = true
                }, object : SafeZonePayloadDecryptor {
                    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) = payload
                }, zoneStore, stateStore)
            val envelope = SafeZonePolicyEnvelope("family-a", "child-a", "parent-a", "key-a", 2, 3, 2, "home", byteArrayOf(1), byteArrayOf(2), "signature", 1000, 10000)
            assertEquals(if (clearFailure) SafeZonePolicyReceiveResult.REJECTED else SafeZonePolicyReceiveResult.APPLIED,
                receiver.receive(envelope, 2000))
            assertEquals(listOf(zone(revision = if (clearFailure) 1 else 2)), zones(DiskStore(zoneBacking.disk)).loadZones())
            assertEquals(if (clearFailure) baseline else null, states(DiskStore(stateBacking.disk)).load("home"))
        }
    }

    @Test fun `shared zone wrappers serialize read modify write without lost updates`() {
        val backing = DiskStore(); val first = zones(backing); val second = zones(backing)
        val ready = CountDownLatch(2); val start = CountDownLatch(1)
        val errors = ConcurrentLinkedQueue<Throwable>()
        val workers = listOf(first to "home", second to "school").map { (repo, id) -> Thread {
            ready.countDown()
            try { check(start.await(5, TimeUnit.SECONDS)); repo.addOrReplace(zone(id)) }
            catch (failure: Throwable) { errors.add(failure) }
        }.apply { start() } }
        assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown()
        workers.forEach { it.join(5000) }
        assertTrue(workers.none { it.isAlive }); assertTrue(errors.isEmpty())
        assertEquals(setOf("home", "school"), zones(DiskStore(backing.disk)).loadZones().map { it.zoneId }.toSet())
    }

    @Test fun `crash after durable state clear before zone commit cold starts old geometry safely`() {
        val zoneBacking = DiskStore(); val stateBacking = DiskStore()
        zones(zoneBacking).addOrReplace(zone()); states(stateBacking).save(baseline)
        states(stateBacking).clear("home")
        // Process dies here. No zone transaction has started in the other file.
        val restartedZones = zones(DiskStore(zoneBacking.disk))
        val restartedStates = states(DiskStore(stateBacking.disk))
        assertEquals(listOf(zone()), restartedZones.loadZones())
        assertNull(restartedStates.load("home"))
        val alerts = RecordingGeofenceAlertPort()
        val monitor = GeofenceMonitor(restartedZones, restartedStates, alerts,
            GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1))
        assertTrue(monitor.evaluateSample(org.pca.app.platform.LocationSample(25.0, 55.0, 5f, 0L), 1L).isEmpty())
        assertTrue(alerts.delivered.isEmpty())
    }

    @Test fun `monitor tick cannot resurrect old baseline after a policy replacement`() {
        val zoneBacking = DiskStore(); val stateBacking = DiskStore()
        val zoneStore = zones(zoneBacking); val stateStore = states(stateBacking)
        zoneStore.addOrReplace(zone()); stateStore.save(baseline.copy(confirmedMembership = GeofenceMembership.OUTSIDE))
        val started = CountDownLatch(1)
        var replacement: Thread? = null
        stateBacking.beforeCandidate = {
            if (replacement == null) {
                replacement = Thread {
                    started.countDown()
                    zoneStore.withPolicyLock {
                        stateStore.clear("home")
                        check(zoneStore.addOrReplaceIfNewer(scope, zone(revision = 2)))
                    }
                }.apply { start() }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (replacement?.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
                assertEquals(Thread.State.BLOCKED, replacement?.state)
            }
        }
        val monitor = GeofenceMonitor(zoneStore, stateStore, RecordingGeofenceAlertPort(),
            GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1))
        monitor.evaluateSample(org.pca.app.platform.LocationSample(25.0, 55.0, 5f, 0L), 1L)
        replacement?.join(5_000)
        assertTrue(replacement?.isAlive == false)
        assertEquals(listOf(zone(revision = 2)), zones(DiskStore(zoneBacking.disk)).loadZones())
        assertNull(states(DiskStore(stateBacking.disk)).load("home"))
    }

    @Test fun `impossible completed debounce streak cannot create an exit alert`() {
        val zoneBacking = DiskStore(); val stateBacking = DiskStore()
        val zoneStore = zones(zoneBacking); val stateStore = states(stateBacking)
        zoneStore.addOrReplace(zone())
        stateStore.save(GeofenceZoneState("home", GeofenceMembership.INSIDE,
            GeofenceMembership.OUTSIDE, candidateStreak = 2))
        val alerts = RecordingGeofenceAlertPort()
        val monitor = GeofenceMonitor(zoneStore, stateStore, alerts,
            GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 2))
        val outside = org.pca.app.platform.LocationSample(26.0, 55.0, 5f, 0L)
        assertTrue(monitor.evaluateSample(outside, 1L).isEmpty())
        assertTrue(alerts.delivered.isEmpty())
        assertEquals(GeofenceMembership.UNKNOWN, stateStore.load("home")?.confirmedMembership)
    }

    @Test fun `older or equal competing receiver cannot overwrite policy accepted during baseline clear`() = runTest {
      for (competingRevision in listOf(2L, 3L)) {
        val zoneBacking = DiskStore(); val stateBacking = DiskStore()
        val zoneStore = zones(zoneBacking); val stateStore = states(stateBacking)
        zoneStore.addOrReplace(zone()); stateStore.save(baseline)
        var competingWrite = false
        stateBacking.beforeCandidate = {
            if (!competingWrite) {
                competingWrite = true
                zones(zoneBacking).addOrReplace(zone(revision = competingRevision).copy(label = "Competing"))
            }
        }
        val payload = SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "home", 2, 3, zone(revision = 2)))
        val receiver = SafeZonePolicyReceiver("family-a", "child-a",
            object : SafeZoneFamilyAuthority {
                override suspend fun isRecipientAuthorized(familyId: String, recipientEndpointId: String, trustSetEpoch: Long, keyEpoch: Long) = true
                override suspend fun resolveAuthorizedSender(familyId: String, senderDeviceId: String, senderKeyId: String, trustSetEpoch: Long, keyEpoch: Long) = SafeZoneAuthorizedSender(SafeZoneFamilyRole.OWNER, "key")
            }, object : SafeZoneEnvelopeSignatureVerifier {
                override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) = true
            }, object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) = payload
            }, zoneStore, stateStore)
        val envelope = SafeZonePolicyEnvelope("family-a", "child-a", "parent-a", "key-a", 2, 3, 2, "home", byteArrayOf(1), byteArrayOf(2), "signature", 1000, 10000)
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope, 2000))
        assertTrue(competingWrite)
        assertEquals(listOf(zone(revision = competingRevision).copy(label = "Competing")),
            zones(DiskStore(zoneBacking.disk)).loadZones())
        if (competingRevision > 2L) {
            assertThrows(IllegalStateException::class.java) { zoneStore.addOrReplace(zone(revision = 2)) }
        }
        // Existing direct local authoring keeps its equal-revision behavior.
        zoneStore.addOrReplace(zone(revision = competingRevision).copy(label = "Updated label"))
        assertEquals("Updated label", zoneStore.loadZones().single().label)
      }
    }

    private class DiskStore(initial: Map<String, String> = emptyMap()) : PersistentStateStore {
        val memory = initial.toMutableMap()
        var disk = initial.toMap()
        var flushCount = 0
        var candidateWrites = 0
        var markedBeforeCandidate = true
        var mismatchAtFlush = -1
        var failFlushAt = emptySet<Int>()
        var throwAfterFlushAt = emptySet<Int>()
        var failMarkerRemove = false
        var beforeCandidate: (() -> Unit)? = null
        override fun getString(key: String): String? = if (flushCount == mismatchAtFlush) "mismatch" else memory[key]
        override fun putString(key: String, value: String) {
            if (!key.endsWith("_pending_write")) { candidateWrites++; markedBeforeCandidate = markedBeforeCandidate && disk[key + "_pending_write"] == "pending"; beforeCandidate?.invoke() }
            memory[key] = value
        }
        override fun remove(key: String) {
            if (key.endsWith("_pending_write") && failMarkerRemove) error("marker removal failed")
            if (!key.endsWith("_pending_write")) { candidateWrites++; markedBeforeCandidate = markedBeforeCandidate && disk[key + "_pending_write"] == "pending"; beforeCandidate?.invoke() }
            memory.remove(key)
        }
        override fun contains(key: String) = memory.containsKey(key)
        override fun clear() { memory.clear() }
        override fun flush() {
            flushCount++
            if (flushCount in failFlushAt) error("disk write failed")
            disk = memory.toMap()
            if (flushCount in throwAfterFlushAt) error("disk confirmation failed")
        }
        fun reset() { flushCount = 0; candidateWrites = 0 }
    }
}
