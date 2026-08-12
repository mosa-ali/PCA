import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { securityHeadersPlugin } from './vite/securityHeadersPlugin';

// https://vitejs.dev/config/
export default defineConfig({
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
        theme_color: '#1d4f4a',
        background_color: '#0b1220',
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
  },
  preview: {
    port: 4000,
    strictPort: true,
  },
});
