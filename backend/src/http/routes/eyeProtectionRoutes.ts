/**
 * PCA eye-protection reminders: the authenticated HTTP surface over
 * eyeprotection/EyeProtectionSettingsService.ts. Parent-session membership is
 * the authority for these ordinary settings.
 * Reads allow active family Administrators and Viewers; writes require an
 * active Administrator and the session's CSRF token. Child-device auth is
 * not used as Parent authority here.
 *
 * Unlike childPolicyRoutes.ts's schedule-policy route, this is a plain,
 * non-E2EE settings read/write (see EyeProtectionSettingsRepository's own
 * doc comment for why a bounded reminders-enabled boolean is the correct,
 * reviewed exception to the "no new plaintext policy store" posture that
 * route documents) -- this file never parses or relays an encrypted
 * envelope, it reads/writes the setting directly through the service.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_HEADER_NAME, csrfCookieName, parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import type { EyeProtectionSettingsService } from '../../eyeprotection/EyeProtectionSettingsService.js';
import type { EyeProtectionSettings } from '../../eyeprotection/EyeProtectionSettingsRepository.js';
import type { ChildProfileRegistryRepository } from '../../childprofiles/ChildProfileRegistryRepository.js';

const MAX_BODY_BYTES = 1024;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export interface EyeProtectionRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- omitting it fails the route closed with 503 (matching childPolicyRoutes.ts's own `not_configured` convention), never a silent allow. */
  eyeProtectionSettingsService?: EyeProtectionSettingsService;
  /** Durable opaque membership proof; absent compositions fail closed for both reads and writes. */
  childProfileRegistryRepository?: Pick<ChildProfileRegistryRepository, 'resolveMembership'>;
  now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(csrfCookieName());
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

  async function requireRole(session: { accountId: string; familyId: string }, reply: FastifyReply, allowed: ReadonlySet<string>): Promise<boolean> {
    const role = await deps.parentAccountService.activeFamilyRole(session.accountId as never, session.familyId);
    if (!role || !allowed.has(role)) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  const READ_ROLES = new Set(['ADMINISTRATOR', 'VIEWER']);
  const ADMIN_ROLES = new Set(['ADMINISTRATOR']);

  async function requireChildProfileMember(familyId: string, childProfileId: string, reply: FastifyReply): Promise<boolean> {
    if (!deps.childProfileRegistryRepository) {
      await reply.code(503).send({ error: 'membership_authority_unavailable' });
      return false;
    }
    const membership = await deps.childProfileRegistryRepository.resolveMembership(familyId, childProfileId);
    if (membership !== 'MEMBER') {
      await reply.code(403).send({ error: 'family_scope_forbidden' });
      return false;
    }
    return true;
  }

  // ---- Parent: current eye-protection reminders setting for one child ----
  app.get(
    '/api/parent/families/:familyId/children/:childProfileId/eye-protection',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!(await requireRole(session, reply, READ_ROLES))) return;
      if (!deps.eyeProtectionSettingsService) return reply.code(503).send({ error: 'not_configured' });

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!(await requireChildProfileMember(session.familyId, childProfileId, reply))) return;

      const settings = await deps.eyeProtectionSettingsService.get(session.familyId, childProfileId);
      return reply.code(200).send({ eyeProtection: toSettingsDto(settings) });
    },
  );

  // ---- Parent: enable/disable eye-protection reminders for one child ----
  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/eye-protection',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!(await requireRole(session, reply, ADMIN_ROLES))) return;
      if (!deps.eyeProtectionSettingsService) return reply.code(503).send({ error: 'not_configured' });

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;
      if (!isPlainObject(body) || typeof body.remindersEnabled !== 'boolean') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!(await requireChildProfileMember(session.familyId, childProfileId, reply))) return;

      const settings = await deps.eyeProtectionSettingsService.updateReminders(session.familyId, childProfileId, body.remindersEnabled);
      return reply.code(200).send({ eyeProtection: toSettingsDto(settings) });
    },
  );
}
