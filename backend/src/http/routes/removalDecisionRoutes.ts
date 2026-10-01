/**
 * PCA-ADD-ENR-012/016/017/018/020: the authenticated HTTP surface for the
 * consolidated `RemovalDecisionAuthority` (see
 * ../../familyrbac/RemovalDecisionAuthority.ts for the full design note).
 *
 * This file is new -- neither of the two prior services
 * (enrollment/ProtectionApprovalService.ts, familyrbac/RemovalDecisionService.ts)
 * ever had an HTTP route. It follows the SAME session/CSRF conventions
 * parentAccountRoutes.ts already established (HttpOnly session cookie +
 * double-submit CSRF cookie for state-changing requests) rather than
 * inventing a second auth transport, but is kept in its own file per this
 * lane's file-ownership boundary.
 *
 * Production composition is provided by main.ts/buildServer.ts; this route
 * owns only authenticated transport and delegates authority to its services.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import {
  CSRF_HEADER_NAME,
  csrfCookieName,
  parseCookies,
  sessionCookieName,
} from '../../parentaccount/cookies.js';
import {
  RemovalDecisionError,
  type RemovalDecisionAuthority,
  type RemovalDecisionOperation,
  type RemovalDecisionRecord,
  type RemovalProtectionLevel,
  type SignedRemovalDecision,
} from '../../familyrbac/RemovalDecisionAuthority.js';
import type { ReasonCategory, StepUpAssertion } from '../../familyrbac/types.js';
import { AdministrationPinError, type AdministrationPinService } from '../../enrollment/AdministrationPinService.js';
import type { SensitiveParentStepUpOperation } from '../../parentaccount/mfa/ParentMfaRepository.js';
import type { RemovalTargetResolver } from '../../familyrbac/RemovalTargetResolver.js';

const MAX_BODY_BYTES = 8 * 1024;
const PARENT_READ_ROLES: ReadonlySet<string> = new Set(['ADMINISTRATOR', 'VIEWER']);

/**
 * Resolves whether protective authority currently applies to the target
 * child/device before a removal/disable request is allowed to be created
 * (PCA-ADD-ENR-016). This is a deliberately narrow, coordinator-owned
 * binding to the device's actual platform-authority state (doc
 * 08_ENROLLMENT_DEVICE_LIFECYCLE.md Section 8/PCA-FR-145) -- this route
 * file never resolves or asserts that state itself.
 */
