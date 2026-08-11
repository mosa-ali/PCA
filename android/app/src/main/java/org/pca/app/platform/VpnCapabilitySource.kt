package org.pca.app.platform

import android.content.Intent

enum class VpnConnectionState { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

/**
 * Adapter over the platform's VPN-based web-filtering CAPABILITY
 * (permission + connection lifecycle) -- doc 06 Section 6 / PCA-SEC-002.
 * This is the FOUNDATION layer only: permission check/request and
 * connection-state reporting. It deliberately does NOT include the actual
 * traffic-filtering VpnService/tunnel implementation or any classification
 * logic -- that is PCA-5 (Web filtering and PCA Safe Browser) scope, built
 * on top of this contract, not duplicated here.
 *
 * Hard constraints on ANY future implementation of the VpnService this
 * interface fronts (doc 06 Section 6, restated here so PCA-5 inherits them
 * without re-deriving):
 *  - MUST run as a foreground service with a persistent, non-hideable
 *    notification while connected.
 *  - NO covert TLS MITM ever.
 *  - Classification is on-device only -- no egress to any PCA server or
 *    third party for a filtering decision. This interface's surface
 *    intentionally has no "submit this URL/host to a server" method; do
 *    not add one to satisfy a future feature without revisiting this
 *    constraint explicitly.
 */
interface VpnCapabilitySource {
    /** Re-queries platform permission state live -- never a cached flag. */
    fun isPermissionGranted(): Boolean
    fun connectionState(): VpnConnectionState
    /** Returns the platform consent Intent to launch if permission is not yet granted (VpnService.prepare), or null if already granted. */
    fun createConsentIntentIfNeeded(): Intent?
}
