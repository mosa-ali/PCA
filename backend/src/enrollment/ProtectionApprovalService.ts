import type { AdministrationPinService } from './AdministrationPinService.js';

export const PROTECTION_REQUEST_MAX_LIFETIME_MS = 15 * 60 * 1000;

export type ProtectionOperation = 'REMOVE_REVOKE_DEVICE' | 'DISABLE_PROTECTION_POLICY';
export type ProtectionLevel = 'STANDARD' | 'PROTECTED' | 'DEGRADED' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED';
export type ProtectionApprovalState = 'PARENT_APPROVAL_REQUIRED' | 'KEEP_ACTIVE' | 'TEMPORARILY_DISABLE' | 'ALLOW_REMOVAL';
export type ProtectionDecision = Exclude<ProtectionApprovalState, 'PARENT_APPROVAL_REQUIRED'>;
export type ProtectionReasonCategory =
  | 'ROUTINE_POLICY_CHANGE'
  | 'CHILD_SAFETY_CONCERN'
  | 'DEVICE_LOST_OR_STOLEN'
  | 'FAMILY_MEMBERSHIP_CHANGE'
  | 'RECOVERY'
  | 'OTHER';

export interface ProtectionApprovalRequestInput {
  requestId: string;
  familyId: string;
  childId: string;
  deviceId: string;
  operation: ProtectionOperation;
  protectionLevel: ProtectionLevel;
  requestedAt: Date;
  expiresAt: Date;
  reasonCategory: ProtectionReasonCategory | null;
  /** The coordinator supplies this only after resolving the device's authority state. */
  protectiveAuthorityApplies: true;
}

export interface ProtectionApprovalRequest extends ProtectionApprovalRequestInput {
  state: ProtectionApprovalState;
  decidedAt: Date | null;
  decisionMethod: 'REMOTE_PARENT' | 'LOCAL_ADMINISTRATION_PIN' | 'AUTHORIZED_RECOVERY' | null;
  temporaryDisableUntil: Date | null;
}

export interface ProtectionDecisionInput {
  decision: ProtectionDecision;
  temporaryDisableUntil: Date | null;
}

export interface LocalPinDecisionInput extends ProtectionDecisionInput {
  /** Transient only; never part of a stored request or decision result. */
  pin: string;
}

export interface RemoteParentDecisionProof {
  /** Opaque proof verified by the coordinator's family-RBAC service. */
  signature: string;
  actorDeviceId: string;
  actionId: string;
  idempotencyKey: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface AuthorizedRecoveryProof {
  /** Opaque recovery proof; the enrollment service never interprets recovery material. */
  proof: string;
  recoveryTransactionId: string;
}

export interface ParentApprovalAuthority {
  /** Must verify signature, role, exact request binding, step-up, expiry, and replay. */
  verifyRemoteDecision(input: {
    request: ProtectionApprovalRequest;
    decision: ProtectionDecisionInput;
    proof: RemoteParentDecisionProof;
  }): Promise<boolean>;
  /** Must verify the approved recovery protocol and exact request binding. */
  verifyAuthorizedRecovery(input: {
    request: ProtectionApprovalRequest;
    decision: ProtectionDecisionInput;
    proof: AuthorizedRecoveryProof;
  }): Promise<boolean>;
}

export interface ProtectionApprovalRepository {
  get(requestId: string): Promise<ProtectionApprovalRequest | null>;
  listForFamily(familyId: string): Promise<ProtectionApprovalRequest[]>;
  create(request: ProtectionApprovalRequest): Promise<void>;
  decide(requestId: string, next: ProtectionApprovalRequest): Promise<'APPLIED' | 'ALREADY_DECIDED' | 'CONFLICT'>;
}

export class InMemoryProtectionApprovalRepository implements ProtectionApprovalRepository {
  private readonly requests = new Map<string, ProtectionApprovalRequest>();

