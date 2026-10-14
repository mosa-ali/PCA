package org.pca.app.feature.webprotection.ui

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SafeBrowserPostRequestInterceptionTest {
    @Test
    fun `main frame POST gets local no-store 403 while GET is routed through navigation policy`() {
        val webView = WebView(RuntimeEnvironment.getApplication())
        val evaluatedUrls = mutableListOf<String>()
        val client = safeBrowserWebViewClient(
            onMainFrameNavigation = { url ->
                evaluatedUrls += url
                NavigationRequestOutcome.ProceedToLoad
            },
            onPageFinished = { _, _ -> },
            onAddressChanged = {},
        )
        val post = Request("https://blocked.example/submit", "POST", isForMainFrame = true)

        val blocked = client.shouldInterceptRequest(webView, post)

        assertNotNull(blocked)
        assertEquals(403, blocked?.statusCode)
        assertEquals("Forbidden", blocked?.reasonPhrase)
        assertEquals("no-store", blocked?.responseHeaders?.get("Cache-Control"))
        assertTrue((blocked?.data as? ByteArrayInputStream)?.readBytes()?.isEmpty() == true)
        assertTrue("a blocked POST must not be sent to the navigation policy", evaluatedUrls.isEmpty())

        val get = Request("https://safe.example/", "GET", isForMainFrame = true)
        assertNull(client.shouldInterceptRequest(webView, get))
        assertFalse("an allowed GET remains delegated to WebView after policy approval", client.shouldOverrideUrlLoading(webView, get))
        assertEquals(listOf("https://safe.example/"), evaluatedUrls)
    }

    @Test
    fun `subresource POST is left to the WebView and never enters main frame policy`() {
        val webView = WebView(RuntimeEnvironment.getApplication())
        val evaluatedUrls = mutableListOf<String>()
        val client = safeBrowserWebViewClient(
            onMainFrameNavigation = { url ->
                evaluatedUrls += url
                NavigationRequestOutcome.ProceedToLoad
            },
            onPageFinished = { _, _ -> },
            onAddressChanged = {},
        )
        val subresourcePost = Request("https://safe.example/resource", "POST", isForMainFrame = false)

        assertNull(client.shouldInterceptRequest(webView, subresourcePost))
        assertFalse(client.shouldOverrideUrlLoading(webView, subresourcePost))
        assertTrue(evaluatedUrls.isEmpty())
    }

    private data class Request(
        private val rawUrl: String,
        private val requestMethod: String,
        private val isForMainFrame: Boolean,
    ) : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(rawUrl)
        override fun isForMainFrame(): Boolean = isForMainFrame
        override fun isRedirect(): Boolean = false
        override fun hasGesture(): Boolean = false
        override fun getMethod(): String = requestMethod
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }
}
