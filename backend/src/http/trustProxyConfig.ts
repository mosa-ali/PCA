/**
 * PCA-DW-W2-15A -- CIDR-validated `trustProxy` configuration for
 * buildServer.ts's Fastify instance.
 *
 * Fastify's `trustProxy` option controls whether `request.ip` (and thus
 * every rate limiter keyed on it -- see http/rateLimit.ts,
 * parentaccount/rateLimiter.ts) is allowed to come from the client-supplied
 * `X-Forwarded-For` header instead of the raw TCP peer address. `true`
 * blindly enables that for a broad default (loopback/link-local/unique-
 * local peers) -- fine directly-exposed-to-the-internet-with-no-proxy, but
 * if PCA is EVER placed behind a real reverse proxy/load balancer/CDN
 * without validating which upstream peers are legitimate, any client can
 * forge its own rate-limit identity (and, if this codebase ever gates an
 * authorization decision on IP, its own apparent origin) by simply sending
 * an `X-Forwarded-For` header -- this is exactly the "X-Forwarded-*
 * spoofing under trustProxy hop-count" class of bug (GHSA-3m5p-2c4r-xxw2).
 *
 * The only mode that is actually safe under a general topology is an
 * explicit, validated allowlist of the CIDR ranges/addresses the real
 * proxy(ies) connect FROM -- Fastify hands this straight to
 * `@fastify/proxy-addr`, which walks the `X-Forwarded-For` chain and stops
 * trusting it the moment it reaches a hop outside the allowlist. This
 * module resolves that allowlist from `PCA_TRUSTED_PROXY_CIDRS` (a comma-
 * separated list of bare IPs and/or CIDR ranges) and validates every entry
 * itself (bounded prefix lengths, well-formed IPv4/IPv6 addresses) before
 * ever handing it to Fastify, so a malformed value fails loudly at
 * resolution time rather than silently misbehaving on the first real
 * request.
 *
 * FAILS CLOSED, in every environment, not just production: unset ->
 * `false` (trust nothing; `request.ip` is always the raw socket peer,
 * `X-Forwarded-For` is always ignored -- the safe default, since PCA has no
 * reverse proxy in front of it today). A configured-but-malformed value
 * throws immediately rather than falling back to `false` silently --
 * a config typo must be visible, never quietly downgrade to "no proxy
 * trust" without anyone noticing the flag they set was never honoured.
 */

import { isIP } from 'node:net';

export type TrustProxyOption = false | string[];

export class InvalidTrustedProxyConfigError extends Error {
  constructor(entry: string, reason: string) {
    super(`PCA_TRUSTED_PROXY_CIDRS entry ${JSON.stringify(entry)} is invalid: ${reason}`);
    this.name = 'InvalidTrustedProxyConfigError';
  }
}

function validateEntry(rawEntry: string): string {
  const entry = rawEntry.trim();
  if (entry.length === 0) throw new InvalidTrustedProxyConfigError(rawEntry, 'empty entry');

  const slashIndex = entry.indexOf('/');
  if (slashIndex === -1) {
    if (isIP(entry) === 0) throw new InvalidTrustedProxyConfigError(entry, 'not a valid IPv4/IPv6 address');
    return entry;
  }

  const address = entry.slice(0, slashIndex);
  const prefixRaw = entry.slice(slashIndex + 1);
  const ipVersion = isIP(address);
  if (ipVersion === 0) throw new InvalidTrustedProxyConfigError(entry, 'CIDR base address is not a valid IPv4/IPv6 address');

  if (!/^\d+$/.test(prefixRaw)) throw new InvalidTrustedProxyConfigError(entry, 'CIDR prefix length must be a non-negative integer');
  const prefixLength = Number.parseInt(prefixRaw, 10);
  const maxPrefixLength = ipVersion === 4 ? 32 : 128;
  if (prefixLength > maxPrefixLength) {
    throw new InvalidTrustedProxyConfigError(entry, `CIDR prefix length must be between 0 and ${maxPrefixLength} for IPv${ipVersion}`);
  }
  return entry;
}

/**
 * Resolves the Fastify `trustProxy` option from `PCA_TRUSTED_PROXY_CIDRS`.
 * Never returns `true` and never trusts an unbounded hop count -- either a
 * validated, explicit CIDR/IP allowlist, or `false` (trust nothing).
 */
export function resolveTrustProxyOption(env: NodeJS.ProcessEnv = process.env): TrustProxyOption {
  const raw = env.PCA_TRUSTED_PROXY_CIDRS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;
  return raw.split(',').map((entry) => validateEntry(entry));
}
