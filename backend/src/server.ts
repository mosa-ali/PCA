import Fastify from 'fastify';

/**
 * The foundation deliberately exposes no family-data, enrollment, policy, or
 * recovery API. Those routes require their own protocol and security review.
 */
export function buildServer() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ service: 'pca-backend', status: 'ok' }));

  return app;
}
