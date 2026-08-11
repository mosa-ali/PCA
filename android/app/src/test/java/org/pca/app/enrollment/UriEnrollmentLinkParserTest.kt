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
}
