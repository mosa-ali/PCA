/**
 * S8 (2026-09-24) -- rate-limit identity for the RESOLVED client address.
 *
 * WHAT WENT WRONG IN PRODUCTION (live evidence): App Service appends
 * `X-Forwarded-For: <client-ip>:<port>` -- WITH the client's ephemeral
 * source port. Under the CIDR allowlist in trustProxyConfig.ts,
 * @fastify/proxy-addr stops at that (syntactically non-IP) entry and
 * surfaces it verbatim as `request.ip`, so every request keyed a DIFFERENT
 * `ip:port` string: per-IP rate-limit budgets never accumulated (observed:
 * 42 + 35 requests from two independent client networks, zero per-IP 429s,
 * while the per-email budget tripped exactly at its 10-request cap).
 *
 * THE FIX IS DELIBERATELY NARROW: strip a trailing ":port" from the ALREADY
 * RESOLVED address, and ONLY for the two shapes a forwarded address can
 * legitimately take -- "IPv4:port" and "[IPv6]:port". Everything else is
 * returned unchanged. A bare IPv6 address is never truncated at one of its
 * own colons because the bracketed form is required for the strip.
 *
 * NO TRUST DECISION LIVES HERE: this module never reads a header, never
 * talks to DNS, and never decides which hop is the client. That decision
 * stays entirely in @fastify/proxy-addr under the CIDR allowlist (see
 * trustProxyConfig.ts), so proxy-addr's last-untrusted-hop rule remains
 * the sole spoofing boundary: a forged X-Forwarded-For from an untrusted
 * socket peer is never used, and a forged entry prepended in front of the
 * platform-appended real entry cannot displace it.
 */

const IPV4_WITH_PORT = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;
const BRACKETED_IPV6_WITH_PORT = /^\[([0-9a-fA-F:]+)\]:(\d{1,5})$/;

function isIpv4Octet(value: string): boolean {
  return Number(value) <= 255; // the regex already bounds the digit count
}

function isPortNumber(value: string): boolean {
  return Number(value) <= 65535; // the regex already bounds the digit count
}

function stripAddressPort(address: string): string {
  const ipv4 = IPV4_WITH_PORT.exec(address);
  if (ipv4) {
    if (isIpv4Octet(ipv4[1]) && isIpv4Octet(ipv4[2]) && isIpv4Octet(ipv4[3]) && isIpv4Octet(ipv4[4]) && isPortNumber(ipv4[5])) {
      return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.${ipv4[4]}`;
    }
    return address;
  }
  const ipv6 = BRACKETED_IPV6_WITH_PORT.exec(address);
  if (ipv6) {
    // A bracketed form must actually contain an IPv6-shaped address (at
    // least one colon); "[abc]:80" is not one and stays unchanged.
    if (ipv6[1].includes(':') && isPortNumber(ipv6[2])) {
      return ipv6[1];
    }
  }
  return address;
}

/**
 * The rate-limit key for the client address @fastify/proxy-addr resolved
 * onto the request. See this module's header for why the strip is this
 * narrow, and test/http/clientAddressRateLimit.test.mjs for the spoof
 * negative controls that pin the trust decision to proxy-addr alone.
 */
export function clientAddressKey(request: { ip: string }): string {
  return stripAddressPort(request.ip);
}
