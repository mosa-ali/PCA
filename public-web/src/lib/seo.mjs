/**
 * PUBLIC-2 / PUBLIC-12 — per-page metadata.
 *
 * ORIGIN HANDLING (this is what keeps the artifact topology-neutral):
 * every link, asset and form target in the site is ORIGIN-RELATIVE, so the
 * build drops onto any host unchanged. Only canonical, hreflang and OpenGraph
 * URLs are absolute, because those three are meant to name the canonical
 * public host no matter which copy of the site a crawler happens to reach.
 * The origin comes from PUBLIC_SITE_ORIGIN at build time and defaults to
 * https://www.pcasafe.com -- PUBLIC-0 confirmed www is the working canonical
 * and that the apex pcasafe.com does not resolve (NXDOMAIN).
 *
 * INDEXABILITY: routes carry `indexable` in the route table. Non-indexable
 * routes emit robots noindex,nofollow AND are excluded from sitemap.xml, so
 * the two can never disagree. Auth routes are never indexable (IA section 17);
 * the legal drafts are non-indexable until legal review closes (BLOCK-3).
 */

import { LOCALES, LOCALE_META, urlFor, routeById } from '../content/routes.mjs';

export const DEFAULT_ORIGIN = 'https://www.pcasafe.com';

export function siteOrigin() {
  const raw = process.env.PUBLIC_SITE_ORIGIN?.trim();
  if (!raw) return DEFAULT_ORIGIN;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_SITE_ORIGIN is not a valid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`PUBLIC_SITE_ORIGIN must be http(s): ${raw}`);
  }
  return parsed.origin;
}

export function absoluteUrl(routeId, locale, origin = siteOrigin()) {
  return `${origin}${urlFor(routeId, locale)}`;
}

/**
 * Language alternates for a route. x-default points at English, which is the
 * default locale and the un-prefixed tree.
 */
export function languageAlternates(routeId, origin = siteOrigin()) {
  const alternates = LOCALES.map((locale) => ({
    hreflang: LOCALE_META[locale].htmlLang,
    href: absoluteUrl(routeId, locale, origin),
  }));
  alternates.push({ hreflang: 'x-default', href: absoluteUrl(routeId, 'en', origin) });
  return alternates;
}

/**
 * Content Security Policy for the public site.
 *
 * Deliberately stricter than either console's policy, because Release A makes
 * no network calls at all:
 *   - connect-src 'none'  : there is no API client, no fetch, no analytics.
 *   - form-action 'none'  : Release A submits no forms (contact is a mailto).
 *   - style-src 'self'    : all CSS is an external file; no inline styles, so
 *                           'unsafe-inline' is not needed as it is in parent-web.
 *
 * frame-ancestors is INERT when delivered via <meta> per CSP Level 3 -- it is
 * kept so the policy is already correct the day a real response header serves
 * it. Clickjacking protection, HSTS, X-Frame-Options, X-Content-Type-Options
 * and Permissions-Policy are RELEASE-A PREDEPLOY BLOCKERS per the owner
 * ruling, not build blockers: they must come from the host or CDN, which is
 * exactly the gap tracked as PPR1R-D039.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
];

/**
 * The <meta> policy deliberately OMITS frame-ancestors.
 *
 * parent-web keeps it in its meta tag so the string is "already correct" for a
 * future real header. Real-Chromium UAT showed the cost of that: Chrome logs
 * "the frame-ancestors directive is ignored when delivered via a <meta>
 * element" as a console ERROR on every single page load, in both locales, at
 * every viewport. PUBLIC-13 acceptance requires no console errors, and a
 * permanent known-noise error trains reviewers to ignore the console -- which
 * is how a real error gets missed.
 *
 * So frame-ancestors lives only where it actually works: in
 * REQUIRED_RESPONSE_HEADERS below, which the host or CDN must serve.
 */
export const CSP_CONTENT = CSP_DIRECTIVES.join('; ');

/** The full policy, including directives only a real response header honours. */
export const CSP_HEADER_CONTENT = [...CSP_DIRECTIVES, "frame-ancestors 'none'"].join('; ');

/** Response headers a host/CDN must set. Emitted to dist/ for the predeploy report. */
export const REQUIRED_RESPONSE_HEADERS = {
  'Content-Security-Policy': CSP_HEADER_CONTENT,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export function robotsContent(routeId) {
  return routeById(routeId).indexable ? 'index, follow' : 'noindex, nofollow';
}
