package org.pca.app.feature.webprotection.vpn

import java.io.ByteArrayOutputStream

/**
 * Minimal DNS message parser/builder, scoped ONLY to what [WebProtectionVpnService]'s DNS-level
 * domain filtering and SafeSearch CNAME rewriting need: decoding the first question's QNAME/QTYPE,
 * decoding upstream answer resource records far enough to read TYPE/CLASS/TTL/RDATA (RDATA bytes
 * are only ever copied verbatim for A/AAAA records, never interpreted further), and building a
 * small, fixed set of synthetic/rewritten response messages. There is no TCP, no TLS, and no HTTP
 * payload handling anywhere in this file -- it only ever reads/writes a UDP/53 DNS datagram already
 * handed to it by [WebProtectionVpnService] (which itself only reaches a domain name, never a full
 * URL/path/query string -- DNS messages structurally do not carry one).
 */

data class DnsQuestion(val name: String, val qtype: Int, val qclass: Int)
data class DnsResourceRecord(val name: String, val type: Int, val cls: Int, val ttl: Int, val rdata: ByteArray)
data class DnsMessage(val id: Int, val flags: Int, val question: DnsQuestion?, val answers: List<DnsResourceRecord>)

const val DNS_TYPE_A = 1
const val DNS_TYPE_CNAME = 5
const val DNS_TYPE_AAAA = 28
const val DNS_CLASS_IN = 1

object DnsMessageCodec {

    /** Returns null only for a message too short to even contain a header -- a header with `qdcount == 0` (e.g. certain malformed or non-query traffic) decodes to a [DnsMessage] with `question = null`, which [WebProtectionVpnService] treats as "nothing to classify, forward untouched" rather than a parse failure. */
    fun parse(bytes: ByteArray): DnsMessage? {
        if (bytes.size < 12) return null
        val id = u16(bytes, 0)
        val flags = u16(bytes, 2)
        val qdcount = u16(bytes, 4)
        val ancount = u16(bytes, 6)
        if (qdcount < 1) return DnsMessage(id, flags, null, emptyList())

        val nameResult = readName(bytes, 12) ?: return DnsMessage(id, flags, null, emptyList())
        var offset = nameResult.second
        if (offset + 4 > bytes.size) return DnsMessage(id, flags, null, emptyList())
        val qtype = u16(bytes, offset)
        val qclass = u16(bytes, offset + 2)
        offset += 4
        val question = DnsQuestion(nameResult.first, qtype, qclass)

        val answers = mutableListOf<DnsResourceRecord>()
        var cursor = offset
        for (i in 0 until ancount) {
            val record = readRecord(bytes, cursor) ?: break
            answers.add(record.first)
            cursor = record.second
        }
        return DnsMessage(id, flags, question, answers)
    }

