// Central place that reads Vite env vars, so the rest of the app never
// touches import.meta.env directly. Keeps the config surface auditable.

/**
 * A misconfigured value is treated exactly like an unset one -- the caller
 * renders nothing rather than a control that navigates somewhere unusable.
 * The scheme check is also what keeps a `javascript:` or `data:` value from
 * ever reaching an `href` if the env var is set from an untrusted build input.
 */
function readHttpUrl(raw: string | undefined, production: boolean): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !production)) return null;
    if (parsed.username || parsed.password) return null;
    if (production && isLoopbackHostname(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const LOCAL_DEVELOPMENT_API_BASE_URL = 'http://localhost:4001';
const LOCAL_DEVELOPMENT_CHILD_APP_PUBLIC_ORIGIN = 'http://localhost:4000';

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.');
}

/**
 * Real (non-demo) production bundles must name their HTTPS API endpoint at build time.
 * Vite replaces this value while compiling, so accepting the local fallback
 * in a production build permanently bakes localhost into the shipped JS and
 * cannot be repaired by changing the container environment afterwards.
 *
 * Development, tests, and the explicit fixture-backed demo build retain the
 * existing localhost default. The demo artifact is independently forbidden by
 * the production demo-mode gate.
 */
export function resolveApiBaseUrl(raw: string | undefined, production: boolean): string {
  const value = (raw ?? '').trim();
  if (!production) return value || LOCAL_DEVELOPMENT_API_BASE_URL;

  if (value === '') {
    throw new Error('Production Parent Web build requires VITE_PCA_API_BASE_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Production VITE_PCA_API_BASE_URL must be a valid absolute HTTPS URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Production VITE_PCA_API_BASE_URL must use HTTPS.');
  }
  if (isLoopbackHostname(parsed.hostname)) {
    throw new Error('Production VITE_PCA_API_BASE_URL must not target localhost or a loopback address.');
  }

  return value.replace(/\/+$/, '');
}

/**
 * A production enrollment link must be supplied by the deployment owner. The
 * Parent Web and Android App Link host must be configured together and backed
 * by the matching Digital Asset Links file; no production localhost fallback
 * is safe. Returning null leaves the invitation journey visibly unavailable
 * until the route and signed-certificate association are ready.
 */
export function resolveChildAppEnrollmentLinkBaseUrl(raw: string | undefined, production: boolean): string | null {
  const value = (raw ?? '').trim();
  if (value === '') {
    return production ? null : `${LOCAL_DEVELOPMENT_CHILD_APP_PUBLIC_ORIGIN}/enroll`;
  }

  const safeUrl = readHttpUrl(value, production);
  if (!safeUrl) return null;
  try {
    const parsed = new URL(safeUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    // Android's manifest matches the canonical host and HTTPS scheme only.
    // WHATWG URL normalizes an explicit :443 away; every other port would
    // make Parent links and the App Link filter disagree.
    if (parsed.port !== '') return null;
    return `${parsed.origin}/enroll`;
  } catch {
    return null;
  }
}

const demoMode = (import.meta.env.VITE_PCA_DEMO_MODE ?? 'false') === 'true';

export const config = {
  apiBaseUrl: resolveApiBaseUrl(import.meta.env.VITE_PCA_API_BASE_URL, import.meta.env.PROD && !demoMode),
  demoMode,
  production: import.meta.env.PROD && !demoMode,
  /**
   * Base URL used to compose the one-time child-device enrollment link
   * (base + '/' + raw invitation token, nothing else -- never familyId,
   * role, or any other secret/authority). Env-var-driven so no production
   * hostname is ever hardcoded here. The deployment supplies the one public
   * origin that Android uses for the /enroll/ App Link prefix; this client
   * appends the fixed route segment itself.
   */
  deviceEnrollmentLinkBaseUrl: resolveChildAppEnrollmentLinkBaseUrl(
    import.meta.env.VITE_PCA_CHILD_APP_PUBLIC_ORIGIN,
    import.meta.env.PROD && !demoMode,
  ),
  /**
   * The Android Child App installation-information destination this deployment
   * publishes. The selected Parent destination is Public Web's /child-app/
   * landing page. It may report that no signed installer is available yet.
   *
   * `null` unless a real URL is configured for this deployment. There is
   * DELIBERATELY no default and no fallback: an unapproved store/package URL
   * or stand-in host would be a fabricated production link.
   *
   * Null does NOT hide anything from the parent. The header's "Download App"
   * action is global and always rendered, and it navigates to the internal
   * /download page (pages/download/DownloadApp.tsx); this value only decides
    * whether that page can offer the configured installation-information link or
   * must say, plainly, that none is configured for this environment. Nothing
   * outside that page and Add Device's install step reads it, so an env value
   * can only ever reach one `href`, and
   * only after `readHttpUrl` above has confirmed its scheme.
   *
   * Android only. iOS is post-V1 and gets no installation action anywhere:
   * enrollment is refused server-side (`ENROLLABLE_PLATFORMS =
   * new Set(['ANDROID'])` in backend/src/http/routes/invitationRoutes.ts
   * returns PLATFORM_ENROLLMENT_UNAVAILABLE), so an iOS download would lead a
   * parent to an app that cannot be enrolled.
  */
  childAppDistributionUrl: readHttpUrl(
    import.meta.env.VITE_PCA_CHILD_APP_DISTRIBUTION_URL,
    import.meta.env.PROD,
  ),
  /**
   * Production invitation creation requires a separate, explicit release
   * readiness switch. The distribution URL may be the public landing page
   * while that page truthfully reports that no signed installer is published;
   * URL presence alone must never unlock child or device creation.
   */
  childAppEnrollmentReady: import.meta.env.VITE_PCA_CHILD_APP_ENROLLMENT_READY === 'true',
  /**
   * Mark a localhost-only debug package explicitly so the Parent UI cannot
   * describe it as a release. Production bundles always use release wording.
   */
  childAppDistributionKind: !import.meta.env.PROD &&
    import.meta.env.VITE_PCA_CHILD_APP_DISTRIBUTION_KIND === 'local-test'
    ? 'local-test'
    : 'release',
};
