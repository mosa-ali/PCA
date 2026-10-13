package org.pca.app.feature.webprotection.vpn

import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome
import org.pca.app.feature.webprotection.policy.canonicalizeDomain
import org.pca.app.feature.webprotection.policy.safeSearchDnsHostFor

enum class VpnDnsDomainDecision { ALLOW, BLOCK }

/** One real upstream DNS resolution -- [rawBytes] is the exact wire response (used for ordinary verbatim relay), [message] is its already-decoded form (used only to read A/AAAA answer records for a SafeSearch rewrite). Both describe the SAME resolver response; there is never a second, different resolution performed for the two. */
data class UpstreamDnsResponse(val rawBytes: ByteArray, val message: DnsMessage)

/**
 * Pure, Android-framework-free core of this lane's DNS-only enforcement decision. Given one already-
 * decoded client DNS query, decides whether to return a synthesized NXDOMAIN, a SafeSearch-CNAME-
 * rewritten response, or an ordinary relayed response -- and records the domain-level outcome into
 * [decisionChannel] so [VpnMetadataDecisionAdapter] can report it truthfully afterward.
 *
 * [WebProtectionVpnService] is the only Android-specific caller: it decodes one UDP/53 packet off the
 * TUN interface into a [DnsMessage], calls [handle] here, and writes the returned bytes back onto the
 * TUN interface (or drops the packet on a `null` result -- e.g. a non-A/AAAA query this device could
 * not resolve upstream, in which case the client simply times out and falls back to its own retry/
 * secondary-resolver behavior, exactly as it would on any real DNS outage). This class itself never
 * touches a socket, a TUN file descriptor, or any raw IPv4/UDP framing -- fully unit-testable on the
 * JVM with a fake [resolveUpstream].
 */
class VpnDnsRequestHandler(
    private val domainDecider: (CanonicalDomain) -> VpnDnsDomainDecision,
    private val safeSearchModeProvider: () -> SafeSearchMode,
    private val decisionChannel: VpnDnsDecisionChannel,
    private val resolveUpstream: (name: String, qtype: Int) -> UpstreamDnsResponse?,
) {
    fun handle(query: DnsMessage): ByteArray? = handle(query, decisionChannel.captureLifecycleEpoch())

    /** [lifecycleEpoch] is captured when the packet enters the service, before worker-queue delay. */
    fun handle(query: DnsMessage, lifecycleEpoch: Long): ByteArray? {
        val question = query.question ?: return null // nothing to classify -- caller drops/ignores rather than guessing at a malformed query

        if (question.qtype != DNS_TYPE_A && question.qtype != DNS_TYPE_AAAA) {
            // Only A/AAAA are classified/filtered -- doc 14 scope is web/content filtering, not a
            // general-purpose resolver policy. Every other record type (MX, TXT, NS, ...) is
            // forwarded upstream and relayed back verbatim, unfiltered.
            val upstream = resolveUpstream(question.name, question.qtype) ?: return null
            return DnsMessageCodec.rewriteResponseId(upstream.rawBytes, query.id)
        }

        val domain = canonicalizeDomain(question.name)
            ?: return DnsMessageCodec.buildNxDomainResponse(query) // not a plausible hostname at all -- never resolved

        // A previous query's verdict must not survive a new attempt that fails upstream. The
        // generation also prevents a slower, older same-domain request from overwriting the
        // result of a newer request when the VPN worker pool resolves queries concurrently.
        val decisionAttempt = decisionChannel.clearDecision(domain, lifecycleEpoch) ?: return null
        val decision = domainDecider(domain)
        if (decision == VpnDnsDomainDecision.BLOCK) {
            decisionChannel.recordDecision(domain, VpnDecisionOutcome.BLOCKED, decisionAttempt)
            return DnsMessageCodec.buildNxDomainResponse(query)
        }

        val safeSearchHost = safeSearchDnsHostFor(domain, safeSearchModeProvider())
        if (safeSearchHost != null) {
            val safeSearchUpstream = resolveUpstream(safeSearchHost, question.qtype)
            if (safeSearchUpstream != null) {
                val response = DnsMessageCodec.buildSafeSearchResponse(
                    query.id,
                    question,
                    safeSearchHost,
                    safeSearchUpstream.message.answers,
                )
                decisionChannel.recordDecision(domain, VpnDecisionOutcome.ALLOWED, decisionAttempt)
                return response
            }
            // The selected override is the enforcement mechanism. Resolving the original host
            // here would silently bypass the requested mode, so preserve the network failure and
            // leave the domain decision unavailable rather than returning an unfiltered answer.
            return null
        }

        val upstream = resolveUpstream(question.name, question.qtype) ?: return null
        val response = DnsMessageCodec.rewriteResponseId(upstream.rawBytes, query.id)
        decisionChannel.recordDecision(domain, VpnDecisionOutcome.ALLOWED, decisionAttempt)
        return response
    }
}
