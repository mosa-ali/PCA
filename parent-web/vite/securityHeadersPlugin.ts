import type { Plugin } from 'vite';

/**
 * Baseline security headers deliverable via <meta> (a static SPA host
 * cannot set real HTTP response headers). This covers CSP and referrer
 * policy. X-Frame-Options, X-Content-Type-Options and Permissions-Policy
 * CANNOT be set via <meta> per spec -- those still need to be set as real
 * HTTP response headers by whatever serves this build in production
 * (KNOWN_BACKEND_INTEGRATION_ACTION / deployment config, not something this
 * SPA slice can enforce on its own). frame-ancestors 'none' below covers
 * the same clickjacking risk X-Frame-Options addresses, in browsers that
 * honor CSP.
 *
 * connect-src is deliberately 'self' only: VITE_PCA_API_BASE_URL is a
 * runtime-configurable env var, not something safe to bake a specific
 * origin for into a static built asset. If a deployment's backend lives on
 * a different origin than this app is served from, the real HTTP-response
 * CSP header that deployment's server sets should list that exact origin
 * explicitly -- do not widen this meta tag with a wildcard.
 *
 * apply: 'build' only -- Vite's dev server injects its own inline
 * <script type="module"> React Fast Refresh preamble ahead of <head>,
 * which a strict script-src 'self' CSP correctly blocks, so this must not
 * run during `npm run dev`.
 */
export const CSP_CONTENT =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
  "base-uri 'self'; form-action 'self'; object-src 'none'";

export function securityHeadersPlugin(): Plugin {
  return {
    name: 'pca-security-headers',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_CONTENT },
          injectTo: 'head-prepend',
        },
        {
          tag: 'meta',
          attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
