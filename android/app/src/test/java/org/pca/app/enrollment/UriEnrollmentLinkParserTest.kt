package org.pca.app.enrollment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UriEnrollmentLinkParserTest {
    private val parser = UriEnrollmentLinkParser(expectedScheme = "pca", expectedHost = "enroll")

    @Test
    fun `parses a well-formed enrollment link`() {
        val result = parser.parse("pca://enroll?token=abc123")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = "abc123"), result)
    }

    @Test
    fun `ignores other query parameters, extracting only token`() {
        val result = parser.parse("pca://enroll?utm_source=qr&token=abc123&extra=ignored")
        assertEquals("abc123", result?.rawInvitationToken)
    }

    @Test
    fun `rejects a wrong scheme`() {
        assertNull(parser.parse("https://enroll?token=abc123"))
    }

    @Test
    fun `rejects a wrong host`() {
        assertNull(parser.parse("pca://not-enroll?token=abc123"))
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
    fun `rejects a completely malformed URI rather than throwing`() {
        assertNull(parser.parse("not a uri at all ::::"))
    }

    @Test
    fun `rejects an empty string`() {
        assertNull(parser.parse(""))
    }

    @Test
    fun `scheme comparison is case-insensitive, host comparison is not`() {
        assertEquals("abc123", parser.parse("PCA://enroll?token=abc123")?.rawInvitationToken)
        assertNull(parser.parse("pca://ENROLL?token=abc123"))
    }

    @Test
    fun `never treats an unrelated authority claim in the query string as trusted -- only token is ever extracted`() {
        val result = parser.parse("pca://enroll?token=abc123&familyId=attacker-controlled&role=OWNER")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = "abc123"), result)
    }

    // -------------------------------------------------------------------
    // PCA-ADD-ENR-008: Android App Link (https://) continuation form --
    // additive to the custom-scheme form above, never a replacement.
    // -------------------------------------------------------------------

    private val appLinkParser = UriEnrollmentLinkParser(
        expectedScheme = "pca",
        expectedHost = "enroll",
        appLinkScheme = "https",
        appLinkHost = "enroll.pca.app",
    )

    @Test
    fun `App Link form -- parses the token as the final path segment, matching exactly what parent-web generates`() {
        val result = appLinkParser.parse("https://enroll.pca.app/abc123")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "https://enroll.pca.app", rawInvitationToken = "abc123"), result)
    }

    @Test
    fun `App Link form -- a trailing slash does not produce an empty token`() {
        val result = appLinkParser.parse("https://enroll.pca.app/abc123/")
        assertEquals("abc123", result?.rawInvitationToken)
    }

    @Test
    fun `App Link form -- the custom pca scheme still works on the SAME parser instance (additive, not a replacement)`() {
        val result = appLinkParser.parse("pca://enroll?token=xyz789")
        assertEquals(ParsedEnrollmentLink(serverBaseUrl = "pca://enroll", rawInvitationToken = "xyz789"), result)
    }

    @Test
    fun `App Link form -- rejects a wrong host even with the right App Link scheme`() {
        assertNull(appLinkParser.parse("https://not-enroll.pca.app/abc123"))
    }

    @Test
    fun `App Link form -- rejects the http (non-https) scheme`() {
        assertNull(appLinkParser.parse("http://enroll.pca.app/abc123"))
    }

    @Test
    fun `App Link form -- rejects a bare host with no path at all`() {
        assertNull(appLinkParser.parse("https://enroll.pca.app"))
        assertNull(appLinkParser.parse("https://enroll.pca.app/"))
    }

    @Test
    fun `App Link form -- when the parser was constructed WITHOUT app-link params, https links are rejected outright (no accidental broadening of the original construction)`() {
        assertNull(parser.parse("https://enroll.pca.app/abc123"))
    }

    @Test
    fun `App Link form -- an unrelated query string on the App Link form is never treated as trusted`() {
        val result = appLinkParser.parse("https://enroll.pca.app/abc123?familyId=attacker-controlled&role=OWNER")
        assertEquals("abc123", result?.rawInvitationToken)
    }
}
