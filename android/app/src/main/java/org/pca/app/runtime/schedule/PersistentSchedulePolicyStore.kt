package org.pca.app.runtime.schedule

import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore

/**
 * Coordinator integration glue: backs [SchedulePolicyStore] with the same durable, OS-backed
 * [PersistentStateStore] pattern already established for [org.pca.app.feature.screentime.persistence.PersistentScreenTimeSnapshotStore]
 * and [org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore] -- replacing the
 * in-memory reference implementation used during standalone lane development, per mission
 * section 12's "policy accepted -> process/device restart while offline -> same schedule
 * decision still produced" requirement. The slot generation detects torn or mismatched local
 * writes; it is not a hardware monotonic counter and does not replace Trust Set authorization.
 */
class PersistentSchedulePolicyStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : SchedulePolicyStore {
    private val coordinationLock: Any = store.coordinationLock

    override fun save(snapshot: SchedulePolicySnapshot) {
        val raw = SchedulePolicyJson.encodeSnapshot(snapshot).toString()
        synchronized(coordinationLock) {
            val previous = readUnlocked()
            check(previous !is SchedulePolicyStoreRead.Corrupt) {
                "Cannot replace corrupt persisted schedule policy state"
            }
            val previousSnapshot = (previous as? SchedulePolicyStoreRead.Present)?.snapshot
            previousSnapshot?.let { current ->
                check(snapshot.deviceTrustSetEpoch >= current.deviceTrustSetEpoch &&
                    snapshot.deviceKeyEpoch >= current.deviceKeyEpoch) {
                    "Cannot roll back the persisted Trust Set or key epoch floor"
                }
                // A literal retry is a no-op. In particular it cannot refresh lastPolicySyncAtUtc
                // or advance the durable slot generation merely by replaying the same snapshot.
                if (snapshot == current) return
                enforcePolicyRevision(current, snapshot)
            }

            val previousPointer = store.getString(activePointerKey)
            val previousFormat = store.getString(formatKey)
            val activePointer = previousPointer?.let(::parseActivePointer)
            val nextGeneration = activePointer?.let { Math.addExact(it.generation, 1L) } ?: 1L
            val nextSlot = if (activePointer?.slot == SLOT_0) SLOT_1 else SLOT_0
            val nextSlotKey = slotSnapshotKey(nextSlot)
            val nextGenerationKey = slotGenerationKey(nextSlot)

            // Stage and durably verify the snapshot before changing the committed-format marker
            // or active pointer. Interrupted staging is ignored; the existing pointer remains live.
            store.putString(nextSlotKey, raw)
            store.putString(nextGenerationKey, nextGeneration.toString())
            store.flush()
            check(store.getString(nextSlotKey) == raw) {
                "Schedule policy snapshot readback did not match the staged bytes"
            }
            check(store.getString(nextGenerationKey) == nextGeneration.toString()) {
                "Schedule policy generation readback did not match the staged value"
            }
            check(decode(raw) == SchedulePolicyStoreRead.Present(snapshot)) {
                "Schedule policy snapshot did not round-trip"
            }

            try {
                // Once the marker is durable, a missing pointer is corruption. Never fall back
                // to a legacy snapshot or an older slot after a committed slot-format write.
                store.putString(formatKey, SLOT_FORMAT)
                store.flush()
                check(store.getString(formatKey) == SLOT_FORMAT) {
                    "Schedule policy storage-format readback did not match"
                }

                val nextPointer = encodeActivePointer(ActivePointer(nextGeneration, nextSlot))
                store.putString(activePointerKey, nextPointer)
                store.flush()
                check(store.getString(activePointerKey) == nextPointer) {
                    "Schedule policy active-generation readback did not match"
                }
                check(readUnlocked() == SchedulePolicyStoreRead.Present(snapshot)) {
                    "Schedule policy active snapshot readback did not match"
                }
            } catch (failure: Exception) {
                try {
                    restore(activePointerKey, previousPointer)
                    restore(formatKey, previousFormat)
                    store.flush()
                    if (previousPointer == null) {
                        // Rollback to legacy/empty state must also remove evidence from the
                        // uncommitted slot, or future reads could mistake it for lost metadata.
                        store.remove(nextSlotKey)
                        store.remove(nextGenerationKey)
                        store.flush()
                        check(!store.contains(nextSlotKey) && !store.contains(nextGenerationKey)) {
                            "Schedule policy staged-slot cleanup readback did not match"
                        }
                    }
                    check(store.getString(activePointerKey) == previousPointer) {
                        "Schedule policy active-generation rollback readback did not match"
                    }
                    check(store.getString(formatKey) == previousFormat) {
                        "Schedule policy format rollback readback did not match"
                    }
                    check(readUnlocked() == previous) {
                        "Schedule policy rollback did not restore the previous readable state"
                    }
                } catch (rollbackFailure: Exception) {
                    // The backing store can no longer establish which pointer is durable.
                    // Fail closed for this adapter instance until it is reconstructed.
                    writeStateUncertain = true
                    failure.addSuppressed(rollbackFailure)
                }
                throw IllegalStateException("Schedule policy snapshot activation failed", failure)
            }
        }
    }

