import { createHash } from 'node:crypto';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { FamilyAuditService } from './FamilyAuditStore.js';
import { MAX_ACTION_LIFETIME_MS, isPlausibleActionId, isPlausibleIdempotencyKey, isPlausibleOpaqueId } from './policy.js';
import type { ParentActionAuthorizationService } from './ParentActionAuthorizationService.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from './TrustSetRoleResolver.js';
import type { ParentOperation, ReasonCategory, StepUpAssertion } from './types.js';

/** The two existing family-RBAC operations that can protect a removal decision. */
export type RemovalDecisionOperation = Extract<ParentOperation, 'REMOVE_REVOKE_DEVICE' | 'DISABLE_PROTECTION_POLICY'>;

export const REMOVAL_DECISION_OPERATIONS: ReadonlySet<RemovalDecisionOperation> = new Set([
  'REMOVE_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
]);

/** PCA-ADD-ENR-019's controlled protection vocabulary. */
export type RemovalProtectionLevel = 'STANDARD' | 'PROTECTED' | 'DEGRADED' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED';

/** PCA-ADD-ENR-016/017: no additional lifecycle values are admitted here. */
export type RemovalDecisionState = 'PARENT_APPROVAL_REQUIRED' | 'KEEP_ACTIVE' | 'TEMPORARILY_DISABLE' | 'ALLOW_REMOVAL';

export const REMOVAL_DECISIONS: ReadonlySet<RemovalDecisionState> = new Set([
  'KEEP_ACTIVE',
  'TEMPORARILY_DISABLE',
  'ALLOW_REMOVAL',
]);

export const REMOVAL_PROTECTION_LEVELS: ReadonlySet<RemovalProtectionLevel> = new Set([
  'STANDARD',
  'PROTECTED',
  'DEGRADED',
  'AUTHORIZATION_REQUIRED',
  'NOT_SUPPORTED',
]);

export const REMOVAL_REASON_CATEGORIES: ReadonlySet<ReasonCategory> = new Set([
  'ROUTINE_POLICY_CHANGE',
  'CHILD_SAFETY_CONCERN',
  'DEVICE_LOST_OR_STOLEN',
  'FAMILY_MEMBERSHIP_CHANGE',
  'RECOVERY',
  'OTHER',
]);

export interface RemovalDecisionRequestInput {
  requestId: string;
  familyId: string;
  childId: string;
  deviceId: string;
  operation: RemovalDecisionOperation;
  protectionLevel: RemovalProtectionLevel;
  requestedAt: Date;
  expiresAt: Date;
  reasonCategory: ReasonCategory | null;
}

/** Durable parent-facing record. IDs are opaque references; no child profile or policy plaintext is stored. */
export interface RemovalDecisionRecord extends RemovalDecisionRequestInput {
  state: RemovalDecisionState;
  decidedAt: Date | null;
  decidedByDeviceId: string | null;
  decisionActionId: string | null;
  idempotencyKey: string | null;
  temporaryDisableUntil: Date | null;
  /** SHA-256 of the signed decision's canonical binding, never the signature or a PIN. */
  decisionFingerprint: string | null;
}

/** The signed, exact child/device/request binding accepted by this service. */
export interface SignedRemovalDecision {
  requestId: string;
  familyId: string;
  childId: string;
  deviceId: string;
  operation: RemovalDecisionOperation;
  protectionLevel: RemovalProtectionLevel;
  reasonCategory: ReasonCategory | null;
  decision: Exclude<RemovalDecisionState, 'PARENT_APPROVAL_REQUIRED'>;
  temporaryDisableUntil: Date | null;
  actorDeviceId: string;
  actionId: string;
  idempotencyKey: string;
  trustSetEpoch: number;
  policyRevision: number | null;
  issuedAt: Date;
  expiresAt: Date;
  stepUp: StepUpAssertion;
  signature: string;
}

export interface RemovalDecisionSigningKey {
  familyId: string;
  deviceId: string;
  publicKey: string;
}

/** Production composition supplies the key from the verified family/device authority boundary. */
export interface RemovalDecisionSigningKeyResolver {
  resolve(familyId: string, actorDeviceId: string): Promise<RemovalDecisionSigningKey | null>;
}

/** The replay key is scoped by family and action; implementations must make claim atomic across callers. */
export interface RemovalDecisionReplayLedger {
  claim(familyId: string, actionId: string, decisionFingerprint: string): Promise<'CLAIMED' | 'ALREADY_CLAIMED'>;
}

