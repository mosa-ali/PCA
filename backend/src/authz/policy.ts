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
  LICENSE_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
  RELEASE_METADATA_LOOKUP: { requiresFamilyScope: false, requiresLicense: false },
};

export function resolveRequirements(operation: ServiceOperation): OperationRequirements {
  const requirements = OPERATION_MATRIX[operation];
  if (!requirements) throw new Error(`No authorization requirements registered for operation: ${operation}`);
  return requirements;
}
