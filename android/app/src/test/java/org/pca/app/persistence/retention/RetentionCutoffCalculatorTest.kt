package org.pca.app.persistence.retention

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.persistence.entity.RetentionPolicy

class RetentionCutoffCalculatorTest {

    private val utc: ZoneId = ZoneId.of("UTC")

    @Test
    fun `14 days is an exact 14x24h elapsed interval, not calendar days`() {
        val now = Instant.parse("2026-08-12T10:15:30Z")

        val cutoff = RetentionCutoffCalculator.cutoffFor(RetentionPolicy.FOURTEEN_DAYS, now, utc)

        assertEquals(now.minusSeconds(14L * 24 * 60 * 60), cutoff)
    }

    @Test
    fun `one month from March 31 resolves to the prior month's final valid day`() {
        // PCA-DATA-030: a naive 30-day subtraction would land on Mar 2, not Feb 28.
        val now = ZonedDateTime.of(2026, 3, 31, 12, 0, 0, 0, utc).toInstant()

        val cutoff = RetentionCutoffCalculator.cutoffFor(RetentionPolicy.ONE_MONTH, now, utc)
        val cutoffDate = cutoff.atZone(utc)

        assertEquals(2026, cutoffDate.year)
        assertEquals(2, cutoffDate.monthValue)
        assertEquals(28, cutoffDate.dayOfMonth) // 2026 is not a leap year
        assertEquals(12, cutoffDate.hour)
    }

    @Test
    fun `nine months computed in the family's own timezone, not UTC`() {
        val zone = ZoneId.of("Asia/Riyadh") // UTC+3, no DST
        val now = ZonedDateTime.of(2026, 8, 12, 1, 30, 0, 0, zone).toInstant()

        val cutoff = RetentionCutoffCalculator.cutoffFor(RetentionPolicy.NINE_MONTHS, now, zone)
        val cutoffLocal = cutoff.atZone(zone)

        assertEquals(2025, cutoffLocal.year)
        assertEquals(11, cutoffLocal.monthValue)
        assertEquals(12, cutoffLocal.dayOfMonth)
        assertEquals(1, cutoffLocal.hour)
        assertEquals(30, cutoffLocal.minute)
    }

    @Test
    fun `audit floor uses whichever cutoff is earlier -- the longer retention`() {
        // doc 10 Section 2's five supported general windows top out at 9 months, so the
        // 12-month audit floor (PCA-DATA-021) always wins today -- this asserts that
        // relationship holds for both the shortest and longest supported general windows,
        // not just an arbitrary one.
        val now = Instant.parse("2026-08-12T00:00:00Z")
        val twelveMonthCutoff = now.atZone(utc).minusMonths(12).toInstant()

        val floorWithShortestGeneral = RetentionCutoffCalculator.auditFloorCutoff(RetentionPolicy.FOURTEEN_DAYS, now, utc)
        val floorWithLongestGeneral = RetentionCutoffCalculator.auditFloorCutoff(RetentionPolicy.NINE_MONTHS, now, utc)

        assertEquals(twelveMonthCutoff, floorWithShortestGeneral)
        assertEquals(twelveMonthCutoff, floorWithLongestGeneral)
    }

    @Test
    fun `tombstone cutoff is the fixed fourteen-day bounded lifetime`() {
        val now = Instant.parse("2026-08-12T00:00:00Z")

        assertEquals(now.minusSeconds(14L * 24 * 60 * 60), RetentionCutoffCalculator.tombstoneCutoff(now, utc))
    }

    @Test
    fun `location retention is valid only when no longer than general retention`() {
        assertEquals(true, RetentionCutoffCalculator.isLocationRetentionAllowed(RetentionPolicy.THREE_MONTHS, RetentionPolicy.ONE_MONTH))
        assertEquals(true, RetentionCutoffCalculator.isLocationRetentionAllowed(RetentionPolicy.FOURTEEN_DAYS, RetentionPolicy.LATEST_ONLY))
        assertEquals(false, RetentionCutoffCalculator.isLocationRetentionAllowed(RetentionPolicy.FOURTEEN_DAYS, RetentionPolicy.ONE_MONTH))
        assertEquals(false, RetentionCutoffCalculator.isLocationRetentionAllowed(RetentionPolicy.LATEST_ONLY, RetentionPolicy.LATEST_ONLY))
    }

    @Test(expected = IllegalStateException::class)
    fun `LATEST_ONLY has no time-based cutoff`() {
        RetentionCutoffCalculator.cutoffFor(RetentionPolicy.LATEST_ONLY, Instant.now(), utc)
    }
}
