package org.pca.app.runtime.trustset

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceRootStore
import org.pca.app.security.DskSignatureEngine

/**
 * Root-bound runtime entry point for ordinary Trust Set work. Construction can seed only from
 * the committed ceremony's exact epoch-1 record. Reconciliation and submission only update the
 * local accepted Trust Set floor; this class has no device-lifecycle or policy-activation API.
 */
class OrdinaryTrustSetRuntime private constructor(
    private val rootStore: FirstDeviceRootStore,
    private val root: FirstDeviceRootRecord,
    private val store: PersistentOrdinaryEpochStore,
    private val coordinator: OrdinaryTrustSetCoordinator,
) {
    private val flight = Mutex()

    /** Retry the exact durable request first, then verify any newer server head from that floor. */
    suspend fun reconcile(): Boolean = flight.withLock {
        requireCurrentRoot()
        val before = store.read() ?: return@withLock false
        val hadPending = before.pending != null
        if (hadPending) coordinator.reconcile()
        val advanced = coordinator.catchUp()
        requireCurrentRoot()
        advanced > 0 || (hadPending && store.read()?.pending == null)
    }

    /** Product actions may submit through this root-bound call point; unknown outcomes stay pending. */
    suspend fun prepareAndSubmit(candidate: UntrustedTrustSetEpoch): Boolean = flight.withLock {
        requireCurrentRoot()
        if (!coordinator.prepare(candidate)) return@withLock false
        requireCurrentRoot()
        val accepted = coordinator.submitExact()
        requireCurrentRoot()
        accepted
    }

    private fun requireCurrentRoot() {
        check(root.state == FirstDeviceRootState.ROOT_COMMITTED && rootStore.current() == root &&
            rootStore.confirmDurable(root)) { "committed_first_device_root_changed" }
    }

    companion object {
        /** Build only after an authenticated API/session has been composed for this same root. */
        fun create(
            rootStore: FirstDeviceRootStore,
            ordinaryStore: PersistentOrdinaryEpochStore,
            api: OrdinaryTrustSetApi,
            signer: DskSignatureEngine,
            verifier: OrdinaryEpochSignatureVerifier,
        ): OrdinaryTrustSetRuntime {
            val root = rootStore.current() ?: throw IllegalStateException("committed_first_device_root_unavailable")
            require(root.state == FirstDeviceRootState.ROOT_COMMITTED && root.familyId != null)
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore, ordinaryStore, verifier)
            check(rootStore.confirmDurable(root)) { "committed_first_device_root_changed" }
            val coordinator = OrdinaryTrustSetCoordinator(
                ordinaryStore, api, signer, verifier, root.seed.deviceId, root.seed.signingKeyId, root.seed.dskAlias,
            )
            return OrdinaryTrustSetRuntime(rootStore, root, ordinaryStore, coordinator)
        }
    }
}
