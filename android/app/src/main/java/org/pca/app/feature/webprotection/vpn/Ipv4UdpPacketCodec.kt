package org.pca.app.feature.webprotection.vpn

/**
 * Minimal, allocation-light IPv4 + UDP packet parser/builder, scoped ONLY to what
 * [WebProtectionVpnService]'s DNS-only enforcement needs. This codec structurally CANNOT read or
 * alter anything beyond a UDP datagram's header/payload bytes -- there is no TCP segment parsing,
 * no TLS record parsing, and no IPv6 support here at all (any non-IPv4/non-UDP packet [parse]s to
 * null and the service passes it through the TUN interface unexamined; see that class's doc
 * comment). This is the concrete backing for this lane's "no general packet forwarding, no payload
 * decryption" claim: the only bytes this file ever interprets are a DNS message's own wire bytes,
 * handed off to [DnsMessageCodec].
 */

data class Ipv4UdpPacket(
    val sourceAddress: ByteArray,
    val destAddress: ByteArray,
    val sourcePort: Int,
    val destPort: Int,
    val payload: ByteArray,
)

object Ipv4UdpPacketCodec {
    private const val IPV4_VERSION = 4
    private const val PROTOCOL_UDP = 17

    /** Returns null for anything that is not a well-formed IPv4/UDP datagram (IPv6, TCP, ICMP, truncated/malformed bytes) -- callers must treat null as "not ours to inspect," never as an error to surface, since the vast majority of a device's real traffic is legitimately not UDP/53 and must pass through untouched. */
    fun parse(buffer: ByteArray, length: Int): Ipv4UdpPacket? {
        if (length < 20) return null
        val versionAndIhl = buffer[0].toInt() and 0xFF
        val version = versionAndIhl shr 4
        if (version != IPV4_VERSION) return null
        val ihl = (versionAndIhl and 0x0F) * 4
        if (ihl < 20 || length < ihl + 8) return null
        val protocol = buffer[9].toInt() and 0xFF
        if (protocol != PROTOCOL_UDP) return null

        val srcAddr = buffer.copyOfRange(12, 16)
        val dstAddr = buffer.copyOfRange(16, 20)
        val udpOffset = ihl
        val srcPort = u16(buffer, udpOffset)
        val dstPort = u16(buffer, udpOffset + 2)
        val udpLength = u16(buffer, udpOffset + 4)
        val payloadOffset = udpOffset + 8
        val payloadLength = udpLength - 8
        if (payloadLength < 0 || payloadOffset + payloadLength > length) return null

        return Ipv4UdpPacket(srcAddr, dstAddr, srcPort, dstPort, buffer.copyOfRange(payloadOffset, payloadOffset + payloadLength))
    }

    /**
     * Builds a complete IPv4/UDP datagram (header + payload) with a correct IPv4 header checksum,
     * addressed FROM [sourceAddress]:[sourcePort] TO [destAddress]:[destPort]. The UDP checksum
     * field is left as `0` ("no checksum computed"), which RFC 768 explicitly permits for IPv4 --
     * used both to relay a real upstream DNS answer back to the TUN client (source address spoofed
     * as the tunnel's own advertised DNS server, since that is the address the client believes it
     * queried) and to synthesize a local NXDOMAIN response.
     */
    fun build(sourceAddress: ByteArray, destAddress: ByteArray, sourcePort: Int, destPort: Int, payload: ByteArray): ByteArray {
        val ipHeaderLen = 20
        val udpLen = 8 + payload.size
        val totalLen = ipHeaderLen + udpLen
        val packet = ByteArray(totalLen)

        packet[0] = ((IPV4_VERSION shl 4) or 5).toByte() // version 4, IHL 5 (20 bytes, no options)
        packet[1] = 0 // DSCP/ECN
        writeU16(packet, 2, totalLen)
        writeU16(packet, 4, 0) // identification
        writeU16(packet, 6, 0x4000) // flags: Don't Fragment, no offset
        packet[8] = 64 // TTL
        packet[9] = PROTOCOL_UDP.toByte()
        writeU16(packet, 10, 0) // checksum placeholder
        System.arraycopy(sourceAddress, 0, packet, 12, 4)
        System.arraycopy(destAddress, 0, packet, 16, 4)
        writeU16(packet, 10, checksum(packet, 0, ipHeaderLen))

        val udpOffset = ipHeaderLen
        writeU16(packet, udpOffset, sourcePort)
        writeU16(packet, udpOffset + 2, destPort)
        writeU16(packet, udpOffset + 4, udpLen)
        writeU16(packet, udpOffset + 6, 0) // UDP checksum: 0 = not computed (valid for IPv4 per RFC 768)
        System.arraycopy(payload, 0, packet, udpOffset + 8, payload.size)

        return packet
    }

    private fun u16(buffer: ByteArray, offset: Int): Int =
        ((buffer[offset].toInt() and 0xFF) shl 8) or (buffer[offset + 1].toInt() and 0xFF)

    private fun writeU16(buffer: ByteArray, offset: Int, value: Int) {
        buffer[offset] = ((value shr 8) and 0xFF).toByte()
        buffer[offset + 1] = (value and 0xFF).toByte()
    }

    private fun checksum(buffer: ByteArray, offset: Int, length: Int): Int {
        var sum = 0L
        var i = offset
        while (i < offset + length - 1) {
            sum += ((buffer[i].toInt() and 0xFF) shl 8) or (buffer[i + 1].toInt() and 0xFF)
            i += 2
        }
        if (length % 2 == 1) {
            sum += (buffer[offset + length - 1].toInt() and 0xFF) shl 8
        }
        while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
        return (sum.inv() and 0xFFFF).toInt()
    }
}
