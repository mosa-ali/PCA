/**
 * PCA product-completion programme, Writer P0-C (family/members): the
 * authenticated HTTP surface over familymembers/FamilyMemberInvitationService.
 * Follows the SAME session/CSRF/actor-device conventions
 * childRequestRoutes.ts/removalDecisionRoutes.ts already established
 * (HttpOnly family session cookie + double-submit CSRF cookie for
 * state-changing requests; `actorDeviceId` derived EXCLUSIVELY from a
 * verified DeviceSessionService bearer token, never a client-supplied
 * field) -- this file invents no new session/authentication model.
 *
 * Production wires the SAME shared ParentActionAuthorizationService
 * instance main.ts already constructs for Safe Zone/RemovalDecisionAuthority/
 * childRequestRoutes.ts, currently backed by UnavailableTrustSetRoleResolver
 * -- every invite/revoke/change-role/remove call here fails closed with the
 * honest NOT_AUTHORIZED reason until a real trust-set source is wired,
 * exactly like every other consumer of that shared instance.
 *
 * The remove route (:accountId/remove) targets an already-ACCEPTED member
 * by their parent_accounts.account_id, not a family_member_invitations id
 * -- it is the one mutation in this file that acts on parent_accounts
 * directly (via FamilyMemberInvitationService.removeMember /
 * FamilyMemberInvitationRepository.removeMemberAtomically), atomically
 * clearing that account's family_id and releasing the parent-member seat
 * it consumed in the SAME transaction.
 *
 * The accept route is deliberately NOT gated by ParentActionAuthorizationService:
 * the accepting account has no role in this family yet (that's the whole
 * point of accepting), so there is nothing for that service to resolve an
 * actor role from. Its own family session cookie proves who they are; the
 * invitationId proves what they're accepting; FamilyMemberInvitationService.
 * acceptInvitation's own atomic guard (PENDING + not expired) is the real
 * authorization boundary for this one action.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { FamilyMemberInvitationError, type FamilyMemberInvitationService } from '../../familymembers/FamilyMemberInvitationService.js';
import type { FamilyMemberInvitationRecord, InvitedFamilyRole } from '../../familymembers/types.js';

const MAX_BODY_BYTES = 4 * 1024;
const INVITED_ROLES: ReadonlySet<string> = new Set(['ADMINISTRATOR', 'VIEWER']);

export interface FamilyMemberRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise family/members routes need no change -- when omitted, this file registers nothing (mirrors registerBrowserEndpointRoutes' own optional-feature convention). */
  familyMemberInvitationService?: FamilyMemberInvitationService;
  deviceSessionService: DeviceSessionService;
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

/** Never returns the raw invitedEmailHash buffer to the client -- it is a one-way digest kept server-side only, mirroring RealDeviceEnrollmentClient's own rule about never re-serving a raw secret. */
function toInvitationDto(record: FamilyMemberInvitationRecord): Record<string, unknown> {
  return {
    invitationId: record.invitationId,
    familyId: record.familyId,
    role: record.role,
    status: record.status,
    invitedByAccountId: record.invitedByAccountId,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    acceptedAt: record.acceptedAt?.toISOString() ?? null,
    expiredAt: record.expiredAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    acceptedByAccountId: record.acceptedByAccountId,
  };
}

function errorStatus(code: FamilyMemberInvitationError['code']): number {
  switch (code) {
    case 'INVALID_INPUT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'ALREADY_ACCEPTED':
    case 'REVOKED':
    case 'EXPIRED':
    case 'NOT_PENDING':
    case 'DUPLICATE_PENDING_INVITATION':
    case 'CAPACITY_EXCEEDED':
    case 'CANNOT_REMOVE_SELF':
    case 'CANNOT_REMOVE_OWNER':
      return 409;
    case 'NOT_AUTHORIZED':
      return 403;
    default:
      return 400;
  }
}

