package org.pca.app.enrollment

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.pca.app.persistence.entity.EnrollmentLifecycleAuditEntity
import org.pca.app.persistence.repository.EnrollmentLifecycleAuditRepository
import java.util.UUID

/**
 * PCA-FR-140: durable, device-local [EnrollmentLifecycleAuditSink] backed by
 * [EnrollmentLifecycleAuditRepository] (Room, `enrollment_lifecycle_audits`
 * table) -- replaces the previous [InMemoryEnrollmentLifecycleAuditSink]
 * production default, which lost every record on process death. [append]
 * itself is synchronous per the [EnrollmentLifecycleAuditSink] contract
 * ([EnrollmentLifecycleAuditor.recordTransition] is not suspend either), so
 * the actual Room write is dispatched onto [scope]; this mirrors every other
 * fire-and-forget local-audit write in this app and is safe because
 * [EnrollmentLifecycleAuditRepository.insert] is `@Insert(REPLACE)` on a
 * caller-supplied id, so a write that is still in flight at process death
 * is simply lost exactly once (never partially applied or duplicated) --
 * an acceptable best-effort posture for an audit trail, not a durability
 * guarantee for a decision itself (the underlying [PairingState] commit
 * this audits is never gated on this write completing).
 */
class PersistentEnrollmentLifecycleAuditSink(
    private val repository: EnrollmentLifecycleAuditRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) : EnrollmentLifecycleAuditSink {
    override fun append(record: EnrollmentLifecycleAuditRecord) {
        scope.launch {
            repository.insert(
                EnrollmentLifecycleAuditEntity(
                    id = UUID.randomUUID().toString(),
                    familyId = record.familyId,
                    deviceId = record.deviceId,
                    actorId = record.actorId,
                    fromState = record.fromState?.name,
                    toState = record.toState.name,
                    reason = record.reason,
                    occurredAtEpochMillis = record.occurredAtUtc.toEpochMilli(),
                ),
            )
        }
    }
}
