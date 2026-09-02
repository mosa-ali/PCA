// Family RBAC role model. This is NOT a central SQL role authority -- it is
// the client-side reflection of the signed Family Trust Set role assigned to
// the current member (see docs/architecture/18_PARENT_CONTROL_PANEL_RBAC.md
// and docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 3.2). Real
// enforcement happens server/device-side via signed envelopes; this module
// exists so the UI never pretends hiding a button is authorization.

export type FamilyRole = 'OWNER' | 'ADMINISTRATOR' | 'VIEWER' | 'CHILD';

// NOTE on VIEW_DEVICE_ENROLLMENT / CREATE_DEVICE_INVITATION /
// REVOKE_DEVICE_INVITATION / CONFIRM_DEVICE_PAIRING: the real backend
// authorization for these (backend/src/authz/policy.ts) is account
// family-scope + license based (AuthzService), NOT this client-side
// FamilyRole model -- there is no server-side mapping from
// OWNER/ADMINISTRATOR/VIEWER/CHILD to CREATE_INVITATION etc. today. The
// evaluation below is therefore a conservative client-side UX heuristic
// only (same tier as device revocation/policy edits), never authoritative
// -- the server's 403 (AuthzError) is the real rejection signal and every
// caller must handle it explicitly rather than trust this gate alone.

export type FamilyAction =
  | 'VIEW_DASHBOARD'
  | 'EDIT_CHILD_POLICY'
  | 'APPROVE_REQUEST'
  | 'ADD_VIEWER'
  | 'REMOVE_NON_OWNER_PARENT'
  | 'ADD_ADMINISTRATOR'
  | 'CHANGE_ANY_ROLE'
  | 'CHANGE_RETENTION'
  | 'DELETE_HISTORY'
  | 'EXPORT_DATA'
  | 'REMOVE_OR_REVOKE_DEVICE'
  | 'DISABLE_PROTECTION_POLICY'
  | 'TRANSFER_OWNERSHIP'
  | 'REVEAL_RECOVERY_MATERIAL'
  | 'MANAGE_WELLBEING_MESSAGES'
  | 'CREATE_CHILD_REQUEST'
  | 'VIEW_DEVICE_ENROLLMENT'
  | 'CREATE_DEVICE_INVITATION'
  | 'REVOKE_DEVICE_INVITATION'
  | 'CONFIRM_DEVICE_PAIRING'
  // PCA-ADD-BILL-040 (doc PCA_ADDENDUM_002 Section 18): billing/subscription
  // self-service is Family-Owner-only by default, same tier as
  // CHANGE_RETENTION/DELETE_HISTORY/EXPORT_DATA -- never delegable to
  // Administrator, unlike ADD_VIEWER/REMOVE_OR_REVOKE_DEVICE.
  | 'VIEW_BILLING'
  | 'REQUEST_DEVICE_INCREASE'
  | 'REQUEST_PARENT_MEMBER_INCREASE'
  | 'MANAGE_PAYMENT_METHOD';

/**
 * `reasonKey` is what the UI renders (PermissionGate's tooltip and the
 * /not-permitted page look it up through i18n, in the same `rbac.*` namespace
 * RolesMatrix/NotPermitted already use), so an Arabic parent reads Arabic.
 * `reason` is the unchanged English diagnostic: it is what the dev
 * FamilyAuthorityGateway and useFamilyAction still put on the thrown Error, so
 * it stays greppable in logs and in the audit trail. Never render `reason`.
 *
 * `reasonKey` is optional only because a PermissionResult can also be produced
 * by a gateway rather than by evaluatePermission below (see
 * api/real/unavailableProviders.ts's fail-closed denial). Every denial
 * evaluatePermission returns always carries one; consumers must fall back to
 * their own localized copy, never to `reason`.
 */
export type PermissionResult =
  | { allowed: true; requiresStepUp: boolean }
  | { allowed: false; reason: string; reasonKey?: string };

/** The `rbac.denialReason.*` i18n keys this module can produce. */
export type DenialReasonCode =
  | 'CHILD_ONLY_REQUEST_ACTION'
  | 'ROLE_NOT_RECOGNISED'
  | 'VIEWER_READ_ONLY_POLICY'
  | 'CHILD_CANNOT_EDIT_POLICY'
  | 'VIEWER_MANAGEMENT_NOT_DELEGATED'
  | 'OWNER_OR_DELEGATED_ADMIN_ONLY_VIEWERS'
  | 'OWNER_ONLY_STEP_UP'
  | 'OWNER_ONLY_RETENTION_DELETE_EXPORT'
  | 'DEVICE_REVOCATION_NOT_DELEGATED'
  | 'OWNER_OR_DELEGATED_ADMIN_ONLY_DEVICES'
  | 'ENROLLMENT_NOT_FOR_CHILD'
  | 'OWNER_OR_ADMIN_ONLY_INVITE_DEVICE'
  | 'INVITATION_REVOCATION_NOT_DELEGATED'
  | 'OWNER_OR_DELEGATED_ADMIN_ONLY_INVITATION'
  | 'OWNER_ONLY_BILLING'
  | 'UNRECOGNISED_ACTION';

