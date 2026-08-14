package org.pca.app.feature.webprotection.safebrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.SafeSearchMode

class SafeSearchUrlRewriterTest {

    @Test
    fun `mode OFF never rewrites the URL, even for a supported provider`() {
        val result = applySafeSearchQueryParameter("https://www.google.com/search?q=cats", "google.com", SafeSearchMode.OFF)
        assertFalse(result.applied)
        assertEquals("https://www.google.com/search?q=cats", result.url)
    }

    @Test
    fun `mode STRICT on a supported provider (Google) injects the documented safe parameter`() {
        val result = applySafeSearchQueryParameter("https://www.google.com/search?q=cats", "google.com", SafeSearchMode.STRICT)
        assertTrue(result.applied)
        assertTrue(result.url.contains("safe=active"))
        assertTrue(result.url.contains("q=cats")) // existing parameters are preserved
    }

    @Test
    fun `a pre-existing same-named parameter is replaced, never left alongside an unsafe value`() {
        val result = applySafeSearchQueryParameter("https://www.google.com/search?q=cats&safe=off", "google.com", SafeSearchMode.STRICT)
        assertTrue(result.applied)
        assertTrue(result.url.contains("safe=active"))
        assertFalse(result.url.contains("safe=off"))
    }

    @Test
    fun `Bing uses its own documented adlt parameter`() {
        val result = applySafeSearchQueryParameter("https://www.bing.com/search?q=dogs", "bing.com", SafeSearchMode.MODERATE)
        assertTrue(result.applied)
        assertTrue(result.url.contains("adlt=moderate"))
    }

    @Test
    fun `an unsupported provider is never rewritten -- honestly reported as not applied`() {
        val result = applySafeSearchQueryParameter("https://unrelated-shop.example/checkout?item=1", "unrelated-shop.example", SafeSearchMode.STRICT)
        assertFalse(result.applied)
        assertEquals("https://unrelated-shop.example/checkout?item=1", result.url)
    }

    @Test
    fun `YouTube has no query-parameter mechanism -- never rewritten at the Safe Browser layer even though it has a DNS mechanism`() {
        val result = applySafeSearchQueryParameter("https://www.youtube.com/watch?v=abc", "youtube.com", SafeSearchMode.STRICT)
        assertFalse(result.applied)
    }

    @Test
    fun `a malformed URL is returned unchanged rather than throwing`() {
        val malformed = "https://exa mple.com/ba d path"
        val result = applySafeSearchQueryParameter(malformed, "example.com", SafeSearchMode.STRICT)
        assertFalse(result.applied)
        assertEquals(malformed, result.url)
    }
}
