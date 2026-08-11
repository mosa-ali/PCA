package org.pca.app.platform

import android.content.Context
import android.content.Intent
import android.net.VpnService
import java.util.concurrent.atomic.AtomicReference

/**
 * Standard Mode / general implementation of the VPN capability foundation.
 * `connectionState` is a plain in-process state holder: the actual
 * VpnService implementation (PCA-5) is expected to call [updateState] as
 * its own lifecycle callbacks fire (onCreate/tunnel established/onDestroy),
 * so this adapter never has to reach into a running Service instance
 * directly.
 */
class StandardVpnCapabilitySource(private val context: Context) : VpnCapabilitySource {
    private val state = AtomicReference(VpnConnectionState.DISCONNECTED)

    override fun isPermissionGranted(): Boolean = VpnService.prepare(context) == null

    override fun connectionState(): VpnConnectionState = state.get()

    override fun createConsentIntentIfNeeded(): Intent? = VpnService.prepare(context)

    /** Called by the concrete VpnService implementation as its lifecycle changes. Not part of [VpnCapabilitySource] itself -- callers needing only the read-side capability never need this. */
    fun updateState(newState: VpnConnectionState) {
        state.set(newState)
    }
}