  async get(requestId: string): Promise<ProtectionApprovalRequest | null> {
    const request = this.requests.get(requestId);
    return request === undefined ? null : cloneRequest(request);
  }

  async listForFamily(familyId: string): Promise<ProtectionApprovalRequest[]> {
    return [...this.requests.values()]
      .filter((request) => request.familyId === familyId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
      .map(cloneRequest);
  }

  async create(request: ProtectionApprovalRequest): Promise<void> {
    if (this.requests.has(request.requestId)) throw new ProtectionApprovalError('CONFLICT');
    this.requests.set(request.requestId, cloneRequest(request));
  }

  async decide(requestId: string, next: ProtectionApprovalRequest): Promise<'APPLIED' | 'ALREADY_DECIDED' | 'CONFLICT'> {
    const current = this.requests.get(requestId);
    if (current === undefined) return 'CONFLICT';
    if (current.state !== 'PARENT_APPROVAL_REQUIRED') {
      return sameDecision(current, next) ? 'ALREADY_DECIDED' : 'CONFLICT';
    }
    this.requests.set(requestId, cloneRequest(next));
    return 'APPLIED';
  }
}

export class ProtectionApprovalError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'EXPIRED'
    | 'NOT_AUTHORIZED'
    | 'PIN_NOT_CONFIGURED'
    | 'PIN_INVALID'
    | 'RATE_LIMITED'
    | 'INVALID_STATE'
    | 'CONFLICT';

  constructor(code: ProtectionApprovalError['code']) {
    super({
      INVALID_INPUT: 'Protection approval input is not valid.',
      NOT_FOUND: 'Protection approval request was not found.',
      EXPIRED: 'Protection approval request has expired.',
      NOT_AUTHORIZED: 'Protection approval was denied.',
      PIN_NOT_CONFIGURED: 'Administration PIN is not configured.',
      PIN_INVALID: 'Administration PIN was not accepted.',
      RATE_LIMITED: 'Administration PIN authorization is temporarily rate limited.',
      INVALID_STATE: 'Protection approval request is no longer awaiting a decision.',
      CONFLICT: 'Protection approval request conflicts with an existing request.',
    }[code]);
    this.name = 'ProtectionApprovalError';
    this.code = code;
  }
}

/**
 * Enrollment-owned state machine for PCA-ADD-ENR-016/017. It owns the
 * parent-facing request lifecycle and exact child/device metadata. Shared
 * family-RBAC, signed remote decisions, recovery authorization, and HTTP
 * route composition remain injected coordinator bindings.
 */
export class ProtectionApprovalService {
  private readonly repository: ProtectionApprovalRepository;
  private readonly pinService: AdministrationPinService;
  private readonly authority: ParentApprovalAuthority;
  private readonly now: () => Date;

  constructor(options: {
    repository: ProtectionApprovalRepository;
    pinService: AdministrationPinService;
    authority: ParentApprovalAuthority;
    now?: () => Date;
  }) {
    this.repository = options.repository;
    this.pinService = options.pinService;
    this.authority = options.authority;
    this.now = options.now ?? (() => new Date());
  }

  async createRequest(input: ProtectionApprovalRequestInput): Promise<ProtectionApprovalRequest> {
    validateRequest(input);
    const request: ProtectionApprovalRequest = {
      ...input,
      state: 'PARENT_APPROVAL_REQUIRED',
      decidedAt: null,
      decisionMethod: null,
      temporaryDisableUntil: null,
    };
    try {
      await this.repository.create(request);
    } catch (error) {
      // A client retry may race the original create. The opaque request id is
      // the durable correlation/idempotency key; replaying the exact request
      // returns the committed state, while reusing it for different target or
      // authority data remains a conflict.
      if (error instanceof ProtectionApprovalError && error.code === 'CONFLICT') {
        const existing = await this.repository.get(request.requestId);
        if (existing !== null && sameRequest(existing, request)) return cloneRequest(existing);
      }
      throw error;
    }
    return cloneRequest(request);
  }

