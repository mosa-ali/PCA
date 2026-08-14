package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class Ipv4UdpPacketCodecTest {

    private val clientAddress = byteArrayOf(10, 111, 222.toByte(), 2)
    private val dnsAddress = byteArrayOf(10, 111, 222.toByte(), 1)

    @Test
    fun `build then parse round-trips source, destination, ports and payload exactly`() {
        val payload = byteArrayOf(1, 2, 3, 4, 5, 6, 7)
        val packetBytes = Ipv4UdpPacketCodec.build(
            sourceAddress = clientAddress,
            destAddress = dnsAddress,
            sourcePort = 54321,
            destPort = 53,
            payload = payload,
        )

        val parsed = Ipv4UdpPacketCodec.parse(packetBytes, packetBytes.size)

        requireNotNull(parsed)
        assertArrayEquals(clientAddress, parsed.sourceAddress)
        assertArrayEquals(dnsAddress, parsed.destAddress)
        assertEquals(54321, parsed.sourcePort)
        assertEquals(53, parsed.destPort)
        assertArrayEquals(payload, parsed.payload)
    }

    @Test
    fun `an odd-length payload still round-trips (checksum handles the padding case)`() {
        val payload = byteArrayOf(9, 8, 7)
        val packetBytes = Ipv4UdpPacketCodec.build(clientAddress, dnsAddress, 1000, 53, payload)

        val parsed = Ipv4UdpPacketCodec.parse(packetBytes, packetBytes.size)

        requireNotNull(parsed)
        assertArrayEquals(payload, parsed.payload)
    }

    @Test
    fun `a truncated buffer is rejected rather than parsed as a malformed packet`() {
        assertNull(Ipv4UdpPacketCodec.parse(ByteArray(10), 10))
    }

    @Test
    fun `an IPv6 version nibble is rejected -- this codec never touches IPv6`() {
        val buffer = ByteArray(40)
        buffer[0] = 0x60 // version 6
        assertNull(Ipv4UdpPacketCodec.parse(buffer, buffer.size))
    }

    @Test
    fun `a non-UDP protocol (TCP, 6) is rejected -- this codec never parses a TCP segment`() {
        val buffer = ByteArray(28)
        buffer[0] = 0x45 // version 4, IHL 5
        buffer[9] = 6 // TCP
        assertNull(Ipv4UdpPacketCodec.parse(buffer, buffer.size))
    }
}
