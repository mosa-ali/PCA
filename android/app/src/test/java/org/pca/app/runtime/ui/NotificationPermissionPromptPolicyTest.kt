package org.pca.app.runtime.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionPromptPolicyTest {

    private companion object {
        const val API_32 = 32
        const val API_33 = 33
        const val API_35 = 35
    }

    @Test
    fun `enabled notifications never prompt again on any api level`() {
        for (sdkInt in listOf(API_32, API_33, API_35)) {
            assertEquals(
                "sdkInt=$sdkInt",
                NotificationPermissionPromptPolicy.Action.ALREADY_ENABLED,
                NotificationPermissionPromptPolicy.nextAction(sdkInt, notificationsEnabled = true, promptWasShown = false),
            )
        }
    }

    @Test
    fun `the first user-initiated request on api 33 or later shows the runtime dialog once`() {
        assertEquals(
            NotificationPermissionPromptPolicy.Action.REQUEST_RUNTIME_PERMISSION,
            NotificationPermissionPromptPolicy.nextAction(API_33, notificationsEnabled = false, promptWasShown = false),
        )
    }

    @Test
    fun `a second attempt after the dialog was already shown falls back to settings, never a silent no-op re-request`() {
        assertEquals(
            NotificationPermissionPromptPolicy.Action.OPEN_SETTINGS,
            NotificationPermissionPromptPolicy.nextAction(API_35, notificationsEnabled = false, promptWasShown = true),
        )
    }

    /** Below API 33 POST_NOTIFICATIONS is not a runtime permission, so there is no dialog to show;
     * disabled notifications there can only mean a user-disabled channel, whose one real remedy is
     * the app-notification settings screen. */
    @Test
    fun `below api 33 a disabled state goes straight to settings and never requests a permission`() {
        assertEquals(
            NotificationPermissionPromptPolicy.Action.OPEN_SETTINGS,
            NotificationPermissionPromptPolicy.nextAction(API_32, notificationsEnabled = false, promptWasShown = false),
        )
        assertEquals(
            NotificationPermissionPromptPolicy.Action.OPEN_SETTINGS,
            NotificationPermissionPromptPolicy.nextAction(API_32, notificationsEnabled = false, promptWasShown = true),
        )
    }

    @Test
    fun `the runtime permission floor is android 13`() {
        assertEquals(API_33, NotificationPermissionPromptPolicy.RUNTIME_PERMISSION_MIN_SDK)
    }

    @Test
    fun `settings return refreshes only when the round-trip actually changed disabled to enabled`() {
        assertTrue(NotificationPermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasEnabled = false, isEnabled = true))
        assertFalse(NotificationPermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasEnabled = false, isEnabled = false))
        assertFalse(NotificationPermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasEnabled = true, isEnabled = true))
        assertFalse(NotificationPermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasEnabled = true, isEnabled = false))
    }
}