export interface RemovalDecisionRoutesDeps {
  parentAccountService: ParentAccountService;
  removalDecisionAuthority: RemovalDecisionAuthority;
  removalTargetResolver?: Pick<RemovalTargetResolver, 'resolveForRemoval'>;
  /** PCA-ADD-ENR-012: family-scoped offline Administration PIN status/configuration. */
  administrationPinService?: AdministrationPinService;
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

function toRecordDto(record: RemovalDecisionRecord): Record<string, unknown> {
  return {
    requestId: record.requestId,
    familyId: record.familyId,
    childId: record.childId,
    deviceId: record.deviceId,
    operation: record.operation,
    protectionLevel: record.protectionLevel,
    requestedAt: record.requestedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    reasonCategory: record.reasonCategory,
    state: record.state,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    decisionMethod: record.decisionMethod,
    temporaryDisableUntil: record.temporaryDisableUntil?.toISOString() ?? null,
  };
}

function errorStatus(code: RemovalDecisionError['code']): number {
  switch (code) {
    case 'INVALID_INPUT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'CONFLICT':
      return 409;
    case 'ACTION_EXPIRED':
    case 'EXPIRED':
    case 'INVALID_STATE':
      return 409;
    case 'INVALID_SIGNATURE':
    case 'NOT_AUTHORIZED':
    case 'REPLAYED_ACTION':
    case 'PIN_NOT_CONFIGURED':
    case 'PIN_INVALID':
      return 403;
    default:
      return 400;
  }
}

const OPERATIONS: ReadonlySet<string> = new Set(['REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY']);
const PROTECTION_LEVELS: ReadonlySet<string> = new Set(['STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED']);
const REASON_CATEGORIES: ReadonlySet<string> = new Set([
  'ROUTINE_POLICY_CHANGE',
  'CHILD_SAFETY_CONCERN',
  'DEVICE_LOST_OR_STOLEN',
  'FAMILY_MEMBERSHIP_CHANGE',
  'RECOVERY',
  'OTHER',
]);
const DECISIONS: ReadonlySet<string> = new Set(['KEEP_ACTIVE', 'TEMPORARILY_DISABLE', 'ALLOW_REMOVAL']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseReasonCategory(value: unknown): ReasonCategory | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && REASON_CATEGORIES.has(value) ? (value as ReasonCategory) : undefined;
}

function parseDecisionBody(body: unknown): { decision: 'KEEP_ACTIVE' | 'TEMPORARILY_DISABLE' | 'ALLOW_REMOVAL'; temporaryDisableUntil: Date | null } | null {
  if (!isPlainObject(body) || typeof body.decision !== 'string' || !DECISIONS.has(body.decision)) return null;
  if (body.decision === 'TEMPORARILY_DISABLE') {
    const until = parseDate(body.temporaryDisableUntil);
    if (until === null) return null;
    return { decision: body.decision as 'TEMPORARILY_DISABLE', temporaryDisableUntil: until };
  }
  if (body.temporaryDisableUntil !== undefined && body.temporaryDisableUntil !== null) return null;
  return { decision: body.decision as 'KEEP_ACTIVE' | 'ALLOW_REMOVAL', temporaryDisableUntil: null };
}

function stepUpOperationForRemoval(operation: RemovalDecisionOperation): SensitiveParentStepUpOperation {
  switch (operation) {
    case 'REMOVE_REVOKE_DEVICE':
      return 'family.device.enrollment.revoke';
    case 'DISABLE_PROTECTION_POLICY':
      return 'family.security.settings.change';
  }
}

export function registerRemovalDecisionRoutes(app: FastifyInstance, deps: RemovalDecisionRoutesDeps): void {
  const { parentAccountService, removalDecisionAuthority } = deps;

  async function familySession(request: FastifyRequest, reply: FastifyReply): Promise<{ accountId: string; familyId: string; rawSessionToken: string } | null> {
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
      return { accountId: session.accountId, familyId: session.familyId, rawSessionToken: token };
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      throw error;
    }
  }

  async function requireActiveAdministrator(
    session: { accountId: string; familyId: string },
    reply: FastifyReply,
  ): Promise<boolean> {
    try {
      if (await parentAccountService.activeFamilyRole(session.accountId as never, session.familyId) === 'ADMINISTRATOR') {
        return true;
      }
    } catch {
      // A failed role lookup must never authorize a removal or PIN mutation.
    }
    await reply.code(403).send({ error: 'forbidden' });
    return false;
  }

  async function requireActiveParentReader(
    session: { accountId: string; familyId: string },
    reply: FastifyReply,
  ): Promise<boolean> {
    try {
      const role = await parentAccountService.activeFamilyRole(session.accountId as never, session.familyId);
      if (role !== null && PARENT_READ_ROLES.has(role)) return true;
    } catch {
      // A failed membership lookup must never disclose family removal or PIN state.
    }
    await reply.code(403).send({ error: 'forbidden' });
    return false;
  }

  async function consumeParentStepUp(
    session: { rawSessionToken: string; familyId: string },
    reply: FastifyReply,
    operation: SensitiveParentStepUpOperation,
    token: unknown,
  ): Promise<boolean> {
    if (
      typeof token !== 'string' ||
      !(await parentAccountService.consumeSensitiveStepUpForSession(session.rawSessionToken, session.familyId, operation, token))
    ) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
    if (error instanceof RemovalDecisionError) {
      await reply.code(errorStatus(error.code)).send({ error: error.code.toLowerCase() });
      return;
    }
    throw error;
  }

