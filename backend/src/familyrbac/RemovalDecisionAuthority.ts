import { createHash } from 'node:crypto';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import type { AdministrationPinService } from '../enrollment/AdministrationPinService.js';
import type {
  OpaqueProtectionAlertComposer,
  ProtectionAlertProducer,
} from '../alerts/ProtectionAlertProducer.js';
import { FamilyAuditService } from './FamilyAuditStore.js';
import { MAX_ACTION_LIFETIME_MS, isPlausibleActionId, isPlausibleIdempotencyKey, isPlausibleOpaqueId } from './policy.js';
import type { ParentActionAuthorizationService } from './ParentActionAuthorizationService.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from './TrustSetRoleResolver.js';
import type { ParentOperation, ReasonCategory, StepUpAssertion } from './types.js';

/**
 * Consolidated durable removal/disable decision authority for
 * PCA-ADD-ENR-012/016/017/018/020.
 *
 * This class replaces the two previously independent, never-composed,
 * never-routed implementations of the same decision authority:
 *
 *   - `enrollment/ProtectionApprovalService.ts` (deleted): owned the
 *     PARENT_APPROVAL_REQUIRED lifecycle plus local-PIN and
 *     authorized-recovery decision modes, backed by real MySQL persistence
 *     (`MySqlProtectionApprovalRepository.ts`, migration 0022).
 *   - `familyrbac/RemovalDecisionService.ts` (deleted, folded in here):
 *     owned the signed-remote-parent decision mode with exact request
 *     binding, signature verification, trust-set epoch checks, RBAC via
 *     `ParentActionAuthorizationService`, anti-replay, and audit via
 *     `FamilyAuditService` -- but only ever had an in-memory repository.
 *
 * There is now exactly ONE durable request/state record model, ONE audit
 * trail (`FamilyAuditService`, injected once and shared by every decision
 * mode), and three supported decision paths that all terminate in the same
 * closed state vocabulary: PARENT_APPROVAL_REQUIRED -> {KEEP_ACTIVE,
 * TEMPORARILY_DISABLE, ALLOW_REMOVAL}.
 */

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
export type RemovalDecision = Exclude<RemovalDecisionState, 'PARENT_APPROVAL_REQUIRED'>;

