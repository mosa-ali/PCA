import type { FamilyRole, OpaqueDeviceId, OpaqueFamilyId } from '../familytrustset/types.js';

export type { FamilyRole };
export type ActionId = string;
export type IdempotencyKey = string;
export type OpaqueMemberId = string;
export type CorrelationId = string;

/**
 * doc 18 Section 2's exact operation table rows, one member per row (a row
 * naming two operations, e.g. "Add Viewer / remove non-owner parent", is
 * split into its two named members since they can have different targets).
 * `RECOVERY_SENSITIVE_ACTION` covers "reveal or regenerate recovery
 * material" -- deliberately its own operation, never folded into
 * OWNERSHIP_TRANSFER_INITIATION, since doc 18 Section 4 treats recovery
 * material exposure as its own no-ordinary-role-bypass case.
 */
export type ParentOperation =
  | 'VIEW_DASHBOARD'
  | 'EDIT_CHILD_POLICY'
  | 'APPROVE_BONUS_TIME'
  | 'APPROVE_UNBLOCK'
  | 'APPROVE_EXCEPTION'
  | 'ADD_VIEWER'
  | 'REMOVE_NON_OWNER_PARENT'
  | 'ADD_ADMINISTRATOR'
  | 'CHANGE_ROLE'
  | 'CHANGE_RETENTION'
  | 'DELETE_NOW'
  | 'EXPORT_FAMILY_DATA'
  | 'REMOVE_REVOKE_DEVICE'
  | 'DISABLE_PROTECTION_POLICY'
  | 'OWNERSHIP_TRANSFER_INITIATION'
  | 'RECOVERY_SENSITIVE_ACTION';

/**
 * doc 18 Section 2's table cells, modeled honestly rather than collapsed to
 * a boolean: "yes", "yes + step-up", "configurable policy + step-up", "no",
 * "no by default", "request only", "read-only", "own transparency only" are
 * seven DISTINCT authority shapes, not one allow/deny bit. UI visibility is
 * never authorization (doc 18 Section 1) -- this type is the matrix
 * OUTCOME, not a permission to trust without the device-side signed-envelope
 * check doc 18 requires downstream.
 */
export type AuthorizationVerdict =
  | 'ALLOW'
  | 'ALLOW_WITH_STEP_UP'
  | 'ALLOW_IF_CONFIGURED_WITH_STEP_UP'
  | 'ALLOW_READ_ONLY'
  | 'ALLOW_OWN_SCOPE_ONLY'
  | 'REQUEST_ONLY'
  | 'DENY';

/**
 * doc 18 Section 2: "An Owner may choose whether an Administrator can
 * add/remove a Viewer or revoke a child device; the safe default is off."
 * This is FAMILY-level configuration (part of E2EE, signed, auditable
 * policy), never a client-asserted flag -- callers must source it from the
 * same verified policy channel as the rest of family policy, never from
 * unauthenticated request input.
 */
export interface FamilyRbacPolicyConfig {
  administratorCanManageViewers: boolean;
  administratorCanRevokeDeviceOrDisableProtection: boolean;
}

export function defaultFamilyRbacPolicyConfig(): FamilyRbacPolicyConfig {
  return { administratorCanManageViewers: false, administratorCanRevokeDeviceOrDisableProtection: false };
}

export type TargetScopeKind = 'FAMILY' | 'CHILD_PROFILE' | 'DEVICE' | 'MEMBER';

/** What a ParentOperation acts on. `id` is opaque; `FAMILY` scope has no narrower id and `id` is the familyId itself. */
export interface TargetScope {
  kind: TargetScopeKind;
  id: string;
}

export type StepUpState = 'FRESH' | 'EXPIRED' | 'FAILED' | 'UNSUPPORTED' | 'CANCELLED';

/**
 * doc 18 Section 4's platform-neutral step-up contract. This module never
 * implements biometrics itself (Coordinator/PCA-2 bind platform
 * authentication later) -- it only defines the state shape a caller
 * presents and the freshness rule this module enforces.
 */
export interface StepUpAssertion {
  state: StepUpState;
  assertedAt: Date | null;
  /** Only meaningful when state === 'FRESH'; the assertion is stale past this instant even if state was captured as FRESH. */
  freshUntil: Date | null;
}

export type ReasonCategory =
  | 'ROUTINE_POLICY_CHANGE'
  | 'CHILD_SAFETY_CONCERN'
  | 'DEVICE_LOST_OR_STOLEN'
  | 'FAMILY_MEMBERSHIP_CHANGE'
  | 'RECOVERY'
  | 'OTHER';

/**
 * doc 18 Section 3/8: every parent action's binding fields. `requiredRole`
 * and `stepUpRequirement` are the matrix's OWN computed requirement for
 * `operation` (informational/audit provenance), never an input the caller
 * can override to weaken the check the authorization service independently
 * re-derives from `operation` and the resolved actor role.
 */
export interface ParentAction {
  actionId: ActionId;
  idempotencyKey: IdempotencyKey;
  familyId: OpaqueFamilyId;
  actorDeviceId: OpaqueDeviceId;
  actorMemberId: OpaqueMemberId | null;
  operation: ParentOperation;
  targetScope: TargetScope;
  requiredRole: FamilyRole;
  trustSetEpoch: number;
  policyRevision: number | null;
  issuedAt: Date;
  expiresAt: Date;
  stepUpRequired: boolean;
  correlationId: CorrelationId | null;
}

/** doc 18 Section 4: "binds the confirmation screen to the action, targets, and reason." No free-form sensitive information is required for authority (Section 8). */
export interface SensitiveActionConfirmation {
  actionId: ActionId;
  actorDeviceId: OpaqueDeviceId;
  targetScope: TargetScope;
  operation: ParentOperation;
  reasonCategory: ReasonCategory | null;
  stepUp: StepUpAssertion;
}

/** doc 18 Section 3's exact vocabulary. */
export type DeliveryStatus =
  | 'PENDING_DELIVERY'
  | 'APPLIED'
  | 'PARTIALLY_APPLIED'
  | 'DEVICE_OFFLINE'
  | 'EPOCH_STALE'
  | 'REVOKED'
  | 'FAILED';

/** One target device's acknowledgement of a ParentAction -- the ONLY input that may ever produce APPLIED (see deriveDeliveryStatus). */
export interface TargetAcknowledgement {
  deviceId: OpaqueDeviceId;
  acknowledgedActionId: ActionId;
  acknowledgedTrustSetEpoch: number;
  acknowledgedAt: Date;
  outcome: 'ACK_SUCCESS' | 'ACK_REJECTED_STALE_EPOCH' | 'ACK_REJECTED_REVOKED' | 'ACK_REJECTED_OTHER';
}