const DENIAL_REASON_KEY_PREFIX = 'rbac.denialReason.';

export function denialReasonKey(code: DenialReasonCode): string {
  return `${DENIAL_REASON_KEY_PREFIX}${code}`;
}

/**
 * Reverses denialReasonKey. A consumer that only has the PermissionResult
 * (e.g. NotPermitted, re-evaluating the forwarded (role, action) pair) can
 * use this to recover the structured DenialReasonCode and look up
 * actionable "what to do next" guidance via nextStepKey below, without
 * NotPermitted needing its own second copy of the denial switch. Returns
 * null for anything that isn't one of this module's own denial keys (e.g.
 * there was no reasonKey to re-derive from at all).
 */
export function denialReasonCodeFromKey(reasonKey: string): DenialReasonCode | null {
  if (!reasonKey.startsWith(DENIAL_REASON_KEY_PREFIX)) return null;
  return reasonKey.slice(DENIAL_REASON_KEY_PREFIX.length) as DenialReasonCode;
}

/**
 * Buckets every DenialReasonCode into the actionable "what to do next"
 * guidance NotPermitted shows under the denial reason (rbac.nextStep.* i18n
 * keys) -- several codes share the same real-world next step (e.g. every
 * "only the Owner" denial has the same answer: ask the Owner), so this is a
 * many-to-one map rather than per-code copy. Exhaustive over
 * DenialReasonCode: a TS error here if a new code is ever added without
 * also deciding its bucket.
 */
const NEXT_STEP_BUCKET: Record<DenialReasonCode, 'ownerOnly' | 'notDelegated' | 'ownerOrAdmin' | 'askAParent' | 'other'> = {
  CHILD_ONLY_REQUEST_ACTION: 'other',
  ROLE_NOT_RECOGNISED: 'other',
  VIEWER_READ_ONLY_POLICY: 'askAParent',
  CHILD_CANNOT_EDIT_POLICY: 'askAParent',
  VIEWER_MANAGEMENT_NOT_DELEGATED: 'notDelegated',
  OWNER_OR_DELEGATED_ADMIN_ONLY_VIEWERS: 'ownerOrAdmin',
  OWNER_ONLY_STEP_UP: 'ownerOnly',
  OWNER_ONLY_RETENTION_DELETE_EXPORT: 'ownerOnly',
  DEVICE_REVOCATION_NOT_DELEGATED: 'notDelegated',
  OWNER_OR_DELEGATED_ADMIN_ONLY_DEVICES: 'ownerOrAdmin',
  ENROLLMENT_NOT_FOR_CHILD: 'askAParent',
  OWNER_OR_ADMIN_ONLY_INVITE_DEVICE: 'ownerOrAdmin',
  INVITATION_REVOCATION_NOT_DELEGATED: 'notDelegated',
  OWNER_OR_DELEGATED_ADMIN_ONLY_INVITATION: 'ownerOrAdmin',
  OWNER_ONLY_BILLING: 'ownerOnly',
  UNRECOGNISED_ACTION: 'other',
};

/** i18n key (under `rbac.nextStep.*`) for the actionable "what to do next" line NotPermitted shows for a given denial reason. */
export function nextStepKey(code: DenialReasonCode): string {
  return `rbac.nextStep.${NEXT_STEP_BUCKET[code]}`;
}

/**
 * Whether an Administrator may perform the "configurable" actions the Owner
 * can delegate (doc 18 table: add/remove Viewer, revoke device). Modeled
 * client-side as a family policy flag; defaults to the documented safe
 * default (off).
 */
export interface DelegableAdministratorPolicy {
  administratorsCanManageViewers: boolean;
  administratorsCanRevokeDevices: boolean;
}

export const SAFE_DEFAULT_DELEGATION: DelegableAdministratorPolicy = {
  administratorsCanManageViewers: false,
  administratorsCanRevokeDevices: false,
};

const STEP_UP_ACTIONS: ReadonlySet<FamilyAction> = new Set<FamilyAction>([
  'ADD_ADMINISTRATOR',
  'CHANGE_ANY_ROLE',
  'CHANGE_RETENTION',
  'DELETE_HISTORY',
  'EXPORT_DATA',
  'REMOVE_OR_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
  'TRANSFER_OWNERSHIP',
  'REVEAL_RECOVERY_MATERIAL',
  'ADD_VIEWER',
  'REMOVE_NON_OWNER_PARENT',
  'CREATE_DEVICE_INVITATION',
  'REVOKE_DEVICE_INVITATION',
  'CONFIRM_DEVICE_PAIRING',
  'REQUEST_DEVICE_INCREASE',
  'MANAGE_PAYMENT_METHOD',
]);

/**
 * Pure permission evaluation mirroring the doc 18 Section 2 matrix. This is
 * the single source of truth the UI consults; both route guards and the
 * FamilyAuthorityGateway dev implementation call into this so there is no
 * divergent second copy of the matrix.
 */
