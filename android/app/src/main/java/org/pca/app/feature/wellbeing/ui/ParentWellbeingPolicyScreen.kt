package org.pca.app.feature.wellbeing.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy

/**
 * Parent policy surface (doc 35, PCA-WELL-007). Deliberately limited to positive-terminology
 * toggles -- category enablement, faith content, lock-screen suggestions, periodic/game-return/
 * break suggestions, daily cap, and custom-suggestion permission. There is intentionally no
 * "nag intensity" or similarly framed control anywhere in this screen.
 */
@Composable
fun ParentWellbeingPolicyScreen(
    policy: WellbeingNudgePolicy,
    onPolicyChange: (WellbeingNudgePolicy) -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = stringResource(R.string.wellbeing_parent_policy_title), style = MaterialTheme.typography.titleLarge)

        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_enabled), policy.enabled) { onPolicyChange(policy.copy(enabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_periodic), policy.periodicNudgesEnabled) { onPolicyChange(policy.copy(periodicNudgesEnabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_game_return), policy.gameReturnNudgeEnabled) { onPolicyChange(policy.copy(gameReturnNudgeEnabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_break), policy.breakSuggestionsEnabled) { onPolicyChange(policy.copy(breakSuggestionsEnabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_lock_screen), policy.lockScreenSuggestionsEnabled) { onPolicyChange(policy.copy(lockScreenSuggestionsEnabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_faith), policy.faithContentEnabled) { onPolicyChange(policy.copy(faithContentEnabled = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_custom), policy.parentCanAddCustomSuggestions) { onPolicyChange(policy.copy(parentCanAddCustomSuggestions = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_child_snooze), policy.childCanSnooze) { onPolicyChange(policy.copy(childCanSnooze = it)) }
        PolicyToggleRow(stringResource(R.string.wellbeing_policy_toggle_child_not_for_me), policy.childCanMarkNotHelpful) { onPolicyChange(policy.copy(childCanMarkNotHelpful = it)) }

        for (category in WellbeingCategory.entries) {
            PolicyToggleRow(
                label = stringResource(category.labelRes()),
                checked = category in policy.enabledCategories,
            ) { checked ->
                val updated = if (checked) policy.enabledCategories + category else policy.enabledCategories - category
                onPolicyChange(policy.copy(enabledCategories = updated))
            }
        }
    }
}

@Composable
private fun PolicyToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(text = label, modifier = Modifier.padding(end = 8.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
