/**
 * PCA product-completion programme, Writer P0-B: screen-time + apps policy
 * writes. Per docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
 * POLICY_WRITE_AUTHORITY section, this is a thin pre-check in front of the
 * existing envelope relay -- NOT a new plaintext policy store. This file
 * follows the SAME session/CSRF/actor-device-binding conventions
 * childRequestRoutes.ts and parentAccountRoutes.ts's Safe Zone routes
 * already established (see either file's own header comment for the full
 * rationale): `actorDeviceId` is derived EXCLUSIVELY from a verified
 * DeviceSessionService session token presented as `Authorization: Bearer
 * <token>`, never a client-supplied field.
 *
 * The request body is an OPAQUE, already-encrypted envelope
 * (ciphertextB64/nonceB64/keyEpoch) plus a recipientDeviceId the CALLING
 * PARENT BROWSER supplies -- this route never parses or validates policy
 * content, exactly like parentAccountRoutes.ts's Safe Zone routes never
 * parse coordinates. recipientDeviceId is deliberately client-supplied
 * (not resolved server-side from childProfileId) because this schema has
 * no child-profile-to-device mapping anywhere (checked: devices/
 * DeviceRepository carry no child_profile_id column, and
 * ChildProfileMembershipResolver's own doc comment says a readable
 * central child-profile directory is deliberately out of scope) -- the
 * parent browser is the party that holds decrypted family state and
 * therefore knows which device(s) belong to which child. OutboundRelayService.submitBatch
 * independently verifies recipientDeviceId resolves to a real device in
 * the CALLER's own family (CROSS_FAMILY_RECIPIENT otherwise), so a
 * spoofed or foreign recipientDeviceId is rejected regardless of what the
 * childProfileId authorization pre-check above it decided.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { ParentActionAuthorizationService } from '../../familyrbac/ParentActionAuthorizationService.js';
import type { OutboundRelayService } from '../../runtime-sync/OutboundRelayService.js';

const MAX_BODY_BYTES = 96 * 1024; // matches parentAccountRoutes.ts's MAX_SAFE_ZONE_BODY_BYTES order of magnitude
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export interface ChildPolicyRoutesDeps {
  parentAccountService: ParentAccountService;
  deviceSessionService: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- omitting it fails the route closed with 503 (matching parentAccountRoutes.ts's Safe Zone `not_configured` convention), never a silent allow. */
  parentActionAuthorization?: Pick<ParentActionAuthorizationService, 'authorize'>;
  outboundRelayService: Pick<OutboundRelayService, 'submitBatch'>;
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

function validOpaqueBase64(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= 2 && value.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(value);
}

interface SchedulePolicyBody {
  recipientDeviceId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
}

function validSchedulePolicyBody(body: unknown): body is SchedulePolicyBody {
  if (!isPlainObject(body)) return false;
  return (
    typeof body.recipientDeviceId === 'string' && OPAQUE_TOKEN.test(body.recipientDeviceId) &&
    validOpaqueBase64(body.ciphertextB64, 87380) &&
    validOpaqueBase64(body.nonceB64, 88) &&
    typeof body.keyEpoch === 'number' && Number.isInteger(body.keyEpoch) && body.keyEpoch > 0
  );
}

export function registerChildPolicyRoutes(app: FastifyInstance, deps: ChildPolicyRoutesDeps): void {
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

  /** Same actor-identity-binding rationale as childRequestRoutes.ts's requireActorDevice -- see this file's own header comment. */
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

  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/schedule-policy',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!deps.parentActionAuthorization) return reply.code(503).send({ error: 'not_configured' });
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!validSchedulePolicyBody(request.body)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const body = request.body;

      // TRUE authority is the receiving device's own signed-envelope
      // verification against its own trust set -- this call is a pre-check
      // only (ParentActionAuthorizationService's own doc comment). While
      // UnavailableTrustSetRoleResolver is wired in production this always
      // denies honestly rather than allowing a plaintext-blind server ACL
      // to stand in for real family authority.
      const issuedAt = now();
      const decision = await deps.parentActionAuthorization.authorize({
        familyId: session.familyId,
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
        return reply.code(403).send({ error: 'forbidden' });
      }

      const messageId = randomUUID();
      const result = await deps.outboundRelayService.submitBatch(actorDeviceId, session.familyId, [
        {
          messageId,
          recipientDeviceId: body.recipientDeviceId,
          ciphertext: Buffer.from(body.ciphertextB64, 'base64url'),
          messageType: 'SCHEDULE_POLICY_V1',
          enqueuedAtEpochMillis: issuedAt.getTime(),
        },
      ]);
      const outcome = result.results[0]?.outcome;
      if (outcome === 'CROSS_FAMILY_RECIPIENT' || outcome === 'INVALID') {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }
      if (outcome === 'CONFLICT') {
        return reply.code(409).send({ error: 'conflict' });
      }
      // QUEUED, or dropped for batch bound (a single-item batch never hits
      // the bound, but the honest response follows OutboundBatchResult's
      // own contract regardless) -- either way this is PENDING, never
      // DELIVERED/APPLIED (see PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
      // PENDING/DELIVERED/APPLIED_SEMANTICS section).
      return reply.code(202).send({ status: 'PENDING', messageId });
    },
  );
}