export function evaluatePermission(
  role: FamilyRole,
  action: FamilyAction,
  delegation: DelegableAdministratorPolicy = SAFE_DEFAULT_DELEGATION,
): PermissionResult {
  const requiresStepUp = STEP_UP_ACTIONS.has(action);
  const deny = (code: DenialReasonCode, reason: string): PermissionResult => ({
    allowed: false,
    reason,
    reasonKey: denialReasonKey(code),
  });
  const allow = (): PermissionResult => ({ allowed: true, requiresStepUp });

  switch (action) {
    case 'VIEW_DASHBOARD':
      return allow();
    case 'CREATE_CHILD_REQUEST':
      return role === 'CHILD' ? allow() : role === 'OWNER' || role === 'ADMINISTRATOR' || role === 'VIEWER'
        ? deny('CHILD_ONLY_REQUEST_ACTION', 'Only a child requests through this action; parents act via APPROVE_REQUEST/EDIT_CHILD_POLICY.')
        : deny('ROLE_NOT_RECOGNISED', 'Role not recognised.');
    case 'EDIT_CHILD_POLICY':
    case 'APPROVE_REQUEST':
    case 'MANAGE_WELLBEING_MESSAGES':
      if (role === 'OWNER' || role === 'ADMINISTRATOR') return allow();
      if (role === 'VIEWER') return deny('VIEWER_READ_ONLY_POLICY', 'Viewers are read-only and cannot edit family policy.');
      return deny('CHILD_CANNOT_EDIT_POLICY', 'A child may only submit requests, not edit policy.');
    case 'ADD_VIEWER':
    case 'REMOVE_NON_OWNER_PARENT':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanManageViewers
          ? allow()
          : deny('VIEWER_MANAGEMENT_NOT_DELEGATED', 'Owner has not delegated Viewer management to Administrators.');
      }
      return deny('OWNER_OR_DELEGATED_ADMIN_ONLY_VIEWERS', 'Only the Owner (or a delegated Administrator) may manage Viewers.');
    case 'ADD_ADMINISTRATOR':
    case 'CHANGE_ANY_ROLE':
    case 'TRANSFER_OWNERSHIP':
    case 'REVEAL_RECOVERY_MATERIAL':
      return role === 'OWNER'
        ? allow()
        : deny('OWNER_ONLY_STEP_UP', 'Only the Owner may perform this action, with step-up authentication.');
    case 'CHANGE_RETENTION':
    case 'DELETE_HISTORY':
    case 'EXPORT_DATA':
      return role === 'OWNER'
        ? allow()
        : deny('OWNER_ONLY_RETENTION_DELETE_EXPORT', 'Only the Owner may change retention, delete history, or export by default.');
    case 'REMOVE_OR_REVOKE_DEVICE':
    case 'DISABLE_PROTECTION_POLICY':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanRevokeDevices
          ? allow()
          : deny('DEVICE_REVOCATION_NOT_DELEGATED', 'Owner has not delegated device revocation to Administrators.');
      }
      return deny('OWNER_OR_DELEGATED_ADMIN_ONLY_DEVICES', 'Only the Owner (or a delegated Administrator) may revoke devices or disable protection.');
    case 'VIEW_DEVICE_ENROLLMENT':
      if (role === 'OWNER' || role === 'ADMINISTRATOR' || role === 'VIEWER') return allow();
      return deny('ENROLLMENT_NOT_FOR_CHILD', 'Device enrollment status is a parent-management surface, not shown to a Child.');
    case 'CREATE_DEVICE_INVITATION':
      if (role === 'OWNER' || role === 'ADMINISTRATOR') return allow();
      return deny('OWNER_OR_ADMIN_ONLY_INVITE_DEVICE', 'Only the Owner or an Administrator may invite a new child device.');
    case 'REVOKE_DEVICE_INVITATION':
    case 'CONFIRM_DEVICE_PAIRING':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanRevokeDevices
          ? allow()
          : deny('INVITATION_REVOCATION_NOT_DELEGATED', 'Owner has not delegated device revocation/pairing to Administrators.');
      }
      return deny('OWNER_OR_DELEGATED_ADMIN_ONLY_INVITATION', 'Only the Owner (or a delegated Administrator) may revoke an invitation or confirm device pairing.');
    case 'VIEW_BILLING':
    case 'REQUEST_DEVICE_INCREASE':
    case 'REQUEST_PARENT_MEMBER_INCREASE':
    case 'MANAGE_PAYMENT_METHOD':
      return role === 'OWNER'
        ? allow()
        : deny('OWNER_ONLY_BILLING', 'Billing and subscription self-service is Family-Owner-only by default and is not delegable to Administrators.');
    default:
      return deny('UNRECOGNISED_ACTION', 'Unrecognised action.');
  }
}

export const ROLE_LABEL_KEYS: Record<FamilyRole, string> = {
  OWNER: 'roles.owner',
  ADMINISTRATOR: 'roles.administrator',
  VIEWER: 'roles.viewer',
  CHILD: 'roles.child',
};
