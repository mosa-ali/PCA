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
 * DERIVED FROM THE ARTIFACT, not copied from another app. `assertCspCoversArtifact()`
 * in build.mjs re-derives the required sources from the emitted files on every
 * build and fails if this policy is either too loose or too tight, so the two
 * cannot drift apart.
 *
 * What the Release A artifact actually loads, measured:
 *   - one same-origin stylesheet          -> style-src 'self'
 *   - one same-origin deferred script     -> script-src 'self'
 *   - same-origin SVG images and favicon  -> img-src 'self'
 *   - nothing else at all: 0 fonts, 0 data: URIs, 0 iframes, 0 <video>/<audio>,
 *     0 <form>, 0 <object>/<embed>, 0 web manifest, 0 workers, 0 fetch/XHR.
 *
 * So the baseline is `default-src 'none'` and every unused fetch directive
 * inherits it. That is what removes connect-src, font-src, media-src,
 * frame-src, worker-src, manifest-src and object-src as separate lines: they
 * are not omitted, they are 'none' by inheritance.
 *
 * Two directives were deliberately TIGHTENED after real measurement:
 *   - `img-src 'self' data:` -> `img-src 'self'`. Every `data:` occurrence in
 *     dist/ was the policy string itself; not one image used a data URI.
 *   - `font-src 'self'` was dropped. The stylesheet declares no @font-face and
 *     contains no url() at all -- the site is system-font only.
 * A directive nobody needs is not free: it is standing permission for the next
 * change to smuggle something in without a review.
 *
 * 'unsafe-inline' and 'unsafe-eval' appear nowhere, in either directive. The
 * site emits no inline <style>, no style="" attribute, no inline <script> and
 * no on*= handler, so neither is technically required -- and parent-web's
 * style-src 'unsafe-inline' is exactly the compromise this artifact avoids.
 */
const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
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
 * REQUIRED_RESPONSE_HEADERS below, served by deploy/nginx.conf.
 */
export const CSP_CONTENT = CSP_DIRECTIVES.join('; ');

/**
 * The full policy, including the directives only a real response header honours.
 *
 * frame-ancestors is inert in <meta> per CSP Level 3. upgrade-insecure-requests
 * is honoured in <meta>, but it is kept header-side so that the one policy a
 * reviewer has to audit for transport behaviour is the one the server sends.
 */
export const CSP_HEADER_CONTENT = [
  ...CSP_DIRECTIVES,
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Response headers the host must set. Emitted to reports/ for the predeploy
 * report, asserted against the running container by deploy/verify-container.mjs,
 * and served by deploy/nginx.conf. Those three must agree; the verifier is what
 * makes disagreement fail rather than ship.
 *
 * Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy were evaluated
 * against actual behaviour rather than copied in:
 *   - COOP same-origin: the site opens no popup and is opened by none, so it
 *     severs nothing that exists and removes window.opener as an attack path.
 *   - CORP same-origin: nothing here is meant to be embedded by another site.
 *     Note this is stricter than cross-origin and would need revisiting if a
 *     future asset is ever meant to be hotlinked; today none is.
 * Cross-Origin-Embedder-Policy is deliberately NOT set: it buys cross-origin
 * isolation, which only matters for SharedArrayBuffer and high-resolution
 * timers, and this site uses neither.
 */
export const REQUIRED_RESPONSE_HEADERS = {
  'Content-Security-Policy': CSP_HEADER_CONTENT,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function robotsContent(routeId) {
  return routeById(routeId).indexable ? 'index, follow' : 'noindex, nofollow';
}
