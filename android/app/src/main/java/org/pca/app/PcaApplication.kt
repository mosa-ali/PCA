package org.pca.app

import android.app.Application
import org.pca.app.runtime.graph.PcaAppGraph

/**
 * Composition-root entry point (PCA-RUNTIME-ANDROID-1 Section 2). Owns exactly one
 * [PcaAppGraph] for the process lifetime and starts it immediately -- local protection (screen
 * time, Break Shield, eye-distance, wellbeing dispatch) must be running before [MainActivity] or
 * any other component even exists, and must keep running for as long as the process does,
 * independent of which Activity is currently in the foreground (Section 0: offline-first, always
 * running locally).
 */
class PcaApplication : Application() {
    val graph: PcaAppGraph by lazy { PcaAppGraph.getInstance(this) }

    override fun onCreate() {
        super.onCreate()
        graph.start()
    }
}