/** In-memory reference implementation; a durable deployment must replace this port with an atomic store. */
export class InMemoryRemovalDecisionReplayLedger implements RemovalDecisionReplayLedger {
  private readonly fingerprintsByFamily = new Map<string, Map<string, string>>();

  async claim(familyId: string, actionId: string, decisionFingerprint: string): Promise<'CLAIMED' | 'ALREADY_CLAIMED'> {
    let byAction = this.fingerprintsByFamily.get(familyId);
    if (byAction === undefined) {
      byAction = new Map();
      this.fingerprintsByFamily.set(familyId, byAction);
    }
    if (byAction.has(actionId)) return 'ALREADY_CLAIMED';
    byAction.set(actionId, decisionFingerprint);
    return 'CLAIMED';
  }
}

export type CommitRemovalDecisionResult = 'APPLIED' | 'ALREADY_DECIDED' | 'CONFLICT';

/** Repository port with an atomic pending-to-decision operation. */
export interface RemovalDecisionRepository {
  get(requestId: string): Promise<RemovalDecisionRecord | null>;
  create(record: RemovalDecisionRecord): Promise<void>;
  commitDecision(requestId: string, next: RemovalDecisionRecord): Promise<CommitRemovalDecisionResult>;
}

/** Reference repository used by focused tests and local compositions. */
export class InMemoryRemovalDecisionRepository implements RemovalDecisionRepository {
  private readonly records = new Map<string, RemovalDecisionRecord>();

  async get(requestId: string): Promise<RemovalDecisionRecord | null> {
    return this.records.get(requestId) ?? null;
  }

  async create(record: RemovalDecisionRecord): Promise<void> {
    if (this.records.has(record.requestId)) throw new Error('REMOVAL_REQUEST_ALREADY_EXISTS');
    this.records.set(record.requestId, record);
  }

  async commitDecision(requestId: string, next: RemovalDecisionRecord): Promise<CommitRemovalDecisionResult> {
    const current = this.records.get(requestId);
    if (current === undefined) return 'CONFLICT';
    if (current.state !== 'PARENT_APPROVAL_REQUIRED') {
      const sameDecision =
        current.decisionFingerprint === next.decisionFingerprint &&
        current.decisionActionId === next.decisionActionId &&
        current.idempotencyKey === next.idempotencyKey;
      return sameDecision ? 'ALREADY_DECIDED' : 'CONFLICT';
    }
    this.records.set(requestId, next);
    return 'APPLIED';
  }
}

export type RemovalDecisionErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ACTION_EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'NOT_AUTHORIZED'
  | 'REPLAYED_ACTION'
  | 'INVALID_STATE';

const REMOVAL_DECISION_ERROR_MESSAGES: Record<RemovalDecisionErrorCode, string> = {
  INVALID_INPUT: 'Removal decision input is not valid.',
  NOT_FOUND: 'Removal decision request was not found.',
  ACTION_EXPIRED: 'Removal decision authorization has expired.',
  INVALID_SIGNATURE: 'Removal decision authorization could not be verified.',
  NOT_AUTHORIZED: 'Removal decision authorization was denied.',
  REPLAYED_ACTION: 'Removal decision authorization was already used.',
  INVALID_STATE: 'Removal decision request is not awaiting parent approval.',
};

export class RemovalDecisionError extends Error {
  readonly code: RemovalDecisionErrorCode;

  constructor(code: RemovalDecisionErrorCode) {
    super(REMOVAL_DECISION_ERROR_MESSAGES[code]);
    this.name = 'RemovalDecisionError';
    this.code = code;
  }
}

/**
 * Controlled remote decision boundary for PCA-ADD-ENR-016/017/018/024.
 *
 * The caller supplies a signed decision, but this service independently
 * re-binds it to the stored request, verifies the signature against the
 * family/device key boundary, and asks ParentActionAuthorizationService for
 * the role verdict. That existing service owns the operation matrix and its
 * ActionIdempotencyLedger; this class never accepts a caller-supplied role.
 */
export class RemovalDecisionService {
  private readonly repository: RemovalDecisionRepository;
  private readonly authorization: ParentActionAuthorizationService;
  private readonly signingKeyResolver: RemovalDecisionSigningKeyResolver;
  private readonly signatureVerifier: DeviceSignatureVerifier;
  private readonly targetDeviceRoleResolver: TrustSetRoleResolver;
  private readonly replayLedger: RemovalDecisionReplayLedger;
  private readonly auditService: FamilyAuditService;
  private readonly now: () => Date;

