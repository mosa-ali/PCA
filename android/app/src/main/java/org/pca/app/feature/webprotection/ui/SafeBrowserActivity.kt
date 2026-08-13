package org.pca.app.feature.webprotection.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import org.pca.app.PcaApplication
import org.pca.app.feature.webprotection.policy.WebLocale

/**
 * doc 6/48's real, production child-facing Safe Browser surface -- closes
 * the previously-verified gap where [org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy]
 * was only reachable from unit tests. Reuses the single [PcaApplication.graph]
 * composition root's already-wired production objects; this Activity owns no
 * business logic of its own beyond constructing the one [SafeBrowserController]
 * for its lifecycle and rendering [SafeBrowserScreen].
 *
 * doc 39: child Safe Browser language follows the DEVICE/system locale
 * independently of the parent account language -- [deviceWebLocale] reads
 * [java.util.Locale.getDefault] directly, never a parent-account preference.
 */
class SafeBrowserActivity : ComponentActivity() {
    private lateinit var controller: SafeBrowserController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as PcaApplication).graph
        controller = SafeBrowserController(
            identityContextProvider = graph.webProtectionIdentityContextProvider,
            navigationPolicy = graph.safeBrowserNavigationPolicy,
            unblockRequestService = graph.parentUnblockRequestService,
            childRequestQueue = graph.childRequestQueue,
            familySyncRuntimePort = graph.familySyncRuntimePort,
            scope = graph.coroutineScope,
            locale = { deviceWebLocale() },
        )

        setContent {
            MaterialTheme {
                SafeBrowserScreen(controller = controller, locale = deviceWebLocale())
            }
        }
    }

    private fun deviceWebLocale(): WebLocale =
        if (java.util.Locale.getDefault().language == "ar") WebLocale.AR else WebLocale.EN
}
