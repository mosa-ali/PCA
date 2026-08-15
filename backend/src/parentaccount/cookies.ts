/**
 * Minimal, dependency-free cookie parse/serialize helpers -- this backend
 * has no cookie middleware installed (fastify's own dependency list is
 * intentionally minimal, see backend/package.json), so
 * FAMILY_SERVICE_SESSION_V1's HttpOnly/Secure/SameSite=Strict transport is
 * implemented directly against the raw `Cookie`/`Set-Cookie` headers.
 */

export const SESSION_COOKIE_NAME = 'pca_family_session';
export const CSRF_COOKIE_NAME = 'pca_family_csrf';
export const CSRF_HEADER_NAME = 'x-pca-csrf-token';

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

/** Cookies are Secure whenever NODE_ENV=='production' -- matches this codebase's other production-vs-not gates (e.g. billing/provider/sandboxProvider.ts's own NODE_ENV check). */
export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}
