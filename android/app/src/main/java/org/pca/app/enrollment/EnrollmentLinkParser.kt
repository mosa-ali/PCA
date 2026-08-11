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

/** Only the `token` query parameter is ever extracted -- any other parameter present in the URI is silently ignored, never interpreted as an authority claim. */
class UriEnrollmentLinkParser(
    private val expectedScheme: String,
    private val expectedHost: String,
) : EnrollmentLinkParser {

    override fun parse(uri: String): ParsedEnrollmentLink? {
        val parsed = try {
            URI(uri)
        } catch (_: Exception) {
            return null
        }
        // expectedScheme is guaranteed non-null; calling equals on it (rather
        // than on the possibly-null parsed.scheme, e.g. for a relative/
        // schemeless input like "") safely handles a null scheme as "not equal".
        if (!expectedScheme.equals(parsed.scheme, ignoreCase = true) || parsed.host != expectedHost) return null

        val token = parsed.query
            ?.split("&")
            ?.asSequence()
            ?.map { it.split("=", limit = 2) }
            ?.firstOrNull { it.size == 2 && it[0] == "token" }
            ?.get(1)
        if (token.isNullOrEmpty()) return null

        return ParsedEnrollmentLink(serverBaseUrl = "$expectedScheme://$expectedHost", rawInvitationToken = token)
    }
}