  constructor(options: {
    repository: RemovalDecisionRepository;
    authorization: ParentActionAuthorizationService;
    signingKeyResolver: RemovalDecisionSigningKeyResolver;
    signatureVerifier: DeviceSignatureVerifier;
    targetDeviceRoleResolver: TrustSetRoleResolver;
    replayLedger?: RemovalDecisionReplayLedger;
    auditService: FamilyAuditService;
    now?: () => Date;
  }) {
    this.repository = options.repository;
    this.authorization = options.authorization;
    this.signingKeyResolver = options.signingKeyResolver;
    this.signatureVerifier = options.signatureVerifier;
    this.targetDeviceRoleResolver = options.targetDeviceRoleResolver;
    this.replayLedger = options.replayLedger ?? new InMemoryRemovalDecisionReplayLedger();
    this.auditService = options.auditService;
    this.now = options.now ?? (() => new Date());
  }

  /** Creates the only request state this service accepts: PARENT_APPROVAL_REQUIRED. */
  async createRequest(input: RemovalDecisionRequestInput): Promise<RemovalDecisionRecord> {
    validateRequestInput(input);
    const record: RemovalDecisionRecord = {
      ...input,
      state: 'PARENT_APPROVAL_REQUIRED',
      decidedAt: null,
      decidedByDeviceId: null,
      decisionActionId: null,
      idempotencyKey: null,
      temporaryDisableUntil: null,
      decisionFingerprint: null,
    };
    await this.repository.create(record);
    await this.auditService.record({
      familyId: input.familyId,
      actionType: input.operation,
      actorDeviceId: input.deviceId,
      actorMemberId: null,
      targetScope: { kind: 'CHILD_PROFILE', id: input.childId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'PENDING',
      targetAcknowledgementCount: 0,
      reasonCategory: input.reasonCategory,
      correlationId: input.requestId,
      actionId: null,
      freeTextNote: null,
    });
    return record;
  }

  async getRequest(requestId: string): Promise<RemovalDecisionRecord | null> {
    if (!isPlausibleOpaqueId(requestId)) throw new RemovalDecisionError('INVALID_INPUT');
    return this.repository.get(requestId);
  }

  async decide(signedDecision: SignedRemovalDecision): Promise<RemovalDecisionRecord> {
    const request = await this.repository.get(signedDecision.requestId);
    if (request === null) throw new RemovalDecisionError('NOT_FOUND');

    validateRequestInput(request);
    const canonical = validateAndCanonicalizeDecision(request, signedDecision, this.now());
    const decisionFingerprint = fingerprint(canonical);

    const signingKey = await this.signingKeyResolver.resolve(request.familyId, signedDecision.actorDeviceId).catch(() => null);
    if (
      signingKey === null ||
      signingKey.familyId !== request.familyId ||
      signingKey.deviceId !== signedDecision.actorDeviceId ||
      signingKey.publicKey.length === 0
    ) {
      await this.recordDenied(request, signedDecision, 'NOT_AUTHORIZED');
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    }

    let validSignature = false;
    try {
      validSignature = await this.signatureVerifier.verify(signingKey.publicKey, canonical, signedDecision.signature);
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      await this.recordDenied(request, signedDecision, 'INVALID_SIGNATURE');
      throw new RemovalDecisionError('INVALID_SIGNATURE');
    }

    // Child-profile membership is checked by ParentActionAuthorizationService
    // below. The device is a separate exact binding and must also be resolved
    // from the same verified trust-set authority; a signed request containing
    // a foreign or revoked device identifier is never enough to authorize it.
    const targetDevice = this.targetDeviceRoleResolver.resolveActor(request.familyId, request.deviceId);
    if (isActorResolutionFailure(targetDevice)) {
      await this.recordDenied(request, signedDecision, 'NOT_AUTHORIZED');
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    }

    // A completed action can be retried idempotently, but only for the exact
    // signed binding previously committed. Signature verification above still
    // applies on this path; a caller cannot turn knowledge of an action ID
    // into a protected record read by presenting a forged retry.
    // A different action or payload can never turn a completed request into a
    // second decision.
    if (request.state !== 'PARENT_APPROVAL_REQUIRED') {
      if (
        request.decisionFingerprint === decisionFingerprint &&
        request.decisionActionId === signedDecision.actionId &&
        request.idempotencyKey === signedDecision.idempotencyKey
      ) {
        return request;
      }
      await this.recordDenied(request, signedDecision, 'INVALID_STATE');
      throw new RemovalDecisionError('INVALID_STATE');
    }

    const authorization = this.authorization.authorize({
      familyId: request.familyId,
      actorDeviceId: signedDecision.actorDeviceId,
      operation: request.operation,
      targetScope: { kind: 'CHILD_PROFILE', id: request.childId },
      issuedAt: signedDecision.issuedAt,
      expiresAt: signedDecision.expiresAt,
      stepUp: signedDecision.stepUp,
      idempotencyKey: signedDecision.idempotencyKey,
      actionId: signedDecision.actionId,
    });
    if (authorization.verdict !== 'ALLOW') {
      // ParentActionAuthorizationService records the authoritative RBAC
      // denial in the shared family audit stream; do not duplicate it here.
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    }

    const replay = await this.replayLedger.claim(request.familyId, signedDecision.actionId, decisionFingerprint);
    if (replay !== 'CLAIMED') {
      await this.recordDenied(request, signedDecision, 'REPLAYED_ACTION');
      throw new RemovalDecisionError('REPLAYED_ACTION');
    }

    const decided: RemovalDecisionRecord = {
      ...request,
      state: signedDecision.decision,
      decidedAt: this.now(),
      decidedByDeviceId: signedDecision.actorDeviceId,
      decisionActionId: signedDecision.actionId,
      idempotencyKey: signedDecision.idempotencyKey,
      temporaryDisableUntil: signedDecision.temporaryDisableUntil,
      decisionFingerprint,
    };
    const committed = await this.repository.commitDecision(request.requestId, decided);
    if (committed === 'ALREADY_DECIDED') {
      const current = await this.repository.get(request.requestId);
      if (
        current !== null &&
        current.decisionFingerprint === decisionFingerprint &&
        current.decisionActionId === signedDecision.actionId &&
        current.idempotencyKey === signedDecision.idempotencyKey
      ) {
        return current;
      }
    }
    if (committed !== 'APPLIED') throw new RemovalDecisionError('INVALID_STATE');

    await this.auditService.record({
      familyId: request.familyId,
      actionType: request.operation,
      actorDeviceId: signedDecision.actorDeviceId,
      actorMemberId: null,
      targetScope: { kind: 'CHILD_PROFILE', id: request.childId },
      authorizationRole: null,
      trustSetEpoch: signedDecision.trustSetEpoch,
      policyRevision: signedDecision.policyRevision,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: request.reasonCategory,
      correlationId: request.requestId,
      actionId: signedDecision.actionId,
      freeTextNote: signedDecision.decision,
    });
    return decided;
  }

  private async recordDenied(
    request: RemovalDecisionRecord,
    signedDecision: SignedRemovalDecision,
    reason: RemovalDecisionErrorCode,
  ): Promise<void> {
    await this.auditService.record({
      familyId: request.familyId,
      actionType: request.operation,
      actorDeviceId: signedDecision.actorDeviceId,
      actorMemberId: null,
      targetScope: { kind: 'CHILD_PROFILE', id: request.childId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'DENIED',
      targetAcknowledgementCount: 0,
      reasonCategory: request.reasonCategory,
      correlationId: request.requestId,
      actionId: isPlausibleActionId(signedDecision.actionId) ? signedDecision.actionId : null,
      freeTextNote: reason,
    });
  }
}

export function canonicalizeRemovalDecision(decision: Omit<SignedRemovalDecision, 'signature'>): string {
  const fields = [
    decision.requestId,
    decision.familyId,
    decision.childId,
    decision.deviceId,
    decision.operation,
    decision.protectionLevel,
    decision.reasonCategory ?? '',
    decision.decision,
    decision.temporaryDisableUntil?.toISOString() ?? '',
    decision.actorDeviceId,
    decision.actionId,
    decision.idempotencyKey,
    String(decision.trustSetEpoch),
    decision.policyRevision === null ? '' : String(decision.policyRevision),
    decision.issuedAt.toISOString(),
    decision.expiresAt.toISOString(),
    decision.stepUp.state,
    decision.stepUp.assertedAt?.toISOString() ?? '',
    decision.stepUp.freshUntil?.toISOString() ?? '',
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

function validateRequestInput(input: RemovalDecisionRequestInput): void {
  if (
    !isPlausibleOpaqueId(input.requestId) ||
    !isPlausibleOpaqueId(input.familyId) ||
    !isPlausibleOpaqueId(input.childId) ||
    !isPlausibleOpaqueId(input.deviceId) ||
    !REMOVAL_DECISION_OPERATIONS.has(input.operation) ||
    !isValidDate(input.requestedAt) ||
    !isValidDate(input.expiresAt) ||
    input.expiresAt.getTime() <= input.requestedAt.getTime() ||
    input.expiresAt.getTime() - input.requestedAt.getTime() > MAX_ACTION_LIFETIME_MS ||
    !REMOVAL_PROTECTION_LEVELS.has(input.protectionLevel) ||
    !REMOVAL_REASON_CATEGORIES.has(input.reasonCategory as ReasonCategory) && input.reasonCategory !== null
  ) {
    throw new RemovalDecisionError('INVALID_INPUT');
  }
}

function validateAndCanonicalizeDecision(
  request: RemovalDecisionRecord,
  decision: SignedRemovalDecision,
  now: Date,
): string {
  if (
    !isPlausibleOpaqueId(decision.requestId) ||
    !isPlausibleOpaqueId(decision.familyId) ||
    !isPlausibleOpaqueId(decision.childId) ||
    !isPlausibleOpaqueId(decision.deviceId) ||
    !isPlausibleOpaqueId(decision.actorDeviceId) ||
    !isPlausibleActionId(decision.actionId) ||
    !isPlausibleIdempotencyKey(decision.idempotencyKey) ||
    !isStepUpAssertion(decision.stepUp) ||
    !Number.isInteger(decision.trustSetEpoch) ||
    decision.trustSetEpoch < 0 ||
    (decision.policyRevision !== null && (!Number.isInteger(decision.policyRevision) || decision.policyRevision < 0)) ||
    !REMOVAL_DECISIONS.has(decision.decision) ||
    !REMOVAL_PROTECTION_LEVELS.has(decision.protectionLevel) ||
    !REMOVAL_REASON_CATEGORIES.has(decision.reasonCategory as ReasonCategory) && decision.reasonCategory !== null ||
    !isValidDate(decision.issuedAt) ||
    !isValidDate(decision.expiresAt) ||
    !isValidDate(decision.stepUp.assertedAt) && decision.stepUp.assertedAt !== null ||
    !isValidDate(decision.stepUp.freshUntil) && decision.stepUp.freshUntil !== null ||
    decision.familyId !== request.familyId ||
    decision.requestId !== request.requestId ||
    decision.childId !== request.childId ||
    decision.deviceId !== request.deviceId ||
    decision.operation !== request.operation ||
    decision.protectionLevel !== request.protectionLevel ||
    decision.reasonCategory !== request.reasonCategory ||
    decision.expiresAt.getTime() > request.expiresAt.getTime() ||
    decision.expiresAt.getTime() <= decision.issuedAt.getTime() ||
    decision.expiresAt.getTime() - decision.issuedAt.getTime() > MAX_ACTION_LIFETIME_MS ||
    now.getTime() < decision.issuedAt.getTime() ||
    now.getTime() >= request.expiresAt.getTime() ||
    now.getTime() >= decision.expiresAt.getTime() ||
    decision.decision === 'TEMPORARILY_DISABLE' &&
      (decision.temporaryDisableUntil === null ||
        !isValidDate(decision.temporaryDisableUntil) ||
        decision.temporaryDisableUntil.getTime() <= now.getTime() ||
        decision.temporaryDisableUntil.getTime() > decision.expiresAt.getTime()) ||
    decision.decision !== 'TEMPORARILY_DISABLE' && decision.temporaryDisableUntil !== null
  ) {
    const expired = isValidDate(decision.expiresAt) && now.getTime() >= decision.expiresAt.getTime();
    throw new RemovalDecisionError(expired ? 'ACTION_EXPIRED' : 'INVALID_INPUT');
  }

  return canonicalizeRemovalDecision(decision);
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isStepUpAssertion(value: unknown): value is StepUpAssertion {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StepUpAssertion>;
  if (!['FRESH', 'EXPIRED', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(candidate.state ?? '')) return false;
  if (!isValidDate(candidate.assertedAt ?? null) && candidate.assertedAt !== null) return false;
  if (!isValidDate(candidate.freshUntil ?? null) && candidate.freshUntil !== null) return false;
  return true;
}

function fingerprint(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