export const REMOVAL_DECISIONS: ReadonlySet<RemovalDecision> = new Set([
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

export type RemovalDecisionMethod = 'REMOTE_PARENT' | 'LOCAL_ADMINISTRATION_PIN' | 'AUTHORIZED_RECOVERY';

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
  /** The coordinator supplies this only after resolving the device's authority state (PCA-ADD-ENR-016). */
  protectiveAuthorityApplies: true;
}

/** Durable parent-facing record. IDs are opaque references; no child profile or policy plaintext is stored. */
export interface RemovalDecisionRecord extends RemovalDecisionRequestInput {
  state: RemovalDecisionState;
  decidedAt: Date | null;
  decisionMethod: RemovalDecisionMethod | null;
  temporaryDisableUntil: Date | null;
  /** Populated only by the signed remote-parent mode; null for PIN/recovery decisions. */
  decidedByDeviceId: string | null;
  decisionActionId: string | null;
  idempotencyKey: string | null;
  /** SHA-256 of the signed decision's canonical binding. Null for non-signed decision modes. */
  decisionFingerprint: string | null;
}

export interface RemovalDecisionInput {
  decision: RemovalDecision;
  temporaryDisableUntil: Date | null;
}

/** Transient only; never part of a stored request, decision result, or error message. */
export interface LocalPinDecisionInput extends RemovalDecisionInput {
  pin: string;
}

/** The signed, exact child/device/request binding accepted by the remote-parent mode. */
export interface SignedRemovalDecision {
  requestId: string;
  familyId: string;
  childId: string;
  deviceId: string;
  operation: RemovalDecisionOperation;
  protectionLevel: RemovalProtectionLevel;
  reasonCategory: ReasonCategory | null;
  decision: RemovalDecision;
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

export interface AuthorizedRecoveryProof {
  /** Opaque recovery proof; this module never interprets recovery material. */
  proof: string;
  recoveryTransactionId: string;
}

/** Coordinator binding for the authorized-recovery decision mode -- must verify the approved recovery protocol and exact request binding. */
export interface AuthorizedRecoveryAuthority {
  verifyAuthorizedRecovery(input: {
    request: RemovalDecisionRecord;
    decision: RemovalDecisionInput;
    proof: AuthorizedRecoveryProof;
  }): Promise<boolean>;
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
  listForFamily(familyId: string): Promise<RemovalDecisionRecord[]>;
  create(record: RemovalDecisionRecord): Promise<void>;
  commitDecision(requestId: string, next: RemovalDecisionRecord): Promise<CommitRemovalDecisionResult>;
  /**
   * PCA-ADD-ENR-016/017/023 crash-safety: an ALLOW_REMOVAL decision on a
   * REMOVE_REVOKE_DEVICE request must eventually result in the target
   * device actually being revoked (DeviceDirectoryService.revokeDevice),
   * not merely a decision-request row saying so. RemovalDecisionAuthority
   * already attempts that revocation inline, best-effort, right after the
   * decision commits -- but a process crash between those two steps must
   * be recoverable without a human manually re-deciding anything. This is
   * the recovery query: every ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE decision
   * whose target device is not (yet) `devices.status = 'REVOKED'` -- a
   * narrowly-scoped read across the shared `devices` table this domain
   * does not own, identical in spirit to
   * ParentAccountRepository.findFamilyStatus's own precedent. Safe to call
   * repeatedly: DeviceDirectoryService.revokeDevice is itself idempotent.
   */
  listAllowRemovalPendingDeviceRevocation(): Promise<RemovalDecisionRecord[]>;
}

/** Reference repository used by focused tests and local compositions. */
export class InMemoryRemovalDecisionRepository implements RemovalDecisionRepository {
  private readonly records = new Map<string, RemovalDecisionRecord>();
  /** Test-only device-status view: a deviceId present here is treated as already revoked. Mutate directly in tests to simulate DeviceDirectoryService state. */
  readonly revokedDeviceIdsForTest = new Set<string>();

  async get(requestId: string): Promise<RemovalDecisionRecord | null> {
    const record = this.records.get(requestId);
    return record === undefined ? null : cloneRecord(record);
  }

  async listForFamily(familyId: string): Promise<RemovalDecisionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.familyId === familyId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
      .map(cloneRecord);
  }

  async create(record: RemovalDecisionRecord): Promise<void> {
    if (this.records.has(record.requestId)) throw new RemovalDecisionError('CONFLICT');
    this.records.set(record.requestId, cloneRecord(record));
  }

  async commitDecision(requestId: string, next: RemovalDecisionRecord): Promise<CommitRemovalDecisionResult> {
    const current = this.records.get(requestId);
    if (current === undefined) return 'CONFLICT';
    if (current.state !== 'PARENT_APPROVAL_REQUIRED') {
      return sameDecisionOutcome(current, next) ? 'ALREADY_DECIDED' : 'CONFLICT';
    }
    this.records.set(requestId, cloneRecord(next));
    return 'APPLIED';
  }

  async listAllowRemovalPendingDeviceRevocation(): Promise<RemovalDecisionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.state === 'ALLOW_REMOVAL' && record.operation === 'REMOVE_REVOKE_DEVICE' && !this.revokedDeviceIdsForTest.has(record.deviceId))
      .map(cloneRecord);
  }
}

export type RemovalDecisionErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ACTION_EXPIRED'
  | 'EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'NOT_AUTHORIZED'
  | 'REPLAYED_ACTION'
  | 'INVALID_STATE'
  | 'PIN_NOT_CONFIGURED'
  | 'PIN_INVALID'
  | 'RATE_LIMITED'
  | 'CONFLICT';

