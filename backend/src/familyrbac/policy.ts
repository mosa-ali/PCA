import type {
  AuthorizationVerdict,
  DeliveryStatus,
  FamilyRbacPolicyConfig,
  FamilyRole,
  ParentOperation,
  TargetAcknowledgement,
} from './types.js';

export const MAX_ACTION_ID_LENGTH = 128;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
export const MAX_OPAQUE_ID_LENGTH = 128;
export const MAX_ACTION_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes -- an authorization/confirmation window, not a data-retention period
export const STEP_UP_MAX_FRESHNESS_MS = 5 * 60 * 1000; // doc 18 Section 4: "re-authenticated after a short session"
export const ACTION_IDEMPOTENCY_LEDGER_CAPACITY = 4096;

/**
 * doc 18 Section 2's table, transcribed cell-for-cell. Administrator is the
 * highest normal Parent Web role. Normal family
 * administration is therefore allowed with step-up; cryptographic/trust,
 * destructive privacy, platform, and commercial authority remains Owner-only
 * (OWNER is retained internally for the trust-root plane).
 */
const OPERATION_MATRIX: Record<ParentOperation, Record<FamilyRole, AuthorizationVerdict>> = {
  VIEW_DASHBOARD: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'ALLOW_READ_ONLY', CHILD: 'ALLOW_OWN_SCOPE_ONLY' },
  EDIT_CHILD_POLICY: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'DENY', CHILD: 'REQUEST_ONLY' },
  APPROVE_BONUS_TIME: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'DENY', CHILD: 'REQUEST_ONLY' },
  APPROVE_UNBLOCK: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'DENY', CHILD: 'REQUEST_ONLY' },
  APPROVE_EXCEPTION: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'DENY', CHILD: 'REQUEST_ONLY' },
  APPROVE_INSTALL: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW', VIEWER: 'DENY', CHILD: 'REQUEST_ONLY' },
  ADD_VIEWER: { OWNER: 'ALLOW', ADMINISTRATOR: 'ALLOW_WITH_STEP_UP', VIEWER: 'DENY', CHILD: 'DENY' },
  REMOVE_NON_OWNER_PARENT: {
    OWNER: 'ALLOW',
    ADMINISTRATOR: 'ALLOW_WITH_STEP_UP',
    VIEWER: 'DENY',
    CHILD: 'DENY',
  },
  ADD_ADMINISTRATOR: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'ALLOW_WITH_STEP_UP', VIEWER: 'DENY', CHILD: 'DENY' },
  CHANGE_ROLE: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'ALLOW_WITH_STEP_UP', VIEWER: 'DENY', CHILD: 'DENY' },
  CHANGE_RETENTION: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'DENY', VIEWER: 'DENY', CHILD: 'DENY' },
  DELETE_NOW: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'DENY', VIEWER: 'DENY', CHILD: 'DENY' },
  EXPORT_FAMILY_DATA: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'DENY', VIEWER: 'DENY', CHILD: 'DENY' },
  REMOVE_REVOKE_DEVICE: {
    OWNER: 'ALLOW_WITH_STEP_UP',
    ADMINISTRATOR: 'ALLOW_WITH_STEP_UP',
    VIEWER: 'DENY',
    CHILD: 'DENY',
  },
  DISABLE_PROTECTION_POLICY: {
    OWNER: 'ALLOW_WITH_STEP_UP',
    ADMINISTRATOR: 'ALLOW_WITH_STEP_UP',
    VIEWER: 'DENY',
    CHILD: 'DENY',
  },
  OWNERSHIP_TRANSFER_INITIATION: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'DENY', VIEWER: 'DENY', CHILD: 'DENY' },
  RECOVERY_SENSITIVE_ACTION: { OWNER: 'ALLOW_WITH_STEP_UP', ADMINISTRATOR: 'DENY', VIEWER: 'DENY', CHILD: 'DENY' },
};

