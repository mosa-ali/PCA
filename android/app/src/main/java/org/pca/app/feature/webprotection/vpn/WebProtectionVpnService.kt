package org.pca.app.feature.webprotection.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import androidx.core.app.NotificationCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.pca.app.R
import org.pca.app.feature.webprotection.identity.WebProtectionIdentity
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.platform.VpnConnectionState
import org.pca.app.runtime.graph.PcaAppGraph

/**
 * doc 14 layer-2 CONCRETE enforcement: a real, user-consented [VpnService] that establishes a
 * DNS-ONLY tunnel and applies this device's existing, LKG-durable
 * [org.pca.app.feature.webprotection.engine.WebRuleRepository] / [org.pca.app.feature.webprotection.engine.WebFilterEngine]
 * rule set to every outbound DNS A/AAAA query, deterministically -- replacing
 * [VpnMetadataDecisionAdapter]'s previously-permanent UNAVAILABLE result with a real one whenever
 * this service is actually connected and enforcing (see [VpnDnsDecisionChannel]).
 *
 * Built directly on the EXISTING [org.pca.app.platform.StandardVpnCapabilitySource] foundation
 * (PCA-2) via [org.pca.app.platform.StandardVpnCapabilitySource.updateState] calls at each real
 * lifecycle transition, exactly as that class's own doc comment anticipates -- this service never
 * duplicates permission/consent logic, only reports its own lifecycle into it.
 *
 * ## Why DNS-only, not full packet forwarding
 * [android.net.VpnService.Builder.addRoute] is only ever called for this tunnel's own advertised
 * fake DNS server address ([TUNNEL_DNS_ADDRESS]/32) -- NEVER `0.0.0.0/0`. Combined with
 * `addDnsServer([TUNNEL_DNS_ADDRESS])`, Android configures the system resolver to send DNS queries
 * to this tunnel, while every other packet (the actual HTTP/HTTPS/TCP payload of a connection) is
 * routed by the OS entirely OUTSIDE this VPN, untouched by this service. This is a deliberate,
 * honestly-scoped design choice (see the final report's KNOWN_PLATFORM_LIMITATIONS): it never
 * performs general packet forwarding, so there is no NAT/TCP-proxy engine here to get wrong, and by
 * construction there is no code path in this class capable of reading a TCP payload, a TLS
 * handshake, or any HTTPS content -- domain/DNS metadata only, matching doc 14's visibility matrix
 * exactly ("Android local VPN/DNS: destinations/DNS ... only; never claim HTTPS path/content").
 *
 * Known, honestly-documented limitation: an app that ignores the system DNS resolver (a hardcoded
 * DNS-over-HTTPS/DNS-over-TLS resolver, or a hardcoded alternate resolver IP) bypasses this layer
 * entirely -- this service can never observe or block that traffic's domain. The PCA Safe Browser
 * and its own deterministic rule-engine integration remain fully independent of this VPN's state and
 * are unaffected by that limitation either way.
 */
class WebProtectionVpnService : VpnService() {

