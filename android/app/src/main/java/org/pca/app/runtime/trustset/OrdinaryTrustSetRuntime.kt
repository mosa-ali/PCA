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

    /** Reports whether exact-request custody still needs a later status/retry attempt. */
    suspend fun hasPendingRequest(): Boolean = flight.withLock {
        requireCurrentRoot()
        store.read()?.pending != null
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
            check(rootStore.compareAndRunIfCurrent(root) {
                OrdinaryTrustSetBootstrapAnchor.seed(rootStore, ordinaryStore, verifier)
                true
            }) { "committed_first_device_root_changed" }
            check(rootStore.confirmDurable(root)) { "committed_first_device_root_changed" }
            fun assertRoot() {
                check(rootStore.current() == root && rootStore.confirmDurable(root)) {
                    "committed_first_device_root_changed"
                }
            }
            // A root can change while authenticated transport is suspended. Revalidate before
            // handing any response to the coordinator, where it could authorize signing,
            // replay or a durable floor update.
            val boundApi = object : OrdinaryTrustSetApi {
                override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                    assertRoot()
                    return api.submit(familyId, request).also { assertRoot() }
                }
                override suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                    assertRoot()
                    return api.status(familyId, request).also { assertRoot() }
                }
                override suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord {
                    assertRoot()
                    return api.getEpoch(familyId, trustSetEpoch).also { assertRoot() }
                }
                override suspend fun getHead(familyId: String): AcceptedEpochRecord {
                    assertRoot()
                    return api.getHead(familyId).also { assertRoot() }
                }
            }
            val boundSigner = object : DskSignatureEngine {
                override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                    assertRoot()
                    return signer.signCanonicalDer(alias, message).also { assertRoot() }
                }
            }
            val boundStore = object : OrdinaryEpochStore by ordinaryStore {
                override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean =
                    rootStore.compareAndRunIfCurrent(root) {
                        ordinaryStore.compareAndSetDurably(expected, next)
                    }
            }
            val coordinator = OrdinaryTrustSetCoordinator(
                boundStore, boundApi, boundSigner, verifier, root.seed.deviceId, root.seed.signingKeyId, root.seed.dskAlias,
            )
            return OrdinaryTrustSetRuntime(rootStore, root, ordinaryStore, coordinator)
        }
    }
}
