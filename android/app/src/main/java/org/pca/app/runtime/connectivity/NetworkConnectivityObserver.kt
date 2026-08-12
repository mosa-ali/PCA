package org.pca.app.runtime.connectivity

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Real, observable device-level Internet reachability -- used ONLY to drive remote-visibility
 * concerns (Section 0: "Internet is used for: new policy delivery, parent synchronization,
 * relay, remote visibility. It is NOT permission for local protection to operate."). Nothing in
 * [PcaRuntime]'s local-enforcement path is gated on this signal; it is consumed solely to report
 * an honest connectivity status and to know when a family-sync attempt might succeed.
 */
interface NetworkConnectivityObserver {
    /** Cold flow of raw device-level Internet-reachability transitions, deduplicated so a flapping
     * radio does not emit the same value twice in a row. This is deliberately RAW -- any debounce
     * against rapid flapping is the collector's responsibility (Section 13), because different
     * collectors (UI display vs. sync-attempt triggering) may want different debounce windows. */
    fun observe(): Flow<Boolean>

    /** Best-effort synchronous snapshot for callers (e.g. process-restart recovery) that cannot
     * wait for the first flow emission. */
    fun isCurrentlyOnline(): Boolean
}

class AndroidNetworkConnectivityObserver(context: Context) : NetworkConnectivityObserver {
    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    override fun observe(): Flow<Boolean> = callbackFlow {
        val manager = connectivityManager
        if (manager == null) {
            trySend(false)
            awaitClose { }
            return@callbackFlow
        }

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(isOnline(manager))
            }

            override fun onLost(network: Network) {
                trySend(isOnline(manager))
            }

            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                trySend(isOnline(manager))
            }
        }

        trySend(isOnline(manager))
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        manager.registerNetworkCallback(request, callback)
        awaitClose { manager.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()

    override fun isCurrentlyOnline(): Boolean {
        val manager = connectivityManager ?: return false
        return isOnline(manager)
    }

    private fun isOnline(manager: ConnectivityManager): Boolean {
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
