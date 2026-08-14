// Central place that reads Vite env vars for Platform Administration.
// Deliberately its own module (not shared with parent-web) -- this app's
// API base URL, session realm, and every other configuration knob must
// never be able to silently collapse onto parent-web's, per the addendum's
// PCA-ADD-PA-001 "architecturally separate application" requirement.
export const config = {
  apiBaseUrl: import.meta.env.VITE_PCA_PLATFORM_ADMIN_API_BASE_URL ?? 'http://localhost:4001',
};
