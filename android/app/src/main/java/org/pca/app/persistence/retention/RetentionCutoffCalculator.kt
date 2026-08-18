package org.pca.app.persistence.retention

import java.time.Duration
import java.time.Instant
import java.time.Period
import java.time.ZoneId
import java.time.ZonedDateTime
import org.pca.app.persistence.entity.RetentionPolicy

/**
 * doc 11 Section 2's authoritative clock rule (PCA-DATA-030):
 *  - `14 days` is an exact elapsed 14x24h interval.
 *  - `1/3/6/9 months` are calendar-month intervals computed in the family's
 *    policy timezone, converted back to a UTC instant; if the target month
 *    lacks the source day, [ZonedDateTime.minus] already resolves to that
 *    month's final valid day (java.time's calendar arithmetic), matching
 *    the doc's overflow rule without extra handling.
 *
 * `minSdk 26` provides `java.time` natively -- no desugaring dependency
 * needed.
 */
object RetentionCutoffCalculator {

    /** PCA-DATA-022: location history may be shorter than or equal to general activity history. */
    fun isLocationRetentionAllowed(generalPolicy: RetentionPolicy, locationPolicy: RetentionPolicy): Boolean {
        if (generalPolicy == RetentionPolicy.LATEST_ONLY) return false
        if (locationPolicy == RetentionPolicy.LATEST_ONLY) return true
        return windowRank(locationPolicy) <= windowRank(generalPolicy)
    }

    private fun windowRank(policy: RetentionPolicy): Int = when (policy) {
        RetentionPolicy.FOURTEEN_DAYS -> 0
        RetentionPolicy.ONE_MONTH -> 1
        RetentionPolicy.THREE_MONTHS -> 2
        RetentionPolicy.SIX_MONTHS -> 3
        RetentionPolicy.NINE_MONTHS -> 4
        RetentionPolicy.LATEST_ONLY -> error("LATEST_ONLY is not a general time window")
    }

    /** [RetentionPolicy.LATEST_ONLY] has no time-based cutoff -- callers must branch on it separately. */
    fun cutoffFor(policy: RetentionPolicy, nowUtc: Instant, policyZone: ZoneId): Instant = when (policy) {
        RetentionPolicy.FOURTEEN_DAYS -> nowUtc.minus(Duration.ofDays(14))
        RetentionPolicy.ONE_MONTH -> nowUtc.atZone(policyZone).minus(Period.ofMonths(1)).toInstant()
        RetentionPolicy.THREE_MONTHS -> nowUtc.atZone(policyZone).minus(Period.ofMonths(3)).toInstant()
        RetentionPolicy.SIX_MONTHS -> nowUtc.atZone(policyZone).minus(Period.ofMonths(6)).toInstant()
        RetentionPolicy.NINE_MONTHS -> nowUtc.atZone(policyZone).minus(Period.ofMonths(9)).toInstant()
        RetentionPolicy.LATEST_ONLY ->
            error("LATEST_ONLY has no time-based cutoff; use LocationPointDao.deleteAllExceptLatestForDevice")
    }

    private fun durationFor(policy: RetentionPolicy, nowUtc: Instant, policyZone: ZoneId): Duration =
        Duration.between(cutoffFor(policy, nowUtc, policyZone), nowUtc)

    private val AUDIT_FLOOR = Period.ofMonths(12)

    /**
     * PCA-DATA-026: a tombstone's own fixed, family-policy-independent bounded lifetime -- a
     * tombstone's only job is to let a short post-deletion reconciliation window distinguish
     * "deleted" from "never existed"; fourteen days is the shortest supported retention
     * window and is deliberately finite, satisfying the bounded-lifetime requirement without
     * allowing deletion metadata to outlive the app's shortest activity-history window.
     */
    private val TOMBSTONE_LIFETIME = Duration.ofDays(14)

    @Suppress("UNUSED_PARAMETER")
    fun tombstoneCutoff(nowUtc: Instant, policyZone: ZoneId): Instant =
        nowUtc.minus(TOMBSTONE_LIFETIME)

    /**
     * PCA-DATA-021: audit-trail retention floor is the family's general
     * retention window OR 12 months, whichever is LONGER.
     */
    fun auditFloorCutoff(generalPolicy: RetentionPolicy, nowUtc: Instant, policyZone: ZoneId): Instant {
        val generalCutoff = cutoffFor(generalPolicy, nowUtc, policyZone)
        val twelveMonthCutoff = nowUtc.atZone(policyZone).minus(AUDIT_FLOOR).toInstant()
        // Longer floor == the EARLIER of the two cutoffs (keeps more history).
        return if (generalCutoff.isBefore(twelveMonthCutoff)) generalCutoff else twelveMonthCutoff
    }
}
