// Central place that reads Vite env vars, so the rest of the app never
// touches import.meta.env directly. Keeps the config surface auditable.
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
};
