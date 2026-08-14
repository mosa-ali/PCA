package org.pca.app.feature.webprotection.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeSearchProviderRegistryTest {

    @Test
    fun `a known provider (google) is reported as supporting SafeSearch, by exact and subdomain match`() {
        assertTrue(providerSupportsSafeSearch("google.com"))
        assertTrue(providerSupportsSafeSearch("www.google.com"))
    }

    @Test
    fun `an unknown provider is honestly unsupported -- never a fabricated match`() {
        assertFalse(providerSupportsSafeSearch("some-random-shop.example"))
        assertNull(findSafeSearchProviderCapability("some-random-shop.example"))
    }

    @Test
    fun `a domain that merely contains a provider name as a substring, without being a real subdomain, does not match`() {
        // "notgoogle.com" must not match "google.com" -- domainMatchesSuffix requires an exact
        // suffix boundary (a preceding '.'), never a bare substring search.
        assertFalse(providerSupportsSafeSearch("notgoogle.com"))
        assertFalse(providerSupportsSafeSearch("evilgoogle.com.attacker.example"))
    }

    @Test
    fun `safeSearchDnsHostFor returns null when mode is OFF, regardless of provider support`() {
        assertNull(safeSearchDnsHostFor("google.com", SafeSearchMode.OFF))
    }

    @Test
    fun `safeSearchDnsHostFor returns the documented host for a supported provider and mode`() {
        assertEquals("forcesafesearch.google.com", safeSearchDnsHostFor("google.com", SafeSearchMode.STRICT))
        assertEquals("restrict.youtube.com", safeSearchDnsHostFor("youtube.com", SafeSearchMode.STRICT))
        assertEquals("restrictmoderate.youtube.com", safeSearchDnsHostFor("youtube.com", SafeSearchMode.MODERATE))
    }

    @Test
    fun `safeSearchDnsHostFor is null for a provider with no documented DNS mechanism (DuckDuckGo)`() {
        assertNull(safeSearchDnsHostFor("duckduckgo.com", SafeSearchMode.STRICT))
    }

    @Test
    fun `safeSearchDnsHostFor is null for an entirely unsupported provider even at STRICT`() {
        assertNull(safeSearchDnsHostFor("unrelated-shop.example", SafeSearchMode.STRICT))
    }
}
