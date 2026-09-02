/**
 * WEB_RULE parent-authoring HTTP surface, over the existing
 * web/WebRuleStore.ts's WebRuleService. Follows the SAME session/CSRF/
 * actor-device-binding conventions childPolicyRoutes.ts and
 * eyeProtectionRoutes.ts already established (see either file's own header
 * comment for the full rationale): `actorDeviceId` for a mutating route is
 * derived EXCLUSIVELY from a verified DeviceSessionService session token
 * presented as `Authorization: Bearer <token>`, never a client-supplied
 * field. Authorization reuses the SAME EDIT_CHILD_POLICY ParentOperation
 * and CHILD_PROFILE targetScope pre-check those routes already establish
 * for per-child settings mutations (see ParentActionAuthorizationService's
 * own doc comment: this is an advisory pre-check, not the final authority).
 *
 * Unlike childPolicyRoutes.ts's schedule-policy route, a parent-authored
 * web allow/deny rule is a plain, non-E2EE RULE DEFINITION -- exactly like
 * eyeProtectionRoutes.ts's reminders-enabled setting -- so this file never
 * parses or relays an opaque encrypted envelope: it reads/writes the
 * canonical (domain, listType) rule directly through WebRuleService, which
 * already stores it in a real, tested, family-scoped repository
 * (WebRuleStore.ts's own doc comment: "Only a deterministic in-memory
 * implementation exists today -- MySQL persistence is a later slice").
 * WebFilterEngine already consumes this SAME repository for the live
 * domain-decision pipeline (doc 14), so storing the definition here is not
 * a new plaintext exposure -- it is the identical store the read/decision
 * path already safely uses.
 *
 * What this route does NOT do: it never attempts to push the resulting
 * rule set down to a child device for offline VPN/DNS enforcement -- that
 * delivery step still requires the SAME production family-envelope crypto
 * suite gating items D/E/G (see docs/pre-production/PCA_PARTIAL_INTENTIONAL_REGISTER.csv
 * row G). A successful write here is honestly reported by the caller as
 * "stored, delivery pending" (WebRuleDeliveryStatus.PENDING_DELIVERY on the
 * parent-web side), never as DELIVERED/APPLIED.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { ParentActionAuthorizationService } from '../../familyrbac/ParentActionAuthorizationService.js';
import { WebRuleError, type WebRuleService } from '../../web/WebRuleStore.js';
import type { WebRule, WebRuleListType } from '../../web/types.js';

const MAX_BODY_BYTES = 2048;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DOMAIN_INPUT_LENGTH = 2048; // generous raw-input ceiling; WebRuleService.canonicalizeDomain enforces the real RFC 1035 shape/length

export interface WebRuleRoutesDeps {
  parentAccountService: ParentAccountService;
  deviceSessionService: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- omitting it fails the route closed with 503 (matching childPolicyRoutes.ts's own `not_configured` convention), never a silent allow. */
  parentActionAuthorization?: Pick<ParentActionAuthorizationService, 'authorize'>;
  webRuleService?: Pick<WebRuleService, 'setParentRule' | 'removeParentRule' | 'listParentRules'>;
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

function isValidListType(value: unknown): value is WebRuleListType {
  return value === 'ALLOW' || value === 'DENY';
}

function toRuleDto(rule: WebRule): Record<string, unknown> {
  return { domain: rule.domain, listType: rule.listType, createdAtUtc: rule.createdAt.toISOString() };
}

export function registerWebRuleRoutes(app: FastifyInstance, deps: WebRuleRoutesDeps): void {
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

  async function authorizeEditChildPolicy(
    reply: FastifyReply,
    familyId: string,
    actorDeviceId: string,
    childProfileId: string,
  ): Promise<boolean> {
    if (!deps.parentActionAuthorization) {
      await reply.code(503).send({ error: 'not_configured' });
      return false;
    }
    const now = deps.now ?? (() => new Date());
    const issuedAt = now();
    const decision = await deps.parentActionAuthorization.authorize({
      familyId,
      actorDeviceId,
      operation: 'EDIT_CHILD_POLICY',
      targetScope: { kind: 'CHILD_PROFILE', id: childProfileId },
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 60_000),
      stepUp: null,
      idempotencyKey: randomUUID(),
      actionId: randomUUID(),
    });
    if (decision.verdict !== 'ALLOW') {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  // ---- Parent: current parent-authored allow/deny rules for the family ----
  app.get(
    '/api/parent/families/:familyId/children/:childProfileId/web-rules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.webRuleService) return reply.code(503).send({ error: 'not_configured' });
      const session = await familySession(request, reply);
      if (!session) return;

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const rules = await deps.webRuleService.listParentRules(session.familyId);
      return reply.code(200).send({ rules: rules.map(toRuleDto) });
    },
  );

  // ---- Parent: add/replace one allow/deny rule ----
  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/web-rules',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.webRuleService) return reply.code(503).send({ error: 'not_configured' });
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
      if (
        !isPlainObject(body) ||
        typeof body.domain !== 'string' ||
        body.domain.length === 0 ||
        body.domain.length > MAX_DOMAIN_INPUT_LENGTH ||
        !isValidListType(body.listType)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      if (!(await authorizeEditChildPolicy(reply, session.familyId, actorDeviceId, childProfileId))) return;

      try {
        const source = body.listType === 'ALLOW' ? 'PARENT_ALLOWLIST' : 'PARENT_DENYLIST';
        await deps.webRuleService.setParentRule(session.familyId, body.domain, body.listType, source);
        const rules = await deps.webRuleService.listParentRules(session.familyId);
        return reply.code(200).send({ rules: rules.map(toRuleDto) });
      } catch (error) {
        if (error instanceof WebRuleError) {
          return reply.code(400).send({ error: 'invalid_request', reason: error.code });
        }
        throw error;
      }
    },
  );

  // ---- Parent: remove one allow/deny rule ----
  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/web-rules/remove',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.webRuleService) return reply.code(503).send({ error: 'not_configured' });
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
      if (
        !isPlainObject(body) ||
        typeof body.domain !== 'string' ||
        body.domain.length === 0 ||
        body.domain.length > MAX_DOMAIN_INPUT_LENGTH ||
        !isValidListType(body.listType)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      if (!(await authorizeEditChildPolicy(reply, session.familyId, actorDeviceId, childProfileId))) return;

      try {
        await deps.webRuleService.removeParentRule(session.familyId, body.domain, body.listType);
        const rules = await deps.webRuleService.listParentRules(session.familyId);
        return reply.code(200).send({ rules: rules.map(toRuleDto) });
      } catch (error) {
        if (error instanceof WebRuleError) {
          return reply.code(400).send({ error: 'invalid_request', reason: error.code });
        }
        throw error;
      }
    },
  );
}
