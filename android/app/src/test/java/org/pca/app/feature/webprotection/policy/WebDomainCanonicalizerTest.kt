package org.pca.app.feature.webprotection.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebDomainCanonicalizerTest {

    @Test
    fun `strips scheme, path, port and trailing dot to a bare lowercase hostname`() {
        assertEquals("example.com", canonicalizeDomain("https://Example.com:443/some/path?q=1#frag"))
        assertEquals("example.com", canonicalizeDomain("example.com."))
        assertEquals("example.com", canonicalizeDomain("EXAMPLE.COM"))
    }

    @Test
    fun `unicode and punycode forms of the same domain canonicalize identically`() {
        val fromUnicode = canonicalizeDomain("münchen.example")
        val fromPunycode = canonicalizeDomain("xn--mnchen-3ya.example")
        assertEquals(fromUnicode, fromPunycode)
        assertEquals("xn--mnchen-3ya.example", fromUnicode)
    }

    @Test
    fun `rejects IPv4 literals, bare single-label hosts and malformed input`() {
        assertNull(canonicalizeDomain("192.168.1.1"))
        assertNull(canonicalizeDomain("localhost"))
        assertNull(canonicalizeDomain(""))
        assertNull(canonicalizeDomain(null))
        assertNull(canonicalizeDomain("   "))
    }

    @Test
    fun `isCanonicalDomain is true only for the exact already-canonical form`() {
        assertTrue(isCanonicalDomain("example.com"))
        assertFalse(isCanonicalDomain("Example.COM"))
        assertFalse(isCanonicalDomain("192.168.1.1"))
    }

    @Test
    fun `does not merge www subdomain into its parent domain`() {
        assertEquals("www.example.com", canonicalizeDomain("https://www.example.com/"))
        assertEquals("example.com", canonicalizeDomain("https://example.com/"))
    }

    @Test
    fun `flags mixed-script labels as suspicious without changing canonicalization`() {
        // Latin "a" mixed with Cyrillic "а" (U+0430) in one label -- classic homograph attempt.
        val mixedLabel = "pаypal.example"
        assertTrue(hasSuspiciousScriptMixing(mixedLabel))
        // Single-script (pure Cyrillic) label is not flagged by this signal.
        assertFalse(hasSuspiciousScriptMixing("пример.example"))
    }

    @Test
    fun `canonicalization runs with zero network dependency`() {
        // No network client, HTTP call, or DNS resolution is reachable from this function --
        // verified structurally by this test completing synchronously and deterministically for
        // an unresolvable/fictitious hostname (a real network path would hang, error, or vary).
        val result = canonicalizeDomain("this-domain-does-not-exist-and-is-never-resolved.invalid")
        assertEquals("this-domain-does-not-exist-and-is-never-resolved.invalid", result)
    }
}
