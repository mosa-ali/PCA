// Central place that reads Vite env vars for Platform Administration.
// Deliberately its own module (not shared with parent-web) -- this app's
// API base URL, session realm, and every other configuration knob must
// never be able to silently collapse onto parent-web's, per the addendum's
// PCA-ADD-PA-001 "architecturally separate application" requirement.
//
// DEFAULT IS DELIBERATELY EMPTY (same-origin), NOT an absolute backend URL.
// This app has NO CORS layer to fall back on (see vite.config.ts's header --
// the backend intentionally has none either): every real deployment serves
// this app and its /platform-admin/* API from the SAME origin, behind a
// reverse proxy. An empty apiBaseUrl makes every request in
// platformAdminAuthClient.ts/platformAdminApiClient.ts relative, which
// resolves against whatever origin this app is actually served from --
// correct by default in production, in plain local dev (nothing to
// misconfigure), and in the real-backend E2E suite (proxied same-origin by
// vite.config.ts's dev-only proxy). A previous version of this default
// pointed at an absolute http://localhost:4001, which silently broke every
// one of those cases whenever this app itself was NOT also served from
// port 4001 (the normal case): the browser then had to make a genuinely
// cross-origin request that the CORS-less backend always rejects, and
// login failed with a generic "Something went wrong" error that gave no
// hint the URL, not the credentials, was the problem (confirmed by direct
// reproduction against a real backend + MySQL: see
// tests/unit/platformAdminApiClient.test.ts and e2e-real/realBackend.spec.ts's
// header for the corrected setup notes). Only override this (to an
// explicit absolute origin) for the rare case where the backend is not
// reachable same-origin from wherever this app is served.
export const config = {
  apiBaseUrl: import.meta.env.VITE_PCA_PLATFORM_ADMIN_API_BASE_URL ?? '',
};
