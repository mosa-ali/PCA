import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import type { AuthzRepository } from '../../authz/AuthzRepository.js';
import { validateRetentionPolicy } from '../../retention/engine.js';
import { applyDeleteNow } from '../../retention/deleteNow.js';
import type { DeleteNowLedger } from '../../retention/DeleteNowLedger.js';
import { isRetentionEntityClass } from '../../retention/types.js';
import type { DeletionState, LocationRetentionMode, RetentionPolicySettings, RetentionRecord, RetentionWindow } from '../../retention/types.js';
import { DEFAULT_RETENTION_WINDOW, RETENTION_WINDOWS } from '../../retention/policy.js';
import { FamilyAuditService } from '../../familyrbac/FamilyAuditStore.js';

/**
 * doc 11 Section 6/Section 5.1/PCA-DATA-027: this HTTP layer only ever
 * records a "delete now" REQUEST -- it never receives a signed child-device
 * acknowledgement (that arrives, if at all, via the device-side envelope
 * flow this route intentionally does not implement, PCA-DATA-027/crypto
 * gate). So every response from this route MUST disclose the request as
 * pending, literally reusing retention/types.ts's own `DeletionState` enum
 * value rather than inventing a parallel ad hoc status string -- this is
 * the doc 11 Section 6 "the UI MUST report the child deletion as pending,
 * never completed" requirement, made structurally impossible to violate by
 * type (there is no other DeletionState this constant could be reassigned
 * to that would still compile as a "delete now accepted" response).
 */
const DELETE_NOW_DISCLOSED_STATE: DeletionState = 'DELETE_PENDING_REMOTE_DEVICE';

/**
 * PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A049, the "false assurance" finding).
 * This backend holds NO retention-policy storage (doc 09/10: readable family
 * policy is never a central entity) and the E2EE policy-delivery path to
 * devices is crypto-gated (PRODUCTION_CRYPTO_SUITE). A parent's chosen window
 * is therefore VALIDATED and AUDITED here and nothing else: it is not stored,
 * not delivered and not enforced by anything. The response says exactly that
 * (202 + persisted:false + this disclosed state). It previously answered
 * 200 { accepted: true }, telling a parent their choice was in force when
 * nothing kept it; this constant MUST NOT be turned back into an
 * acceptance claim until a real, delivered policy path exists.
 */
export const RETENTION_POLICY_DISCLOSED_STATE = 'RETENTION_POLICY_VALIDATED_NOT_PERSISTED_PENDING_CRYPTO_REVIEW' as const;

/**
 * doc 11 Section 10: "mark it EXPORT_EXISTS_EXTERNALLY and disclose that
 * limitation at creation" -- this route never fabricates a completed
 * export (see this file's top doc comment), but the 202 intake response
 * still owes the caller the SAME disclosure doc 11 Section 10 requires be
 * shown at creation time, so a client integrating this endpoint cannot
 * miss it by only reading a later, not-yet-implemented completion payload.
 */
const EXPORT_CREATION_DISCLOSURE = 'EXPORT_WILL_EXIST_OUTSIDE_APP_MANAGED_RETENTION_ONCE_CREATED' as const;

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FAMILY_ID_LENGTH = 128;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_ACTION_ID_LENGTH = 128;
const MAX_RECORD_ID_LENGTH = 128;
const MAX_ENTITY_CLASS_LENGTH = 64;
const MAX_DELETE_NOW_RECORDS = 5000;

export interface RetentionRoutesDeps {
  authService: AuthService;
  parentAccountService?: Pick<ParentAccountService, 'consumeSensitiveStepUp'>;
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
 * Authenticates the service session and requires an ACTIVE family scope,
 * ACTIVE Parent membership, and ACTIVE family. The sensitive mutation
 * handlers then consume a single-use TOTP grant; ParentAccountService
 * revalidates that the account is an ACTIVE Administrator in this family.
 * These routes validate and audit requests only: retention policy is not
 * persisted or delivered, deletion remains pending device acknowledgement,
 * and export remains pending crypto review.
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
    // PCA-DATA-020: entityClass MUST be one of the actual known
    // RetentionEntityClass values (retention/types.ts's
    // ALL_RETENTION_ENTITY_CLASSES, generated from the same literal union
    // planPurge/planDeleteNow are typed against) -- never an unchecked
    // caller-supplied string. This is the runtime half of the type-level
    // scope restriction those pure functions already enforce: it stops an
    // external caller from ever getting a Section 3.2-protected entity
    // name (e.g. "Family", "DeviceKeyMetadata") accepted into a
    // RetentionRecord at all, let alone into a delete-now plan.
    if (!isRetentionEntityClass(entityClass) || (entityClass as string).length > MAX_ENTITY_CLASS_LENGTH) return null;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_RECORD_ID_LENGTH) return null;
    if (typeof eventTimestampUtc !== 'string') return null;
    const parsed = new Date(eventTimestampUtc);
    if (Number.isNaN(parsed.getTime())) return null;
    records.push({ entityClass, id, eventTimestampUtc: parsed });
  }
  return records;
}

