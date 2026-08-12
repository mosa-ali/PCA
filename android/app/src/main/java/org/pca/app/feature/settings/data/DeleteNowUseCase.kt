package org.pca.app.feature.settings.data

import java.time.Instant
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity
import org.pca.app.persistence.retention.DeleteNowCoordinator

/**
 * PCA-RUNTIME-PERSIST-1 Section 20: the authorized scope of one "Delete
 * Now" request. This use case never infers scope on its own -- the caller
 * (the confirmation UI, Section 20's "parent-authorized local deletion
 * only") is the one deciding which of these the parent picked.
 */
sealed class DeleteNowScope {
    data class Device(val familyId: String, val deviceId: String) : DeleteNowScope()
    data class Child(val familyId: String, val memberId: String, val childDeviceIds: List<String>) : DeleteNowScope()
    data class Family(val familyId: String) : DeleteNowScope()
}

sealed class DeleteNowResult {
    data class Success(val receipt: RetentionDeletionReceiptEntity) : DeleteNowResult()
    data class Failure(val reason: String) : DeleteNowResult()
}

/**
 * Real settings/use-case entry point for "Delete Now" (Section 20), on top
 * of the existing [DeleteNowCoordinator] (already multi-family-safe --
 * Section 3 forbids a second, parallel implementation of that transaction
 * logic). Every scope resolves to exactly one coordinator call inside one
 * transaction, so an interruption mid-delete cannot leave a half-deleted
 * family (Section 21's "Delete Now interruption" case): either the whole
 * scope's rows are gone and a receipt exists, or nothing changed and
 * [DeleteNowResult.Failure] is returned.
 */
class DeleteNowUseCase(private val coordinator: DeleteNowCoordinator) {
    suspend fun execute(scope: DeleteNowScope, nowUtc: Instant = Instant.now()): DeleteNowResult = try {
        val receipt = when (scope) {
            is DeleteNowScope.Device -> coordinator.deleteDevice(scope.familyId, scope.deviceId, nowUtc)
            is DeleteNowScope.Child -> coordinator.deleteChild(scope.familyId, scope.memberId, scope.childDeviceIds, nowUtc)
            is DeleteNowScope.Family -> coordinator.deleteFamily(scope.familyId, nowUtc)
        }
        DeleteNowResult.Success(receipt)
    } catch (e: Exception) {
        DeleteNowResult.Failure(e.message ?: "unknown_error")
    }
}
