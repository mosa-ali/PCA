/**
 * PCA-FR-130 ("Bonus Time"): the authenticated HTTP surface over
 * childrequests/ChildRequestService.ts + BonusGrantLedger.ts. Follows the
 * SAME session/CSRF conventions parentAccountRoutes.ts/removalDecisionRoutes.ts
 * already established (HttpOnly family session cookie + double-submit CSRF
 * cookie for state-changing parent requests) and the SAME actor-device-
 * binding pattern parentAccountRoutes.ts's Safe Zone routes use
 * (`authorizeSafeZoneRequest`'s doc comment): `actorDeviceId` for every
 * parent decision is derived EXCLUSIVELY from a verified
 * `DeviceSessionService` session token presented as `Authorization: Bearer
 * <token>`, never trusted from a client-supplied field. A child device
 * submitting its own request authenticates the SAME way (its own device
 * session bearer token) -- this route file never invents a second device
 * authentication transport.
 *
 * NOT wired into main.ts/buildServer.ts risk note: it IS wired (see
 * buildServer.ts's registerChildRequestRoutes call) -- unlike
 * removalDecisionRoutes.ts's original state, this lane wires its own route
 * file immediately, reusing the SAME shared `ParentActionAuthorizationService`
 * instance (generic across every ParentOperation) main.ts already
 * constructs for Safe Zone/RemovalDecisionAuthority. Production currently
 * wires `UnavailableTrustSetRoleResolver` under that shared service (see
 * main.ts's own doc comment on `trustSetRoleResolver`), so every decide/
 * grant call here fails closed with NOT_AUTHORIZED_TO_DECIDE until a real
 * trust-set source is wired -- exactly the same honest, visible,
 * fail-closed posture as every other consumer of that shared instance.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { ChildRequestError, type ChildRequestService } from '../../childrequests/ChildRequestService.js';
import type { ChildRequest, ChildRequestType, ParentDecisionOutcome } from '../../childrequests/types.js';
import type { BonusGrantLedger } from '../../childrequests/BonusGrantLedger.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { AppScope } from '../../schedule/types.js';

const MAX_BODY_BYTES = 8 * 1024;

/** See the `bonus-time/grant` route's own comment: a proactive parent-initiated grant has no real originating child device. */
const NO_CHILD_DEVICE_SENTINEL = 'PARENT_INITIATED_NO_CHILD_DEVICE';

export interface ChildRequestRoutesDeps {
  parentAccountService: ParentAccountService;
  childRequestService: ChildRequestService;
  bonusGrantLedger: BonusGrantLedger;
  deviceSessionService: DeviceSessionService;
  /** Same deterministic-clock convention as every other service in this codebase -- never read `Date.now()` inline, so revoke/active-grants stay as testable as decide() itself. */
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

const REQUEST_TYPES: ReadonlySet<string> = new Set(['BONUS_TIME', 'UNBLOCK', 'SCHEDULE_EXCEPTION', 'POLICY_EXCEPTION']);
const DECISIONS: ReadonlySet<string> = new Set(['APPROVED', 'DENIED', 'COUNTERED']);

function parseAppScope(value: unknown): AppScope | null | undefined {
  if (value === 'ALL') return 'ALL';
  if (isPlainObject(value) && Array.isArray(value.apps) && value.apps.every((a) => typeof a === 'string')) {
    return { apps: value.apps as string[] };
  }
  return undefined;
}

function toRequestDto(request: ChildRequest): Record<string, unknown> {
  return {
    requestId: request.requestId,
    familyId: request.familyId,
    childDeviceId: request.childDeviceId,
    childMemberId: request.childMemberId,
    requestType: request.requestType,
    targetScope: request.targetScope,
    state: request.state,
    requestedAt: request.requestedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decidedByDeviceId: request.decidedByDeviceId,
    decisionActionId: request.decisionActionId,
    correlationId: request.correlationId,
    reasonNote: request.reasonNote,
    requestedExtraMinutes: request.requestedExtraMinutes,
    requestedAppScope: request.requestedAppScope,
    grantedExtraMinutes: request.grantedExtraMinutes,
    grantExpiresAtUtc: request.grantExpiresAtUtc?.toISOString() ?? null,
  };
}

function errorStatus(code: ChildRequestError['code']): number {
  switch (code) {
    case 'INVALID_INPUT':
    case 'BONUS_MINUTES_OUT_OF_BOUND':
    case 'COUNTER_OFFER_NOT_SHORTER':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'ILLEGAL_TRANSITION':
    case 'REQUEST_EXPIRED':
      return 409;
    case 'NOT_AUTHORIZED_TO_DECIDE':
    case 'NOT_THE_REQUESTER':
      return 403;
    default:
      return 400;
  }
}

export function registerChildRequestRoutes(app: FastifyInstance, deps: ChildRequestRoutesDeps): void {
  const { parentAccountService, childRequestService, bonusGrantLedger, deviceSessionService } = deps;
  const now = deps.now ?? (() => new Date());

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

  /**
   * SECURITY (actor-identity binding): see this file's own header comment
   * and parentAccountRoutes.ts's `authorizeSafeZoneRequest` doc comment for
   * the full rationale -- `actorDeviceId` is derived EXCLUSIVELY from a
   * verified device-session bearer token scoped to the caller's own already
   * cookie-authenticated family, never from any client-supplied device id
   * field.
   */
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
    if (error instanceof ChildRequestError) {
      await reply.code(errorStatus(error.code)).send({ error: error.code.toLowerCase() });
      return;
    }
    throw error;
  }

