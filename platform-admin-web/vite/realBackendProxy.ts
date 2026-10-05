import type { ProxyOptions } from 'vite';

/** Opt-in same-origin proxy for the real-backend E2E flow only. */
export function createRealBackendProxy(target?: string): Record<string, ProxyOptions> | undefined {
  if (!target) return undefined;
  return {
    '/platform-admin': {
      target,
      changeOrigin: true,
    },
    // The refund orchestration endpoint predates the /platform-admin route
    // namespace. Keep its dev proxy exact-match and opt-in with the same
    // backend target as the authenticated Platform Admin API routes.
    '^/billing/admin/refund$': {
      target,
      changeOrigin: true,
    },
  };
}