export function registerFamilyMemberRoutes(app: FastifyInstance, deps: FamilyMemberRoutesDeps): void {
  if (!deps.familyMemberInvitationService) return;
  const { parentAccountService, familyMemberInvitationService, deviceSessionService } = deps;

  async function familySession(request: FastifyRequest, reply: FastifyReply): Promise<{ accountId: string; familyId: string } | null> {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    try {
      const session = await parentAccountService.readSession(token);
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

  /** See this file's own header comment on actor-identity binding. */
  async function requireActorDevice(request: FastifyRequest, reply: FastifyReply, familyId: string): Promise<string | null> {
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
      await reply.code(401).send({ error: 'actor_device_session_required' });
      return null;
    }
    try {
      const identity = await deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), familyId);
      return identity.deviceId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) {
        await reply.code(401).send({ error: 'actor_device_session_invalid' });
        return null;
      }
      throw error;
    }
  }

  async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
    if (error instanceof FamilyMemberInvitationError) {
      await reply.code(errorStatus(error.code)).send({ error: error.code.toLowerCase() });
      return;
    }
    throw error;
  }

  // ---- Parent: list this family's member invitations (pending + terminal history) ----
  app.get('/api/parent/families/:familyId/members/invitations', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    const invitations = await familyMemberInvitationService.listInvitationsForFamily(session.familyId);
    return reply.code(200).send({ invitations: invitations.map(toInvitationDto) });
  });

  // ---- Parent: invite a new family member by email, with a role (never OWNER) ----
  app.post(
    '/api/parent/families/:familyId/members/invitations',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const body = request.body;
      if (!isPlainObject(body) || typeof body.invitedEmail !== 'string' || typeof body.role !== 'string' || !INVITED_ROLES.has(body.role)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const created = await familyMemberInvitationService.createInvitation({
          familyId: session.familyId,
          invitedEmail: body.invitedEmail,
          role: body.role as InvitedFamilyRole,
          invitedByAccountId: session.accountId,
          actorDeviceId,
        });
        return reply.code(201).send({ invitation: toInvitationDto(created) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: revoke a pending (or otherwise still-live) invitation ----
  app.post(
    '/api/parent/families/:familyId/members/invitations/:invitationId/revoke',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { invitationId } = request.params as { invitationId: string };
      try {
        const revoked = await familyMemberInvitationService.revokeInvitationForFamily(session.familyId, invitationId, actorDeviceId);
        return reply.code(200).send({ invitation: toInvitationDto(revoked) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: revise a still-PENDING invitation's offered role ----
  app.post(
    '/api/parent/families/:familyId/members/invitations/:invitationId/role',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { invitationId } = request.params as { invitationId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.role !== 'string' || !INVITED_ROLES.has(body.role)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const updated = await familyMemberInvitationService.changeInvitationRole(session.familyId, invitationId, body.role as InvitedFamilyRole, actorDeviceId);
        return reply.code(200).send({ invitation: toInvitationDto(updated) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: remove an already-ACCEPTED family member (never the Owner, never yourself) ----
  app.post(
    '/api/parent/families/:familyId/members/:accountId/remove',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { accountId } = request.params as { accountId: string };
      try {
        const result = await familyMemberInvitationService.removeMember(session.familyId, accountId, session.accountId, actorDeviceId);
        return reply.code(200).send({ removed: true, auditEventId: result.auditEventId });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Any authenticated parent account: accept an invitation addressed to them.
  // No familyId in this path (the acceptor may have no family, or a different one,
  // at the time they accept) -- the invitation record itself is the source of truth
  // for which family this joins. See this file's own header comment.
  app.post(
    '/api/parent/member-invitations/:invitationId/accept',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = readSessionCookie(request);
      if (token === null) return reply.code(401).send({ error: 'unauthorized' });
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      let accountId: string;
      try {
        const session = await parentAccountService.readSession(token);
        accountId = session.accountId;
      } catch (error) {
        if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
        throw error;
      }

      const { invitationId } = request.params as { invitationId: string };
      try {
        const accepted = await familyMemberInvitationService.acceptInvitation(invitationId, accountId);
        return reply.code(200).send({ invitation: toInvitationDto(accepted) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );
}
