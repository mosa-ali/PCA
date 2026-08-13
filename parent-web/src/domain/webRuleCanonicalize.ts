// PCA-WEB-RUNTIME-1 (doc 25): domain canonicalization for parent-authored web
// rules. This is a BROWSER-RUNTIME MIRROR of
// `backend/src/web/canonicalize.ts` / `android/.../policy/WebDomainCanonicalizer.kt`,
// not a literal shared import -- the backend module uses Node's
// `node:url.domainToASCII`, which does not exist in a browser bundle, and
// this package has no build step that could polyfill it. Instead, this
// module uses the browser's OWN native `URL` parser to perform the identical
// WHATWG URL Standard IDNA-to-ASCII conversion (every modern browser engine
// implements the same standard, ICU-backed, that Node's `domainToASCII`
// implements) -- so this is genuine reuse of the same specification/vectors
// doc 25 requires, not a bespoke reimplementation of Unicode handling.
//
// The three engines (backend, Android, parent-web) are kept in lockstep by
// running the SAME conformance vectors against each -- see
// `tests/domain/webRuleCanonicalize.test.ts` and
// `backend/src/web/canonicalize.test.ts` (existing) for the shared test
// cases; if one drifts, both test suites fail.

export const MAX_DOMAIN_LENGTH = 253; // RFC 1035 total-length ceiling
export const MAX_LABEL_LENGTH = 63; // RFC 1035 per-label ceiling

const LABEL_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IPV4_SHAPE = /^\d{1,3}(\.\d{1,3}){3}$/;

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
  if (atIndex !== -1) hostname = hostname.slice(atIndex + 1); // reject embedded credentials by discarding them, never trusting them

  if (hostname.startsWith('[')) return null; // IPv6 literal in URL form -- not a domain rule key

  const portIndex = hostname.lastIndexOf(':');
  if (portIndex !== -1) hostname = hostname.slice(0, portIndex);

  while (hostname.endsWith('.')) hostname = hostname.slice(0, -1);

  return hostname.length === 0 ? null : hostname;
}

/** IDNA conversion via the browser's native URL parser -- see module header. */
function convertIdnaToAscii(hostnameToken: string): string | null {
  try {
    const ascii = new URL(`https://${hostnameToken}`).hostname;
    return ascii.length === 0 ? null : ascii;
  } catch {
    return null;
  }
}

/** Mirrors backend `canonicalizeDomain` exactly (same structural rules, same rejections) -- see module header for why this is a native-API mirror rather than a literal shared import. */
export function canonicalizeDomain(input: unknown): string | null {
  const hostnameToken = stripToHostnameToken(input);
  if (hostnameToken === null) return null;

  const ascii = convertIdnaToAscii(hostnameToken);
  if (ascii === null) return null;

  if (ascii.length > MAX_DOMAIN_LENGTH) return null;
  if (IPV4_SHAPE.test(ascii)) return null;
  if (ascii.includes(':')) return null;

  const labels = ascii.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return null;
    if (!LABEL_SHAPE.test(label)) return null;
  }

  return ascii;
}

export function isCanonicalDomain(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && canonicalizeDomain(candidate) === candidate;
}
