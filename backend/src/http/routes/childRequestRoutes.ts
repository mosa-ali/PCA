/**
 * PCA-FR-130 ("Bonus Time"): the authenticated HTTP surface over
 * childrequests/ChildRequestService.ts + BonusGrantLedger.ts. Follows the
 * SAME session/CSRF conventions parentAccountRoutes.ts/removalDecisionRoutes.ts
 * already established. Parent decisions and direct grants use the authenticated
 * Parent account and family role; child devices submitting requests or
 * acknowledging application remain bound to their verified device-session
 * bearer token.
 *
 * NOT wired into main.ts/buildServer.ts risk note: it IS wired (see
 * buildServer.ts's registerChildRequestRoutes call) -- unlike
 * removalDecisionRoutes.ts's original state, this lane wires its own route
 * file immediately, reusing the SAME shared `ParentActionAuthorizationService`
 * instance (generic across every ParentOperation) main.ts already
 * constructs for Safe Zone/RemovalDecisionAuthority. Parent session actions
 * use the separate family-scoped account authorizer; device-authenticated
 * child submission and applied-report routes retain their existing checks.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_HEADER_NAME, csrfCookieName, parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import { ChildRequestError, type ChildRequestService } from '../../childrequests/ChildRequestService.js';
import type { ChildRequest, ChildRequestType, ParentDecisionOutcome } from '../../childrequests/types.js';
import type { BonusGrantLedger } from '../../childrequests/BonusGrantLedger.js';
import type { ChildProfileRegistryRepository } from '../../childprofiles/ChildProfileRegistryRepository.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { AppScope } from '../../schedule/types.js';
import {
  UnavailableChildProfileMembershipResolver,
  type ChildProfileMembershipResolver,
} from '../../childprofiles/ChildProfileMembershipResolver.js';

const MAX_BODY_BYTES = 8 * 1024;
const PARENT_READ_ROLES = new Set(['ADMINISTRATOR', 'VIEWER']);
const PARENT_ADMIN_ROLES = new Set(['ADMINISTRATOR']);

export interface ChildRequestRoutesDeps {
  parentAccountService: ParentAccountService;
  childRequestService: ChildRequestService;
  bonusGrantLedger: BonusGrantLedger;
  deviceSessionService: DeviceSessionService;
  /**
   * PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION: the `bonus-time/active-grants` (read) and
   * `bonus-time/grants/:grantId/revoke` (write) routes below read/mutate `bonusGrantLedger` directly
   * by a client-supplied `childProfileId`, WITHOUT going through ChildRequestService/
   * ParentActionAuthorizationService's own CHILD_PROFILE membership check (decide()/grantDirectly()
   * already get that check for free via their targetScope, so this is the ONLY place these two
   * ledger-touching routes independently need it). Defaults to the SAME fail-closed
   * UnavailableChildProfileMembershipResolver default ParentActionAuthorizationService itself uses --
   * forgetting to wire a real resolver denies these routes rather than silently reopening the
   * cross-family IDOR this closes. Production wires the SAME instance passed to the shared
   * ParentActionAuthorizationService (see main.ts), never a second independently-constructed one.
   */
  childProfileMembership?: ChildProfileMembershipResolver;
  /** Durable async membership proof for Parent-session targets and ledger reads/writes. */
  childProfileRegistryRepository?: Pick<ChildProfileRegistryRepository, 'resolveMembership'>;
  /** Same deterministic-clock convention as every other service in this codebase -- never read `Date.now()` inline, so revoke/active-grants stay as testable as decide() itself. */
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

