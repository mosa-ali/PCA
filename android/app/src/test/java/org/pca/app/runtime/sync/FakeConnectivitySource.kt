package org.pca.app.runtime.sync

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.Flow
import org.pca.app.runtime.sync.connectivity.ConnectivitySignal
import org.pca.app.runtime.sync.connectivity.ConnectivitySource

/** Test-only ConnectivitySource: [emit] simulates a flap in either direction. */
class FakeConnectivitySource : ConnectivitySource {
    private val flow = MutableSharedFlow<ConnectivitySignal>(replay = 1)

    suspend fun emit(signal: ConnectivitySignal) = flow.emit(signal)

    override fun observe(): Flow<ConnectivitySignal> = flow
}
