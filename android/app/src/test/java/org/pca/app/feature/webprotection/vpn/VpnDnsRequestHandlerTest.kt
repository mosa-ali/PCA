package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome

private const val CLIENT_QUERY_ID = 1234

class VpnDnsRequestHandlerTest {

    private fun question(name: String, qtype: Int = DNS_TYPE_A) = DnsQuestion(name, qtype, DNS_CLASS_IN)
    private fun query(name: String, qtype: Int = DNS_TYPE_A, id: Int = CLIENT_QUERY_ID) =
        DnsMessage(id, flags = 0x0100, question = question(name, qtype), answers = emptyList())

    private fun fakeUpstreamAnswer(name: String) = UpstreamDnsResponse(
        rawBytes = DnsMessageCodec.buildQuery(id = 0, name = name, qtype = DNS_TYPE_A), // stand-in wire bytes; only .message is inspected for SafeSearch
        message = DnsMessage(
            id = 0,
            flags = 0x8180,
            question = question(name),
            answers = listOf(DnsResourceRecord(name, DNS_TYPE_A, DNS_CLASS_IN, ttl = 60, rdata = byteArrayOf(93, 184.toByte(), 216.toByte(), 34))),
        ),
    )

    private fun handler(
        decider: (String) -> VpnDnsDomainDecision,
        safeSearchMode: SafeSearchMode = SafeSearchMode.OFF,
        channel: VpnDnsDecisionChannel = VpnDnsDecisionChannel(),
        resolveUpstream: (String, Int) -> UpstreamDnsResponse? = { name, _ -> fakeUpstreamAnswer(name) },
    ) = VpnDnsRequestHandler(
        domainDecider = { domain -> decider(domain) },
        safeSearchModeProvider = { safeSearchMode },
        decisionChannel = channel,
        resolveUpstream = resolveUpstream,
    )

    @Test
    fun `a blocked domain returns a synthesized NXDOMAIN and records BLOCKED in the decision channel`() {
        val channel = VpnDnsDecisionChannel()
        val h = handler(decider = { VpnDnsDomainDecision.BLOCK }, channel = channel)

        val response = h.handle(query("blocked-by-parent.example"))

        requireNotNull(response)
        val parsed = DnsMessageCodec.parse(response)!!
        assertEquals(CLIENT_QUERY_ID, parsed.id)
        assertEquals(0, parsed.answers.size)
        assertEquals(3, parsed.flags and 0x000F) // NXDOMAIN
        assertEquals(VpnDecisionOutcome.BLOCKED, channel.decisionFor("blocked-by-parent.example"))
    }

    @Test
    fun `an allowed domain with SafeSearch OFF is relayed via an ordinary upstream resolution and recorded ALLOWED`() {
        val channel = VpnDnsDecisionChannel()
        var requestedName: String? = null
        val h = handler(
            decider = { VpnDnsDomainDecision.ALLOW },
            channel = channel,
            resolveUpstream = { name, qtype -> requestedName = name; fakeUpstreamAnswer(name) },
        )

        val response = h.handle(query("safe-example.com"))

        requireNotNull(response)
        assertEquals("safe-example.com", requestedName) // the ORIGINAL domain was resolved, not rewritten
        val parsed = DnsMessageCodec.parse(response)!!
        assertEquals(CLIENT_QUERY_ID, parsed.id)
        assertEquals(VpnDecisionOutcome.ALLOWED, channel.decisionFor("safe-example.com"))
    }

    @Test
    fun `an allowed, SafeSearch-supported provider domain resolves the provider's documented safe host instead, and the client still sees the original question`() {
        val requestedNames = mutableListOf<String>()
        val h = handler(
            decider = { VpnDnsDomainDecision.ALLOW },
            safeSearchMode = SafeSearchMode.STRICT,
            resolveUpstream = { name, _ -> requestedNames.add(name); fakeUpstreamAnswer(name) },
        )

        val response = h.handle(query("google.com"))

        requireNotNull(response)
        assertEquals(listOf("forcesafesearch.google.com"), requestedNames) // never the raw original domain queried upstream
        val parsed = DnsMessageCodec.parse(response)!!
        assertEquals("google.com", parsed.question?.name) // client's own question is answered as asked
        assertTrue(parsed.answers.any { it.type == DNS_TYPE_CNAME })
    }

    @Test
    fun `an allowed but SafeSearch-unsupported provider domain is never rewritten, even with mode STRICT`() {
        val requestedNames = mutableListOf<String>()
        val h = handler(
            decider = { VpnDnsDomainDecision.ALLOW },
            safeSearchMode = SafeSearchMode.STRICT,
            resolveUpstream = { name, _ -> requestedNames.add(name); fakeUpstreamAnswer(name) },
        )

        val response = h.handle(query("unrelated-shop.example"))

        requireNotNull(response)
        assertEquals(listOf("unrelated-shop.example"), requestedNames) // no safe-search host substitution happened
    }

    @Test
    fun `SafeSearch host resolution failure falls back to an ordinary resolution of the original domain rather than failing the whole request`() {
        val requestedNames = mutableListOf<String>()
        val h = handler(
            decider = { VpnDnsDomainDecision.ALLOW },
            safeSearchMode = SafeSearchMode.STRICT,
            resolveUpstream = { name, _ ->
                requestedNames.add(name)
                if (name == "forcesafesearch.google.com") null else fakeUpstreamAnswer(name)
            },
        )

        val response = h.handle(query("google.com"))

        requireNotNull(response)
        assertEquals(listOf("forcesafesearch.google.com", "google.com"), requestedNames)
    }

    @Test
    fun `a non-A AAAA query type is forwarded and relayed verbatim without ever consulting the domain decider`() {
        var deciderCalled = false
        val h = handler(decider = { deciderCalled = true; VpnDnsDomainDecision.BLOCK })

        val response = h.handle(query("mail.example.com", qtype = 15 /* MX */))

        requireNotNull(response)
        assertFalse(deciderCalled)
    }

    @Test
    fun `an unparseable hostname is refused as NXDOMAIN without ever being handed to the domain decider`() {
        var deciderCalled = false
        val h = handler(decider = { deciderCalled = true; VpnDnsDomainDecision.ALLOW })

        val response = h.handle(query("not a valid host"))

        requireNotNull(response)
        assertFalse(deciderCalled)
        val parsed = DnsMessageCodec.parse(response)!!
        assertEquals(3, parsed.flags and 0x000F)
    }

    @Test
    fun `a query with no question at all is dropped -- never a fabricated response`() {
        val h = handler(decider = { VpnDnsDomainDecision.ALLOW })
        val response = h.handle(DnsMessage(id = 1, flags = 0, question = null, answers = emptyList()))
        assertNull(response)
    }

    @Test
    fun `upstream resolution failure on the ordinary path returns null -- never a fabricated answer`() {
        val h = handler(decider = { VpnDnsDomainDecision.ALLOW }, resolveUpstream = { _, _ -> null })
        val response = h.handle(query("offline-upstream.example"))
        assertNull(response)
    }
}
