import { domainToASCII, domainToUnicode } from 'node:url';
import type { CanonicalDomain } from './types.js';

export const MAX_DOMAIN_LENGTH = 253; // RFC 1035 total-length ceiling
export const MAX_LABEL_LENGTH = 63; // RFC 1035 per-label ceiling

const LABEL_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IPV4_SHAPE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * FINDING-005. This module has four DELIBERATELY separate stages, in
 * order, each with one job:
 *
 *  1. stripToHostnameToken   -- DNS canonicalization: reduce a bare
 *     hostname or full URL string down to the raw hostname token (strip
 *     scheme, userinfo, path/query/fragment, port, trailing dot). Does
 *     NOT touch character encoding or case.
 *  2. convertIdnaToAscii     -- IDNA conversion: hand that raw token to
 *     Node's built-in `url.domainToASCII`, which implements the WHATWG URL
 *     Standard's domain-to-ASCII algorithm (Unicode UTS-46 IDNA
 *     compatibility processing, ICU-backed). This is the ONLY place
 *     Unicode-vs-punycode equivalence is resolved, and it is a maintained
 *     platform implementation, not bespoke Unicode handling.
 *  3. canonicalizeDomain     -- policy matching key: validates the
 *     resulting ASCII form against this module's own structural rules
 *     (length ceilings, label shape, no bare IP literal) and returns it as
 *     the CanonicalDomain every WebRule/lookup is keyed on.
 *  4. hasSuspiciousScriptMixing -- homograph/confusable defense: a
 *     SEPARATE, independent signal (see below), never consulted by
 *     canonicalizeDomain and never affecting which CanonicalDomain string
 *     is produced.
 *
 * The bug this closes: a Unicode label (e.g. "münchen.example") and its
 * A-label form ("xn--mnchen-3ya.example") previously canonicalized
 * differently -- the structural LABEL_SHAPE check rejected any non-ASCII
 * input outright (returning null), so a parent denylist entry authored
 * against one representation could never match a navigation attempt
 * expressed in the other. Every call now routes through IDNA conversion
 * FIRST, so both representations of the same domain always produce the
 * identical CanonicalDomain string before any allow/deny lookup runs.
 */
function stripToHostnameToken(input: unknown): string | null {
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

  while (hostname.endsWith('.')) hostname = hostname.slice(0, -1);

  return hostname.length === 0 ? null : hostname;
}

/**
 * IDNA conversion stage. `url.domainToASCII` returns '' (per the WHATWG
 * URL Standard) when the input cannot be processed into valid ASCII
 * labels -- malformed punycode (a `xn--` label that fails to decode),
 * disallowed/unassigned code points, or a bidi/joiner rule violation.
 * That failure is surfaced as null here rather than guessed at or passed
 * through unconverted: "fail safely when normalization is uncertain"
 * means an unrecognized domain is treated as NOT MATCHABLE by any rule,
 * never silently accepted in whatever raw form it arrived in.
 */
function convertIdnaToAscii(hostnameToken: string): string | null {
  const ascii = domainToASCII(hostnameToken);
  return ascii.length === 0 ? null : ascii;
}

/**
 * doc 14 step C: "Canonicalize URL/domain; verify signed rule version" runs
 * before any allow/deny/category lookup, so a rule authored as
 * "Example.COM." and a navigation to "https://example.com:443/path" --
 * or to its Unicode/punycode equivalent -- must resolve to the identical
 * lookup key. Accepts either a bare hostname or a full URL string; returns
 * null for anything that cannot be reduced to a plausible DNS hostname
 * (including IPv4/IPv6 literals -- domain rules are never IP-scoped here).
 *
 * Deliberately does NOT strip a leading "www." label: doc 14 treats each
 * canonical domain as its own rule-lookup key, and silently merging
 * "www.example.com" into "example.com" would let a parent's denylist entry
 * for one silently fail to cover the other (or vice versa) -- ambiguous
 * either direction, so the module leaves both distinct rather than guessing.
 */
export function canonicalizeDomain(input: unknown): CanonicalDomain | null {
  const hostnameToken = stripToHostnameToken(input);
  if (hostnameToken === null) return null;

  const ascii = convertIdnaToAscii(hostnameToken);
  if (ascii === null) return null;

  if (ascii.length > MAX_DOMAIN_LENGTH) return null;
  if (IPV4_SHAPE.test(ascii)) return null;
  if (ascii.includes(':')) return null; // bare IPv6 literal, no brackets

  const labels = ascii.split('.');
  if (labels.length < 2) return null; // require at least one dot -- rejects bare "localhost"-style tokens
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return null;
    if (!LABEL_SHAPE.test(label)) return null;
  }

  return ascii;
}

export function isCanonicalDomain(candidate: unknown): candidate is CanonicalDomain {
  return typeof candidate === 'string' && canonicalizeDomain(candidate) === candidate;
}

/**
 * Homograph/confusable defense -- INDEPENDENT of canonicalization and
 * policy matching. Unicode's own Security Mechanisms (UTS #39, "Restriction
 * Level Detection" §5.2) treat a label whose visible characters are drawn
 * from more than one script as the primary signal of a possible spoof
 * ("Highly Restrictive"/single-script profiles are the safe case). This
 * function implements exactly that single well-established check --
 * multi-script mixing within one label -- using the ECMAScript `\p{Script=}`
 * Unicode property escapes (backed by the same Unicode Character Database
 * ICU itself uses), not a bespoke confusables/glyph-similarity algorithm.
 *
 * This is a SIGNAL for a caller (e.g. a future classifier/review policy)
 * to route a domain for extra scrutiny -- it never changes the
 * CanonicalDomain canonicalizeDomain() returns and is never consulted by
 * it, keeping IDNA conversion and homograph defense on two separate code
 * paths as required. A `false` result is not a safety guarantee against
 * every possible spoof, only against the specific mixed-script pattern
 * this check inspects.
 */
const CONFUSABLE_SCRIPT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Thai', /\p{Script=Thai}/u],
];

export function hasSuspiciousScriptMixing(input: unknown): boolean {
  const hostnameToken = stripToHostnameToken(input);
  if (hostnameToken === null) return false;

  // Decode via IDNA round-trip so an A-label input ("xn--...") is inspected
  // in the same Unicode form as an already-Unicode input -- an A-label is
  // pure ASCII and would otherwise trivially look single-script.
  const unicodeForm = domainToUnicode(hostnameToken);
  if (unicodeForm.length === 0) return false; // undecodable input carries no script-mixing signal of its own

  for (const label of unicodeForm.split('.')) {
    const scriptsPresent = new Set<string>();
    for (const ch of label) {
      for (const [scriptName, pattern] of CONFUSABLE_SCRIPT_PATTERNS) {
        if (pattern.test(ch)) scriptsPresent.add(scriptName);
      }
      if (scriptsPresent.size > 1) return true;
    }
  }
  return false;
}