  app.get('/api/parent/families/:familyId/removal-decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await requireActiveParentReader(session, reply))) return;
    try {
      const records = await removalDecisionAuthority.listRequests(session.familyId);
      return reply.code(200).send({ removalDecisions: records.map(toRecordDto) });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/api/parent/families/:familyId/removal-decisions/:requestId', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await requireActiveParentReader(session, reply))) return;
    const { requestId } = request.params as { requestId: string };
    try {
      const record = await removalDecisionAuthority.getRequest(session.familyId, requestId);
      if (record === null) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ removalDecision: toRecordDto(record) });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post(
    '/api/parent/families/:familyId/removal-decisions',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!(await requireActiveAdministrator(session, reply))) return;
      if (!deps.removalTargetResolver) return reply.code(503).send({ error: 'not_configured' });

      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { requestId, deviceId, operation } = body;
      const requestedAt = parseDate(body.requestedAt);
      const expiresAt = parseDate(body.expiresAt);
      const reasonCategory = parseReasonCategory(body.reasonCategory);
      if (
        typeof requestId !== 'string' ||
        typeof deviceId !== 'string' ||
        typeof operation !== 'string' || !OPERATIONS.has(operation) ||
        requestedAt === null || expiresAt === null || reasonCategory === undefined
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      let target;
      try {
        target = await deps.removalTargetResolver.resolveForRemoval(session.familyId, deviceId);
      } catch {
        return reply.code(503).send({ error: 'not_configured' });
      }
      if (target.outcome !== 'RESOLVED') return reply.code(409).send({ error: 'protective_authority_not_applicable' });
      if (!(await consumeParentStepUp(session, reply, stepUpOperationForRemoval(operation as RemovalDecisionOperation), body.stepUpToken))) return;

      try {
        const record = await removalDecisionAuthority.createRequest({
          requestId,
          familyId: session.familyId,
          requestedByParentAccountId: session.accountId,
          childId: target.childProfileId,
          deviceId,
          operation: operation as RemovalDecisionOperation,
          protectionLevel: target.protectionLevel as RemovalProtectionLevel,
          requestedAt,
          expiresAt,
          reasonCategory,
          protectiveAuthorityApplies: true,
        });
        return reply.code(201).send({ removalDecision: toRecordDto(record) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  app.post(
    '/api/parent/families/:familyId/removal-decisions/:requestId/decide/local-pin',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!(await requireActiveAdministrator(session, reply))) return;
      const { requestId } = request.params as { requestId: string };
      const body = request.body;
      const decisionInput = parseDecisionBody(body);
      if (decisionInput === null || !isPlainObject(body) || typeof body.pin !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const storedRequest = await removalDecisionAuthority.getRequest(session.familyId, requestId);
      if (storedRequest === null) return reply.code(404).send({ error: 'not_found' });
      if (!(await consumeParentStepUp(session, reply, stepUpOperationForRemoval(storedRequest.operation), body.stepUpToken))) return;
      try {
        const record = await removalDecisionAuthority.decideWithLocalPin(requestId, session.familyId, {
          ...decisionInput,
          pin: body.pin,
        }, session.accountId);
        return reply.code(200).send({ removalDecision: toRecordDto(record) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  app.post(
    '/api/parent/families/:familyId/removal-decisions/:requestId/decide/authorized-recovery',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const { requestId } = request.params as { requestId: string };
      const body = request.body;
      const decisionInput = parseDecisionBody(body);
      if (
        decisionInput === null ||
        !isPlainObject(body) ||
        !isPlainObject(body.proof) ||
        typeof body.proof.proof !== 'string' ||
        typeof body.proof.recoveryTransactionId !== 'string'
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const record = await removalDecisionAuthority.decideWithAuthorizedRecovery(requestId, session.familyId, decisionInput, {
          proof: body.proof.proof,
          recoveryTransactionId: body.proof.recoveryTransactionId,
        }, session.accountId);
        return reply.code(200).send({ removalDecision: toRecordDto(record) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  // Signed remote-parent decisions are exact-request-bound and independently
  // RBAC/signature/anti-replay verified by RemovalDecisionAuthority itself;
  // this route's own job is limited to session/family-scope/CSRF plus input
  // shape, never to weaken or duplicate that verification.
  app.post(
    '/api/parent/families/:familyId/removal-decisions/:requestId/decide/signed',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      const { requestId } = request.params as { requestId: string };
      const body = request.body;
      if (!isPlainObject(body) || typeof body.signature !== 'string') return reply.code(400).send({ error: 'invalid_request' });

      const requestedAt = parseDate(body.issuedAt);
      const expiresAt = parseDate(body.expiresAt);
      const stepUpRaw = body.stepUp;
      if (
        typeof body.childId !== 'string' ||
        typeof body.deviceId !== 'string' ||
        typeof body.operation !== 'string' || !OPERATIONS.has(body.operation) ||
        typeof body.protectionLevel !== 'string' || !PROTECTION_LEVELS.has(body.protectionLevel) ||
        typeof body.decision !== 'string' || !DECISIONS.has(body.decision) ||
        typeof body.actorDeviceId !== 'string' ||
        typeof body.actionId !== 'string' ||
        typeof body.idempotencyKey !== 'string' ||
        typeof body.trustSetEpoch !== 'number' ||
        requestedAt === null || expiresAt === null ||
        !isPlainObject(stepUpRaw)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const temporaryDisableUntil = parseDate(body.temporaryDisableUntil);
      const stepUp: StepUpAssertion = {
        state: stepUpRaw.state as StepUpAssertion['state'],
        assertedAt: parseDate(stepUpRaw.assertedAt),
        freshUntil: parseDate(stepUpRaw.freshUntil),
      };
      const signedDecision: SignedRemovalDecision = {
        requestId,
        familyId: session.familyId,
        childId: body.childId,
        deviceId: body.deviceId,
        operation: body.operation as RemovalDecisionOperation,
        protectionLevel: body.protectionLevel as RemovalProtectionLevel,
        reasonCategory: (parseReasonCategory(body.reasonCategory) ?? null) as ReasonCategory | null,
        decision: body.decision as SignedRemovalDecision['decision'],
        temporaryDisableUntil: body.temporaryDisableUntil == null ? null : temporaryDisableUntil,
        actorDeviceId: body.actorDeviceId,
        actionId: body.actionId,
        idempotencyKey: body.idempotencyKey,
        trustSetEpoch: body.trustSetEpoch,
        policyRevision: typeof body.policyRevision === 'number' ? body.policyRevision : null,
        issuedAt: requestedAt,
        expiresAt,
        stepUp,
        signature: body.signature,
      };
      try {
        const record = await removalDecisionAuthority.decideWithSignedRemoteParent(signedDecision);
        return reply.code(200).send({ removalDecision: toRecordDto(record) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  const PIN_PATTERN = /^\d{6,64}$/;

  app.get('/api/parent/families/:familyId/administration-pin', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await requireActiveParentReader(session, reply))) return;
    if (!deps.administrationPinService) return reply.code(503).send({ error: 'not_configured' });
    try {
      const status = await deps.administrationPinService.getStatus(session.familyId);
      return reply.code(200).send({ pinStatus: status });
    } catch (error) {
      if (error instanceof AdministrationPinError) return reply.code(400).send({ error: error.code.toLowerCase() });
      throw error;
    }
  });

  app.post(
    '/api/parent/families/:familyId/administration-pin',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!(await requireActiveAdministrator(session, reply))) return;
      if (!deps.administrationPinService) return reply.code(503).send({ error: 'not_configured' });
      const body = request.body;
      if (!isPlainObject(body) || typeof body.pin !== 'string' || !PIN_PATTERN.test(body.pin)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!(await consumeParentStepUp(session, reply, 'family.security.settings.change', body.stepUpToken))) return;
      try {
        const status = await deps.administrationPinService.configurePin(session.familyId, body.pin);
        return reply.code(200).send({ pinStatus: status });
      } catch (error) {
        if (error instanceof AdministrationPinError) return reply.code(400).send({ error: error.code.toLowerCase() });
        throw error;
      }
    },
  );
}
