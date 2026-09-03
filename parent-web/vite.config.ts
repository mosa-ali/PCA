import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { securityHeadersPlugin } from './vite/securityHeadersPlugin';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Real-backend E2E proxy (mirrors platform-admin-web/vite.config.ts's
  // identical VITE_E2E_REAL_PROXY_TARGET pattern). The backend has no CORS
  // layer, so a real E2E run must reach it same-origin through this dev-
  // server proxy rather than cross-origin -- a dev-server port mismatch
  // would be a real security regression, not a test convenience worth
  // making. Completely inert unless VITE_E2E_REAL_PROXY_TARGET is
  // explicitly set -- normal `npm run dev`/`npm run build`/production usage
  // never sets it, so this proxy block never activates outside that one
  // opt-in test flow.
  const e2eRealProxyTarget = env.VITE_E2E_REAL_PROXY_TARGET;
  return {
    plugins: [
      securityHeadersPlugin(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: 'PCA Parent Console',
          short_name: 'PCA Parent',
          description:
            'Parental Control App - Parent Web Console (offline app shell; family data stays E2EE, decrypted only in a trusted parent browser context).',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Scope caching to the static app shell only. API responses (which
          // may carry encrypted family data) are never precached or runtime
          // cached here -- see docs/architecture/09_SECURITY_PRIVACY_E2EE.md.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: '/offline.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    server: {
      port: 4000,
      strictPort: true,
      proxy: e2eRealProxyTarget
        ? {
            '/api': {
              target: e2eRealProxyTarget,
              changeOrigin: true,
            },
            // Real HTTP clients whose backend routes live under /v1 (billing/
            // commercial, retention, device enrollment/pairing) -- confirmed
            // by direct reproduction that without this rule, RealBillingClient's
            // cookie-authenticated (no bearer-token gate) requests to
            // /v1/families/:familyId/commercial/* 404 against THIS dev
            // server itself instead of reaching the real backend, which looks
            // indistinguishable from "route doesn't exist" even though the
            // backend route (backend/src/http/routes/familyCommercialRoutes.ts)
            // is genuinely implemented.
            '/v1': {
              target: e2eRealProxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      port: 4000,
      strictPort: true,
    },
  };
});
