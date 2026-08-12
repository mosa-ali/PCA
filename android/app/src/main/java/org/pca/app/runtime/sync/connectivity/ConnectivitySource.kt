package org.pca.app.runtime.sync.connectivity

import kotlinx.coroutines.flow.Flow

enum class ConnectivitySignal { AVAILABLE, UNAVAILABLE }

/**
 * Doc 40 Section 4/8: connectivity becoming available only TRIGGERS a
 * reconnect attempt -- it never by itself implies the honest `LIVE`
 * connection state (see state/SyncConnectionStateCalculator.kt), and this
 * interface makes no promise beyond "the platform network interface is
 * usable," not "the Internet, or this backend, is reachable."
 */
interface ConnectivitySource {
    fun observe(): Flow<ConnectivitySignal>
}
