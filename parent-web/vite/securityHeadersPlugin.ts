import type { Plugin } from 'vite';

/**
 * Baseline security headers deliverable via <meta> (a static SPA host
 * cannot set real HTTP response headers). This covers CSP and referrer
 * policy. X-Frame-Options, X-Content-Type-Options and Permissions-Policy
 * CANNOT be set via <meta> per spec -- those still need to be set as real
 * HTTP response headers by whatever serves this build in production
 * (KNOWN_BACKEND_INTEGRATION_ACTION / deployment config, not something this
 * SPA slice can enforce on its own).
 *
 * CLICKJACKING IS NOT COVERED HERE. Per CSP Level 3, frame-ancestors (along
 * with sandbox and report-uri) is IGNORED when a policy is delivered in a
 * <meta http-equiv> element -- it is only honoured in a real
 * Content-Security-Policy response header. The frame-ancestors 'none'
 * directive in CSP_CONTENT below is therefore INERT as shipped; it is kept
 * in the string only so the policy is already correct on the day something
 * serves it as a real header. Nothing in this repository sets
 * X-Frame-Options either. The practical consequence: this console is
 * framable by any site today, and stays framable until a reverse proxy /
 * CDN in front of the built assets sets a real Content-Security-Policy (or
 * X-Frame-Options) response header. That is deployment work; no change to
 * this plugin can close it.
 *
 * connect-src includes the exact configured API origin (or the local backend
 * default) so the checked-in local parent-web/backend configuration is
 * reachable. It never uses a wildcard. A deployment that changes
 * VITE_PCA_API_BASE_URL must rebuild the SPA so this policy changes with the
 * client endpoint.
 *
 * apply: 'build' only -- Vite's dev server injects its own inline
 * <script type="module"> React Fast Refresh preamble ahead of <head>,
 * which a strict script-src 'self' CSP correctly blocks, so this must not
 * run during `npm run dev`.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:4001';

function resolveApiOrigin(apiBaseUrl: string): string | null {
  try {
    const parsed = new URL(apiBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const configuredApiOrigin = resolveApiOrigin(process.env.VITE_PCA_API_BASE_URL ?? DEFAULT_API_BASE_URL);
const connectSources = configuredApiOrigin ? `'self' ${configuredApiOrigin}` : "'self'";

export const CSP_CONTENT =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  `img-src 'self' data:; font-src 'self'; connect-src ${connectSources}; frame-ancestors 'none'; ` +
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
