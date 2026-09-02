import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { securityHeadersPlugin } from './vite/securityHeadersPlugin';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Dev-server-only proxy, used EXCLUSIVELY by the real-backend E2E suite
  // (e2e-real/realBackend.spec.ts / playwright.real.config.ts) to make the
  // Platform Admin API same-origin from the browser's perspective during a
  // local test run against a real backend process on a different port --
  // the backend intentionally has no CORS layer of its own (this app is
  // deployed same-origin behind a reverse proxy in every real environment,
  // per PCA-ADD-PA-001's "architecturally separate application" posture;
  // adding permissive CORS headers to the backend just to satisfy a local
  // dev-server port mismatch would be a real security regression, not a
  // test convenience worth making). Completely inert unless
  // VITE_E2E_REAL_PROXY_TARGET is explicitly set -- normal `npm run dev`/
  // `npm run build`/production usage never sets it, so this proxy block
  // never activates outside that one opt-in test flow.
  const e2eRealProxyTarget = env.VITE_E2E_REAL_PROXY_TARGET;

  return {
    // Build-time CSP + referrer policy meta tags (build only -- see
    // vite/securityHeadersPlugin.ts). connect-src is derived from the SAME
    // env var src/config/env.ts reads, resolved through loadEnv above so a
    // .env file counts, not just a shell variable; unset (the documented
    // normal case) means a same-origin-only policy.
    plugins: [securityHeadersPlugin(env.VITE_PCA_PLATFORM_ADMIN_API_BASE_URL), react()],
    server: {
      port: 4100,
      strictPort: true,
      proxy: e2eRealProxyTarget
        ? {
            '/platform-admin': {
              target: e2eRealProxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      port: 4100,
      strictPort: true,
    },
  };
});
