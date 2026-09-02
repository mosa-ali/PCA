package org.pca.app.runtime.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.UsageAccessState

class UsageAccessOnboardingPolicyTest {

    @Test
    fun `a granted usage access needs no settings hand-off`() {
        assertEquals(
            UsageAccessOnboardingPolicy.Action.ALREADY_GRANTED,
            UsageAccessOnboardingPolicy.nextAction(UsageAccessState.GRANTED),
        )
    }

    @Test
    fun `the fresh-install NOT_CONFIGURED default opens the usage access settings screen`() {
        assertEquals(
            UsageAccessOnboardingPolicy.Action.OPEN_USAGE_ACCESS_SETTINGS,
            UsageAccessOnboardingPolicy.nextAction(UsageAccessState.NOT_CONFIGURED),
        )
    }

    @Test
    fun `an explicitly denied usage access also opens the settings screen, since there is no dialog to retry`() {
        assertEquals(
            UsageAccessOnboardingPolicy.Action.OPEN_USAGE_ACCESS_SETTINGS,
            UsageAccessOnboardingPolicy.nextAction(UsageAccessState.DENIED),
        )
    }

    @Test
    fun `a device with no usage access surface is reported unavailable, never as a pending action`() {
        assertEquals(
            UsageAccessOnboardingPolicy.Action.UNAVAILABLE_ON_DEVICE,
            UsageAccessOnboardingPolicy.nextAction(UsageAccessState.UNAVAILABLE),
        )
    }

    /**
     * The honesty invariant this whole policy exists for: only GRANTED may ever be shown as a
     * working capability. If a future state were added and defaulted to "usable", the child status
     * surface would start claiming screen time/Break Shield/wellbeing/YouTube duration are being
     * measured while `queryEventsSince` still returns an empty list.
     */
    @Test
    fun `only GRANTED counts as a usable capability`() {
        assertTrue(UsageAccessOnboardingPolicy.isCapabilityUsable(UsageAccessState.GRANTED))
        for (state in UsageAccessState.entries.filter { it != UsageAccessState.GRANTED }) {
            assertFalse("$state must not be reported as a usable capability", UsageAccessOnboardingPolicy.isCapabilityUsable(state))
        }
    }

    @Test
    fun `settings return refreshes only when the round-trip actually changed denied to granted`() {
        assertTrue(UsageAccessOnboardingPolicy.shouldRefreshAfterSettingsReturn(wasGranted = false, isGranted = true))
        assertFalse(UsageAccessOnboardingPolicy.shouldRefreshAfterSettingsReturn(wasGranted = false, isGranted = false))
        assertFalse(UsageAccessOnboardingPolicy.shouldRefreshAfterSettingsReturn(wasGranted = true, isGranted = true))
        assertFalse(UsageAccessOnboardingPolicy.shouldRefreshAfterSettingsReturn(wasGranted = true, isGranted = false))
    }
}
