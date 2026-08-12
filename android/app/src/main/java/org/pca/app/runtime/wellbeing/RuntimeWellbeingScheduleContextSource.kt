package org.pca.app.runtime.wellbeing

import org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.schedule.ScheduleRuntime
import java.time.Instant

/**
 * Coordinator integration glue: closes WELL-3 (doc 35 / mission section 15) for real. Delegates
 * both questions directly to [ScheduleRuntime.isPcaBedtimeActive]/[ScheduleRuntime.isScheduledQuietContext]
 * -- the exact seam Agent 10 built for this purpose -- so wellbeing quiet-hours can never diverge
 * from or override the family's real, locally-evaluated bedtime/schedule. No policy logic lives
 * here; this class only supplies the current wall-clock instant Agent 10's evaluator needs.
 */
class RuntimeWellbeingScheduleContextSource(
    private val scheduleRuntime: ScheduleRuntime,
    private val wallClockTimeSource: WallClockTimeSource,
) : WellbeingScheduleContextSource {

    private fun nowUtc(): Instant = Instant.ofEpochMilli(wallClockTimeSource.currentTimeMillis())

    override fun isPcaBedtimeActive(): Boolean = scheduleRuntime.isPcaBedtimeActive(nowUtc())

    override fun isScheduledQuietContext(): Boolean = scheduleRuntime.isScheduledQuietContext(nowUtc())
}
