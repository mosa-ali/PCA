package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.EnrollmentLifecycleAuditDao
import org.pca.app.persistence.entity.EnrollmentLifecycleAuditEntity

/**
 * PCA-FR-140: thin repository over [EnrollmentLifecycleAuditDao], mirroring this codebase's
 * existing event-repository convention (see `InstalledAppEventRepository`). `insert` is
 * `@Insert(REPLACE)`-backed on [EnrollmentLifecycleAuditEntity.id] (idempotent, process-restart
 * safe).
 */
class EnrollmentLifecycleAuditRepository(private val dao: EnrollmentLifecycleAuditDao) {
    suspend fun insert(entity: EnrollmentLifecycleAuditEntity) = dao.insert(entity)

    suspend fun getForDevice(deviceId: String): List<EnrollmentLifecycleAuditEntity> = dao.getForDevice(deviceId)

    suspend fun count(): Int = dao.count()
}
