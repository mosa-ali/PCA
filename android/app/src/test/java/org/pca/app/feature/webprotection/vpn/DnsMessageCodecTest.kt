package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DnsMessageCodecTest {

    @Test
    fun `buildQuery then parse recovers the exact id, name, qtype and qclass`() {
        val bytes = DnsMessageCodec.buildQuery(id = 4242, name = "example.com", qtype = DNS_TYPE_A)

        val parsed = DnsMessageCodec.parse(bytes)

        requireNotNull(parsed)
        assertEquals(4242, parsed.id)
        assertEquals("example.com", parsed.question?.name)
        assertEquals(DNS_TYPE_A, parsed.question?.qtype)
        assertEquals(DNS_CLASS_IN, parsed.question?.qclass)
    }

    @Test
    fun `buildNxDomainResponse echoes the client's exact question and reports RCODE 3, zero answers`() {
        val query = DnsMessageCodec.parse(DnsMessageCodec.buildQuery(777, "blocked.example", DNS_TYPE_A))
        requireNotNull(query)

        val response = DnsMessageCodec.buildNxDomainResponse(query)
        val parsedResponse = DnsMessageCodec.parse(response)

        requireNotNull(parsedResponse)
        assertEquals(777, parsedResponse.id)
        assertEquals("blocked.example", parsedResponse.question?.name)
        assertEquals(0, parsedResponse.answers.size)
        val rcode = parsedResponse.flags and 0x000F
        assertEquals(3, rcode) // NXDOMAIN
        val qrBit = (parsedResponse.flags shr 15) and 0x1
        assertEquals(1, qrBit) // this is a response, not a query
    }

    @Test
    fun `rewriteResponseId only changes the transaction id, nothing else`() {
        val upstream = DnsMessageCodec.buildQuery(1, "example.com", DNS_TYPE_A)
        val rewritten = DnsMessageCodec.rewriteResponseId(upstream, clientQueryId = 9999)

        val parsed = DnsMessageCodec.parse(rewritten)
        requireNotNull(parsed)
        assertEquals(9999, parsed.id)
        assertEquals("example.com", parsed.question?.name)
    }

    @Test
    fun `buildSafeSearchResponse answers the original question with a CNAME to the safe-search host plus the upstream address records`() {
        val originalQuery = DnsMessageCodec.parse(DnsMessageCodec.buildQuery(55, "google.com", DNS_TYPE_A))
        requireNotNull(originalQuery)
        val question = originalQuery.question!!

        val upstreamAnswer = DnsResourceRecord(
            name = "forcesafesearch.google.com",
            type = DNS_TYPE_A,
            cls = DNS_CLASS_IN,
            ttl = 300,
            rdata = byteArrayOf(216.toByte(), 239.toByte(), 38, 120),
        )
        // A non-address record (e.g. a stray TXT) must never be copied into the rewritten response.
        val nonAddressAnswer = DnsResourceRecord("forcesafesearch.google.com", type = 16, cls = DNS_CLASS_IN, ttl = 300, rdata = byteArrayOf(0))

        val response = DnsMessageCodec.buildSafeSearchResponse(
            clientQueryId = originalQuery.id,
            originalQuestion = question,
            safeSearchHost = "forcesafesearch.google.com",
            upstreamAnswers = listOf(upstreamAnswer, nonAddressAnswer),
        )

        val parsed = DnsMessageCodec.parse(response)
        requireNotNull(parsed)
        assertEquals(originalQuery.id, parsed.id)
        assertEquals("google.com", parsed.question?.name)
        assertEquals(2, parsed.answers.size) // CNAME + exactly the one address record, TXT excluded

        val cnameAnswer = parsed.answers[0]
        assertEquals("google.com", cnameAnswer.name)
        assertEquals(DNS_TYPE_CNAME, cnameAnswer.type)
        val decodedCnameTarget = DnsMessageCodec.decodeName(cnameAnswer.rdata)
        assertEquals("forcesafesearch.google.com", decodedCnameTarget)

        val addressAnswer = parsed.answers[1]
        assertEquals("forcesafesearch.google.com", addressAnswer.name)
        assertEquals(DNS_TYPE_A, addressAnswer.type)
        assertEquals(upstreamAnswer.rdata.toList(), addressAnswer.rdata.toList())
    }

    @Test
    fun `a message too short to contain a header fails to parse`() {
        assertNull(DnsMessageCodec.parse(ByteArray(5)))
    }

    @Test
    fun `a header claiming zero questions parses with a null question, never a fabricated one`() {
        // Manually crafted 12-byte header: qdcount = 0.
        val header = ByteArray(12)
        header[4] = 0; header[5] = 0
        val parsed = DnsMessageCodec.parse(header)
        assertNotNull(parsed)
        assertNull(parsed!!.question)
        assertTrue(parsed.answers.isEmpty())
    }
}