/**
 * Registers the family privacy-control intake routes: retention policy
 * validation, "Delete now" (idempotent by client-supplied actionId), and
 * export request intake. They require active Parent membership and reserve
 * sensitive writes for the ACTIVE Administrator with fresh TOTP step-up.
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
      if (!deps.parentAccountService || typeof body.stepUpToken !== 'string' || !(await deps.parentAccountService.consumeSensitiveStepUp(request.accountId as string, familyId, 'family.retention.update', body.stepUpToken))) {
        await deps.auditService.record(auditRecord(familyId, 'CHANGE_RETENTION', 'DENIED', 'SENSITIVE_STEP_UP_REQUIRED'));
        return reply.code(403).send({ error: 'forbidden' });
      }

      const violations = validateRetentionPolicy(policy);
      if (violations.length > 0) {
        await deps.auditService.record(auditRecord(familyId, 'CHANGE_RETENTION', 'DENIED', `INVALID_POLICY: ${violations.join(',')}`));
        return reply.code(422).send({ error: 'invalid_policy', violations });
      }

      await deps.auditService.record(auditRecord(familyId, 'CHANGE_RETENTION', 'SUCCESS', 'RETENTION_POLICY_VALIDATED_NOT_PERSISTED'));
      // 202 and never `accepted: true` -- see RETENTION_POLICY_DISCLOSED_STATE.
      return reply.code(202).send({ policy, validated: true, persisted: false, deliveryStatus: RETENTION_POLICY_DISCLOSED_STATE });
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
      if (!deps.parentAccountService || typeof body.stepUpToken !== 'string' || !(await deps.parentAccountService.consumeSensitiveStepUp(request.accountId as string, familyId, 'family.history.delete', body.stepUpToken))) {
        await deps.auditService.record(auditRecord(familyId, 'DELETE_NOW', 'DENIED', 'SENSITIVE_STEP_UP_REQUIRED', actionId));
        return reply.code(403).send({ error: 'forbidden' });
      }
      const records = parseDeleteNowRecords(body.records);
      if (records === null) return reply.code(400).send({ error: 'invalid_request' });

      // actionId is scoped per-family in the ledger key so a duplicate
      // client-generated id in a DIFFERENT family can never replay or
      // observe this family's stored plan.
      const scopedActionId = `${familyId}:${actionId}`;
      const result = await applyDeleteNow(scopedActionId, records, deps.deleteNowLedger, now());

      await deps.auditService.record(
        auditRecord(familyId, 'DELETE_NOW', 'SUCCESS', `actionId=${actionId} idempotent=${result.idempotent} toDelete=${result.plan.toDelete.length}`, actionId),
      );
      return reply.code(200).send({
        actionId,
        idempotent: result.idempotent,
        plan: serializePlan(result.plan),
        deliveryStatus: DELETE_NOW_DISCLOSED_STATE,
      });
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
      if (!deps.parentAccountService || typeof body?.stepUpToken !== 'string' || !(await deps.parentAccountService.consumeSensitiveStepUp(request.accountId as string, familyId, 'family.history.export', body.stepUpToken))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

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
      return reply.code(202).send({ exportId, status: 'PENDING_CRYPTO_REVIEW', disclosures: [EXPORT_CREATION_DISCLOSURE] });
    },
  );

  /**
   * PCA-FR-101/PCA-DEC-003: exposes the architecture-baseline retention
   * default (retention/policy.ts's `DEFAULT_RETENTION_WINDOW`, currently
   * `1_MONTH`) so a client actually has a reachable source for "the
   * default shown for explicit parent confirmation at first enrollment"
   * instead of a client-side value that could silently drift from this
   * module's own constant. Deliberately family-scope-free (no
   * `requireActiveFamilyScope`): the default is a fixed architecture
   * constant, not per-family state, and is needed BEFORE a family has
   * chosen (or necessarily even has) an active retention policy yet.
   * Still requires an authenticated service session, consistent with
   * every other route this file registers.
   */
  app.get(
    '/v1/retention-policy/defaults',
    {
      preHandler: [deps.authAttemptLimiter, requireServiceSession, deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'retention-defaults' })],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({ generalWindow: DEFAULT_RETENTION_WINDOW, availableWindows: RETENTION_WINDOWS, locationMode: 'CURRENT_LAST_ONLY' });
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
