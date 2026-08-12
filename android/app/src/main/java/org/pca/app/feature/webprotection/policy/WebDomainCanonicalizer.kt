package org.pca.app.feature.webprotection.policy

import java.net.IDN

private const val MAX_DOMAIN_LENGTH = 253 // RFC 1035 total-length ceiling
private const val MAX_LABEL_LENGTH = 63 // RFC 1035 per-label ceiling

private val LABEL_SHAPE = Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
private val IPV4_SHAPE = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
private val SCHEME_PREFIX = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

/**
 * Mirrors `backend/src/web/canonicalize.ts` stage-for-stage (see that file's
 * doc comment for the full rationale): (1) strip a bare hostname or full URL
 * string down to the raw hostname token; (2) IDNA-convert to ASCII via the
 * JDK's own `java.net.IDN` (the same maintained ICU-backed Unicode UTS-46
 * algorithm the WHATWG URL Standard specifies -- not bespoke Unicode
 * handling); (3) validate the resulting ASCII form against this module's own
 * structural rules; (4) an independent homograph/confusable signal that never
 * affects which [CanonicalDomain] is produced.
 *
 * Runs entirely offline -- `java.net.IDN` and `java.util.regex` are both
 * pure JDK, no network dependency, satisfying doc 14's "local deterministic
 * rules must continue to work with zero network dependency."
 */
private fun stripToHostnameToken(input: String?): String? {
    if (input.isNullOrEmpty()) return null
    var hostname = input.trim()
    if (hostname.isEmpty()) return null

    val schemeMatch = SCHEME_PREFIX.find(hostname)
    hostname = when {
        schemeMatch != null -> hostname.substring(schemeMatch.value.length)
        hostname.startsWith("//") -> hostname.substring(2)
        else -> hostname
    }

    val pathIndex = hostname.indexOfFirst { it == '/' || it == '?' || it == '#' }
    if (pathIndex != -1) hostname = hostname.substring(0, pathIndex)

    val atIndex = hostname.lastIndexOf('@')
    if (atIndex != -1) hostname = hostname.substring(atIndex + 1)

    if (hostname.startsWith("[")) return null // IPv6 literal in URL form -- not a domain rule key

    val portIndex = hostname.lastIndexOf(':')
    if (portIndex != -1) hostname = hostname.substring(0, portIndex)

    while (hostname.endsWith(".")) hostname = hostname.dropLast(1)

    return hostname.ifEmpty { null }
}

/**
 * IDNA conversion stage. `IDN.toASCII` throws `IllegalArgumentException` when
 * the input cannot be processed into valid ASCII labels -- surfaced as null
 * here rather than guessed at or passed through unconverted: an unrecognized
 * domain is treated as NOT MATCHABLE by any rule, never silently accepted in
 * whatever raw form it arrived in.
 */
private fun convertIdnaToAscii(hostnameToken: String): String? = try {
    // `IDN.toASCII` -- unlike the WHATWG `domainToASCII` the backend module uses -- only lowercases
    // labels it actually punycode-encodes; a label that is already all-ASCII (e.g. "Example.COM")
    // is returned with its original case intact. Lowercasing explicitly here restores the WHATWG
    // mapping-step behavior the backend's CanonicalDomain contract requires ("Lowercased ... hostname").
    val ascii = IDN.toASCII(hostnameToken, IDN.USE_STD3_ASCII_RULES).lowercase()
    ascii.ifEmpty { null }
} catch (_: IllegalArgumentException) {
    null
}

/**
 * doc 14 step C: canonicalize before any allow/deny/category lookup, so a
 * rule authored as "Example.COM." and a navigation to
 * "https://example.com:443/path" -- or its Unicode/punycode equivalent --
 * resolve to the identical lookup key. Accepts either a bare hostname or a
 * full URL string; returns null for anything that cannot be reduced to a
 * plausible DNS hostname (including IPv4/IPv6 literals -- domain rules are
 * never IP-scoped here).
 *
 * Deliberately does NOT strip a leading "www." label -- see the backend
 * counterpart's rationale: silently merging distinct hostnames would let a
 * parent's denylist entry for one silently fail to cover the other.
 */
fun canonicalizeDomain(input: String?): CanonicalDomain? {
    val hostnameToken = stripToHostnameToken(input) ?: return null
    val ascii = convertIdnaToAscii(hostnameToken) ?: return null

    if (ascii.length > MAX_DOMAIN_LENGTH) return null
    if (IPV4_SHAPE.matches(ascii)) return null
    if (ascii.contains(':')) return null // bare IPv6 literal, no brackets

    val labels = ascii.split(".")
    if (labels.size < 2) return null // require at least one dot -- rejects bare "localhost"-style tokens
    for (label in labels) {
        if (label.isEmpty() || label.length > MAX_LABEL_LENGTH) return null
        if (!LABEL_SHAPE.matches(label)) return null
    }
    return ascii
}

fun isCanonicalDomain(candidate: String?): Boolean = candidate != null && canonicalizeDomain(candidate) == candidate

/**
 * Homograph/confusable defense -- INDEPENDENT of canonicalization and policy
 * matching, mirroring `hasSuspiciousScriptMixing` in the backend module. Uses
 * `Character.UnicodeScript` (JDK's own Unicode Character Database-backed
 * script classification, the same authority ICU itself draws from) to flag a
 * label whose visible characters are drawn from more than one script -- a
 * SIGNAL for a caller to route a domain for extra scrutiny, never a
 * guarantee against every possible spoof, and never consulted by
 * [canonicalizeDomain] itself.
 */
private val TRACKED_SCRIPTS = setOf(
    Character.UnicodeScript.LATIN,
    Character.UnicodeScript.CYRILLIC,
    Character.UnicodeScript.GREEK,
    Character.UnicodeScript.HAN,
    Character.UnicodeScript.HIRAGANA,
    Character.UnicodeScript.KATAKANA,
    Character.UnicodeScript.HANGUL,
    Character.UnicodeScript.ARABIC,
    Character.UnicodeScript.HEBREW,
    Character.UnicodeScript.ARMENIAN,
    Character.UnicodeScript.DEVANAGARI,
    Character.UnicodeScript.THAI,
)

fun hasSuspiciousScriptMixing(input: String?): Boolean {
    val hostnameToken = stripToHostnameToken(input) ?: return false
    val unicodeForm = try {
        IDN.toUnicode(hostnameToken)
    } catch (_: IllegalArgumentException) {
        return false // undecodable input carries no script-mixing signal of its own
    }
    if (unicodeForm.isEmpty()) return false

    for (label in unicodeForm.split(".")) {
        val scriptsPresent = mutableSetOf<Character.UnicodeScript>()
        for (ch in label) {
            val script = try {
                Character.UnicodeScript.of(ch.code)
            } catch (_: IllegalArgumentException) {
                continue
            }
            if (script in TRACKED_SCRIPTS) scriptsPresent.add(script)
            if (scriptsPresent.size > 1) return true
        }
    }
    return false
}
