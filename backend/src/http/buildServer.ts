import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import type { AuthService } from '../auth/AuthService.js';
import type { AuthzService } from '../authz/AuthzService.js';
import type { InvitationService } from '../invitation/InvitationService.js';
import type { EnrollmentCoordinator } from '../enrollment/EnrollmentCoordinator.js';
import type { PairingService } from '../pairing/PairingService.js';
import type { DeviceSessionService } from '../runtime-sync/DeviceSessionService.js';
import type { OutboundRelayService } from '../runtime-sync/OutboundRelayService.js';
import type { InboundReconnectService } from '../runtime-sync/InboundReconnectService.js';
import type { DeviceSyncStatusTracker } from '../runtime-sync/StatusService.js';
import { createRateLimiter } from './rateLimit.js';
import { registerInvitationRoutes } from './routes/invitationRoutes.js';
import { registerBootstrapRoutes } from './routes/bootstrapRoutes.js';
import { registerPairingRoutes } from './routes/pairingRoutes.js';
import { registerRuntimeSyncRoutes, type ResolveEnvelopeContext } from './routes/runtimeSyncRoutes.js';

export interface ServerDependencies {
  authService: AuthService;
  authzService: AuthzService;
  invitationService: InvitationService;
  enrollmentCoordinator: EnrollmentCoordinator;
  pairingService: PairingService;
  deviceSessionService: DeviceSessionService;
  outboundRelayService: OutboundRelayService;
  inboundReconnectService: InboundReconnectService;
  statusTracker: DeviceSyncStatusTracker;
  resolveEnvelopeContext: ResolveEnvelopeContext;
}

/**
 * Explicit dependency composition -- no route module instantiates its own
 * repository, service, or database connection. Production wiring
 * constructs real MySQL-backed services and passes them here; tests
 * pass differently-backed (or in-memory) services through the same shape.
 *
 * The reviewed Secure Invite/pairing surface, and the PCA-16 runtime-sync
 * surface (its own device-session authentication -- see
 * runtime-sync/DeviceSessionService.ts), are registered here. Recovery and
 * family policy/control routes remain unexposed until their own distinct
 * authentication/authorization requirements are implemented.
 */
export function buildServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  const rateLimiter = createRateLimiter();
  // Bounds how many session-validation DB round-trips a single IP can force
  // by flooding well-formed-looking-but-invalid bearer tokens, independent
  // of whether the token is ever valid. Applied before requireServiceSession
  // on every authenticated route, in addition to (not instead of) each
  // route's own narrower abuse budget.
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 60, bucket: 'auth-attempt' });

  // Every unhandled exception (a bug, a MySQL outage, an unmapped driver
  // error) must never reach the client as a raw error.message -- that can
  // carry DB hosts/ports, constraint names, or internal invariant text.
  // Ordinary 4xx errors Fastify itself generates (oversized body, malformed
  // JSON) are safe to describe generically; every genuine 5xx collapses to
  // one fixed, non-informative body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      reply.code(500).send({ error: 'internal_error' });
      return;
    }
    reply.code(statusCode).send({ error: 'invalid_request' });
  });

  app.get('/health', async () => ({ service: 'pca-backend', status: 'ok' }));

  // Verifies DB connectivity only -- never exposes hostname, username,
  // password, connection string, or any table content in the response.
  app.get('/health/db', async (_request, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch {
      reply.code(503);
      return { status: 'error', database: 'unavailable' };
    }
  });

  registerInvitationRoutes(app, {
    invitationService: deps.invitationService,
    authService: deps.authService,
    authzService: deps.authzService,
    rateLimiter,
    authAttemptLimiter,
  });
  registerBootstrapRoutes(app, {
    enrollmentCoordinator: deps.enrollmentCoordinator,
    rateLimiter,
  });
  registerPairingRoutes(app, {
    pairingService: deps.pairingService,
    authService: deps.authService,
    authzService: deps.authzService,
    rateLimiter,
    authAttemptLimiter,
  });
  registerRuntimeSyncRoutes(app, {
    deviceSessionService: deps.deviceSessionService,
    outboundRelayService: deps.outboundRelayService,
    inboundReconnectService: deps.inboundReconnectService,
    statusTracker: deps.statusTracker,
    resolveEnvelopeContext: deps.resolveEnvelopeContext,
    rateLimiter,
    authAttemptLimiter,
  });

  return app;
}
