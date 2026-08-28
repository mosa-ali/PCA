/**
 * PCA-PA-3B -- Platform Administration operator (admin) user management
 * HTTP surface (mission Section 16). Composes `PlatformAdminAccountService`
 * (PCA-PA-1) for every mutation -- this file adds zero new account-mutation
 * logic, only the HTTP adapter plus the cross-admin LIST/detail read
 * (`AdminUsersReadModel`, since `PlatformAdminAuthRepository` only exposes
 * single-admin lookups).
 *
 * Sensitive authority: APP_OWNER (via `PlatformAdminAccountService`'s own
 * internal `MANAGE_ADMIN_ACCOUNTS`/`ASSIGN_ADMIN_ROLE` RBAC gate), plus a
 * step-up requirement this route layer adds on top (the service itself has
 * no step-up concept). `PLATFORM_ADMIN_STEP_UP_SCOPES` has no
 * admin-account-specific scope beyond `ADMIN_ROLE_GRANT` -- reused here for
 * every sensitive admin-account action (create, role assign/revoke,
 * disable, reactivate, forced session revocation), since it is the closest
 * and only defined scope covering "granting or altering Platform
 * Administration authority."
 *
 * NEVER returns `passwordCredential`, TOTP secret ciphertext/nonce, or any
 * session token -- `AdminUsersReadModel`'s SELECT list structurally never
 * includes those columns (see its header).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import type { PlatformAdminAccountService } from '../../../platformadmin/auth/PlatformAdminAccountService.js';
import { PlatformAdminAccountError } from '../../../platformadmin/auth/PlatformAdminAccountService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { PLATFORM_ADMIN_ROLES } from '../../../platformadmin/auth/types.js';
import type { PlatformAdminRole } from '../../../platformadmin/auth/types.js';
import { hashAdminEmail } from '../../../platformadmin/auth/emailHash.js';
import { AdminUsersReadModel } from '../../../platformadmin/readmodels/AdminUsersReadModel.js';
import { parsePageRequest } from '../../../platformadmin/api/pagination.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminAdminUserRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminAccountService: PlatformAdminAccountService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 2 * 1024;
const DISPLAY_NAME_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 255;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;
const ADMIN_ID_MAX_LENGTH = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerPlatformAdminAdminUserRoutes(app: FastifyInstance, deps: PlatformAdminAdminUserRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-adminusers-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-adminusers-mutate' });
  const readModel = new AdminUsersReadModel();

  function requireStepUp(request: FastifyRequest, reply: FastifyReply, stepUpId: unknown): Promise<boolean> {
    if (typeof stepUpId !== 'string' || stepUpId.length === 0) {
      reply.code(403).send({ error: 'forbidden' });
      return Promise.resolve(false);
    }
    const adminId = request.platformAdminId as string;
    const sessionId = request.platformAdminSessionId as string;
    return deps.platformAdminAuthService
      .consumeStepUp(stepUpId, adminId, sessionId, 'ADMIN_ROLE_GRANT')
      .then(() => true)
      .catch((error) => {
        if (error instanceof PlatformAdminAuthError) {
          reply.code(403).send({ error: 'forbidden' });
          return false;
        }
        throw error;
      });
  }

  app.get('/platform-admin/admin-users', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'VIEW_ADMIN_ACCOUNTS') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
    const query = (request.query ?? {}) as Record<string, unknown>;
    const page = parsePageRequest(query);
    const status = query.status === 'ACTIVE' || query.status === 'DISABLED' ? query.status : undefined;
    const nameQuery = typeof query.name === 'string' && query.name.trim().length > 0 ? query.name.trim() : undefined;
    const emailHash = typeof query.email === 'string' && query.email.trim().length > 0 ? hashAdminEmail(query.email) : undefined;
    const result = await readModel.list(page, { status, nameQuery, emailHash });
    return reply.code(200).send({
      items: result.items.map((r) => ({
        adminId: r.adminId,
        displayName: r.displayName,
        status: r.status,
        roles: r.roles,
        mfaStatus: r.mfaStatus,
        createdAt: dateToJson(r.createdAt),
        disabledAt: dateToJson(r.disabledAt),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/platform-admin/admin-users/:adminId', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'VIEW_ADMIN_ACCOUNTS') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
    const { adminId } = request.params as { adminId?: string };
    if (typeof adminId !== 'string' || adminId.length === 0 || adminId.length > ADMIN_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    const record = await readModel.getById(adminId);
    if (!record) return reply.code(404).send({ error: 'not_found' });
    return reply.code(200).send({
      adminId: record.adminId,
      displayName: record.displayName,
      status: record.status,
      roles: record.roles,
      mfaStatus: record.mfaStatus,
      createdAt: dateToJson(record.createdAt),
      disabledAt: dateToJson(record.disabledAt),
    });
  });

  app.post('/platform-admin/admin-users', { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    const body = request.body;
    if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
    const { displayName, email, password, role, stepUpId } = body;
    if (typeof displayName !== 'string' || displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    if (typeof email !== 'string' || email.length === 0 || email.length > EMAIL_MAX_LENGTH || !email.includes('@')) return reply.code(400).send({ error: 'invalid_request' });
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    if (typeof role !== 'string' || !(PLATFORM_ADMIN_ROLES as readonly string[]).includes(role)) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await requireStepUp(request, reply, stepUpId))) return;

    const roles = request.platformAdminRoles ?? [];
    const adminId = request.platformAdminId as string;
    try {
      const created = await deps.platformAdminAccountService.createAccount(displayName, hashAdminEmail(email), password, role as PlatformAdminRole, { adminId, roles });
      return reply.code(201).send({ adminId: created.adminId, displayName: created.displayName, status: created.status, createdAt: dateToJson(created.createdAt) });
    } catch (error) {
      if (error instanceof PlatformAdminAccountError) return reply.code(403).send({ error: 'forbidden' });
      throw error;
    }
  });

  app.post(
    '/platform-admin/admin-users/:adminId/roles',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const { adminId } = request.params as { adminId?: string };
      if (typeof adminId !== 'string' || adminId.length === 0 || adminId.length > ADMIN_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { role, action, stepUpId } = body;
      if (typeof role !== 'string' || !(PLATFORM_ADMIN_ROLES as readonly string[]).includes(role)) return reply.code(400).send({ error: 'invalid_request' });
      if (action !== 'GRANT' && action !== 'REVOKE') return reply.code(400).send({ error: 'invalid_request' });
      if (!(await requireStepUp(request, reply, stepUpId))) return;

      const roles = request.platformAdminRoles ?? [];
      const callerAdminId = request.platformAdminId as string;
      try {
        if (action === 'GRANT') {
          await deps.platformAdminAccountService.assignRole(adminId, role as PlatformAdminRole, { adminId: callerAdminId, roles });
          return reply.code(200).send({ status: 'GRANTED' });
        }
        const result = await deps.platformAdminAccountService.revokeRole(adminId, role as PlatformAdminRole, { adminId: callerAdminId, roles });
        return reply.code(200).send({ status: 'REVOKED', revokedSessionCount: result.revokedSessionCount });
      } catch (error) {
        if (error instanceof PlatformAdminAccountError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/admin-users/:adminId/disable',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const { adminId } = request.params as { adminId?: string };
      if (typeof adminId !== 'string' || adminId.length === 0 || adminId.length > ADMIN_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = isPlainObject(request.body) ? request.body : {};
      if (!(await requireStepUp(request, reply, body.stepUpId))) return;
      const roles = request.platformAdminRoles ?? [];
      const callerAdminId = request.platformAdminId as string;
      try {
        const result = await deps.platformAdminAccountService.disableAccount(adminId, { adminId: callerAdminId, roles });
        return reply.code(200).send({ status: 'DISABLED', revokedSessionCount: result.revokedSessionCount });
      } catch (error) {
        if (error instanceof PlatformAdminAccountError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/admin-users/:adminId/reactivate',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const { adminId } = request.params as { adminId?: string };
      if (typeof adminId !== 'string' || adminId.length === 0 || adminId.length > ADMIN_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = isPlainObject(request.body) ? request.body : {};
      if (!(await requireStepUp(request, reply, body.stepUpId))) return;
      const roles = request.platformAdminRoles ?? [];
      const callerAdminId = request.platformAdminId as string;
      try {
        await deps.platformAdminAccountService.reactivateAccount(adminId, { adminId: callerAdminId, roles });
        return reply.code(200).send({ status: 'ACTIVE' });
      } catch (error) {
        if (error instanceof PlatformAdminAccountError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/admin-users/:adminId/sessions/revoke-all',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const { adminId } = request.params as { adminId?: string };
      if (typeof adminId !== 'string' || adminId.length === 0 || adminId.length > ADMIN_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = isPlainObject(request.body) ? request.body : {};
      if (!(await requireStepUp(request, reply, body.stepUpId))) return;
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'MANAGE_ADMIN_ACCOUNTS') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
      const callerAdminId = request.platformAdminId as string;
      const result = await deps.platformAdminAuthService.revokeAllSessions(adminId as string, { adminId: callerAdminId, roles });
      return reply.code(200).send({ revokedSessionCount: result.revokedSessionCount });
    },
  );

}
