package org.pca.app.runtime.communication

/**
 * PCA-FR-015A: maps ordinary phone-call lifecycle signals to a distinct communication exception.
 * RINGING keeps the native call UI available without starting the exception; OFFHOOK starts it;
 * IDLE ends it. This coordinator deliberately
 * has no emergency/SOS semantics and does not grant Messages-app access.
 */
class CommunicationExceptionCoordinator(
    private val onCommunicationStarted: () -> Unit,
    private val onCommunicationEnded: () -> Unit,
) {
    enum class CallState { IDLE, RINGING, OFFHOOK }

    private var active = false

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
        }
    }
}
