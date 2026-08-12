package org.pca.app.runtime.wellbeing

import org.pca.app.feature.breakshield.BreakShieldController
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.feature.wellbeing.ports.BreakStateSource

/**
 * Production [BreakStateSource] closing the gap PCA-WELL-1 left for the Coordinator: reads
 * PCA-3's live [ScreenTimeState] through [BreakShieldController]'s existing pure derivation --
 * never mutates it (PCA-WELL-024), never recomputes break-shield logic of its own. [stateSupplier]
 * is expected to be [PcaRuntime]'s own live screen-time state accessor.
 */
class RuntimeBreakStateSource(
    private val stateSupplier: () -> ScreenTimeState,
) : BreakStateSource {
    override fun isBreakShieldActive(): Boolean =
        BreakShieldController.viewState(stateSupplier()).isShieldVisible
}
