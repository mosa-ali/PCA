package org.pca.app.runtime.prayer

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PPR1R-D005 regression guard, mirroring
 * [org.pca.app.feature.settings.ui.AuditExportScreenReachabilityTest]'s established pattern.
 *
 * The defect this closes was not a wrong implementation -- every part of the prayer reminder
 * subsystem was correct and unit-tested. It was a severed call chain:
 * `AlarmManagerPrayerScheduler` was constructed in `PcaAppGraph` and `scheduleReminder(plan)` was
 * then never called from ANY production file, so the manifest-registered `PrayerReminderReceiver`
 * could never fire and `SCHEDULE_EXACT_ALARM` was a Play-restricted permission with no caller at
 * all. Behavioural tests of the coordinator cannot catch a regression that simply deletes the
 * call site again, so this static check exists alongside them.
 */
class PrayerReminderSchedulingReachabilityTest {

    @Test
    fun `scheduleReminder is called from a real production file, not only its own declaration and interface`() {
        val mainDir = mainSourceDir()
        val declarationPaths = setOf(
            File(mainDir, "java/org/pca/app/feature/prayer/reminder/PrayerReminderContract.kt").canonicalFile,
            File(mainDir, "java/org/pca/app/runtime/prayer/AlarmManagerPrayerScheduler.kt").canonicalFile,
        )
        val callSitePattern = Regex("""\bscheduleReminder\(""")

        val realCallers = mainDir.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.canonicalFile !in declarationPaths }
            .filter { file -> file.readLines().any { callSitePattern.containsMatchIn(it) } }
            .toList()

        assertTrue(
            "PrayerAlarmScheduler.scheduleReminder(...) is never called from any production file other than its " +
                "own declaration -- the prayer reminder subsystem is inert scaffolding again and SCHEDULE_EXACT_ALARM " +
                "is a Play-restricted permission with no caller. See PrayerReminderScheduleCoordinator.",
            realCallers.isNotEmpty(),
        )
    }

    @Test
    fun `PcaAppGraph drives the coordinator from a real periodic cycle`() {
        val graphFile = File(mainSourceDir(), "java/org/pca/app/runtime/graph/PcaAppGraph.kt")
        assertTrue("PcaAppGraph.kt not found at ${graphFile.canonicalPath}", graphFile.exists())
        val source = graphFile.readText()

        assertTrue(
            "PcaAppGraph no longer constructs PrayerReminderScheduleCoordinator -- the scheduler would be orphaned again.",
            source.contains("PrayerReminderScheduleCoordinator("),
        )
        assertTrue(
            "PcaAppGraph constructs the coordinator but never calls scheduleUpcomingReminders(...) -- constructing it " +
                "without driving it is exactly the defect this guards against.",
            Regex("""\bscheduleUpcomingReminders\(""").containsMatchIn(source),
        )
    }

    private fun mainSourceDir(): File {
        val candidates = listOf(
            File("src/main"),
            File("android/app/src/main"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate src/main directory from working directory ${File(".").absolutePath}")
    }
}