    private fun readRecord(bytes: ByteArray, start: Int): Pair<DnsResourceRecord, Int>? {
        val nameResult = readName(bytes, start) ?: return null
        var offset = nameResult.second
        if (offset + 10 > bytes.size) return null
        val type = u16(bytes, offset)
        val cls = u16(bytes, offset + 2)
        val ttl = ((bytes[offset + 4].toInt() and 0xFF) shl 24) or ((bytes[offset + 5].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 6].toInt() and 0xFF) shl 8) or (bytes[offset + 7].toInt() and 0xFF)
        val rdlength = u16(bytes, offset + 8)
        offset += 10
        if (offset + rdlength > bytes.size) return null
        val rdata = bytes.copyOfRange(offset, offset + rdlength)
        offset += rdlength
        return DnsResourceRecord(nameResult.first, type, cls, ttl, rdata) to offset
    }

    /**
     * Decodes a (possibly pointer-compressed, RFC 1035 4.1.4) DNS name starting at [start]. Returns
     * the decoded dotted name and the stream offset immediately following the name AS IT APPEARED IN
     * THE ORIGINAL MESSAGE (a pointer jump target itself never advances the returned offset). Bounded
     * against a malicious/malformed pointer loop.
     */
    private fun readName(bytes: ByteArray, start: Int): Pair<String, Int>? {
        val labels = mutableListOf<String>()
        var offset = start
        var returnOffset = -1
        var jumps = 0
        while (true) {
            if (offset >= bytes.size) return null
            val len = bytes[offset].toInt() and 0xFF
            when {
                len == 0 -> {
                    offset += 1
                    if (returnOffset == -1) returnOffset = offset
                    return labels.joinToString(".") to returnOffset
                }
                len and 0xC0 == 0xC0 -> {
                    if (offset + 1 >= bytes.size) return null
                    if (returnOffset == -1) returnOffset = offset + 2
                    val pointer = ((len and 0x3F) shl 8) or (bytes[offset + 1].toInt() and 0xFF)
                    jumps += 1
                    if (jumps > 20 || pointer >= bytes.size) return null
                    offset = pointer
                }
                else -> {
                    if (offset + 1 + len > bytes.size) return null
                    labels.add(String(bytes, offset + 1, len, Charsets.US_ASCII))
                    offset += 1 + len
                }
            }
        }
    }

    private fun encodeName(name: String): ByteArray {
        val out = ByteArrayOutputStream()
        if (name.isNotEmpty()) {
            for (label in name.split(".")) {
                if (label.isEmpty()) continue
                out.write(label.length and 0xFF)
                out.write(label.toByteArray(Charsets.US_ASCII))
            }
        }
        out.write(0)
        return out.toByteArray()
    }

    /** Builds a standard-query message (RD=1) for [name]/[qtype] under a fresh [id] -- used to ask the upstream resolver either the client's original question, or (SafeSearch path) the provider's documented safe-search-enforcing host instead. */
    fun buildQuery(id: Int, name: String, qtype: Int, qclass: Int = DNS_CLASS_IN): ByteArray {
        val out = ByteArrayOutputStream()
        writeHeader(out, id, flags = 0x0100, qdcount = 1, ancount = 0)
        out.write(encodeName(name))
        writeU16(out, qtype)
        writeU16(out, qclass)
        return out.toByteArray()
    }

    /**
     * Builds a synthetic NXDOMAIN response echoing the client's original question exactly (same id,
     * same qname/qtype/qclass) -- QR=1, RCODE=3 (NXDOMAIN), zero answers. This is the deterministic
     * on-device DNS-block mechanism: an explicit "this name does not exist" per RFC 1035, never a
     * fabricated sinkhole A record (e.g. 0.0.0.0) that a client could misinterpret as a resolved-but-
     * empty host, and never any answer this device did not actually decide to withhold.
     */
    fun buildNxDomainResponse(query: DnsMessage): ByteArray {
        val out = ByteArrayOutputStream()
        val flags = 0x8183 // QR=1, Opcode=0, AA=0, TC=0, RD=1, RA=1, RCODE=3 (NXDOMAIN)
        writeHeader(out, query.id, flags, qdcount = if (query.question != null) 1 else 0, ancount = 0)
        query.question?.let {
            out.write(encodeName(it.name))
            writeU16(out, it.qtype)
            writeU16(out, it.qclass)
        }
        return out.toByteArray()
    }

    /** Rewrites only the transaction id of an already-encoded upstream response to [clientQueryId] -- used on the ordinary (non-SafeSearch) allow path, where the client's own question is answered directly with no name/record rewriting at all. */
    fun rewriteResponseId(upstreamResponseBytes: ByteArray, clientQueryId: Int): ByteArray {
        if (upstreamResponseBytes.size < 2) return upstreamResponseBytes
        val out = upstreamResponseBytes.copyOf()
        out[0] = ((clientQueryId shr 8) and 0xFF).toByte()
        out[1] = (clientQueryId and 0xFF).toByte()
        return out
    }

    /**
     * Builds a SafeSearch-rewritten response: the client asked for [originalQuestion] but this device
     * instead resolved [safeSearchHost] upstream (see [WebProtectionVpnService]). Synthesizes a
     * response to the ORIGINAL question consisting of a CNAME record (`originalQuestion.name ->
     * safeSearchHost`) followed by every A/AAAA record from [upstreamAnswers], each addressed as an
     * answer for [safeSearchHost]. This is the standard, provider-documented DNS SafeSearch mechanism
     * (e.g. Google's `forcesafesearch.google.com`, YouTube's `restrict.youtube.com`): the resolver
     * returns a CNAME to a special enforcing hostname whose own A/AAAA records are what the client
     * actually connects to -- domain/DNS-level only, no TLS/content involvement, no answer this
     * device did not itself receive from a real upstream resolution.
     */
    fun buildSafeSearchResponse(
        clientQueryId: Int,
        originalQuestion: DnsQuestion,
        safeSearchHost: String,
        upstreamAnswers: List<DnsResourceRecord>,
    ): ByteArray {
        val addressRecords = upstreamAnswers.filter { it.type == DNS_TYPE_A || it.type == DNS_TYPE_AAAA }
        val out = ByteArrayOutputStream()
        val flags = 0x8180 // QR=1, RD=1, RA=1, RCODE=0 (NOERROR)
        writeHeader(out, clientQueryId, flags, qdcount = 1, ancount = 1 + addressRecords.size)
        out.write(encodeName(originalQuestion.name))
        writeU16(out, originalQuestion.qtype)
        writeU16(out, originalQuestion.qclass)

        out.write(encodeName(originalQuestion.name))
        writeU16(out, DNS_TYPE_CNAME)
        writeU16(out, DNS_CLASS_IN)
        writeU32(out, 60)
        val cnameRdata = encodeName(safeSearchHost)
        writeU16(out, cnameRdata.size)
        out.write(cnameRdata)

        for (rr in addressRecords) {
            out.write(encodeName(safeSearchHost))
            writeU16(out, rr.type)
            writeU16(out, rr.cls)
            writeU32(out, rr.ttl)
            writeU16(out, rr.rdata.size)
            out.write(rr.rdata)
        }
        return out.toByteArray()
    }

    private fun writeHeader(out: ByteArrayOutputStream, id: Int, flags: Int, qdcount: Int, ancount: Int) {
        writeU16(out, id)
        writeU16(out, flags)
        writeU16(out, qdcount)
        writeU16(out, ancount)
        writeU16(out, 0)
        writeU16(out, 0)
    }

    private fun writeU16(out: ByteArrayOutputStream, value: Int) {
        out.write((value shr 8) and 0xFF)
        out.write(value and 0xFF)
    }

    private fun writeU32(out: ByteArrayOutputStream, value: Int) {
        out.write((value shr 24) and 0xFF)
        out.write((value shr 16) and 0xFF)
        out.write((value shr 8) and 0xFF)
        out.write(value and 0xFF)
    }

    private fun u16(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xFF) shl 8) or (bytes[offset + 1].toInt() and 0xFF)

    /** Decodes a name starting at [offset] within [bytes] -- exposed (beyond [parse]'s internal use) so a test can independently verify that a record's RDATA correctly encodes a name (e.g. this codec's own CNAME answers in [buildSafeSearchResponse]). Returns null if malformed. */
    fun decodeName(bytes: ByteArray, offset: Int = 0): String? = readName(bytes, offset)?.first
}
