import { useCallback } from 'react';
import { evaluatePermission, type FamilyAction } from '../domain/roles';
import type { SensitiveParentStepUpOperation } from '../api/interfaces';
import { useCurrentRole } from '../state/AuthContext';
import { useStepUp } from '../state/StepUpContext';

/**
 * Executes a family-authority-gated action. Always re-checks permission via
 * FamilyAuthorityGateway.checkPermission first (not just a hidden button),
 * runs a step-up re-authentication when the action requires it, and only then
 * calls the gateway operation. Parent browser pairing and trust epochs are
 * retired and are not an authorization input here. Throws if permission is
 * denied or step-up is denied, so callers surface the rejection rather than
 * assuming success.
 */
export function defaultSensitiveOperation(action: FamilyAction): SensitiveParentStepUpOperation | null {
  switch (action) {
    case 'ADD_ADMINISTRATOR': return 'family.member.add';
    case 'CHANGE_ANY_ROLE': return 'family.member.role_change';
    case 'REMOVE_NON_OWNER_PARENT': return 'family.member.remove';
    case 'CHANGE_RETENTION': return 'family.retention.update';
    case 'DELETE_HISTORY': return 'family.history.delete';
    case 'EXPORT_DATA': return 'family.history.export';
    case 'REMOVE_OR_REVOKE_DEVICE':
    case 'REVOKE_DEVICE_INVITATION': return 'family.device.enrollment.revoke';
    case 'CREATE_DEVICE_INVITATION': return 'family.device.enrollment.create';
    case 'DISABLE_PROTECTION_POLICY':
    case 'CONFIRM_DEVICE_PAIRING': return 'family.security.settings.change';
    case 'TRANSFER_OWNERSHIP': return 'family.ownership.transfer';
    case 'REVEAL_RECOVERY_MATERIAL': return 'family.recovery.material.reveal';
    default: return null;
  }
}

export function useFamilyAction() {
  const role = useCurrentRole();
  const { requestSensitiveStepUp } = useStepUp();

  return useCallback(
    async <T,>(action: FamilyAction, run: (stepUpToken?: string) => Promise<T>, sensitiveOperation?: SensitiveParentStepUpOperation): Promise<T> => {
      const permission = evaluatePermission(role, action);
      if (!permission.allowed) {
        throw new Error(permission.reason);
      }
      const operation = sensitiveOperation ?? defaultSensitiveOperation(action);
      if (operation) {
        const stepUpToken = await requestSensitiveStepUp(operation);
        if (!stepUpToken) throw new Error('Step-up authentication was cancelled or denied.');
        return run(stepUpToken);
      }
      return run();
    },
    [role, requestSensitiveStepUp],
  );
}
