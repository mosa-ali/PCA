package org.pca.app.accessibility

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density

/**
 * Shared child-surface accessibility boundary. Every Compose Activity enters through this
 * wrapper so Android system font scaling is honored consistently instead of only on one screen.
 * The cap is the already-tested [AccessibilityPreferences.clampFontScale] safety bound; it does
 * not shrink requests below the system default and does not alter density-independent spacing.
 */
@Composable
fun PcaAccessibilityContent(content: @Composable () -> Unit) {
    val fontScale = rememberClampedFontScale()
    val baseDensity = LocalDensity.current
    CompositionLocalProvider(
        LocalDensity provides Density(baseDensity.density, fontScale),
        content = content,
    )
}
