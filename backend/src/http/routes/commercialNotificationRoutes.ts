/**
 * PCA-COMMERCIAL-NOTIFY-1 -- family-facing commercial-notification read API
 * (mission Section 6) plus a Platform Support view (Section 7). A
 * structurally independent surface, uniquely owned by this file: no other
 * lane registers routes under `/v1/families/:familyId/commercial-notifications`
 * or `/platform-admin/commercial-notifications`.
 *
 * Every family-facing route requires an authenticated service session AND
 * family authorization (VIEW_OWN_NOTIFICATIONS / ACKNOWLEDGE_OWN_NOTIFICATION)
 * before CommercialNotificationService is ever called -- that service
 * performs no authorization of its own, it trusts the family scope it's
 * given (see requireFamilyAuthorization.ts's header).
 *
 * The support route requires a Platform Administration session and returns
 * ONLY CommercialNotificationSupportRow projections (event type/status/
 * opaque account ref) -- never messageKey/params, i.e. never family message
 * content, via CommercialNotificationSupportService's narrower method set.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRequirePlatformAdminSession } from '../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { PlatformAdminAuthService } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import type { CommercialNotificationService, CommercialNotificationSupportService } from '../../commercialnotifications/CommercialNotificationService.js';
import type { CommercialNotificationRow, CommercialNotificationSupportRow } from '../../commercialnotifications/types.js';

const MAX_LIMIT_PARAM = 200;
const MAX_ACCOUNT_REF_LENGTH = 128;
const MAX_NOTIFICATION_ID_LENGTH = 64;

/** Read-only across every Platform Administration role -- support metadata carries no family content, so there is no mutation-vs-read distinction to gate further. */
const SUPPORT_VIEW_ROLES = new Set(['APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']);

export interface CommercialNotificationRoutesDeps {
  commercialNotificationService: CommercialNotificationService;
  commercialNotificationSupportService: CommercialNotificationSupportService;
  authService: AuthService;
  authzService: AuthzService;
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Runs before requireServiceSession on every family-facing route below -- bounds session-validation DB load per IP regardless of token validity. */
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
}

function toNotificationDto(row: CommercialNotificationRow) {
  return {
    notificationId: row.notificationId,
    eventType: row.eventType,
    resourceRef: row.resourceRef,
    messageKey: row.messageKey,
    params: row.params,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
  };
}

function toSupportDto(row: CommercialNotificationSupportRow) {
  return {
    notificationId: row.notificationId,
    accountRef: row.accountRef,
    eventType: row.eventType,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
  };
}

function parseLimitQueryParam(query: unknown): number | undefined {
  if (!query || typeof query !== 'object') return undefined;
  const raw = (query as Record<string, unknown>).limit;
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, MAX_LIMIT_PARAM);
}

export function registerCommercialNotificationRoutes(app: FastifyInstance, deps: CommercialNotificationRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);

  app.get(
    '/v1/families/:familyId/commercial-notifications',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'list-commercial-notifications' }),
        createRequireFamilyAuthorization(deps.authzService, 'VIEW_OWN_NOTIFICATIONS'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const limit = parseLimitQueryParam(request.query);
      const notifications = await deps.commercialNotificationService.list(familyId, limit);
      return reply.send({ notifications: notifications.map(toNotificationDto) });
    },
  );

  app.get(
    '/v1/families/:familyId/commercial-notifications/unread-count',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'commercial-notifications-unread-count' }),
        createRequireFamilyAuthorization(deps.authzService, 'VIEW_OWN_NOTIFICATIONS'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const unreadCount = await deps.commercialNotificationService.unreadCount(familyId);
      return reply.send({ unreadCount });
    },
  );

  app.post(
    '/v1/families/:familyId/commercial-notifications/:notificationId/read',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'mark-commercial-notification-read' }),
        createRequireFamilyAuthorization(deps.authzService, 'ACKNOWLEDGE_OWN_NOTIFICATION'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, notificationId } = request.params as { familyId: string; notificationId: string };
      if (typeof notificationId !== 'string' || notificationId.length === 0 || notificationId.length > MAX_NOTIFICATION_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const outcome = await deps.commercialNotificationService.markRead(notificationId, familyId);
      if (outcome === 'NOT_FOUND') return reply.code(404).send({ error: 'not_found' });
      return reply.send({ status: 'read' });
    },
  );

  app.post(
    '/v1/families/:familyId/commercial-notifications/:notificationId/acknowledge',
    {
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'acknowledge-commercial-notification' }),
        createRequireFamilyAuthorization(deps.authzService, 'ACKNOWLEDGE_OWN_NOTIFICATION'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, notificationId } = request.params as { familyId: string; notificationId: string };
      if (typeof notificationId !== 'string' || notificationId.length === 0 || notificationId.length > MAX_NOTIFICATION_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const outcome = await deps.commercialNotificationService.acknowledge(notificationId, familyId);
      if (outcome === 'NOT_FOUND') return reply.code(404).send({ error: 'not_found' });
      return reply.send({ status: 'acknowledged' });
    },
  );

  app.get(
    '/platform-admin/commercial-notifications',
    {
      preHandler: [
        deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'platform-admin-commercial-notifications' }),
        requirePlatformAdminSession,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (!roles.some((role) => SUPPORT_VIEW_ROLES.has(role))) return reply.code(403).send({ error: 'forbidden' });
      const query = request.query as Record<string, unknown>;
      const accountRef = typeof query.accountRef === 'string' ? query.accountRef : '';
      if (accountRef.length === 0 || accountRef.length > MAX_ACCOUNT_REF_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const limit = parseLimitQueryParam(query);
      const notifications = await deps.commercialNotificationSupportService.listForSupport(accountRef, limit);
      return reply.send({ notifications: notifications.map(toSupportDto) });
    },
  );
}
