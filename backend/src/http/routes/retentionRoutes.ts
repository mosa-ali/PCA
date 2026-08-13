import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzRepository } from '../../authz/AuthzRepository.js';
import { validateRetentionPolicy } from '../../retention/engine.js';
import { applyDeleteNow } from '../../retention/deleteNow.js';
import type { DeleteNowLedger } from '../../retention/DeleteNowLedger.js';
import type { LocationRetentionMode, RetentionPolicySettings, RetentionRecord, RetentionWindow } from '../../retention/types.js';
import { RETENTION_WINDOWS } from '../../retention/policy.js';
import { FamilyAuditService } from '../../familyrbac/FamilyAuditStore.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FAMILY_ID_LENGTH = 128;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_ACTION_ID_LENGTH = 128;
const MAX_RECORD_ID_LENGTH = 128;
const MAX_ENTITY_CLASS_LENGTH = 64;
const MAX_DELETE_NOW_RECORDS = 5000;

export interface RetentionRoutesDeps {
  authService: AuthService;
  /**
   * Deliberately the raw AuthzRepository, NOT AuthzService -- see this
   * file's top-of-module doc comment for why CHANGE_RETENTION/DELETE_NOW/
   * EXPORT_FAMILY_DATA cannot go through AuthzService's ServiceOperation
   * gate.
   */
  authzRepository: AuthzRepository;
  deleteNowLedger: DeleteNowLedger;
  auditService: FamilyAuditService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
  now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Family-scope authentication ONLY -- deliberately NOT a role check.
 *
 * ARCHITECTURAL NOTE (read before extending): CHANGE_RETENTION, DELETE_NOW,
 * and EXPORT_FAMILY_DATA are Owner-only (+ step-up) operations per doc 18
 * Section 2 / familyrbac/policy.ts's OPERATION_MATRIX. A correct Owner-only
 * gate would need to resolve the caller's family role, and the ONLY role
 * authority this codebase defines is TrustSetRoleResolver, which reads a
 * FamilyTrustSetStore -- and FamilyTrustSetStore's own doc comment is
 * explicit: "device-local state, never a server-side source of truth."
 * Separately, authz/types.ts's ServiceOperation enum explicitly excludes a
 * RETENTION_CONTROL-shaped member, with its own doc comment stating
 * "Adding one would itself be the violation this module exists to
 * prevent." Both are genuine, in-code architectural constraints, not
 * oversights -- this route layer therefore intentionally stops at "is this
 * an authenticated account with ACTIVE family scope," the same boundary
 * CREATE_DEVICE_INVITATION/CONFIRM_DEVICE_PAIRING already use (see
 * parent-web/src/domain/roles.ts's own comment on that trust tier). Real
 * Owner-only + step-up enforcement for these three operations belongs to
 * the device-side signed-envelope check doc 18 Section 1 describes as the
 * true authority; this HTTP layer is a family-scoped request intake, not
 * that authority. Every attempt (allowed or denied) is still audited via
 * FamilyAuditService below.
 */
function createRequireActiveFamilyScope(authzRepository: AuthzRepository) {
  return async function requireActiveFamilyScope(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const familyId = (request.params as Record<string, unknown>).familyId;
    if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > MAX_FAMILY_ID_LENGTH) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const status = await authzRepository.findFamilyScopeStatus(request.accountId as string, familyId);
    if (status !== 'ACTIVE') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
  };
}

function isValidRetentionWindow(value: unknown): value is RetentionWindow {
  return typeof value === 'string' && (RETENTION_WINDOWS as string[]).includes(value);
}

function parseLocationMode(value: unknown): LocationRetentionMode | null {
  if (value === 'CURRENT_LAST_ONLY') return 'CURRENT_LAST_ONLY';
  if (isPlainObject(value) && isValidRetentionWindow(value.window)) return { window: value.window };
  return null;
}

function parseRetentionPolicy(body: Record<string, unknown>): RetentionPolicySettings | null {
  const { generalWindow, locationMode, timezone } = body;
  if (!isValidRetentionWindow(generalWindow)) return null;
  const parsedLocationMode = parseLocationMode(locationMode);
  if (parsedLocationMode === null) return null;
  if (typeof timezone !== 'string' || timezone.length === 0 || timezone.length > MAX_TIMEZONE_LENGTH) return null;
  return { generalWindow, locationMode: parsedLocationMode, timezone };
}

function isPlausibleDeleteNowActionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ACTION_ID_LENGTH;
}

function parseDeleteNowRecords(value: unknown): RetentionRecord[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DELETE_NOW_RECORDS) return null;
  const records: RetentionRecord[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    const { entityClass, id, eventTimestampUtc } = entry;
    if (typeof entityClass !== 'string' || entityClass.length === 0 || entityClass.length > MAX_ENTITY_CLASS_LENGTH) return null;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_RECORD_ID_LENGTH) return null;
    if (typeof eventTimestampUtc !== 'string') return null;
    const parsed = new Date(eventTimestampUtc);
    if (Number.isNaN(parsed.getTime())) return null;
    records.push({ entityClass: entityClass as RetentionRecord['entityClass'], id, eventTimestampUtc: parsed });
  }
  return records;
}