  async listRequests(familyId: string): Promise<ProtectionApprovalRequest[]> {
    if (!isOpaqueId(familyId)) throw new ProtectionApprovalError('INVALID_INPUT');
    return (await this.repository.listForFamily(familyId)).map(cloneRequest);
  }

  async getRequest(familyId: string, requestId: string): Promise<ProtectionApprovalRequest | null> {
    if (!isOpaqueId(familyId) || !isOpaqueId(requestId)) throw new ProtectionApprovalError('INVALID_INPUT');
    const request = await this.repository.get(requestId);
    // A request identifier alone is never a family-membership proof. Wrong
    // family and unknown request collapse to the same null result.
    return request === null || request.familyId !== familyId ? null : request;
  }

  async decideWithLocalPin(
    requestId: string,
    familyId: string,
    decision: LocalPinDecisionInput,
  ): Promise<ProtectionApprovalRequest> {
    const request = await this.requirePending(requestId, familyId);
    const result = await this.pinService.verifyPin(familyId, decision.pin);
    // The PIN is accepted only as a transient argument and is never copied
    // into a request, proof, audit field, or error message.
    if (!result.ok) {
      if (result.code === 'NOT_CONFIGURED') throw new ProtectionApprovalError('PIN_NOT_CONFIGURED');
      if (result.code === 'RATE_LIMITED') throw new ProtectionApprovalError('RATE_LIMITED');
      throw new ProtectionApprovalError('PIN_INVALID');
    }
    return this.commitDecision(
      request,
      { decision: decision.decision, temporaryDisableUntil: decision.temporaryDisableUntil },
      'LOCAL_ADMINISTRATION_PIN',
    );
  }

  async decideWithRemoteParent(
    requestId: string,
    familyId: string,
    decision: ProtectionDecisionInput,
    proof: RemoteParentDecisionProof,
  ): Promise<ProtectionApprovalRequest> {
    const request = await this.requirePending(requestId, familyId);
    const authorized = await this.authority.verifyRemoteDecision({ request, decision, proof }).catch(() => false);
    if (!authorized) throw new ProtectionApprovalError('NOT_AUTHORIZED');
    return this.commitDecision(request, decision, 'REMOTE_PARENT');
  }

  async decideWithAuthorizedRecovery(
    requestId: string,
    familyId: string,
    decision: ProtectionDecisionInput,
    proof: AuthorizedRecoveryProof,
  ): Promise<ProtectionApprovalRequest> {
    const request = await this.requirePending(requestId, familyId);
    const authorized = await this.authority.verifyAuthorizedRecovery({ request, decision, proof }).catch(() => false);
    if (!authorized) throw new ProtectionApprovalError('NOT_AUTHORIZED');
    return this.commitDecision(request, decision, 'AUTHORIZED_RECOVERY');
  }

  private async requirePending(requestId: string, familyId: string): Promise<ProtectionApprovalRequest> {
    if (!isOpaqueId(requestId) || !isOpaqueId(familyId)) throw new ProtectionApprovalError('INVALID_INPUT');
    const request = await this.repository.get(requestId);
    if (request === null || request.familyId !== familyId) throw new ProtectionApprovalError('NOT_FOUND');
    if (request.state !== 'PARENT_APPROVAL_REQUIRED') throw new ProtectionApprovalError('INVALID_STATE');
    if (this.now().getTime() >= request.expiresAt.getTime()) throw new ProtectionApprovalError('EXPIRED');
    return request;
  }

