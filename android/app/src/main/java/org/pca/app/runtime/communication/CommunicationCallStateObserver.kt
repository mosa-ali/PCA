package org.pca.app.runtime.communication

/** Public platform seam for the minimum call-state signal PCA needs. No number, contact,
 * message, audio, or call-content data crosses this boundary. */
interface CommunicationCallStateObserver {
    fun start(onState: (CommunicationExceptionCoordinator.CallState) -> Unit)
    fun stop()
    fun isAvailable(): Boolean = false
}

/** Conservative capability fallback when READ_PHONE_STATE is unavailable or the platform cannot
 * register a callback. It preserves native telephony behavior and avoids fabricating timing. */
object NoOpCommunicationCallStateObserver : CommunicationCallStateObserver {
    override fun start(onState: (CommunicationExceptionCoordinator.CallState) -> Unit) = Unit
    override fun stop() = Unit
}

/** Owns observer registration around the coordinator and makes start/stop idempotent. */
class CommunicationCallLifecycleAdapter(
    private val observer: CommunicationCallStateObserver,
    private val coordinator: CommunicationExceptionCoordinator,
) {
    private var started = false

    fun start() {
        if (started) return
        observer.start(coordinator::onCallState)
        started = true
    }

    fun stop() {
        if (!started) return
        observer.stop()
        started = false
    }
}