  // ---- Child device: submit a request (BONUS_TIME or any of the other three existing kinds) ----
  app.post(
    '/api/families/:familyId/child-requests',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const authorizationHeader = request.headers.authorization;
      if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      let childIdentity: { deviceId: string; familyId: string };
      try {
        childIdentity = await deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), familyId);
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'unauthorized' });
        throw error;
      }

      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { requestType, childProfileId, reasonNote } = body;
      if (typeof requestType !== 'string' || !REQUEST_TYPES.has(requestType) || typeof childProfileId !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const requestedAppScope = requestType === 'BONUS_TIME' ? parseAppScope(body.requestedAppScope) : undefined;
      if (requestType === 'BONUS_TIME' && (requestedAppScope === undefined || requestedAppScope === null)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const requestedExtraMinutes = requestType === 'BONUS_TIME' ? body.requestedExtraMinutes : undefined;
      if (requestType === 'BONUS_TIME' && typeof requestedExtraMinutes !== 'number') {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const draft = childRequestService.createDraft(
          familyId,
          childIdentity.deviceId,
          null,
          requestType as ChildRequestType,
          { kind: 'CHILD_PROFILE', id: childProfileId },
          typeof reasonNote === 'string' ? reasonNote : null,
          requestType === 'BONUS_TIME' ? (requestedExtraMinutes as number) : null,
          requestType === 'BONUS_TIME' ? (requestedAppScope as AppScope) : null,
        );
        const pending = await childRequestService.submit(draft);
        return reply.code(201).send({ request: toRequestDto(pending) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: list requests for the family ----
  app.get('/api/parent/families/:familyId/child-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    const requests = await childRequestService.listForFamily(session.familyId);
    return reply.code(200).send({ requests: requests.map(toRequestDto) });
  });

  // ---- Parent: approve / deny / counter-offer a pending request ----
  app.post(
    '/api/parent/families/:familyId/child-requests/:requestId/decide',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { requestId } = request.params as { requestId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.decision !== 'string' || !DECISIONS.has(body.decision)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const counterOfferExtraMinutes = body.decision === 'COUNTERED' ? body.counterOfferExtraMinutes : undefined;
      if (body.decision === 'COUNTERED' && typeof counterOfferExtraMinutes !== 'number') {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const decided = await childRequestService.decide(
          requestId,
          actorDeviceId,
          body.decision as ParentDecisionOutcome,
          randomUUID(),
          randomUUID(),
          counterOfferExtraMinutes as number | undefined,
        );
        const grant = childRequestService.toBonusGrant(decided);
        if (grant !== null) {
          bonusGrantLedger.record((decided.targetScope as { kind: string; id: string }).id, grant, grant.grantedAtUtc);
        }
        return reply.code(200).send({ request: toRequestDto(decided) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: grant bonus time directly (proactive, no pending child request) ----
  app.post(
    '/api/parent/families/:familyId/bonus-time/grant',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const body = request.body;
      if (!isPlainObject(body) || typeof body.childProfileId !== 'string' || typeof body.extraMinutes !== 'number') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const appScope = parseAppScope(body.appScope ?? 'ALL');
      if (appScope === undefined || appScope === null) return reply.code(400).send({ error: 'invalid_request' });

      try {
        const decided = await childRequestService.grantDirectly(
          session.familyId,
          // No originating child DEVICE exists for a proactive grant (only a
          // childProfileId, which may have several devices) -- using the
          // GRANTING PARENT's own actorDeviceId here would misrepresent the
          // audit trail as if the parent's own device had submitted a child
          // request to itself. An honestly-named sentinel instead.
          NO_CHILD_DEVICE_SENTINEL,
          null,
          { kind: 'CHILD_PROFILE', id: body.childProfileId },
          body.extraMinutes,
          appScope,
          actorDeviceId,
          randomUUID(),
          randomUUID(),
          typeof body.reasonNote === 'string' ? body.reasonNote : null,
        );
        const grant = childRequestService.toBonusGrant(decided);
        if (grant !== null) bonusGrantLedger.record(body.childProfileId, grant, grant.grantedAtUtc);
        return reply.code(201).send({ request: toRequestDto(decided) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: revoke an active bonus grant before it expires ----
  app.post(
    '/api/parent/families/:familyId/bonus-time/grants/:grantId/revoke',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { grantId } = request.params as { grantId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.childProfileId !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const revoked = bonusGrantLedger.revoke(body.childProfileId, grantId, now());
      if (!revoked) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ revoked: true });
    },
  );

  // ---- Parent: currently-active bonus grants for one child ----
  app.get('/api/parent/families/:familyId/bonus-time/active-grants', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    const { childProfileId } = request.query as { childProfileId?: string };
    if (typeof childProfileId !== 'string' || childProfileId.length === 0) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const active = bonusGrantLedger.listActive(childProfileId, now());
    return reply.code(200).send({
      grants: active.map((g) => ({
        id: g.id,
        appScope: g.appScope,
        extraMinutes: g.extraMinutes,
        grantedAtUtc: g.grantedAtUtc.toISOString(),
        expiresAtUtc: g.expiresAtUtc.toISOString(),
      })),
    });
  });
}
