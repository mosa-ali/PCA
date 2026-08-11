import type { CanonicalDomain } from './types.js';

export const MAX_DOMAIN_LENGTH = 253; // RFC 1035 total-length ceiling
export const MAX_LABEL_LENGTH = 63; // RFC 1035 per-label ceiling

const LABEL_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IPV4_SHAPE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * doc 14 step C: "Canonicalize URL/domain; verify signed rule version" runs
 * before any allow/deny/category lookup, so a rule authored as
 * "Example.COM." and a navigation to "https://example.com:443/path" must
 * resolve to the identical lookup key. Accepts either a bare hostname or a
 * full URL string; returns null for anything that cannot be reduced to a
 * plausible DNS hostname (including IPv4/IPv6 literals -- domain rules are
 * never IP-scoped here, matching doc 14's domain/category vocabulary, not
 * a raw-address one).
 *
 * Deliberately does NOT strip a leading "www." label: doc 14 treats each
 * canonical domain as its own rule-lookup key, and silently merging
 * "www.example.com" into "example.com" would let a parent's denylist entry
 * for one silently fail to cover the other (or vice versa) -- ambiguous
 * either direction, so the module leaves both distinct rather than guessing.
 */
export function canonicalizeDomain(input: unknown): CanonicalDomain | null {
  if (typeof input !== 'string' || input.length === 0) return null;

  let hostname = input.trim();
  if (hostname.length === 0) return null;

  const schemeMatch = hostname.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  if (schemeMatch) hostname = hostname.slice(schemeMatch[0].length);
  else if (hostname.startsWith('//')) hostname = hostname.slice(2);

  const pathIndex = hostname.search(/[/?#]/);
  if (pathIndex !== -1) hostname = hostname.slice(0, pathIndex);

  const atIndex = hostname.lastIndexOf('@');
  if (atIndex !== -1) hostname = hostname.slice(atIndex + 1);

  if (hostname.startsWith('[')) return null; // IPv6 literal in URL form -- not a domain rule key

  const portIndex = hostname.lastIndexOf(':');
  if (portIndex !== -1) hostname = hostname.slice(0, portIndex);

  hostname = hostname.toLowerCase();
  while (hostname.endsWith('.')) hostname = hostname.slice(0, -1);

  if (hostname.length === 0 || hostname.length > MAX_DOMAIN_LENGTH) return null;
  if (IPV4_SHAPE.test(hostname)) return null;
  if (hostname.includes(':')) return null; // bare IPv6 literal, no brackets

  const labels = hostname.split('.');
  if (labels.length < 2) return null; // require at least one dot -- rejects bare "localhost"-style tokens
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return null;
    if (!LABEL_SHAPE.test(label)) return null;
  }

  return hostname;
}

export function isCanonicalDomain(candidate: unknown): candidate is CanonicalDomain {
  return typeof candidate === 'string' && canonicalizeDomain(candidate) === candidate;
}
