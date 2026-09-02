package org.pca.app.feature.wellbeing.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Regression guard for a real bug found and fixed in commit 953cc21 (coordinator code review,
 * caught before this mission published its wellbeing-card wiring): [WellbeingCardActivity]
 * originally cleared a queued `NEXT_UNLOCK_CARD` entry from `PendingWellbeingCardStore` only
 * inside the Compose screen's `onDismiss` callback. A child leaving via system-back or Home
 * instead of the in-app Dismiss button left the entry in place, and the graph's
 * `screenStateObserver` subscription would relaunch the same stale card on every future unlock
 * indefinitely -- violating PCA-WELL-1's dismiss-is-never-penalized contract (leaving without
 * pressing Dismiss must never behave worse than pressing it).
 *
 * `WellbeingCardActivity` cannot be exercised by a plain JVM unit test (it is a real Android
 * `ComponentActivity`, and this project has no Robolectric harness reliable enough for
 * Activity-lifecycle assertions here -- see `AndroidScreenStateObserverTest`'s own documented
 * finding that Robolectric's broadcast-receiver simulation is unreliable/hang-prone in this
 * environment for the exact same `screenStateObserver` this Activity depends on). A targeted
 * mutation test (moving `pendingWellbeingCardStore.clear()` back into `onDismiss` alone) proved
 * this: the full backend/wellbeing/graph JVM test suite still passed with the bug re-introduced --
 * nothing in this codebase's live test suite protected the fix. This is that missing protection.
 *
 * Mirrors this codebase's own established static-source-scan pattern for exactly this class of
 * "cannot be unit-tested via a live Activity" regression (see
 * `org.pca.app.feature.settings.ui.AuditExportScreenReachabilityTest` and
 * `LocalizationKeyParityTests` for other examples of the same technique in this repo).
 */
class WellbeingCardActivityConsumptionOrderingTest {
    @Test
    fun `pendingWellbeingCardStore is cleared during onCreate, before setContent -- not only inside onDismiss`() {
        val source = activitySourceFile().readText()

        val onCreateStart = source.indexOf("override fun onCreate(")
        assertTrue("WellbeingCardActivity.kt no longer declares onCreate(...) -- this test's assumptions are stale.", onCreateStart >= 0)

        val setContentStart = source.indexOf("setContent {", onCreateStart)
        assertTrue("WellbeingCardActivity.kt's onCreate no longer calls setContent {...} -- this test's assumptions are stale.", setContentStart > onCreateStart)

        val onCreateBodyBeforeSetContent = source.substring(onCreateStart, setContentStart)

        assertTrue(
            "WellbeingCardActivity.onCreate must call pendingWellbeingCardStore.clear() (or an " +
                "equivalent load-time consumption of a queued NEXT_UNLOCK_CARD entry) BEFORE " +
                "setContent -- i.e. at load time, not deferred into the onDismiss callback below. " +
                "A child leaving via system-back/Home (never firing onDismiss) must not leave a " +
                "stale entry that relaunches this Activity on every future unlock. See commit " +
                "953cc21's own commit message for the exact regression this guards against.",
            Regex("""pendingWellbeingCardStore\s*\.\s*clear\s*\(\s*\)""").containsMatchIn(onCreateBodyBeforeSetContent),
        )
    }

    private fun activitySourceFile(): File {
        val candidates = listOf(
            File("src/main/java/org/pca/app/feature/wellbeing/ui/WellbeingCardActivity.kt"),
            File("android/app/src/main/java/org/pca/app/feature/wellbeing/ui/WellbeingCardActivity.kt"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate WellbeingCardActivity.kt from working directory ${File(".").absolutePath}")
    }
}
