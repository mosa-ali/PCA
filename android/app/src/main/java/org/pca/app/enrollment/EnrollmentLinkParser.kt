package org.pca.app.enrollment

import java.net.URI

/**
 * Parses a scanned QR payload or deep-link URI into the opaque invitation
 * token + server endpoint it carries. Never accepts or trusts any OTHER
 * claim from the QR/link payload (familyId, role, policy) -- those come
 * solely from the server-side invitation record once redeemed, matching
 * the backend EnrollmentCoordinator's contract that the bearer token
 * alone authorizes only the bootstrap transition, never caller-supplied
 * identity/authority (backend/src/enrollment/EnrollmentCoordinator.ts).
 * This is the App Link/QR boundary doc 09 Section 3.3's fingerprint-
 * confirmation flow depends on -- no covert installation capability
 * exists here or anywhere else in this module.
 */
data class ParsedEnrollmentLink(val serverBaseUrl: String, val rawInvitationToken: String)

interface EnrollmentLinkParser {
    fun parse(uri: String): ParsedEnrollmentLink?
}

/**
 * Only the `token` query parameter (custom-scheme form) or a canonical 43-character token directly
 * below the configured App Link path prefix is extracted -- any other parameter/segment present
 * in the URI is silently ignored, never interpreted as an authority claim.
 *
 * Accepts TWO link shapes, both leading to the exact same [ParsedEnrollmentLink] outcome:
 *  - `pca://enroll?token=<token>` (custom scheme; always supported, works even on a device where
 *    Android App Links have not been set up/verified for any domain).
 *  - `https://<appLinkHost>/enroll/<token>` (PCA-ADD-ENR-008 Android App Link continuation form,
 *    only when [appLinkScheme]/[appLinkHost]/[appLinkPathPrefix] are supplied). The path must use
 *    the canonical HTTPS host, default port, token segment, and no query or fragment so it matches
 *    Public Web's token-safe route and server-side request logging policy.
 */
class UriEnrollmentLinkParser(
    private val expectedScheme: String,
    private val expectedHost: String,
    private val appLinkScheme: String? = null,
    private val appLinkHost: String? = null,
    private val appLinkPathPrefix: String? = null,
) : EnrollmentLinkParser {

    override fun parse(uri: String): ParsedEnrollmentLink? {
        val parsed = try {
            URI(uri)
        } catch (_: Exception) {
            return null
        }
        // expectedScheme/appLinkScheme are guaranteed non-null when compared; calling equals on
        // them (rather than on the possibly-null parsed.scheme, e.g. for a relative/schemeless
        // input like "") safely handles a null scheme as "not equal".
        if (expectedScheme.equals(parsed.scheme, ignoreCase = true) && parsed.host == expectedHost) {
            return parseQueryParamToken(parsed, expectedScheme, expectedHost)
        }
        if (appLinkScheme != null && appLinkHost != null && appLinkPathPrefix != null &&
            appLinkScheme.equals(parsed.scheme, ignoreCase = true) &&
            parsed.host == appLinkHost &&
            (parsed.port == -1 || parsed.port == 443) &&
            parsed.rawQuery == null &&
            parsed.rawFragment == null
        ) {
            return parsePathSegmentToken(parsed, appLinkScheme, appLinkHost, appLinkPathPrefix)
        }
        return null
    }

    private fun parseQueryParamToken(parsed: URI, scheme: String, host: String): ParsedEnrollmentLink? {
        val token = parsed.query
            ?.split("&")
            ?.asSequence()
            ?.map { it.split("=", limit = 2) }
            ?.firstOrNull { it.size == 2 && it[0] == "token" }
            ?.get(1)
        if (token.isNullOrEmpty()) return null
        return ParsedEnrollmentLink(serverBaseUrl = "$scheme://$host", rawInvitationToken = token)
    }

    private fun parsePathSegmentToken(
        parsed: URI,
        scheme: String,
        host: String,
        pathPrefix: String,
    ): ParsedEnrollmentLink? {
        val rawPath = parsed.rawPath ?: return null
        if (!rawPath.startsWith(pathPrefix)) return null
        val token = rawPath.removePrefix(pathPrefix).removeSuffix("/")
        // Invitation tokens are randomBytes(32).toString('base64url'): exactly
        // 43 URL-safe characters. Keep the token in one path segment and reject
        // encoded separators or alternate path shapes before bootstrap.
        if (!CANONICAL_INVITATION_TOKEN.matches(token)) return null
        return ParsedEnrollmentLink(serverBaseUrl = "$scheme://$host", rawInvitationToken = token)
    }

    private companion object {
        val CANONICAL_INVITATION_TOKEN = Regex("^[A-Za-z0-9_-]{43}$")
    }
}
