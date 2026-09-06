/**
 * Minimal, dependency-free cookie parse/serialize helpers -- this backend
 * has no cookie middleware installed (fastify's own dependency list is
 * intentionally minimal, see backend/package.json), so
 * FAMILY_SERVICE_SESSION_V1's HttpOnly/Secure/SameSite=Strict transport is
 * implemented directly against the raw `Cookie`/`Set-Cookie` headers.
 */

import { isProductionSensitiveRuntime } from '../runtime/environment.js';

const SESSION_COOKIE_BASE_NAME = 'pca_family_session';
const CSRF_COOKIE_BASE_NAME = 'pca_family_csrf';
export const CSRF_HEADER_NAME = 'x-pca-csrf-token';

/**
 * PCA-DW-W2-15C. The `__Host-` prefix is a browser-ENFORCED guarantee
 * (requires Secure, Path=/, and no Domain attribute -- all already true of
 * every cookie this domain sets) that a cookie under this name could only
 * ever have been set by this exact host over HTTPS. That is exactly the
 * split-origin/Domain-widening protection this codebase's realm-separation
 * design (Parent vs. Platform-Admin) already depends on by convention --
 * this makes the browser itself enforce it.
 *
 * The prefix requires Secure, which this codebase only sets when
 * `isProductionSensitiveRuntime()` is true -- a Secure cookie is silently
 * dropped by the browser over a plain-HTTP local dev/test connection. So
 * the prefix is applied in exactly that same condition; local dev/test
 * keeps the bare name so login still works over HTTP.
 *
 * SESSION ONLY, NOT CSRF: the session cookie is HttpOnly and never read by
 * name from JS (confirmed: parent-web's frontend only ever relies on the
 * browser attaching it automatically via `credentials: 'include', never
 * reads its literal name), so prefixing it is a pure hardening with no
 * blast radius. The CSRF companion cookie is deliberately NOT HttpOnly
 * (the double-submit pattern requires JS to read it), and parent-web's
 * frontend currently reads it by a HARDCODED, unprefixed literal name
 * (`const CSRF_COOKIE_NAME = 'pca_family_csrf'`) independently duplicated
 * across ~15 client files -- prefixing it here without also updating every
 * one of those would silently break the CSRF header on every authenticated
 * mutation in production (every request would 403 csrf_mismatch). That is
 * a real, coordinated backend+frontend change this Wave does not make;
 * csrfCookieName() stays a function (not a cached constant) so making that
 * change later only requires editing this one file's return value, not
 * every call site again.
 *
 * Every reader AND writer of these cookies must call these functions --
 * never a cached/static name -- so the two sides can never independently
 * drift out of agreement (which would look exactly like every session
 * silently failing to authenticate).
 */
export function sessionCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return isProductionSensitiveRuntime(env) ? `__Host-${SESSION_COOKIE_BASE_NAME}` : SESSION_COOKIE_BASE_NAME;
}

export function csrfCookieName(_env: NodeJS.ProcessEnv = process.env): string {
  return CSRF_COOKIE_BASE_NAME;
}

const MAX_COOKIE_HEADER_LENGTH = 8192;

/** Parses a raw `Cookie` request header into a name->value map. Malformed/oversized input yields an empty map (fail closed: no cookie is ever "found" from garbage input) rather than throwing. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof header !== 'string' || header.length === 0 || header.length > MAX_COOKIE_HEADER_LENGTH) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length === 0) continue;
    try {
      result.set(name, decodeURIComponent(value));
    } catch {
      // A malformed percent-encoding in one cookie must not take down
      // parsing of every other cookie on the request.
      continue;
    }
  }
  return result;
}

export interface CookieOptions {
  httpOnly: boolean;
  maxAgeSeconds: number;
  secure: boolean;
}

/** `SameSite=Strict` and `Path=/` are non-negotiable for every cookie this domain sets (FAMILY_SERVICE_SESSION_V1 transport). */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** An immediately-expiring cookie, used to clear a previously set cookie on logout. */
export function serializeExpiredCookie(name: string, options: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}