/**
 * Registers the family privacy-control intake routes: retention policy
 * validation, "Delete now" (idempotent by client-supplied actionId), and
 * export request intake. See this module's `createRequireActiveFamilyScope`
 * doc comment for the RBAC boundary these routes intentionally stop at.
 *
 * NONE of these routes execute a real data purge/export against family
 * activity data -- that data is device-local/E2EE (docs/architecture/10,
 * 11), never held by this backend, so there is nothing here to purge or
 * export directly. Each route's job is authenticate + family-scope-check +
 * validate + idempotently record the REQUEST + audit it; the retention
 * policy response echoes back the validated settings rather than persisting
 * them (backend/README.md: this service deliberately holds no policy
 * payload storage). The export route never invokes export/pipeline.ts's
 * runExport -- ExportEncryptor is PENDING_HUMAN_SECURITY_REVIEW (see
 * export/types.ts), so it responds 202/PENDING rather than fabricating a
 * working export.
 */
export function registerRetentionRoutes(app: FastifyInstance, deps: RetentionRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);
  const requireActiveFamilyScope = createRequireActiveFamilyScope(deps.authzRepository);
  const now = deps.now ?? (() => new Date());

  app.post(
    '/v1/families/:familyId/retention-policy',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'change-retention' }),
        requireActiveFamilyScope,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const policy = parseRetentionPolicy(body);
      if (policy === null) return reply.code(400).send({ error: 'invalid_request' });

      const violations = validateRetentionPolicy(policy);
      if (violations.length > 0) {
        await deps.auditService.record(auditRecord(familyId, 'CHANGE_RETENTION', 'DENIED', `INVALID_POLICY: ${violations.join(',')}`));
        return reply.code(422).send({ error: 'invalid_policy', violations });
      }

      await deps.auditService.record(auditRecord(familyId, 'CHANGE_RETENTION', 'SUCCESS', 'RETENTION_POLICY_VALIDATED'));
      return reply.code(200).send({ policy, accepted: true });
    },
  );

  app.post(
    '/v1/families/:familyId/delete-now',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'delete-now' }),
        requireActiveFamilyScope,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { actionId } = body;
      if (!isPlausibleDeleteNowActionId(actionId)) return reply.code(400).send({ error: 'invalid_request' });
      const records = parseDeleteNowRecords(body.records);
      if (records === null) return reply.code(400).send({ error: 'invalid_request' });

      // actionId is scoped per-family in the ledger key so a duplicate
      // client-generated id in a DIFFERENT family can never replay or
      // observe this family's stored plan.
      const scopedActionId = `${familyId}:${actionId}`;
      const result = applyDeleteNow(scopedActionId, records, deps.deleteNowLedger, now());

      await deps.auditService.record(
        auditRecord(familyId, 'DELETE_NOW', 'SUCCESS', `actionId=${actionId} idempotent=${result.idempotent} toDelete=${result.plan.toDelete.length}`, actionId),
      );
      return reply.code(200).send({ actionId, idempotent: result.idempotent, plan: serializePlan(result.plan) });
    },
  );

  app.post(
    '/v1/families/:familyId/export-requests',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [
        deps.authAttemptLimiter,
        requireServiceSession,
        deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'export-data' }),
        requireActiveFamilyScope,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId } = request.params as { familyId: string };
      const body = request.body;
      if (body !== undefined && !isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });

      const exportId = randomUUID();
      await deps.auditService.record({
        familyId,
        actionType: 'EXPORT_FAMILY_DATA',
        actorDeviceId: request.accountId as string,
        actorMemberId: null,
        targetScope: { kind: 'FAMILY', id: familyId },
        authorizationRole: null,
        trustSetEpoch: 0,
        policyRevision: null,
        clientMonotonicSequence: null,
        resultStatus: 'PENDING',
        targetAcknowledgementCount: 0,
        reasonCategory: null,
        correlationId: exportId,
        actionId: null,
        freeTextNote: 'EXPORT_REQUEST_ACCEPTED_PENDING_CRYPTO_REVIEW',
      });
      // 202: request accepted, never a completed artifact -- see this
      // module's doc comment on why export execution is intentionally not
      // wired here (PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW).
      return reply.code(202).send({ exportId, status: 'PENDING_CRYPTO_REVIEW' });
    },
  );

  function auditRecord(
    familyId: string,
    actionType: 'CHANGE_RETENTION' | 'DELETE_NOW',
    resultStatus: 'SUCCESS' | 'DENIED',
    freeTextNote: string,
    correlationId: string | null = null,
  ) {
    return {
      familyId,
      actionType,
      actorDeviceId: 'SERVICE_SESSION',
      actorMemberId: null,
      targetScope: { kind: 'FAMILY' as const, id: familyId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus,
      targetAcknowledgementCount: 0,
      reasonCategory: null,
      correlationId,
      actionId: null,
      freeTextNote,
    };
  }
}

function serializePlan(plan: { toDelete: { entityClass: string; id: string; reason: string }[]; retainedCount: number }) {
  return { toDelete: plan.toDelete, retainedCount: plan.retainedCount };
}
