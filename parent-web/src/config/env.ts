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

export const config = {
  apiBaseUrl: import.meta.env.VITE_PCA_API_BASE_URL ?? 'http://localhost:4001',
  demoMode: (import.meta.env.VITE_PCA_DEMO_MODE ?? 'false') === 'true',
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
