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
  | 'CONFIRM_DEVICE_PAIRING';

export type PermissionResult =
  | { allowed: true; requiresStepUp: boolean }
  | { allowed: false; reason: string };

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
  const deny = (reason: string): PermissionResult => ({ allowed: false, reason });
  const allow = (): PermissionResult => ({ allowed: true, requiresStepUp });

  switch (action) {
    case 'VIEW_DASHBOARD':
      return allow();
    case 'CREATE_CHILD_REQUEST':
      return role === 'CHILD' ? allow() : role === 'OWNER' || role === 'ADMINISTRATOR' || role === 'VIEWER'
        ? deny('Only a child requests through this action; parents act via APPROVE_REQUEST/EDIT_CHILD_POLICY.')
        : deny('Role not recognised.');
    case 'EDIT_CHILD_POLICY':
    case 'APPROVE_REQUEST':
    case 'MANAGE_WELLBEING_MESSAGES':
      if (role === 'OWNER' || role === 'ADMINISTRATOR') return allow();
      if (role === 'VIEWER') return deny('Viewers are read-only and cannot edit family policy.');
      return deny('A child may only submit requests, not edit policy.');
    case 'ADD_VIEWER':
    case 'REMOVE_NON_OWNER_PARENT':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanManageViewers
          ? allow()
          : deny('Owner has not delegated Viewer management to Administrators.');
      }
      return deny('Only the Owner (or a delegated Administrator) may manage Viewers.');
    case 'ADD_ADMINISTRATOR':
    case 'CHANGE_ANY_ROLE':
    case 'TRANSFER_OWNERSHIP':
    case 'REVEAL_RECOVERY_MATERIAL':
      return role === 'OWNER' ? allow() : deny('Only the Owner may perform this action, with step-up authentication.');
    case 'CHANGE_RETENTION':
    case 'DELETE_HISTORY':
    case 'EXPORT_DATA':
      return role === 'OWNER' ? allow() : deny('Only the Owner may change retention, delete history, or export by default.');
    case 'REMOVE_OR_REVOKE_DEVICE':
    case 'DISABLE_PROTECTION_POLICY':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanRevokeDevices
          ? allow()
          : deny('Owner has not delegated device revocation to Administrators.');
      }
      return deny('Only the Owner (or a delegated Administrator) may revoke devices or disable protection.');
    case 'VIEW_DEVICE_ENROLLMENT':
      if (role === 'OWNER' || role === 'ADMINISTRATOR' || role === 'VIEWER') return allow();
      return deny('Device enrollment status is a parent-management surface, not shown to a Child.');
    case 'CREATE_DEVICE_INVITATION':
      if (role === 'OWNER' || role === 'ADMINISTRATOR') return allow();
      return deny('Only the Owner or an Administrator may invite a new child device.');
    case 'REVOKE_DEVICE_INVITATION':
    case 'CONFIRM_DEVICE_PAIRING':
      if (role === 'OWNER') return allow();
      if (role === 'ADMINISTRATOR') {
        return delegation.administratorsCanRevokeDevices
          ? allow()
          : deny('Owner has not delegated device revocation/pairing to Administrators.');
      }
      return deny('Only the Owner (or a delegated Administrator) may revoke an invitation or confirm device pairing.');
    default:
      return deny('Unrecognised action.');
  }
}

export const ROLE_LABEL_KEYS: Record<FamilyRole, string> = {
  OWNER: 'roles.owner',
  ADMINISTRATOR: 'roles.administrator',
  VIEWER: 'roles.viewer',
  CHILD: 'roles.child',
};