    private var tunnel: android.os.ParcelFileDescriptor? = null
    private val running = AtomicBoolean(false)
    private var executor: ExecutorService? = null
    private var readerThread: Thread? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEnforcement()
            return START_NOT_STICKY
        }
        startEnforcement()
        return START_STICKY
    }

    override fun onRevoke() {
        // Android (or the user, via Settings > VPN, or another VPN app taking over) revoked consent
        // out from under us -- doc 24's "VPN disable" abuse case: stop cleanly and report
        // DISCONNECTED, never pretend the tunnel is still enforcing.
        stopEnforcement()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopEnforcement()
        super.onDestroy()
    }

    private fun graph(): PcaAppGraph = PcaAppGraph.getInstance(applicationContext)

    private fun startEnforcement() {
        if (running.get()) return
        val g = graph()
        g.vpnCapabilitySource.updateState(VpnConnectionState.CONNECTING)

        val established = try {
            Builder()
                .setSession(getString(R.string.web_protection_vpn_notification_title))
                .addAddress(TUNNEL_LOCAL_ADDRESS, 32)
                .addDnsServer(TUNNEL_DNS_ADDRESS)
                .addRoute(TUNNEL_DNS_ADDRESS, 32)
                .setBlocking(true)
                .establish()
        } catch (_: Exception) {
            null
        }

        if (established == null) {
            // Consent missing/revoked mid-flight, or the platform refused to establish the tunnel --
            // an honest ERROR/DISCONNECTED transition, never a fabricated CONNECTED state.
            g.vpnCapabilitySource.updateState(VpnConnectionState.ERROR)
            g.vpnDnsDecisionChannel.setEnforcing(false)
            stopSelf()
            return
        }

        tunnel = established
        running.set(true)
        val pool = Executors.newFixedThreadPool(DNS_WORKER_THREADS)
        executor = pool
        g.vpnCapabilitySource.updateState(VpnConnectionState.CONNECTED)
        g.vpnDnsDecisionChannel.setEnforcing(true)

        startForeground(NOTIFICATION_ID, buildNotification())

        val handler = buildRequestHandler(g)
        readerThread = Thread({ runTunnelLoop(established, handler, pool) }, "pca-web-protection-vpn").apply {
            isDaemon = true
            start()
        }
    }

    private fun stopEnforcement() {
        running.set(false)
        readerThread?.interrupt()
        readerThread = null
        executor?.shutdownNow()
        executor = null
        try {
            tunnel?.close()
        } catch (_: Exception) {
            // Already closed/invalid -- nothing further to clean up.
        }
        tunnel = null

        val g = graph()
        g.vpnCapabilitySource.updateState(VpnConnectionState.DISCONNECTED)
        g.vpnDnsDecisionChannel.setEnforcing(false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildRequestHandler(g: PcaAppGraph): VpnDnsRequestHandler {
        val currentFamilyId: () -> String = {
            when (val identity = g.webProtectionIdentityContextProvider.current()) {
                is WebProtectionIdentity.Trusted -> identity.familyId
                // doc 13/14 Safe Limited Mode: never a blank/fabricated family id -- this sentinel
                // structurally never matches any real family-scoped rule, so only the global
                // SECURITY_DENYLIST feed (familyId = null) can ever block a domain in this state,
                // exactly like SafeBrowserController's own Safe Limited Mode handling.
                WebProtectionIdentity.TrustedFamilyContextUnavailable -> VPN_SAFE_LIMITED_MODE_FAMILY_ID
            }
        }
        return VpnDnsRequestHandler(
            domainDecider = { domain ->
                val decision = g.webFilterEngine.decide(currentFamilyId(), domain)
                if (decision.outcome == WebDecisionOutcome.BLOCK) VpnDnsDomainDecision.BLOCK else VpnDnsDomainDecision.ALLOW
            },
            safeSearchModeProvider = { g.vpnSafeSearchPolicyStore.currentMode() },
            decisionChannel = g.vpnDnsDecisionChannel,
            resolveUpstream = { name, qtype -> resolveUpstreamDns(name, qtype) },
        )
    }

    /**
     * Performs one real upstream UDP/53 resolution -- ALWAYS via [protect] so this socket's own
     * traffic is never itself captured by this (or any nested) VPN tunnel, which would otherwise
     * create an infinite resolution loop. Never caches, never logs, never retains the resolved
     * name/answer beyond this single call's return value.
     */
    private fun resolveUpstreamDns(name: String, qtype: Int): UpstreamDnsResponse? = try {
        DatagramSocket().use { socket ->
            protect(socket)
            socket.soTimeout = UPSTREAM_TIMEOUT_MILLIS
            val queryId = (0..0xFFFF).random()
            val queryBytes = DnsMessageCodec.buildQuery(queryId, name, qtype)
            val upstreamAddress = InetAddress.getByName(UPSTREAM_DNS_SERVER)
            socket.send(DatagramPacket(queryBytes, queryBytes.size, upstreamAddress, DNS_PORT))

            val responseBuffer = ByteArray(MAX_DNS_MESSAGE_SIZE)
            val responsePacket = DatagramPacket(responseBuffer, responseBuffer.size)
            socket.receive(responsePacket)
            val responseBytes = responseBuffer.copyOf(responsePacket.length)
            val message = DnsMessageCodec.parse(responseBytes)
            if (message == null) null else UpstreamDnsResponse(responseBytes, message)
        }
    } catch (_: Exception) {
        null
    }

    private fun runTunnelLoop(pfd: android.os.ParcelFileDescriptor, handler: VpnDnsRequestHandler, pool: ExecutorService) {
        val input = FileInputStream(pfd.fileDescriptor)
        val output = FileOutputStream(pfd.fileDescriptor)
        val buffer = ByteArray(MAX_PACKET_SIZE)

        while (running.get() && !Thread.currentThread().isInterrupted) {
            val length = try {
                input.read(buffer)
            } catch (_: Exception) {
                break
            }
            if (length <= 0) continue

            // Anything that is not an IPv4/UDP packet destined to our own advertised fake DNS
            // server (which addRoute() is the ONLY thing ever routed into this tunnel) is neither
            // expected nor handled -- silently skipped, never forwarded or inspected further.
            val packet = Ipv4UdpPacketCodec.parse(buffer, length) ?: continue
            if (packet.destPort != DNS_PORT) continue
            val query = DnsMessageCodec.parse(packet.payload) ?: continue

            try {
                pool.submit {
                    try {
                        val responsePayload = handler.handle(query) ?: return@submit
                        val responseIpPacket = Ipv4UdpPacketCodec.build(
                            sourceAddress = packet.destAddress,
                            destAddress = packet.sourceAddress,
                            sourcePort = packet.destPort,
                            destPort = packet.sourcePort,
                            payload = responsePayload,
                        )
                        synchronized(output) { output.write(responseIpPacket) }
                    } catch (_: Exception) {
                        // A single malformed/failed DNS exchange must never crash the whole tunnel
                        // loop -- the client simply times out and retries, exactly like any ordinary
                        // DNS hiccup on a real network.
                    }
                }
            } catch (_: java.util.concurrent.RejectedExecutionException) {
                // Pool already shut down (service stopping concurrently) -- drop this one packet.
            }
        }
    }

    private fun ensureNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.web_protection_vpn_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.web_protection_vpn_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * doc 25 Section 2: "a persistent, clearly identifiable notification while the monitoring
     * function runs," never hidden/cloaked/impersonating a system component. `setOngoing(true)`
     * plus an active foreground-service notification is the platform mechanism that makes it
     * genuinely non-dismissable by the user while enforcement is active. Uses this app's existing
     * generic-system-icon convention (see [org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery]
     * -- there is no bespoke PCA app icon asset anywhere in this repository yet; a pre-existing,
     * repo-wide gap this lane does not fix). The notification TEXT and channel name are always the
     * real, honest "PCA Web Protection is active" copy (see strings.xml `web_protection_vpn_*`),
     * never disguised as an OS/system notification.
     */
    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.web_protection_vpn_notification_title))
            .setContentText(getString(R.string.web_protection_vpn_notification_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

    companion object {
        const val ACTION_STOP = "org.pca.app.action.WEB_PROTECTION_VPN_STOP"
        private const val CHANNEL_ID = "web_protection_vpn"
        private const val NOTIFICATION_ID = 6001
        private const val TUNNEL_LOCAL_ADDRESS = "10.111.222.2"
        private const val TUNNEL_DNS_ADDRESS = "10.111.222.1"
        private const val UPSTREAM_DNS_SERVER = "1.1.1.1"
        private const val DNS_PORT = 53
        private const val MAX_PACKET_SIZE = 32767
        private const val MAX_DNS_MESSAGE_SIZE = 512
        private const val UPSTREAM_TIMEOUT_MILLIS = 5_000
        private const val DNS_WORKER_THREADS = 4
        private const val VPN_SAFE_LIMITED_MODE_FAMILY_ID = "SAFE_LIMITED_MODE_NO_FAMILY_CONTEXT"
    }
}