/**
 * Pure matrix lookup. Default-deny for any operation/role pair this module
 * does not explicitly recognize -- an unknown ParentOperation (e.g. a
 * future operation added elsewhere without a matching matrix row, or a
 * malformed/forged operation string) resolves to DENY, never ALLOW.
 */
export type ResolvedAuthorizationVerdict = Exclude<AuthorizationVerdict, 'ALLOW_IF_CONFIGURED_WITH_STEP_UP'>;

/**
 * doc 18 Section 2 marks exactly TWO of its table rows as Owner-configurable, and
 * `FamilyRbacPolicyConfig` is the two booleans those rows are expressed as:
 *
 *   "Add Viewer / remove non-owner parent"                      -> Administrator: "configurable policy + step-up"
 *   "Remove/revoke device or disable protection policy"         -> Administrator: "configurable + step-up"
 *
 * and then: "An Owner may choose whether an Administrator can add/remove a Viewer
 * or revoke a child device; the safe default is off."
 *
 * THIS CONFIGURABLE LAYER IS NOT IMPLEMENTED. Two independent facts say so:
 *
 *   1. `ALLOW_IF_CONFIGURED_WITH_STEP_UP` is never used as a matrix cell, so no
 *      cell in OPERATION_MATRIX consults `config` at all.
 *   2. `resolveOperationAuthorization` does not read `config`; the parameter is
 *      accepted only so the call sites already carry the value when the layer is
 *      built. `test/familyrbac/policy.test.mjs` PROVES this insensitivity by
 *      feeding maximally-permissive and maximally-restrictive configs and
 *      asserting identical verdicts.
 *
 * The consequence is stated plainly rather than left to be inferred: the four
 * operations below are hard-coded `ALLOW_WITH_STEP_UP` for ADMINISTRATOR, so the
 * EFFECTIVE default on them is ON, while the documented default is OFF. The
 * safe default is not what runs today.
 *
 * Why this is not simply flipped here to `ALLOW_IF_CONFIGURED_WITH_STEP_UP`, which
 * would collapse to DENY and match the documented default: there is no writer.
 * `FamilyRbacPolicyConfigStore.setForFamily`/`loadFamily` have zero callers in
 * `src/**`, so no Owner, in any family, could ever turn the capability back on --
 * flipping the cells would not implement the documented feature, it would remove
 * Administrator capability outright with no way to restore it. And the writer
 * cannot be added in isolation either: doc 18 Section 2 requires "Policy
 * configuration is itself E2EE, signed, and auditable", so a policy write needs a
 * signed envelope and an audit record, neither of which exists on this surface
 * yet (`MySqlFamilyRbacPolicyConfigRepository` writes plaintext booleans with no
 * signature and no audit event).
 *
 * Tracked as PCA-DEC-034. Do not discharge it by adding a writer that bypasses
 * the signed/audited requirement, and do not discharge it by adding a test that
 * makes the register green.
 */
export const CONFIGURABLE_POLICY_OPERATIONS: readonly ParentOperation[] = [
  'ADD_VIEWER',
  'REMOVE_NON_OWNER_PARENT',
  'REMOVE_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
];

export function resolveOperationAuthorization(
  role: FamilyRole,
  operation: ParentOperation,
  config: FamilyRbacPolicyConfig,
): ResolvedAuthorizationVerdict {
  // Referenced deliberately so the gap above cannot be hidden by an
  // unused-parameter suppression: the value is threaded through every call site,
  // and it is discarded right here until PCA-DEC-034 is ruled on.
  void config;

  const row = OPERATION_MATRIX[operation];
  if (row === undefined) return 'DENY';
  const verdict = row[role];
  if (verdict === undefined) return 'DENY';

  // Fail-closed collapse, and currently DEAD: no matrix cell uses this verdict
  // (see CONFIGURABLE_POLICY_OPERATIONS). It is retained because it is the
  // correct treatment for the configurable cells once they exist -- an
  // unconfigured configurable operation must never be reachable -- and because
  // the alternative, treating it as ALLOW_WITH_STEP_UP, would silently grant
  // authority if a future cell were added with it.
  if (verdict === 'ALLOW_IF_CONFIGURED_WITH_STEP_UP') return 'DENY';
  return verdict;
}

