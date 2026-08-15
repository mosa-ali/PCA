package org.pca.app.feature.youtube.ui

import org.pca.app.feature.youtube.policy.ModeAUsageEvidence
import org.pca.app.feature.youtube.policy.ModeBFeatureFlagState
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.YouTubeMode
import org.pca.app.feature.youtube.policy.isModeBActive

/**
 * PCA-FR-054: everything the parent-facing YouTube monitoring surface needs to honestly frame the
 * Mode A/Mode B trade-off (doc 15). By construction there is no field here a caller could use to
 * make Mode B look toggle-able -- [isModeBAvailable] is a plain, non-actionable boolean this
 * screen only ever renders as an informational "not available" state (see [YouTubeModeScreen]),
 * never wires to a switch/button. The one and only source of truth for whether Mode B could ever
 * become active is [org.pca.app.feature.youtube.policy.isModeBActive], reused here rather than
 * re-implemented, so this screen can never drift from that lane's own release gate.
 */
data class YouTubeModeViewState(
    val currentMode: YouTubeMode,
    val modeAEvidence: ModeAUsageEvidence?,
    val isModeBAvailable: Boolean,
)

object YouTubeModeViewStateBuilder {
    /** [evidence] null means Mode A evidence has never been computed yet for this session (e.g.
     * first render before the async [org.pca.app.feature.youtube.engine.ModeAAndroidUsageAdapter]
     * call resolves) -- rendered as a loading/unavailable state, never as zero usage. */
    fun build(evidence: ModeAUsageEvidence?, modeBFlag: ModeBFeatureFlagState): YouTubeModeViewState =
        YouTubeModeViewState(
            currentMode = YouTubeMode.A,
            modeAEvidence = evidence,
            isModeBAvailable = isModeBActive(modeBFlag),
        )
}

/** Whether [YouTubeModeViewState.modeAEvidence] currently represents genuinely measured
 * usage (as opposed to missing/unsupported evidence) -- pulled out as a pure, directly testable
 * function per doc 5's "missing evidence must never be displayed as zero use" rule this screen
 * must also honor in its own rendering, not just the engine layer. */
fun YouTubeModeViewState.hasMeasuredUsage(): Boolean =
    modeAEvidence?.capabilityStatus == UsageCapabilityStatus.GRANTED && modeAEvidence.durationMs != null
