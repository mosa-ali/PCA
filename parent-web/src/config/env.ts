// Central place that reads Vite env vars, so the rest of the app never
// touches import.meta.env directly. Keeps the config surface auditable.

/**
 * A misconfigured value is treated exactly like an unset one -- the caller
 * renders nothing rather than a control that navigates somewhere unusable.
 * The scheme check is also what keeps a `javascript:` or `data:` value from
 * ever reaching an `href` if the env var is set from an untrusted build input.
 */
function readHttpUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const LOCAL_DEVELOPMENT_API_BASE_URL = 'http://localhost:4001';

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

const demoMode = (import.meta.env.VITE_PCA_DEMO_MODE ?? 'false') === 'true';

export const config = {
  apiBaseUrl: resolveApiBaseUrl(import.meta.env.VITE_PCA_API_BASE_URL, import.meta.env.PROD && !demoMode),
  demoMode,
  /**
   * Base URL used to compose the one-time child-device enrollment link
   * (base + '/' + raw invitation token, nothing else -- never familyId,
   * role, or any other secret/authority). Env-var-driven so no production
   * hostname is ever hardcoded here; defaults to a local dev placeholder.
   */
  deviceEnrollmentLinkBaseUrl: import.meta.env.VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL ?? 'http://localhost:4000/enroll',
  /**
   * The Android download URL THIS deployment publishes, and the only
   * app-download URL this app knows about.
   *
   * `null` unless a real URL is configured for this deployment. There is
   * DELIBERATELY no default and no fallback: a Play Store URL invented here
   * would be a fabricated production link, and a stand-in host would be a dead
   * one.
   *
   * Null does NOT hide anything from the parent. The header's "Download App"
   * action is global and always rendered, and it navigates to the internal
   * /download page (pages/download/DownloadApp.tsx); this value only decides
   * whether that page can offer a real Android link or must say, plainly, that
   * no Android download is configured for this environment. Nothing outside
   * that page reads it, so an env value can only ever reach one `href`, and
   * only after `readHttpUrl` above has confirmed its scheme.
   *
   * Android only. iOS is post-V1 and gets no installation action anywhere:
   * enrollment is refused server-side (`ENROLLABLE_PLATFORMS =
   * new Set(['ANDROID'])` in backend/src/http/routes/invitationRoutes.ts
   * returns PLATFORM_ENROLLMENT_UNAVAILABLE), so an iOS download would lead a
   * parent to an app that cannot be enrolled.
   */
  androidAppDownloadUrl: readHttpUrl(import.meta.env.VITE_PCA_ANDROID_APP_DOWNLOAD_URL),
};
