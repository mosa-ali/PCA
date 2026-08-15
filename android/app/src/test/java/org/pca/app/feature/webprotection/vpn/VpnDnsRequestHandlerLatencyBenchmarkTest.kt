package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.SafeSearchMode

/**
 * PCA-NFR-032: a real, measured-latency JVM microbenchmark for [VpnDnsRequestHandler.handle] --
 * previously only correctness unit tests existed for this class, with no latency evidence at all.
 *
 * Scope, stated honestly rather than overclaimed: this measures ONLY the CPU-bound portion of the
 * DNS filtering path this class itself owns -- domain canonicalization, the block/allow decision,
 * SafeSearch-host lookup, and DNS wire-format parsing/rewriting -- using an in-process, effectively
 * instantaneous fake [resolveUpstream] (matching every other test in `VpnDnsRequestHandlerTest`).
 * It deliberately does NOT and CANNOT measure real upstream DNS round-trip time, real TUN-interface
 * packet I/O, or any other genuinely device/network-dependent latency component of the end-to-end
 * filtering path -- those require a real Android device with a live network connection
 * (`WebProtectionVpnService` actually running against a real DNS resolver), which is out of reach
 * in this JVM-only build/test environment and would need `ANDROID_REAL_DEVICE_UAT` to obtain. This
 * benchmark's honest claim is narrower and still real: "the pure decision/parsing logic this class
 * contributes to per-query latency is small and does not grow unboundedly," which is exactly the
 * kind of regression a correctness-only test suite cannot catch (e.g. an accidentally-quadratic
 * domain-list scan would still pass every correctness test here while silently making every real
 * DNS query slower).
 *
 * The threshold below is deliberately generous (a regression guard, not a tight performance SLA)
 * -- it exists to catch a gross accidental regression (a busy-loop, an O(n^2) scan introduced by a
 * future change), not to certify a specific millisecond budget for real-world network latency.
 */
class VpnDnsRequestHandlerLatencyBenchmarkTest {

    private fun question(name: String, qtype: Int = DNS_TYPE_A) = DnsQuestion(name, qtype, DNS_CLASS_IN)
    private fun query(name: String, id: Int) = DnsMessage(id, flags = 0x0100, question = question(name), answers = emptyList())

    private fun fakeUpstreamAnswer(name: String) = UpstreamDnsResponse(
        rawBytes = DnsMessageCodec.buildQuery(id = 0, name = name, qtype = DNS_TYPE_A),
        message = DnsMessage(
            id = 0,
            flags = 0x8180,
            question = question(name),
            answers = listOf(DnsResourceRecord(name, DNS_TYPE_A, DNS_CLASS_IN, ttl = 60, rdata = byteArrayOf(93, 184.toByte(), 216.toByte(), 34))),
        ),
    )

    @Test
    fun `mean and p99 decision-path latency stay within a generous regression-guard ceiling`() {
        val handler = VpnDnsRequestHandler(
            domainDecider = { domain -> if (domain.endsWith("blocked.example")) VpnDnsDomainDecision.BLOCK else VpnDnsDomainDecision.ALLOW },
            safeSearchModeProvider = { SafeSearchMode.STRICT },
            decisionChannel = VpnDnsDecisionChannel(),
            resolveUpstream = { name, _ -> fakeUpstreamAnswer(name) }, // instantaneous fake -- see class doc comment on scope
        )

        // Warm up the JIT before measuring, same discipline any JVM microbenchmark needs -- the
        // first few hundred calls of ANY JVM code are dominated by interpretation/compilation
        // overhead unrelated to this class's real steady-state cost.
        repeat(WARMUP_ITERATIONS) { i -> handler.handle(query("warmup-$i.example.com", id = i)) }

        val domains = listOf(
            "allowed-example.com", "youtube.com", "blocked.example", "sub.domain.blocked.example", "google.com",
        )
        val samples = LongArray(MEASURED_ITERATIONS)
        for (i in 0 until MEASURED_ITERATIONS) {
            val domain = domains[i % domains.size]
            val start = System.nanoTime()
            handler.handle(query(domain, id = i))
            samples[i] = System.nanoTime() - start
        }

        samples.sort()
        val meanNanos = samples.sum() / samples.size
        val p99Nanos = samples[(samples.size * 99 / 100).coerceAtMost(samples.size - 1)]

        assertTrue(
            "mean decision-path latency ${meanNanos / 1_000}us exceeded the ${MEAN_CEILING_NANOS / 1_000}us regression-guard ceiling",
            meanNanos < MEAN_CEILING_NANOS,
        )
        assertTrue(
            "p99 decision-path latency ${p99Nanos / 1_000}us exceeded the ${P99_CEILING_NANOS / 1_000}us regression-guard ceiling",
            p99Nanos < P99_CEILING_NANOS,
        )
    }

    private companion object {
        const val WARMUP_ITERATIONS = 2_000
        const val MEASURED_ITERATIONS = 5_000
        // Generous by design (see class doc comment) -- these are JVM-microbenchmark ceilings for
        // pure in-process CPU work, not a claim about real device/network DNS latency.
        const val MEAN_CEILING_NANOS = 2_000_000L // 2ms
        const val P99_CEILING_NANOS = 10_000_000L // 10ms
    }
}
