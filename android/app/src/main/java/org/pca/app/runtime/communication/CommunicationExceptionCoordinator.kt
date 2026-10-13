package org.pca.app.runtime.communication

/**
 * PCA-FR-015A: maps ordinary phone-call lifecycle signals to a distinct communication exception.
 * RINGING keeps the native call UI available without starting the exception; OFFHOOK starts it;
 * IDLE ends it. If observation becomes unavailable, its separate callback releases the temporary
 * exception without representing the call as ended. This coordinator deliberately has no
 * emergency/SOS semantics and does not grant Messages-app access.
 */
class CommunicationExceptionCoordinator(
    private val onCommunicationStarted: () -> Unit,
    private val onCommunicationEnded: () -> Unit,
    private val onCommunicationObservationUnavailable: () -> Unit,
    initiallyActive: Boolean = false,
) {
    /** UNAVAILABLE is an observation status, not a telephony call state or a claim that a call ended. */
    enum class CallState { IDLE, RINGING, OFFHOOK, UNAVAILABLE }

    private var active = initiallyActive

    fun onCallState(state: CallState) {
        when (state) {
            CallState.RINGING -> Unit
            CallState.OFFHOOK -> if (!active) {
                active = true
                onCommunicationStarted()
            }
            CallState.IDLE -> if (active) {
                active = false
                onCommunicationEnded()
            }
            CallState.UNAVAILABLE -> if (active) {
                active = false
                onCommunicationObservationUnavailable()
            }
        }
    }
}
