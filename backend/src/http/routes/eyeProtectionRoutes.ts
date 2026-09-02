/**
 * PCA eye-protection reminders: the authenticated HTTP surface over
 * eyeprotection/EyeProtectionSettingsService.ts. Follows the SAME
 * session/CSRF/actor-device-binding conventions childPolicyRoutes.ts and
 * childRequestRoutes.ts already established (see either file's own header
 * comment for the full rationale): `actorDeviceId` for the mutating route
 * is derived EXCLUSIVELY from a verified DeviceSessionService session token
 * presented as `Authorization: Bearer <token>`, never a client-supplied
 * field.
 *
 * Unlike childPolicyRoutes.ts's schedule-policy route, this is a plain,
 * non-E2EE settings read/write (see EyeProtectionSettingsRepository's own
 * doc comment for why a bounded reminders-enabled boolean is the correct,
 * reviewed exception to the "no new plaintext policy store" posture that
 * route documents) -- this file never parses or relays an encrypted
 * envelope, it reads/writes the setting directly through the service.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { EyeProtectionError, type EyeProtectionSettingsService } from '../../eyeprotection/EyeProtectionSettingsService.js';
import type { EyeProtectionSettings } from '../../eyeprotection/EyeProtectionSettingsRepository.js';

const MAX_BODY_BYTES = 1024;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export interface EyeProtectionRoutesDeps {
  parentAccountService: ParentAccountService;
  deviceSessionService: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- omitting it fails the route closed with 503 (matching childPolicyRoutes.ts's own `not_configured` convention), never a silent allow. */
  eyeProtectionSettingsService?: EyeProtectionSettingsService;
  now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(CSRF_COOKIE_NAME);
  const headerToken = request.headers[CSRF_HEADER_NAME];
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  return cookieToken === headerToken;
}

function toSettingsDto(settings: EyeProtectionSettings): Record<string, unknown> {
  return {
    childProfileId: settings.childProfileId,
    remindersEnabled: settings.remindersEnabled,
    updatedAtUtc: settings.updatedAtUtc,
  };
}

export function registerEyeProtectionRoutes(app: FastifyInstance, deps: EyeProtectionRoutesDeps): void {
  const now = deps.now ?? (() => new Date());

  async function familySession(request: FastifyRequest, reply: FastifyReply): Promise<{ accountId: string; familyId: string } | null> {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    try {
      const session = await deps.parentAccountService.readSession(token);
      if (!session.familyId) {
        await reply.code(403).send({ error: 'family_scope_required' });
        return null;
      }
      const { familyId } = request.params as { familyId?: string };
      if (!familyId || familyId !== session.familyId) {
        await reply.code(403).send({ error: 'family_scope_forbidden' });
        return null;
      }
      return { accountId: session.accountId, familyId: session.familyId };
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      throw error;
    }
  }

  /** Same actor-identity-binding rationale as childPolicyRoutes.ts's requireActorDevice -- see this file's own header comment. */
  async function requireActorDevice(request: FastifyRequest, reply: FastifyReply, familyId: string): Promise<string | null> {
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
      await reply.code(401).send({ error: 'actor_device_session_required' });
      return null;
    }
    try {
      const identity = await deps.deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), familyId);
      return identity.deviceId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) {
        await reply.code(401).send({ error: 'actor_device_session_invalid' });
        return null;
      }
      throw error;
    }
  }

  // ---- Parent: current eye-protection reminders setting for one child ----
  app.get(
    '/api/parent/families/:familyId/children/:childProfileId/eye-protection',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.eyeProtectionSettingsService) return reply.code(503).send({ error: 'not_configured' });
      const session = await familySession(request, reply);
      if (!session) return;

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const settings = await deps.eyeProtectionSettingsService.get(session.familyId, childProfileId);
      return reply.code(200).send({ eyeProtection: toSettingsDto(settings) });
    },
  );

  // ---- Parent: enable/disable eye-protection reminders for one child ----
  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/eye-protection',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.eyeProtectionSettingsService) return reply.code(503).send({ error: 'not_configured' });
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;
      if (!isPlainObject(body) || typeof body.remindersEnabled !== 'boolean') {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const settings = await deps.eyeProtectionSettingsService.updateReminders(
          session.familyId,
          childProfileId,
          actorDeviceId,
          body.remindersEnabled,
          randomUUID(),
          randomUUID(),
        );
        return reply.code(200).send({ eyeProtection: toSettingsDto(settings) });
      } catch (error) {
        if (error instanceof EyeProtectionError) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        throw error;
      }
    },
  );
}
