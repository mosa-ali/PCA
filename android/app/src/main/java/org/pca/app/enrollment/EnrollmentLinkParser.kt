package org.pca.app.enrollment

import java.net.URI
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

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
 * Exactly one `token` query parameter (custom-scheme form) or a canonical 43-character token
 * directly below the configured App Link path prefix is extracted -- duplicate `token` parameters
 * are rejected as ambiguous, and any other parameter/segment present in the URI is silently
 * ignored, never interpreted as an authority claim.
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
        if (uri.length > EnrollmentDeepLinkConfig.MAX_INVITATION_URI_LENGTH) return null
        val parsed = try {
            URI(uri)
        } catch (_: Exception) {
            return null
        }
        // A user-info component makes an otherwise trusted host misleading in
        // copied/displayed URLs (for example `https://alias@www.pcasafe.com`).
        // Enrollment links have a fixed authority, so reject this noncanonical
        // form for both the custom scheme and the HTTPS App Link.
        if (parsed.rawUserInfo != null) return null
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
        val query = parsed.rawQuery ?: return null
        val tokenParameters = mutableListOf<List<String>>()
        for (parameter in query.split("&")) {
            val parts = parameter.split("=", limit = 2)
            val rawKey = parts.firstOrNull() ?: ""
            val key = decodeQueryKey(rawKey) ?: return null
            if (key == "token") tokenParameters += parts
        }
        if (tokenParameters.size != 1) return null
        val parameter = tokenParameters.single()
        if (parameter.size != 2) return null
        val token = parameter[1]
        if (!CANONICAL_INVITATION_TOKEN.matches(token)) return null
        return ParsedEnrollmentLink(serverBaseUrl = "$scheme://$host", rawInvitationToken = token)
    }

    /**
     * Decode one raw query key using the same `+`-as-space convention as form-style URL query
     * parsers. Decode percent-encoded bytes as strict UTF-8: malformed escapes or byte sequences
     * make the link invalid instead of allowing this parser to overlook an alias for `token`.
     */
    private fun decodeQueryKey(rawKey: String): String? {
        val decoded = StringBuilder(rawKey.length)
        var index = 0
        while (index < rawKey.length) {
            when (val character = rawKey[index]) {
                '+' -> {
                    decoded.append(' ')
                    index++
                }
                '%' -> {
                    val bytes = ByteArrayOutputStream()
                    while (index < rawKey.length && rawKey[index] == '%') {
                        if (index + 2 >= rawKey.length) return null
                        val high = rawKey[index + 1].digitToIntOrNull(16) ?: return null
                        val low = rawKey[index + 2].digitToIntOrNull(16) ?: return null
                        bytes.write((high shl 4) or low)
                        index += 3
                    }
                    val chars = try {
                        StandardCharsets.UTF_8.newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT)
                            .decode(ByteBuffer.wrap(bytes.toByteArray()))
                            .toString()
                    } catch (_: Exception) {
                        return null
                    }
                    decoded.append(chars)
                }
                else -> {
                    decoded.append(character)
                    index++
                }
            }
        }
        return decoded.toString()
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
        // 32 random bytes encode to 43 unpadded base64url characters. The last
        // character has only four data bits, so its two unused pad bits must be
        // zero; restricting it avoids accepting alternate encodings of a token.
        val CANONICAL_INVITATION_TOKEN = Regex("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")
    }
}