    override fun load(): SchedulePolicySnapshot? = when (val result = read()) {
        SchedulePolicyStoreRead.Absent, SchedulePolicyStoreRead.Corrupt -> null
        is SchedulePolicyStoreRead.Present -> result.snapshot
    }

    override fun read(): SchedulePolicyStoreRead = synchronized(coordinationLock) { readUnlocked() }

    private fun readUnlocked(): SchedulePolicyStoreRead {
        if (writeStateUncertain) return SchedulePolicyStoreRead.Corrupt
        return try {
            val format = store.getString(formatKey)
            val pointerRaw = store.getString(activePointerKey)
            if (format != null && format != SLOT_FORMAT) return SchedulePolicyStoreRead.Corrupt

            if (pointerRaw == null) {
                if (format == SLOT_FORMAT || hasSlotEvidence()) return SchedulePolicyStoreRead.Corrupt
                val legacyRaw = store.getString(key) ?: return SchedulePolicyStoreRead.Absent
                return decode(legacyRaw)
            }
            if (format != SLOT_FORMAT) return SchedulePolicyStoreRead.Corrupt

            val pointer = parseActivePointer(pointerRaw) ?: return SchedulePolicyStoreRead.Corrupt
            val raw = store.getString(slotSnapshotKey(pointer.slot)) ?: return SchedulePolicyStoreRead.Corrupt
            val storedGeneration = store.getString(slotGenerationKey(pointer.slot))
                ?.toLongOrNull()
                ?: return SchedulePolicyStoreRead.Corrupt
            if (storedGeneration != pointer.generation) return SchedulePolicyStoreRead.Corrupt
            decode(raw)
        } catch (_: Exception) {
            SchedulePolicyStoreRead.Corrupt
        }
    }

    private fun decode(raw: String): SchedulePolicyStoreRead = try {
        SchedulePolicyStoreRead.Present(SchedulePolicyJson.decodeSnapshot(JSONObject(raw)))
    } catch (_: Exception) {
        // Do not remove or rewrite raw bytes. Keep them for diagnosis and recovery.
        SchedulePolicyStoreRead.Corrupt
    }

    /** Defense in depth for the envelope's authoritative POLICY_UPDATE version ledger. */
    private fun enforcePolicyRevision(current: SchedulePolicySnapshot, next: SchedulePolicySnapshot) {
        val priorPolicy = current.candidatePolicy ?: current.lastKnownGoodPolicy ?: return
        val nextPolicy = next.candidatePolicy
            ?: error("Cannot erase a persisted schedule policy without an authorized replacement")
        // SchedulePolicyV1 defines policyId as the stable identifier for this child's schedule,
        // not a per-revision identifier. Do not permit a local snapshot write to reset that
        // identity or its strictly increasing revision stream.
        check(nextPolicy.policyId == priorPolicy.policyId) {
            "Cannot change the stable schedule policy identity"
        }
        check(nextPolicy.policyRevision == priorPolicy.policyRevision ||
            SchedulePolicyValidator.isAcceptableRevision(nextPolicy.policyRevision, priorPolicy.policyRevision)) {
            "Schedule policy revision is stale"
        }

        if (nextPolicy.policyRevision == priorPolicy.policyRevision) {
            val samePolicyIdentityAndBytes = priorPolicy.policyId == nextPolicy.policyId &&
                SchedulePolicyEnvelopePayload.encode(priorPolicy) ==
                SchedulePolicyEnvelopePayload.encode(nextPolicy)
            check(samePolicyIdentityAndBytes && current.lastKnownGoodPolicy == next.lastKnownGoodPolicy &&
                current.lastPolicySyncAtUtc == next.lastPolicySyncAtUtc) {
                "Conflicting schedule policy replay or freshness update at the same revision"
            }
        }
    }

    private fun restore(storageKey: String, value: String?) {
        if (value == null) store.remove(storageKey) else store.putString(storageKey, value)
    }

    private fun slotSnapshotKey(slot: String): String = "$key.slot.$slot.snapshot"

    private fun slotGenerationKey(slot: String): String = "$key.slot.$slot.generation"

    private fun hasSlotEvidence(): Boolean = listOf(SLOT_0, SLOT_1).any { slot ->
        store.contains(slotSnapshotKey(slot)) || store.contains(slotGenerationKey(slot))
    }

    private val activePointerKey: String
        get() = "$key.active_generation"

    private val formatKey: String
        get() = "$key.format"

    private fun encodeActivePointer(pointer: ActivePointer): String = "${pointer.generation}:${pointer.slot}"

    private fun parseActivePointer(raw: String): ActivePointer? {
        val parts = raw.split(':')
        if (parts.size != 2) return null
        val generation = parts[0].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val slot = parts[1].takeIf { it == SLOT_0 || it == SLOT_1 } ?: return null
        return ActivePointer(generation, slot)
    }

    private data class ActivePointer(val generation: Long, val slot: String)

    @Volatile
    private var writeStateUncertain = false

    private companion object {
        const val SLOT_0 = "0"
        const val SLOT_1 = "1"
        const val SLOT_FORMAT = "slots-v1"
        const val KEY = "schedule_policy_snapshot_v1"
    }
}
