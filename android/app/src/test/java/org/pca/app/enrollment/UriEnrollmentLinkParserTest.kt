package org.pca.app.enrollment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UriEnrollmentLinkParserTest {
    private val parser = UriEnrollmentLinkParser(expectedScheme = "pca", expectedHost = "enroll")
    private val canonicalToken = "A".repeat(43)

    @Test
    fun `parses a well-formed enrollment link`() {
        val result = parser.parse("pca://enroll?token=$canonicalToken")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = canonicalToken), result)
    }

    @Test
    fun `ignores other query parameters, extracting only token`() {
        val result = parser.parse("pca://enroll?utm_source=qr&token=$canonicalToken&extra=ignored")
        assertEquals(canonicalToken, result?.rawInvitationToken)
    }

    @Test
    fun `rejects a wrong scheme`() {
        assertNull(parser.parse("https://enroll?token=$canonicalToken"))
    }

    @Test
    fun `rejects a wrong host`() {
        assertNull(parser.parse("pca://not-enroll?token=$canonicalToken"))
    }

    @Test
    fun `rejects a missing token parameter`() {
        assertNull(parser.parse("pca://enroll?other=value"))
    }

    @Test
    fun `rejects an empty token value`() {
        assertNull(parser.parse("pca://enroll?token="))
    }

    @Test
    fun `rejects noncanonical custom scheme tokens before enrollment`() {
        assertNull(parser.parse("pca://enroll?token=abc123"))
        assertNull(parser.parse("pca://enroll?token=${"A".repeat(42)}"))
        assertNull(parser.parse("pca://enroll?token=${"A".repeat(44)}"))
        assertNull(parser.parse("pca://enroll?token=${"A".repeat(42)}+"))
        assertNull(parser.parse("pca://enroll?token=%41${canonicalToken.drop(1)}"))
        assertNull(parser.parse("pca://enroll?token=${"A".repeat(42)}B"))
    }

    @Test
    fun `rejects a completely malformed URI rather than throwing`() {
        assertNull(parser.parse("not a uri at all ::::"))
    }

    @Test
    fun `rejects an empty string`() {
        assertNull(parser.parse(""))
    }

    @Test
    fun `scheme comparison is case-insensitive, host comparison is not`() {
        assertEquals(canonicalToken, parser.parse("PCA://enroll?token=$canonicalToken")?.rawInvitationToken)
        assertNull(parser.parse("pca://ENROLL?token=$canonicalToken"))
    }

    @Test
    fun `never treats an unrelated authority claim in the query string as trusted -- only token is ever extracted`() {
        val result = parser.parse("pca://enroll?token=$canonicalToken&familyId=attacker-controlled&role=OWNER")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = canonicalToken), result)
    }

    // -------------------------------------------------------------------
    // PCA-ADD-ENR-008: Android App Link (https://) continuation form --
    // additive to the custom-scheme form above, never a replacement.
    // -------------------------------------------------------------------

    private val appLinkParser = UriEnrollmentLinkParser(
        expectedScheme = "pca",
        expectedHost = "enroll",
        appLinkScheme = "https",
        appLinkHost = "www.pcasafe.com",
        appLinkPathPrefix = "/enroll/",
    )
    private val appLinkToken = "A".repeat(43)

    @Test
    fun `App Link form -- parses one canonical token under the public enroll path`() {
        val result = appLinkParser.parse("https://www.pcasafe.com/enroll/$appLinkToken")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "https://www.pcasafe.com", rawInvitationToken = appLinkToken), result)
    }

    @Test
    fun `App Link form -- a trailing slash does not produce an empty token`() {
        val result = appLinkParser.parse("https://www.pcasafe.com/enroll/$appLinkToken/")
        assertEquals(appLinkToken, result?.rawInvitationToken)
    }

    @Test
    fun `App Link form -- rejects unrelated public site paths and additional path segments`() {
        assertNull(appLinkParser.parse("https://www.pcasafe.com/privacy/$appLinkToken"))
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/$appLinkToken/extra"))
    }

    @Test
    fun `App Link form -- rejects noncanonical or encoded token path segments`() {
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/abc123"))
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/${"A".repeat(42)}%2F"))
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/${"A".repeat(42)}B"))
    }

    @Test
    fun `App Link form -- the custom pca scheme still works on the SAME parser instance (additive, not a replacement)`() {
        val result = appLinkParser.parse("pca://enroll?token=$appLinkToken")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = appLinkToken), result)
    }

    @Test
    fun `App Link form -- rejects a wrong host even with the right App Link scheme`() {
        assertNull(appLinkParser.parse("https://not-public.pcasafe.com/enroll/$appLinkToken"))
    }

    @Test
    fun `App Link form -- rejects the http (non-https) scheme`() {
        assertNull(appLinkParser.parse("http://www.pcasafe.com/enroll/$appLinkToken"))
    }

    @Test
    fun `App Link form -- accepts only the default HTTPS port`() {
        assertEquals(
            appLinkToken,
            appLinkParser.parse("https://www.pcasafe.com:443/enroll/$appLinkToken")?.rawInvitationToken,
        )
        assertNull(appLinkParser.parse("https://www.pcasafe.com:8443/enroll/$appLinkToken"))
    }

    @Test
    fun `App Link form -- rejects a bare host with no path at all`() {
        assertNull(appLinkParser.parse("https://www.pcasafe.com"))
        assertNull(appLinkParser.parse("https://www.pcasafe.com/"))
    }

    @Test
    fun `App Link form -- when the parser was constructed WITHOUT app-link params, https links are rejected outright (no accidental broadening of the original construction)`() {
        assertNull(parser.parse("https://www.pcasafe.com/enroll/$appLinkToken"))
    }

    @Test
    fun `App Link form -- rejects query strings and fragments to match the canonical public route`() {
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/$appLinkToken?familyId=attacker-controlled&role=OWNER"))
        assertNull(appLinkParser.parse("https://www.pcasafe.com/enroll/$appLinkToken#fragment"))
    }
}