const REQUEST_TYPES: ReadonlySet<string> = new Set(['BONUS_TIME', 'UNBLOCK', 'SCHEDULE_EXCEPTION', 'POLICY_EXCEPTION', 'INSTALL_APPROVAL']);
const INSTALL_CAPABILITY_STATES: ReadonlySet<string> = new Set(['ENFORCED', 'REQUEST_ONLY', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED', 'PLATFORM_LIMITED']);
const DECISIONS: ReadonlySet<string> = new Set(['APPROVED', 'DENIED', 'COUNTERED']);

function parseAppScope(value: unknown): AppScope | null | undefined {
  if (value === 'ALL') return 'ALL';
  if (isPlainObject(value) && Array.isArray(value.apps) && value.apps.every((a) => typeof a === 'string')) {
    return { apps: value.apps as string[] };
  }
  return undefined;
}

function toRequestDto(request: ChildRequest, includeParentActorFields = false): Record<string, unknown> {
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
    createdByParentAccountId: includeParentActorFields ? request.createdByParentAccountId : null,
    decidedByAccountId: includeParentActorFields ? request.decidedByAccountId : null,
    decisionActionId: request.decisionActionId,
    correlationId: request.correlationId,
    reasonNote: request.reasonNote,
    requestedExtraMinutes: request.requestedExtraMinutes,
    requestedAppScope: request.requestedAppScope,
    grantedExtraMinutes: request.grantedExtraMinutes,
    grantExpiresAtUtc: request.grantExpiresAtUtc?.toISOString() ?? null,
    installTargetPackageName: request.installTargetPackageName,
    installTargetAppLabel: request.installTargetAppLabel,
    installCapabilityState: request.installCapabilityState,
    installEnforcementOutcome: request.installEnforcementOutcome,
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
      return 403;
    default:
      return 400;
  }
}

export function registerChildRequestRoutes(app: FastifyInstance, deps: ChildRequestRoutesDeps): void {
  const { parentAccountService, childRequestService, bonusGrantLedger, deviceSessionService } = deps;
  const childProfileMembership = deps.childProfileMembership ?? new UnavailableChildProfileMembershipResolver();
  const childProfileRegistryRepository = deps.childProfileRegistryRepository;
  const now = deps.now ?? (() => new Date());

  /** Every non-member/not-found/unavailable outcome maps to the same public denial. */
  async function childProfileInFamily(familyId: string, childProfileId: string): Promise<boolean> {
    try {
      if (childProfileRegistryRepository) {
        return (await childProfileRegistryRepository.resolveMembership(familyId, childProfileId)) === 'MEMBER';
      }
      return childProfileMembership.resolveMembership(familyId, childProfileId).status === 'MEMBER_OF_FAMILY';
    } catch {
      return false;
    }
  }

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

  async function requireParentRole(session: { accountId: string; familyId: string }, reply: FastifyReply, allowed: ReadonlySet<string>): Promise<boolean> {
    const role = await parentAccountService.activeFamilyRole(session.accountId as never, session.familyId);
    if (!role || !allowed.has(role)) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
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

      // PCA-FR-131: an INSTALL_APPROVAL submission carries the target package/app label plus the
      // reporting device's OWN honest capability snapshot -- shape-checked here (all three
      // required except the label, per createDraft's own doc comment); the actual bound/enum
      // validation still happens inside createDraft, never trusted from this HTTP layer alone.
      const installTargetPackageName = requestType === 'INSTALL_APPROVAL' ? body.installTargetPackageName : undefined;
      const installTargetAppLabel = requestType === 'INSTALL_APPROVAL' ? body.installTargetAppLabel : undefined;
      const installCapabilityState = requestType === 'INSTALL_APPROVAL' ? body.installCapabilityState : undefined;
      if (
        requestType === 'INSTALL_APPROVAL' &&
        (typeof installTargetPackageName !== 'string' ||
          (installTargetAppLabel !== undefined && installTargetAppLabel !== null && typeof installTargetAppLabel !== 'string') ||
          typeof installCapabilityState !== 'string' ||
          !INSTALL_CAPABILITY_STATES.has(installCapabilityState))
      ) {
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
          requestType === 'INSTALL_APPROVAL' ? (installTargetPackageName as string) : null,
          requestType === 'INSTALL_APPROVAL' ? ((installTargetAppLabel as string | null | undefined) ?? null) : null,
          requestType === 'INSTALL_APPROVAL' ? (installCapabilityState as ChildRequest['installCapabilityState']) : null,
        );
        const pending = await childRequestService.submit(draft);
        return reply.code(201).send({ request: toRequestDto(pending) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Child device: honestly report what happened when it applied a decided request (PCA-FR-131:
  // the ONLY route that ever writes `installEnforcementOutcome` -- distinct from, and always AFTER,
  // the parent's own /decide call above, so "approved" and "enforced" are never the same write).
  // Same actor-device-bound-by-bearer-token authentication as the submit route above; a request can
  // only ever be acknowledged by the SAME child device that originally submitted it
  // (ChildRequestService.acknowledgeApplied's own requester check, which reports a foreign device as NOT_FOUND -- indistinguishable from an unknown requestId).
  app.post(
    '/api/families/:familyId/child-requests/:requestId/applied',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, requestId } = request.params as { familyId: string; requestId: string };
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
      const capabilityOutcome = isPlainObject(body) ? body.capabilityOutcome : undefined;
      if (capabilityOutcome !== undefined && capabilityOutcome !== null && typeof capabilityOutcome !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const acknowledged = await childRequestService.acknowledgeApplied(
          requestId,
          childIdentity.deviceId,
          (capabilityOutcome as ChildRequest['installEnforcementOutcome'] | undefined) ?? null,
        );
        return reply.code(200).send({ request: toRequestDto(acknowledged) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // ---- Parent: list requests for the family ----
  app.get('/api/parent/families/:familyId/child-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await requireParentRole(session, reply, PARENT_READ_ROLES))) return;
    const requests = await childRequestService.listForFamily(session.familyId);
    return reply.code(200).send({ requests: requests.map((request) => toRequestDto(request, true)) });
  });

  // ---- Parent: approve / deny / counter-offer a pending request ----
  app.post(
    '/api/parent/families/:familyId/child-requests/:requestId/decide',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!(await requireParentRole(session, reply, PARENT_ADMIN_ROLES))) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
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
        const decided = await childRequestService.decideAsParent(
          requestId,
          session.familyId,
          session.accountId,
          body.decision as ParentDecisionOutcome,
          randomUUID(),
          randomUUID(),
          counterOfferExtraMinutes as number | undefined,
        );
        const grant = childRequestService.toBonusGrant(decided);
        if (grant !== null) {
          bonusGrantLedger.record((decided.targetScope as { kind: string; id: string }).id, grant, grant.grantedAtUtc);
        }
        return reply.code(200).send({ request: toRequestDto(decided, true) });
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
      if (!(await requireParentRole(session, reply, PARENT_ADMIN_ROLES))) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const body = request.body;
      if (!isPlainObject(body) || typeof body.childProfileId !== 'string' || typeof body.extraMinutes !== 'number') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const appScope = parseAppScope(body.appScope ?? 'ALL');
      if (appScope === undefined || appScope === null) return reply.code(400).send({ error: 'invalid_request' });

      try {
        const decided = await childRequestService.grantDirectlyAsParent(
          session.familyId,
          null,
          null,
          { kind: 'CHILD_PROFILE', id: body.childProfileId },
          body.extraMinutes,
          appScope,
          session.accountId,
          randomUUID(),
          randomUUID(),
          typeof body.reasonNote === 'string' ? body.reasonNote : null,
        );
        const grant = childRequestService.toBonusGrant(decided);
        if (grant !== null) bonusGrantLedger.record(body.childProfileId, grant, grant.grantedAtUtc);
        return reply.code(201).send({ request: toRequestDto(decided, true) });
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
      if (!(await requireParentRole(session, reply, PARENT_ADMIN_ROLES))) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const { grantId } = request.params as { grantId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.childProfileId !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!(await childProfileInFamily(session.familyId, body.childProfileId))) {
        return reply.code(403).send({ error: 'family_scope_forbidden' });
      }
      const revoked = bonusGrantLedger.revoke(body.childProfileId, grantId, now(), session.accountId);
      if (!revoked) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ revoked: true });
    },
  );

  // ---- Parent: currently-active bonus grants for one child ----
  app.get('/api/parent/families/:familyId/bonus-time/active-grants', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await requireParentRole(session, reply, PARENT_READ_ROLES))) return;
    const { childProfileId } = request.query as { childProfileId?: string };
    if (typeof childProfileId !== 'string' || childProfileId.length === 0) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    if (!(await childProfileInFamily(session.familyId, childProfileId))) {
      return reply.code(403).send({ error: 'family_scope_forbidden' });
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
