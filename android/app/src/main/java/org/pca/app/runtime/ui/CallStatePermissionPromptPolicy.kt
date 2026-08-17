package org.pca.app.runtime.ui

/** Pure decision policy for the transparent, one-shot call-state permission prompt. */
object CallStatePermissionPromptPolicy {
    enum class Action { ALREADY_GRANTED, REQUEST, OPEN_SETTINGS }

    fun nextAction(hasPermission: Boolean, promptWasShown: Boolean): Action = when {
        hasPermission -> Action.ALREADY_GRANTED
        promptWasShown -> Action.OPEN_SETTINGS
        else -> Action.REQUEST
    }
}
