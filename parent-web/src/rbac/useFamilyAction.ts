import { useCallback } from 'react';
import { getApiClients } from '../api/client';
import type { FamilyAction } from '../domain/roles';
import { useStepUp } from '../state/StepUpContext';

/**
 * Executes a family-authority-gated action. Always re-checks permission via
 * FamilyAuthorityGateway.checkPermission first (not just a hidden button),
 * runs a step-up re-authentication when the action requires it, and only
 * then calls the gateway operation. Throws if permission is denied so
 * callers surface the gateway's rejection rather than assuming success.
 */
export function useFamilyAction() {
  const clients = getApiClients();
  const { requestStepUp } = useStepUp();

  return useCallback(
    async <T,>(action: FamilyAction, run: () => Promise<T>): Promise<T> => {
      const permission = await clients.familyAuthority.checkPermission(action);
      if (!permission.allowed) {
        throw new Error(permission.reason);
      }
      if (permission.requiresStepUp) {
        const granted = await requestStepUp(action);
        if (!granted) {
          throw new Error('Step-up authentication was cancelled or denied.');
        }
      }
      return run();
    },
    [clients, requestStepUp],
  );
}
