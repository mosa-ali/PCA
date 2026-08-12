package org.pca.app.feature.wellbeing.ports

import org.pca.app.feature.wellbeing.model.NudgeAggregateSummary

/**
 * Narrow, deliberately implementation-free port for exporting *privacy-minimized* child feedback
 * (item 12, PCA-WELL-017). This module never calls out to a network itself (item 18: "no direct
 * server calls from this module") -- it only ever produces a
 * [NudgeAggregateSummary] (aggregate counts only, never which specific suggestion a child
 * rejected -- see `WellbeingAggregateSummaryBuilder`'s doc) and hands it to whatever implements
 * this port. Some other lane (the existing Family Envelope / FTS sync runtime, doc 09/11 --
 * `android/.../runtime/` subtree, out of this worktree's ownership) is expected to provide the real
 * implementation; no implementation ships in this worktree, matching the same
 * ships-as-a-port-only pattern [WellbeingScheduleContextSource] and
 * `NoOpWellbeingScheduleContextSource` already establish for cross-lane concerns doc 35 defers to
 * a Coordinator.
 */
interface WellbeingFeedbackSyncPort {
    /** Called with an already aggregate-only, privacy-minimized summary -- never raw per-event
     * feedback, never which specific suggestion was rejected. Implementations own their own
     * transport/authorization/retry policy entirely outside this module. */
    fun exportAggregateSummary(summary: NudgeAggregateSummary)
}
