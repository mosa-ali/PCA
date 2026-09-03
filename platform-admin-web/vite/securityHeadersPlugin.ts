import type { Plugin } from 'vite';

/**
 * Baseline security headers for the Platform Administration console,
 * delivered via <meta> (a static SPA host cannot set real HTTP response
 * headers). This covers CSP and referrer policy. X-Frame-Options,
 * X-Content-Type-Options and Permissions-Policy CANNOT be set via <meta>
 * per spec -- those still need to be set as real HTTP response headers by
 * whatever serves this build in production (deployment config, not
 * something this SPA slice can enforce on its own).
 *
 * CLICKJACKING IS NOT COVERED HERE, AND THAT MATTERS MORE IN THIS CONSOLE
 * THAN ANYWHERE ELSE IN THE PRODUCT. Per CSP Level 3, frame-ancestors
 * (along with sandbox and report-uri) is IGNORED when a policy is delivered
 * in a <meta http-equiv> element -- it is only honoured in a real
 * Content-Security-Policy response header. The frame-ancestors 'none'
 * directive in buildCspContent below is therefore INERT as shipped; it is
 * kept in the string only so the policy is already correct on the day
 * something serves it as a real header. Nothing in this repository sets
 * X-Frame-Options either. So this console is framable by any site today,
 * and stays framable until a reverse proxy / CDN in front of the built
 * assets sets a real Content-Security-Policy (or X-Frame-Options) response
 * header -- deployment work that no change to this plugin can do. The
 * exposure is real: this console authorises refunds, settlement batches,
 * entitlement overrides and admin-user role grants, and every one of those
 * mutations is confirmed behind a step-up prompt that a framing attacker
 * can currently bait a click onto.
 *
 * DELIBERATELY NOT A COPY OF parent-web/vite/securityHeadersPlugin.ts's
 * connect-src FALLBACK. parent-web talks to an absolute API origin and so
 * falls back to http://localhost:4001 when unconfigured. THIS app is
 * same-origin by default: src/config/env.ts's apiBaseUrl defaults to ''
 * (empty => relative requests) precisely because the backend has no CORS
 * layer and every real deployment serves this app and its
 * /platform-admin/* API from one origin behind a reverse proxy. So the
 * unconfigured/default policy here is connect-src 'self' and nothing else
 * -- baking in a localhost fallback would both widen the policy for every
 * production build and describe an endpoint this app never uses by
 * default. An explicit absolute VITE_PCA_PLATFORM_ADMIN_API_BASE_URL (the
 * documented rare case in .env.example) is added as an exact origin, never
 * a wildcard; changing it requires rebuilding the SPA so the policy always
 * tracks the client endpoint.
 *
 * style-src keeps 'unsafe-inline' because this app renders inline
 * style={{...}} attributes in several pages (e.g. src/pages/accounts/
 * AccountsList.tsx, src/pages/billing/BillingQuotes.tsx). script-src does
 * NOT get any inline/eval escape hatch.
 *
 * apply: 'build' only -- Vite's dev server injects its own inline
 * <script type="module"> React Fast Refresh preamble ahead of <head>,
 * which a strict script-src 'self' CSP correctly blocks, so this must not
 * run during `npm run dev`.
 */
function resolveApiOrigin(apiBaseUrl: string): string | null {
  if (apiBaseUrl.trim() === '') return null;
  try {
    const parsed = new URL(apiBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Builds the policy for a given configured API base URL. An empty, unset,
 * relative, or non-http(s) value yields the same-origin policy -- the
 * correct default for this app (see the header note), never a localhost
 * fallback.
 */
export function buildCspContent(apiBaseUrl?: string): string {
  const configuredApiOrigin = resolveApiOrigin(apiBaseUrl ?? '');
  const connectSources = configuredApiOrigin ? `'self' ${configuredApiOrigin}` : "'self'";
  return (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data:; font-src 'self'; connect-src ${connectSources}; frame-ancestors 'none'; ` +
    "base-uri 'self'; form-action 'self'; object-src 'none'"
  );
}

/** The policy this app ships with when VITE_PCA_PLATFORM_ADMIN_API_BASE_URL is unset (the normal, documented case). */
export const CSP_CONTENT = buildCspContent(process.env.VITE_PCA_PLATFORM_ADMIN_API_BASE_URL);

/**
 * @param apiBaseUrl the build-time API base URL. vite.config.ts passes the
 * value loadEnv() resolved (so a .env file is honoured, not just a shell
 * variable); omitting it falls back to process.env.
 */
export function securityHeadersPlugin(apiBaseUrl?: string): Plugin {
  const cspContent = apiBaseUrl === undefined ? CSP_CONTENT : buildCspContent(apiBaseUrl);
  return {
    name: 'pca-platform-admin-security-headers',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: cspContent },
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
