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
  // OWNER DECISION (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part M):
  // basic/free V1 child-device enrollment must not require an active paid
  // license row -- core child-protection access must not be blocked merely
  // because no commercial license/bootstrap writer exists yet. This is
  // scoped exactly to CREATE_INVITATION's basic/free V1 enrollment path;
  // it is not a statement that every future PCA feature is free, and it
  // does not touch INITIATE_CHECKOUT (premium/commercial, still license-
  // gated below) or the licenses table/architecture themselves. Matches
  // CREATE_CHILD_PROFILE/LIST_CHILD_PROFILES's own, earlier requirement
  // shape -- see their comment below for the original independent finding
  // (zero writers to `licenses` anywhere in this codebase) this decision
  // now resolves for invitations too.
  CREATE_INVITATION: { requiresFamilyScope: true, requiresLicense: false },
  VIEW_INVITATION_STATUS: { requiresFamilyScope: true, requiresLicense: false },
  REVOKE_INVITATION: { requiresFamilyScope: true, requiresLicense: false },
  LIST_OWN_INVITATIONS: { requiresFamilyScope: true, requiresLicense: false },
  VIEW_PAIRING_REQUEST: { requiresFamilyScope: true, requiresLicense: false },
  CONFIRM_PAIRING_REQUEST: { requiresFamilyScope: true, requiresLicense: false },
  REGISTER_BROWSER_ENDPOINT: { requiresFamilyScope: true, requiresLicense: false },
  LICENSE_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
  RELEASE_METADATA_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
  // PCA-BILL-2A: a paid device-limit-increase checkout requires an active
  // license. Unaffected by CREATE_INVITATION's basic/free V1 owner decision
  // above -- this operation is the premium/commercial path, deliberately
  // still license-gated.
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
  // license -- now the SAME shape as CREATE_INVITATION above, both resting
  // on the same original, independently-verified finding: the `licenses`
  // table (migration 0001) has ZERO writers anywhere in this codebase, in
  // any environment, including seed-local.mjs. Gating child-profile
  // creation on that never-populated table would have made the
  // owner-mandated "new family -> create first child -> select child for
  // enrollment" acceptance flow unreachable for a reason that has nothing
  // to do with child profiles -- this was decided first, ahead of
  // CREATE_INVITATION's own later owner decision on the same table. LIST
  // additionally matches LIST_OWN_INVITATIONS's own precedent: a family
  // must always be able to see who is already there even while a license
  // has lapsed.
  CREATE_CHILD_PROFILE: { requiresFamilyScope: true, requiresLicense: false },
  LIST_CHILD_PROFILES: { requiresFamilyScope: true, requiresLicense: false },
};

export function resolveRequirements(operation: ServiceOperation): OperationRequirements {
  const requirements = OPERATION_MATRIX[operation];
  if (!requirements) throw new Error(`No authorization requirements registered for operation: ${operation}`);
  return requirements;
}
