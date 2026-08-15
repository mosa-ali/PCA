package org.pca.app.runtime.background

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.WorkRequest
import java.util.concurrent.TimeUnit

/**
 * PCA-NFR-033: the one shared, documented, battery-friendly scheduling baseline every periodic
 * [androidx.work.CoroutineWorker] in this app should build on -- so a future feature slice (e.g.
 * a future wellbeing/sensors Worker) does not have to independently re-derive "what counts as a
 * battery-friendly constraint set here," and so the whole app has one consistent policy rather
 * than N slightly different ones.
 *
 * Deliberately conservative and documented, not tuned against a real device profiler (PCA-NFR-034
 * -- see [BackgroundWorkMetrics] for what actually is/isn't measured):
 *  - [standardConstraints] sets `setRequiresBatteryNotLow(true)` so WorkManager itself defers the
 *    job whenever the OS reports the battery critically low, rather than this app deciding "is the
 *    battery low enough to skip" itself (Android's own battery-not-low broadcast is the documented,
 *    canonical signal for this -- no undocumented power-state API is used).
 *  - No `setRequiresCharging`/`setRequiresDeviceIdle` -- usage-ingestion (and any future consumer
 *    of this constraint set) needs to run periodically throughout a normal day of device use, not
 *    only while charging or idle.
 *  - [BACKOFF_POLICY]/[MIN_BACKOFF_MILLIS] retry a failed run with exponential backoff starting at
 *    WorkManager's own enforced minimum ([WorkRequest.MIN_BACKOFF_MILLIS]) rather than hammering a
 *    failing device state (e.g. a transient Room/AppOps failure) on every attempt.
 */
object PcaBackgroundWorkConstraints {
    val BACKOFF_POLICY: BackoffPolicy = BackoffPolicy.EXPONENTIAL
    const val BACKOFF_DELAY_MILLIS: Long = WorkRequest.MIN_BACKOFF_MILLIS
    val BACKOFF_DELAY_TIME_UNIT: TimeUnit = TimeUnit.MILLISECONDS

    fun standardConstraints(): Constraints = Constraints.Builder()
        .setRequiresBatteryNotLow(true)
        .build()
}
