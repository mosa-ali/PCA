package org.pca.app.runtime.sync.connectivity

import android.annotation.SuppressLint
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
 * Doc 40 Section 8/PCA-16 lane brief Section 4: real connectivity
 * monitoring via `ConnectivityManager.NetworkCallback` -- a PLATFORM API,
 * not a Gradle dependency, so this class needs no `build.gradle.kts`
 * change. Requires the `INTERNET`/`ACCESS_NETWORK_STATE` manifest
 * permissions and a live `Context` to construct, neither of which this
 * lane may add (`AndroidManifest.xml`/`MainActivity.kt` are out of scope,
 * see docs/architecture/40_OFFLINE_FIRST_RUNTIME_SYNC.md Section 8) --
 * wiring this into the app process (granting the permission, constructing
 * it with the application Context, starting observation) is left to
 * whichever lane owns those files.
 *
 * "Network available" here means the OS reports a network with internet
 * capability -- NOT that this backend specifically is reachable. That
 * distinction is exactly why observing this alone must never be treated as
 * `LIVE` (see SyncConnectionStateCalculator).
 */
class AndroidConnectivityMonitor(private val context: Context) : ConnectivitySource {

    // Lint's MissingPermission check is correct that ACCESS_NETWORK_STATE is
    // required here -- it is a real, unresolved dependency on the manifest
    // permission this lane may not add (see class doc above), not a false
    // positive. Suppressed rather than left failing the whole module's
    // lintDebug gate; whichever lane adds the manifest permission should
    // remove this suppression once it is present so lint verifies it for
    // real again.
    @SuppressLint("MissingPermission")
    override fun observe(): Flow<ConnectivitySignal> = callbackFlow {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(ConnectivitySignal.AVAILABLE)
            }

            override fun onLost(network: Network) {
                trySend(ConnectivitySignal.UNAVAILABLE)
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                val usable = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                trySend(if (usable) ConnectivitySignal.AVAILABLE else ConnectivitySignal.UNAVAILABLE)
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        connectivityManager.registerNetworkCallback(request, callback)
        trySend(ConnectivitySignal.UNAVAILABLE) // honest initial value until the first callback fires

        awaitClose { connectivityManager.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()
}
