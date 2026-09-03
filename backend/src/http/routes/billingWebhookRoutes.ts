/**
 * PCA-BILL-2A -- provider webhook intake route + a JSON-only TEST_SANDBOX
 * status page (never a real UI, never reachable/registered outside
 * test/development since the sandbox provider itself refuses to exist
 * elsewhere -- see sandboxProvider.ts/providerRegistry.ts).
 *
 * RAW BODY: the webhook route needs the exact raw request bytes (Buffer)
 * to verify a provider's HMAC signature -- a normally-parsed/re-serialized
 * JSON body would not byte-for-byte match what the provider actually
 * signed. This route registers its OWN content-type parser inside an
 * encapsulated child Fastify context (`app.register(async (instance) => ...)`),
 * so this raw-buffer parser applies ONLY to routes registered inside that
 * same child instance -- every other route on `app` (checkout, refund,
 * invitations, etc.) keeps Fastify's normal JSON body parsing untouched.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRateLimiter } from '../rateLimit.js';
import type { WebhookService } from '../../billing/webhook/WebhookService.js';
import type { PaymentProviderRegistry } from '../../billing/provider/providerRegistry.js';

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_PROVIDER_PARAM_LENGTH = 32;
const SIGNATURE_HEADER_NAME = 'x-pca-webhook-signature';

export interface BillingWebhookRoutesDeps {
  webhookService: WebhookService;
  providerRegistry: PaymentProviderRegistry;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

export function registerBillingWebhookRoutes(app: FastifyInstance, deps: BillingWebhookRoutesDeps): void {
  const webhookRateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'billing-webhook' });

  app.register(async (instance) => {
    // Scoped to this child instance only -- see this file's header.
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    instance.post(
      '/billing/webhook/:provider',
      { bodyLimit: MAX_WEBHOOK_BODY_BYTES, preHandler: [webhookRateLimiter] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { provider } = request.params as { provider: string };
        if (typeof provider !== 'string' || provider.length === 0 || provider.length > MAX_PROVIDER_PARAM_LENGTH) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const rawBody = request.body;
        const rawPayload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0);
        const signatureHeaderValue = request.headers[SIGNATURE_HEADER_NAME];
        const signatureHeader = typeof signatureHeaderValue === 'string' ? signatureHeaderValue : undefined;

        // Never log rawPayload/signatureHeader -- this route has no
        // logging statement of its own for exactly that reason (see
        // WebhookService's own header note on the same discipline).
        //
        // PPR1R-D022: `result.httpStatus` is passed through verbatim,
        // including the 503 that a transiently-FAILED event now produces
        // (outcome 'RETRY'). That non-2xx is the request for redelivery --
        // never normalise it to a 200 here, or the event becomes
        // unrecoverable at the provider.
        const result = await deps.webhookService.processWebhook(provider, rawPayload, signatureHeader);
        return reply.code(result.httpStatus).send({ received: result.outcome === 'ACK' });
      },
    );
  });

  // A JSON-only "status page" a client-side redirect can poll after
  // returning from a sandbox checkout -- purely advisory/UX (Section 7):
  // it reads sandbox in-memory state and NEVER marks anything paid, and it
  // reads only through the TEST_SANDBOX provider's own read-only
  // getStatusForTest helper, never mutating.
  app.get(
    '/billing/sandbox/checkout/:providerCheckoutRef',
    { preHandler: [webhookRateLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerCheckoutRef } = request.params as { providerCheckoutRef: string };
      let provider;
      try {
        provider = deps.providerRegistry.resolve('TEST_SANDBOX');
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const result = await provider.queryPayment(providerCheckoutRef);
        return reply.send({ providerPaymentRef: result.providerPaymentRef, status: result.status });
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );
}
