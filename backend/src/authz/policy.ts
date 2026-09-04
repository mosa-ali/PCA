import type { ServiceOperation } from './types.js';

export interface OperationRequirements {
  /** Requires an ACTIVE service_account_family_scopes row for the target family. */
  requiresFamilyScope: boolean;
  /** Requires the account to hold an ACTIVE, unexpired license. */
  requiresLicense: boolean;
}

/**
 * Explicit, closed classification for every operation this layer knows
 * about. There is no default/fallback case: an operation not in this table
 * is a programming error (resolveRequirements throws), never silently
 * permitted.
 */
const OPERATION_MATRIX: Record<ServiceOperation, OperationRequirements> = {
  CREATE_INVITATION: { requiresFamilyScope: true, requiresLicense: true },
  VIEW_INVITATION_STATUS: { requiresFamilyScope: true, requiresLicense: false },
  REVOKE_INVITATION: { requiresFamilyScope: true, requiresLicense: false },
  LIST_OWN_INVITATIONS: { requiresFamilyScope: true, requiresLicense: false },
  VIEW_PAIRING_REQUEST: { requiresFamilyScope: true, requiresLicense: false },
  CONFIRM_PAIRING_REQUEST: { requiresFamilyScope: true, requiresLicense: false },
  REGISTER_BROWSER_ENDPOINT: { requiresFamilyScope: true, requiresLicense: false },
  LICENSE_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
  RELEASE_METADATA_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
  // PCA-BILL-2A: a paid device-limit-increase checkout requires an active
  // license, matching CREATE_INVITATION's requirement shape.
  INITIATE_CHECKOUT: { requiresFamilyScope: true, requiresLicense: true },
  VIEW_OWN_BILLING_STATUS: { requiresFamilyScope: true, requiresLicense: false },
  // PCA-COMMERCIAL-NOTIFY-1: no license requirement -- a family must still
  // be able to see e.g. a PAYMENT_FAILED or REQUEST_DENIED notification
  // even while its license is lapsed/absent.
  VIEW_OWN_NOTIFICATIONS: { requiresFamilyScope: true, requiresLicense: false },
  ACKNOWLEDGE_OWN_NOTIFICATION: { requiresFamilyScope: true, requiresLicense: false },
  // Parent-facing read of one of the caller's own family's device sync
  // status (parentRuntimeSyncRoutes.ts) -- same shape as VIEW_OWN_BILLING_STATUS.
  VIEW_DEVICE_SYNC_STATUS: { requiresFamilyScope: true, requiresLicense: false },
  // PPR-2 opaque child-profile membership registry. Neither requires a
  // license -- DELIBERATELY DIFFERENT from CREATE_INVITATION, and the
  // reason is a real, independently-verified finding: the `licenses` table
  // (migration 0001) has ZERO writers anywhere in this codebase, in any
  // environment, including seed-local.mjs. hasActiveLicense() therefore
  // returns false for every account today, which means CREATE_INVITATION
  // is UNREACHABLE end to end in the current real seeded stack -- a
  // pre-existing gap, orthogonal to this change, not introduced or fixed
  // here (see docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md). Gating
  // child-profile creation on the same never-populated table would make
  // the owner-mandated "new family -> create first child -> select child
  // for enrollment" acceptance flow unreachable too, for a reason that has
  // nothing to do with child profiles. LIST additionally matches
  // LIST_OWN_INVITATIONS's own precedent: a family must always be able to
  // see who is already there even while a license has lapsed.
  CREATE_CHILD_PROFILE: { requiresFamilyScope: true, requiresLicense: false },
  LIST_CHILD_PROFILES: { requiresFamilyScope: true, requiresLicense: false },
};

export function resolveRequirements(operation: ServiceOperation): OperationRequirements {
  const requirements = OPERATION_MATRIX[operation];
  if (!requirements) throw new Error(`No authorization requirements registered for operation: ${operation}`);
  return requirements;
}