  private async commitDecision(
    request: ProtectionApprovalRequest,
    input: ProtectionDecisionInput,
    method: ProtectionApprovalRequest['decisionMethod'],
  ): Promise<ProtectionApprovalRequest> {
    validateDecision(request, input, this.now());
    const next: ProtectionApprovalRequest = {
      ...request,
      state: input.decision,
      decidedAt: this.now(),
      decisionMethod: method,
      temporaryDisableUntil: input.temporaryDisableUntil,
    };
    const result = await this.repository.decide(request.requestId, next);
    if (result === 'ALREADY_DECIDED') {
      const current = await this.repository.get(request.requestId);
      if (current !== null && sameDecision(current, next)) return current;
    }
    if (result !== 'APPLIED') throw new ProtectionApprovalError('CONFLICT');
    return cloneRequest(next);
  }
}

function validateRequest(input: ProtectionApprovalRequestInput): void {
  if (
    !isOpaqueId(input.requestId) ||
    !isOpaqueId(input.familyId) ||
    !isOpaqueId(input.childId) ||
    !isOpaqueId(input.deviceId) ||
    !['REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY'].includes(input.operation) ||
    !['STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED'].includes(input.protectionLevel) ||
    !isValidDate(input.requestedAt) ||
    !isValidDate(input.expiresAt) ||
    input.expiresAt.getTime() <= input.requestedAt.getTime() ||
    input.expiresAt.getTime() - input.requestedAt.getTime() > PROTECTION_REQUEST_MAX_LIFETIME_MS ||
    input.protectiveAuthorityApplies !== true ||
    (input.reasonCategory !== null && !['ROUTINE_POLICY_CHANGE', 'CHILD_SAFETY_CONCERN', 'DEVICE_LOST_OR_STOLEN', 'FAMILY_MEMBERSHIP_CHANGE', 'RECOVERY', 'OTHER'].includes(input.reasonCategory))
  ) {
    throw new ProtectionApprovalError('INVALID_INPUT');
  }
}

function validateDecision(request: ProtectionApprovalRequest, input: ProtectionDecisionInput, now: Date): void {
  if (!['KEEP_ACTIVE', 'TEMPORARILY_DISABLE', 'ALLOW_REMOVAL'].includes(input.decision)) {
    throw new ProtectionApprovalError('INVALID_INPUT');
  }
  if (input.decision === 'TEMPORARILY_DISABLE') {
    if (
      !isValidDate(input.temporaryDisableUntil) ||
      input.temporaryDisableUntil.getTime() <= now.getTime() ||
      input.temporaryDisableUntil.getTime() > request.expiresAt.getTime()
    ) {
      throw new ProtectionApprovalError('INVALID_INPUT');
    }
  } else if (input.temporaryDisableUntil !== null) {
    throw new ProtectionApprovalError('INVALID_INPUT');
  }
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isOpaqueId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function sameDecision(a: ProtectionApprovalRequest, b: ProtectionApprovalRequest): boolean {
  return a.state === b.state && a.decisionMethod === b.decisionMethod && a.temporaryDisableUntil?.getTime() === b.temporaryDisableUntil?.getTime();
}

function sameRequest(a: ProtectionApprovalRequest, b: ProtectionApprovalRequest): boolean {
  return a.requestId === b.requestId
    && a.familyId === b.familyId
    && a.childId === b.childId
    && a.deviceId === b.deviceId
    && a.operation === b.operation
    && a.protectionLevel === b.protectionLevel
    && a.requestedAt.getTime() === b.requestedAt.getTime()
    && a.expiresAt.getTime() === b.expiresAt.getTime()
    && a.reasonCategory === b.reasonCategory
    && a.protectiveAuthorityApplies === b.protectiveAuthorityApplies
    && a.state === b.state
    && a.decidedAt === b.decidedAt
    && a.decisionMethod === b.decisionMethod
    && a.temporaryDisableUntil === b.temporaryDisableUntil;
}

function cloneRequest(request: ProtectionApprovalRequest): ProtectionApprovalRequest {
  return {
    ...request,
    requestedAt: new Date(request.requestedAt),
    expiresAt: new Date(request.expiresAt),
    decidedAt: request.decidedAt === null ? null : new Date(request.decidedAt),
    temporaryDisableUntil: request.temporaryDisableUntil === null ? null : new Date(request.temporaryDisableUntil),
  };
}