export function requiresStepUp(verdict: ResolvedAuthorizationVerdict): verdict is 'ALLOW_WITH_STEP_UP' {
  return verdict === 'ALLOW_WITH_STEP_UP';
}

export function isRequestOnly(verdict: AuthorizationVerdict): boolean {
  return verdict === 'REQUEST_ONLY';
}

export function isPlausibleActionId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_ACTION_ID_LENGTH;
}

export function isPlausibleIdempotencyKey(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

/**
 * doc 18 Section 2: "Ownership transfer... creates a new trust-set epoch
 * and cannot be emulated by changing a role label." The CHANGE_ROLE
 * operation's authorization verdict (Owner-only + step-up) says WHO may
 * attempt an ordinary role change; it says nothing about WHICH roles are
 * reachable that way. This function is the separate, mandatory check any
 * CHANGE_ROLE-executing caller MUST apply to its target role: granting or
 * revoking OWNER through this path is always rejected, full stop --
 * assigning a new Owner is only ever reachable through the dedicated
 * ownership-transfer transaction (OWNERSHIP_TRANSFER_INITIATION and its
 * doc 21 two-party epoch flow), never as a value CHANGE_ROLE accepts.
 */
export function isRoleChangeTargetAllowed(targetRole: FamilyRole): boolean {
  return targetRole !== 'OWNER';
}

/**
 * doc 18 Section 3: "The panel must not show success for every target
 * merely because the initiator accepted the request." APPLIED requires at
 * least one target acknowledgement whose `acknowledgedActionId` matches
 * AND whose `acknowledgedTrustSetEpoch` matches the action's OWN epoch --
 * an ack for a stale epoch is never conflated with success. This function
 * takes ONLY the action's identity/epoch and the acks that arrived; it has
 * no parameter for "did the initiator accept" or "did Relay return 200",
 * so neither can influence the result even by caller error.
 */
export function deriveDeliveryStatus(
  actionId: string,
  trustSetEpoch: number,
  expectedTargetDeviceIds: readonly string[],
  acknowledgements: readonly TargetAcknowledgement[],
  offlineDeviceIds: readonly string[],
  now: Date,
  expiresAt: Date,
): DeliveryStatus {
  const relevant = acknowledgements.filter((a) => a.acknowledgedActionId === actionId);
  const byDevice = new Map<string, TargetAcknowledgement>();
  for (const ack of relevant) byDevice.set(ack.deviceId, ack);

  if (relevant.some((a) => a.outcome === 'ACK_REJECTED_REVOKED')) return 'REVOKED';

  const successAcks = expectedTargetDeviceIds
    .map((id) => byDevice.get(id))
    .filter(
      (a): a is TargetAcknowledgement =>
        a !== undefined && a.outcome === 'ACK_SUCCESS' && a.acknowledgedTrustSetEpoch === trustSetEpoch,
    );

  if (successAcks.length === expectedTargetDeviceIds.length && expectedTargetDeviceIds.length > 0) return 'APPLIED';
  if (successAcks.length > 0) return 'PARTIALLY_APPLIED';

  if (relevant.some((a) => a.outcome === 'ACK_REJECTED_STALE_EPOCH')) return 'EPOCH_STALE';

  if (now.getTime() > expiresAt.getTime()) return 'FAILED';

  const unackedTargets = expectedTargetDeviceIds.filter((id) => !byDevice.has(id));
  if (unackedTargets.length > 0 && unackedTargets.every((id) => offlineDeviceIds.includes(id))) {
    return 'DEVICE_OFFLINE';
  }

  return unackedTargets.length > 0 ? 'PENDING_DELIVERY' : 'FAILED';
}