const REMOVAL_DECISION_ERROR_MESSAGES: Record<RemovalDecisionErrorCode, string> = {
  INVALID_INPUT: 'Removal decision input is not valid.',
  NOT_FOUND: 'Removal decision request was not found.',
  ACTION_EXPIRED: 'Removal decision authorization has expired.',
  EXPIRED: 'Removal decision request has expired.',
  INVALID_SIGNATURE: 'Removal decision authorization could not be verified.',
  NOT_AUTHORIZED: 'Removal decision authorization was denied.',
  REPLAYED_ACTION: 'Removal decision authorization was already used.',
  INVALID_STATE: 'Removal decision request is not awaiting parent approval.',
  PIN_NOT_CONFIGURED: 'Administration PIN is not configured.',
  PIN_INVALID: 'Administration PIN was not accepted.',
  RATE_LIMITED: 'Administration PIN authorization is temporarily rate limited.',
  CONFLICT: 'Removal decision request conflicts with an existing request.',
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
 * PCA-ADD-ENR-016/017/023: the actual device-identity-layer effect of an
 * ALLOW_REMOVAL decision on a REMOVE_REVOKE_DEVICE request. A narrow
 * interface (not the whole DeviceDirectoryService) so this domain depends
 * on exactly the one operation it needs, matching this file's existing
 * TrustSetRoleResolver/AuthorizedRecoveryAuthority precedent. The real
 * implementation (DeviceDirectoryService.revokeDevice) is idempotent --
 * safe to call more than once for the same device, which is what makes
 * best-effort-then-reconcile a sound crash-recovery strategy here rather
 * than requiring a transactional/outbox rewrite of decision commit itself.
 */
export interface DeviceRevocationExecutor {
  revokeDevice(familyId: string, deviceId: string): Promise<unknown>;
}

/** PCA-ADD-ENR-020 alerting composition. Best-effort/optional: alert delivery failure never blocks or reverses a decision. */
export interface RemovalDecisionAlerting {
  producer: ProtectionAlertProducer;
  composeOpaquePayload: OpaqueProtectionAlertComposer;
  alertsEnabled: boolean | (() => boolean);
  /** Resolves the family's current parent devices/key epoch for alert addressing. Coordinator-owned, verified trust-set-backed binding. */
  resolveParentDevices(familyId: string): Promise<Array<{ deviceId: string; keyEpoch: number }>>;
}

/**
 * Controlled removal/disable decision boundary for PCA-ADD-ENR-012/016/017/018/020.
 *
 * Three decision modes share one durable record, one validation contract,
 * and one audit trail:
 *
 *   - decideWithSignedRemoteParent: re-binds the caller's signed decision to
 *     the stored request, verifies the signature against the family/device
 *     key boundary, asks ParentActionAuthorizationService for the role
 *     verdict, and claims an anti-replay ledger slot (folded in from the
 *     former RemovalDecisionService).
 *   - decideWithLocalPin: verifies the family's offline Administration PIN
 *     via AdministrationPinService (folded in from the former
 *     ProtectionApprovalService); the PIN itself is never stored, logged,
 *     or reflected in an error.
 *   - decideWithAuthorizedRecovery: delegates to an injected
 *     AuthorizedRecoveryAuthority binding (folded in from the former
 *     ProtectionApprovalService).
 */
export class RemovalDecisionAuthority {
  private readonly repository: RemovalDecisionRepository;
  private readonly authorization: ParentActionAuthorizationService;
  private readonly signingKeyResolver: RemovalDecisionSigningKeyResolver;
  private readonly signatureVerifier: DeviceSignatureVerifier;
  private readonly targetDeviceRoleResolver: TrustSetRoleResolver;
  private readonly replayLedger: RemovalDecisionReplayLedger;
  private readonly pinService: AdministrationPinService;
  private readonly recoveryAuthority: AuthorizedRecoveryAuthority;
  private readonly auditService: FamilyAuditService;
  private readonly alerting: RemovalDecisionAlerting | null;
  private readonly deviceRevocation: DeviceRevocationExecutor | null;
  private readonly now: () => Date;

  constructor(options: {
    repository: RemovalDecisionRepository;
    authorization: ParentActionAuthorizationService;
    signingKeyResolver: RemovalDecisionSigningKeyResolver;
    signatureVerifier: DeviceSignatureVerifier;
    targetDeviceRoleResolver: TrustSetRoleResolver;
    pinService: AdministrationPinService;
    recoveryAuthority: AuthorizedRecoveryAuthority;
    replayLedger?: RemovalDecisionReplayLedger;
    auditService: FamilyAuditService;
    alerting?: RemovalDecisionAlerting;
    deviceRevocation?: DeviceRevocationExecutor;
    now?: () => Date;
  }) {
    this.deviceRevocation = options.deviceRevocation ?? null;
    this.repository = options.repository;
    this.authorization = options.authorization;
    this.signingKeyResolver = options.signingKeyResolver;
    this.signatureVerifier = options.signatureVerifier;
    this.targetDeviceRoleResolver = options.targetDeviceRoleResolver;
    this.pinService = options.pinService;
    this.recoveryAuthority = options.recoveryAuthority;
    this.replayLedger = options.replayLedger ?? new InMemoryRemovalDecisionReplayLedger();
    this.auditService = options.auditService;
    this.alerting = options.alerting ?? null;
    this.now = options.now ?? (() => new Date());
  }

  /** Creates the only request state this service accepts: PARENT_APPROVAL_REQUIRED. */
  async createRequest(input: RemovalDecisionRequestInput): Promise<RemovalDecisionRecord> {
    validateRequestInput(input);
    const record: RemovalDecisionRecord = {
      ...input,
      state: 'PARENT_APPROVAL_REQUIRED',
      decidedAt: null,
      decisionMethod: null,
      temporaryDisableUntil: null,
      decidedByDeviceId: null,
      decisionActionId: null,
      idempotencyKey: null,
      decisionFingerprint: null,
    };
    try {
      await this.repository.create(record);
    } catch (error) {
      // A client retry may race the original create. The opaque request id is
      // the durable correlation/idempotency key; replaying the exact request
      // returns the committed state, while reusing it for a different target
      // remains a conflict.
      if (error instanceof RemovalDecisionError && error.code === 'CONFLICT') {
        const existing = await this.repository.get(record.requestId);
        if (existing !== null && sameRequest(existing, record)) return existing;
      }
      throw error;
    }
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
    await this.emitAlert(record, 'DISABLE_OR_REMOVAL_REQUESTED');
    return record;
  }

  async listRequests(familyId: string): Promise<RemovalDecisionRecord[]> {
    if (!isPlausibleOpaqueId(familyId)) throw new RemovalDecisionError('INVALID_INPUT');
    return this.repository.listForFamily(familyId);
  }

  /** Family-scoped read: an unknown request and a cross-family request collapse to the same null result (no membership oracle). */
  async getRequest(familyId: string, requestId: string): Promise<RemovalDecisionRecord | null> {
    if (!isPlausibleOpaqueId(familyId) || !isPlausibleOpaqueId(requestId)) throw new RemovalDecisionError('INVALID_INPUT');
    const record = await this.repository.get(requestId);
    return record === null || record.familyId !== familyId ? null : record;
  }

  async decideWithLocalPin(requestId: string, familyId: string, decision: LocalPinDecisionInput): Promise<RemovalDecisionRecord> {
    const request = await this.requirePending(requestId, familyId);
    const result = await this.pinService.verifyPin(familyId, decision.pin);
    // The PIN is accepted only as a transient argument and is never copied
    // into a request, proof, audit field, or error message.
    if (!result.ok) {
      if (result.code === 'NOT_CONFIGURED') throw new RemovalDecisionError('PIN_NOT_CONFIGURED');
      if (result.code === 'RATE_LIMITED') {
        // Fired at the exact moment the lockout threshold is crossed (this
        // call is what crossed it) -- not on every prior failed attempt,
        // which would multiply alerts per PIN-guessing burst rather than
        // signal the one moment that matters to a parent.
        await this.emitAlert(request, 'REPEATED_INVALID_PIN');
        throw new RemovalDecisionError('RATE_LIMITED');
      }
      throw new RemovalDecisionError('PIN_INVALID');
    }
    return this.commitSimpleDecision(
      request,
      { decision: decision.decision, temporaryDisableUntil: decision.temporaryDisableUntil },
      'LOCAL_ADMINISTRATION_PIN',
      'local-administration-pin',
    );
  }

  async decideWithAuthorizedRecovery(
    requestId: string,
    familyId: string,
    decision: RemovalDecisionInput,
    proof: AuthorizedRecoveryProof,
  ): Promise<RemovalDecisionRecord> {
    const request = await this.requirePending(requestId, familyId);
    const authorized = await this.recoveryAuthority.verifyAuthorizedRecovery({ request, decision, proof }).catch(() => false);
    if (!authorized) throw new RemovalDecisionError('NOT_AUTHORIZED');
    return this.commitSimpleDecision(
      request,
      decision,
      'AUTHORIZED_RECOVERY',
      `authorized-recovery:${isPlausibleOpaqueId(proof.recoveryTransactionId) ? proof.recoveryTransactionId : 'unknown'}`,
    );
  }

  async decideWithSignedRemoteParent(signedDecision: SignedRemovalDecision): Promise<RemovalDecisionRecord> {
    if (!isSignedRemovalDecisionObject(signedDecision)) throw new RemovalDecisionError('INVALID_INPUT');
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
    if (isActorResolutionFailure(targetDevice) || targetDevice.trustSetEpoch !== signedDecision.trustSetEpoch) {
      await this.recordDenied(request, signedDecision, 'NOT_AUTHORIZED');
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    }

    // A completed action can be retried idempotently, but only for the exact
    // signed binding previously committed. A different action or payload can
    // never turn a completed request into a second decision.
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
      decisionMethod: 'REMOTE_PARENT',
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
    await this.applyDeviceRevocationIfNeeded(decided);
    await this.emitAlert(decided, isUnenrollment(decided) ? 'UNENROLLMENT' : 'AUTHORITY_CHANGE');
    return decided;
  }

  private async requirePending(requestId: string, familyId: string): Promise<RemovalDecisionRecord> {
    if (!isPlausibleOpaqueId(requestId) || !isPlausibleOpaqueId(familyId)) throw new RemovalDecisionError('INVALID_INPUT');
    const request = await this.repository.get(requestId);
    if (request === null || request.familyId !== familyId) throw new RemovalDecisionError('NOT_FOUND');
    if (request.state !== 'PARENT_APPROVAL_REQUIRED') throw new RemovalDecisionError('INVALID_STATE');
    if (this.now().getTime() >= request.expiresAt.getTime()) throw new RemovalDecisionError('EXPIRED');
    return request;
  }

  private async commitSimpleDecision(
    request: RemovalDecisionRecord,
    input: RemovalDecisionInput,
    method: RemovalDecisionMethod,
    auditActorId: string,
  ): Promise<RemovalDecisionRecord> {
    validateDecisionShape(request, input, this.now());
    const next: RemovalDecisionRecord = {
      ...request,
      state: input.decision,
      decidedAt: this.now(),
      decisionMethod: method,
      temporaryDisableUntil: input.temporaryDisableUntil,
      decidedByDeviceId: null,
      decisionActionId: null,
      idempotencyKey: null,
      decisionFingerprint: null,
    };
    const result = await this.repository.commitDecision(request.requestId, next);
    if (result === 'ALREADY_DECIDED') {
      const current = await this.repository.get(request.requestId);
      if (current !== null && sameDecisionOutcome(current, next)) return current;
    }
    if (result !== 'APPLIED') throw new RemovalDecisionError('CONFLICT');

    await this.auditService.record({
      familyId: request.familyId,
      actionType: request.operation,
      actorDeviceId: auditActorId,
      actorMemberId: null,
      targetScope: { kind: 'CHILD_PROFILE', id: request.childId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: request.reasonCategory,
      correlationId: request.requestId,
      actionId: null,
      freeTextNote: `${method}:${input.decision}`,
    });
    await this.applyDeviceRevocationIfNeeded(next);
    await this.emitAlert(next, isUnenrollment(next) ? 'UNENROLLMENT' : 'AUTHORITY_CHANGE');
    return next;
  }

  /**
   * PCA-ADD-ENR-016/017: the decision record itself has already committed
   * (durably, via compare-and-set) by the time this runs -- ALLOW_REMOVAL
   * is the authorization for the device to actually be revoked, and this
   * is where that authorization is acted on. Scoped to REMOVE_REVOKE_DEVICE
   * only: a DISABLE_PROTECTION_POLICY request's ALLOW_REMOVAL outcome
   * means something else entirely (approval to disable the protection
   * policy) and must never revoke a device's identity.
   *
   * Best-effort and non-blocking, exactly like emitAlert below: a
   * revocation failure here (e.g. a transient DB error, or a crash before
   * this line runs at all) never reverses or blocks the already-committed
   * decision -- the decision is the parent's authoritative intent and must
   * stand regardless. What makes this safe rather than merely "best
   * effort and hope": DeviceDirectoryService.revokeDevice is idempotent,
   * and reconcilePendingRevocations (below) is the durable, retryable
   * recovery path for exactly the case where this inline attempt is lost
   * to a crash -- run it as a periodic reconciliation job (see
   * scripts/reconcile-pending-removals.mjs) so no ALLOW_REMOVAL decision
   * can silently leave its device un-revoked forever.
   */
  private async applyDeviceRevocationIfNeeded(record: RemovalDecisionRecord): Promise<void> {
    if (record.state !== 'ALLOW_REMOVAL' || record.operation !== 'REMOVE_REVOKE_DEVICE') return;
    if (this.deviceRevocation === null) return;
    try {
      await this.deviceRevocation.revokeDevice(record.familyId, record.deviceId);
    } catch {
      // Deliberately non-blocking -- see this method's own doc comment.
      // reconcilePendingRevocations is the durable retry path.
    }
  }

  /**
   * Crash-safety recovery: finds every ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE
   * decision whose target device the repository can see is not yet
   * revoked (see RemovalDecisionRepository.listAllowRemovalPendingDeviceRevocation's
   * own doc comment), and retries the revocation for each. Safe to call
   * repeatedly/on a schedule: DeviceDirectoryService.revokeDevice is
   * idempotent, so a device that was already revoked between the query and
   * this retry is simply a no-op, never a duplicate/harmful action.
   */
  async reconcilePendingRevocations(): Promise<{ attempted: number; succeeded: number; failedRequestIds: string[] }> {
    if (this.deviceRevocation === null) return { attempted: 0, succeeded: 0, failedRequestIds: [] };
    const pending = await this.repository.listAllowRemovalPendingDeviceRevocation();
    const failedRequestIds: string[] = [];
    let succeeded = 0;
    for (const record of pending) {
      try {
        await this.deviceRevocation.revokeDevice(record.familyId, record.deviceId);
        succeeded += 1;
      } catch {
        failedRequestIds.push(record.requestId);
      }
    }
    return { attempted: pending.length, succeeded, failedRequestIds };
  }

  /** PCA-ADD-ENR-020: best-effort alert emission. A composition/delivery failure never blocks or reverses a decision. */
  private async emitAlert(
    record: RemovalDecisionRecord,
    trigger: 'DISABLE_OR_REMOVAL_REQUESTED' | 'AUTHORITY_CHANGE' | 'REPEATED_INVALID_PIN' | 'UNENROLLMENT',
  ): Promise<void> {
    if (this.alerting === null) return;
    const alertsEnabled = typeof this.alerting.alertsEnabled === 'function' ? this.alerting.alertsEnabled() : this.alerting.alertsEnabled;
    if (!alertsEnabled) return;
    try {
      const parentDevices = await this.alerting.resolveParentDevices(record.familyId);
      for (const parentDevice of parentDevices) {
        await this.alerting.producer.produce({
          familyId: record.familyId,
          deviceId: record.deviceId,
          parentDeviceId: parentDevice.deviceId,
          trigger,
          keyEpoch: parentDevice.keyEpoch,
          alertsEnabled: true,
        });
      }
    } catch {
      // Alerting is deliberately non-blocking: the durable decision record above has already committed.
    }
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
    (!REMOVAL_REASON_CATEGORIES.has(input.reasonCategory as ReasonCategory) && input.reasonCategory !== null) ||
    input.protectiveAuthorityApplies !== true
  ) {
    throw new RemovalDecisionError('INVALID_INPUT');
  }
}

/** Shared decision-shape validation for the non-signed (PIN/recovery) modes: decision enum + bounded TEMPORARILY_DISABLE deadline. */
function validateDecisionShape(request: RemovalDecisionRecord, input: RemovalDecisionInput, now: Date): void {
  if (!REMOVAL_DECISIONS.has(input.decision)) throw new RemovalDecisionError('INVALID_INPUT');
  if (input.decision === 'TEMPORARILY_DISABLE') {
    if (
      !isValidDate(input.temporaryDisableUntil) ||
      input.temporaryDisableUntil.getTime() <= now.getTime() ||
      input.temporaryDisableUntil.getTime() > request.expiresAt.getTime()
    ) {
      throw new RemovalDecisionError('INVALID_INPUT');
    }
  } else if (input.temporaryDisableUntil !== null) {
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
    (!REMOVAL_REASON_CATEGORIES.has(decision.reasonCategory as ReasonCategory) && decision.reasonCategory !== null) ||
    !isValidDate(decision.issuedAt) ||
    !isValidDate(decision.expiresAt) ||
    (!isValidDate(decision.stepUp.assertedAt) && decision.stepUp.assertedAt !== null) ||
    (!isValidDate(decision.stepUp.freshUntil) && decision.stepUp.freshUntil !== null) ||
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
    (decision.decision === 'TEMPORARILY_DISABLE' &&
      (decision.temporaryDisableUntil === null ||
        !isValidDate(decision.temporaryDisableUntil) ||
        decision.temporaryDisableUntil.getTime() <= now.getTime() ||
        decision.temporaryDisableUntil.getTime() > decision.expiresAt.getTime())) ||
    (decision.decision !== 'TEMPORARILY_DISABLE' && decision.temporaryDisableUntil !== null)
  ) {
    const expired = isValidDate(decision.expiresAt) && now.getTime() >= decision.expiresAt.getTime();
    throw new RemovalDecisionError(expired ? 'ACTION_EXPIRED' : 'INVALID_INPUT');
  }

  return canonicalizeRemovalDecision(decision);
}

/**
 * PCA-ADD-ENR-020's UNENROLLMENT trigger: an ALLOW_REMOVAL decision on a
 * REMOVE_REVOKE_DEVICE request is this codebase's actual "device leaves
 * protection" event -- the same exact condition applyDeviceRevocationIfNeeded
 * already gates on. A DISABLE_PROTECTION_POLICY request's ALLOW_REMOVAL
 * outcome means something else entirely (approval to disable the policy,
 * never device revocation, per applyDeviceRevocationIfNeeded's own doc
 * comment) and must keep reporting as AUTHORITY_CHANGE, not UNENROLLMENT.
 */
function isUnenrollment(record: RemovalDecisionRecord): boolean {
  return record.state === 'ALLOW_REMOVAL' && record.operation === 'REMOVE_REVOKE_DEVICE';
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

function isSignedRemovalDecisionObject(value: unknown): value is SignedRemovalDecision {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SignedRemovalDecision>;
  return isPlausibleOpaqueId(candidate.requestId) && typeof candidate.signature === 'string' && candidate.signature.length > 0;
}

function fingerprint(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Superset equality check used by every repository's ALREADY_DECIDED comparison, covering both the signed-fingerprint shape and the PIN/recovery shape. */
function sameDecisionOutcome(a: RemovalDecisionRecord, b: RemovalDecisionRecord): boolean {
  return (
    a.state === b.state &&
    a.decisionMethod === b.decisionMethod &&
    (a.temporaryDisableUntil?.getTime() ?? null) === (b.temporaryDisableUntil?.getTime() ?? null) &&
    a.decisionActionId === b.decisionActionId &&
    a.idempotencyKey === b.idempotencyKey &&
    a.decisionFingerprint === b.decisionFingerprint
  );
}

function sameRequest(a: RemovalDecisionRecord, b: RemovalDecisionRecord): boolean {
  return (
    a.requestId === b.requestId &&
    a.familyId === b.familyId &&
    a.childId === b.childId &&
    a.deviceId === b.deviceId &&
    a.operation === b.operation &&
    a.protectionLevel === b.protectionLevel &&
    a.requestedAt.getTime() === b.requestedAt.getTime() &&
    a.expiresAt.getTime() === b.expiresAt.getTime() &&
    a.reasonCategory === b.reasonCategory &&
    a.protectiveAuthorityApplies === b.protectiveAuthorityApplies
  );
}

function cloneRecord(record: RemovalDecisionRecord): RemovalDecisionRecord {
  return {
    ...record,
    requestedAt: new Date(record.requestedAt),
    expiresAt: new Date(record.expiresAt),
    decidedAt: record.decidedAt === null ? null : new Date(record.decidedAt),
    temporaryDisableUntil: record.temporaryDisableUntil === null ? null : new Date(record.temporaryDisableUntil),
  };
}
