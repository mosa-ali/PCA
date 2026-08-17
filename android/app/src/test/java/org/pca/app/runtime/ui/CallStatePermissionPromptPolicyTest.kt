package org.pca.app.runtime.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class CallStatePermissionPromptPolicyTest {
    @Test
    fun grantedPermissionNeverPromptsAgain() {
        assertEquals(
            CallStatePermissionPromptPolicy.Action.ALREADY_GRANTED,
            CallStatePermissionPromptPolicy.nextAction(hasPermission = true, promptWasShown = false),
        )
    }

    @Test
    fun firstUserInitiatedRequestPromptsOnce() {
        assertEquals(
            CallStatePermissionPromptPolicy.Action.REQUEST,
            CallStatePermissionPromptPolicy.nextAction(hasPermission = false, promptWasShown = false),
        )
    }

    @Test
    fun deniedPermissionOpensSettingsInsteadOfRepeatingPrompt() {
        assertEquals(
            CallStatePermissionPromptPolicy.Action.OPEN_SETTINGS,
            CallStatePermissionPromptPolicy.nextAction(hasPermission = false, promptWasShown = true),
        )
    }

    @Test
    fun settingsReturnRefreshesOnlyWhenPermissionChangedToGranted() {
        assertEquals(
            true,
            CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn(
                wasGranted = false,
                isGranted = true,
            ),
        )
        assertEquals(
            false,
            CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn(
                wasGranted = false,
                isGranted = false,
            ),
        )
        assertEquals(
            false,
            CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn(
                wasGranted = true,
                isGranted = true,
            ),
        )
    }
}
