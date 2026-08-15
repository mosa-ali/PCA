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
 * Only the `token` query parameter (custom-scheme form) or the final non-empty path segment
 * (App Link form) is ever extracted -- any other parameter/segment present in the URI is silently
 * ignored, never interpreted as an authority claim.
 *
 * Accepts TWO link shapes, both leading to the exact same [ParsedEnrollmentLink] outcome:
 *  - `pca://enroll?token=<token>` (custom scheme; always supported, works even on a device where
 *    Android App Links have not been set up/verified for any domain).
 *  - `https://<appLinkHost>/<token>` (PCA-ADD-ENR-008 Android App Link continuation form,
 *    only when [appLinkScheme]/[appLinkHost] are supplied -- see
 *    [EnrollmentDeepLinkConfig.APP_LINK_HOST]'s own doc for why this shape exists). This is also
 *    exactly the link shape parent-web actually generates (`${baseUrl}/${token}`, a path segment,
 *    never a `token=` query parameter) -- see parent-web/src/pages/family/
 *    DeviceEnrollmentPanel.tsx's `enrollmentLink` construction.
 */
class UriEnrollmentLinkParser(
    private val expectedScheme: String,
    private val expectedHost: String,
    private val appLinkScheme: String? = null,
    private val appLinkHost: String? = null,
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
        if (appLinkScheme != null && appLinkHost != null &&
            appLinkScheme.equals(parsed.scheme, ignoreCase = true) && parsed.host == appLinkHost
        ) {
            return parsePathSegmentToken(parsed, appLinkScheme, appLinkHost)
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

    private fun parsePathSegmentToken(parsed: URI, scheme: String, host: String): ParsedEnrollmentLink? {
        val token = (parsed.path ?: "").split("/").lastOrNull { it.isNotEmpty() }
        if (token.isNullOrEmpty()) return null
        return ParsedEnrollmentLink(serverBaseUrl = "$scheme://$host", rawInvitationToken = token)
    }
}
