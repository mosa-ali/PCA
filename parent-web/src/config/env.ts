// Central place that reads Vite env vars, so the rest of the app never
// touches import.meta.env directly. Keeps the config surface auditable.
export const config = {
  apiBaseUrl: import.meta.env.VITE_PCA_API_BASE_URL ?? 'http://localhost:4001',
  demoMode: (import.meta.env.VITE_PCA_DEMO_MODE ?? 'false') === 'true',
};
