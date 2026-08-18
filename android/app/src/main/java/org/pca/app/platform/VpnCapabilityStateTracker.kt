package org.pca.app.platform

/**
 * History-aware VPN capability state. Android exposes consent through
 * `VpnService.prepare()` and lifecycle through the running service; it does
 * not expose a stronger generic "VPN is enforcing all traffic" proof to a
 * Standard Mode app. This tracker therefore reports only those two signals.
 */
enum class TrackedVpnState {
    CONNECTED,
    DISCONNECTED,
    CONSENT_REQUIRED,
    REVOKED,
    DEGRADED,
}

class VpnCapabilityStateTracker(
    private val source: VpnCapabilitySource,
) {
    private var everObservedConnected = false

    @Synchronized
    fun currentState(): TrackedVpnState {
        if (!source.isPermissionGranted()) {
            return if (everObservedConnected) TrackedVpnState.REVOKED else TrackedVpnState.CONSENT_REQUIRED
        }

        return when (source.connectionState()) {
            VpnConnectionState.CONNECTED -> {
                everObservedConnected = true
                TrackedVpnState.CONNECTED
            }
            VpnConnectionState.ERROR -> TrackedVpnState.DEGRADED
            VpnConnectionState.CONNECTING,
            VpnConnectionState.DISCONNECTED,
            -> if (everObservedConnected) TrackedVpnState.DEGRADED else TrackedVpnState.DISCONNECTED
        }
    }
}
