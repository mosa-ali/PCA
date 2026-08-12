import { useCallback } from 'react';
import { getApiClients } from '../api/client';
import type { FamilyAction } from '../domain/roles';
import { useStepUp } from '../state/StepUpContext';

/** Actions that read only, and so are not blocked by an unconverged trusted-browser epoch. */
const EPOCH_EXEMPT_ACTIONS: ReadonlySet<FamilyAction> = new Set<FamilyAction>(['VIEW_DASHBOARD']);

/**
 * Trusted-browser states that must block sensitive family-authority
 * mutations even though the *role* check would otherwise allow them. A
 * browser with a stale or revoked trust epoch must not be able to write
 * family policy off cached UI state -- convergence (re-sync or re-pairing)
 * must happen first (docs/architecture/09_SECURITY_PRIVACY_E2EE.md
 * Section 3.3). Pre-trust states (BROWSER_NOT_TRUSTED / PAIRING_REQUIRED /
 * PAIRING_PENDING) are intentionally NOT included here -- those gate
 * *decryption* of family content (see TrustedBrowserProvider), which is a
 * separate concern from the role-based mutation gateway this hook enforces.
 */
const EPOCH_BLOCKING_STATES: ReadonlySet<string> = new Set(['EPOCH_STALE', 'REVOKED']);

/**
 * Executes a family-authority-gated action. Always re-checks permission via
 * FamilyAuthorityGateway.checkPermission first (not just a hidden button),
 * confirms the trusted-browser epoch has not gone stale/revoked (a browser
 * whose trust has lapsed must not be able to perform sensitive mutations
 * even if cached UI state looks fine), runs a step-up re-authentication
 * when the action requires it, and only then calls the gateway operation.
 * Throws if permission is denied or the browser trust state blocks the
 * action, so callers surface the rejection rather than assuming success.
 */
export function useFamilyAction() {
  const clients = getApiClients();
  const { requestStepUp } = useStepUp();

  return useCallback(
    async <T,>(action: FamilyAction, run: () => Promise<T>): Promise<T> => {
      if (!EPOCH_EXEMPT_ACTIONS.has(action)) {
        const trustedBrowserSnapshot = await clients.trustedBrowser.getSnapshot();
        if (EPOCH_BLOCKING_STATES.has(trustedBrowserSnapshot.state)) {
          throw new Error(
            `This browser's trust state (${trustedBrowserSnapshot.state}) does not permit family-authority ` +
              'mutations right now. Sensitive changes are blocked until the trusted-browser epoch converges ' +
              '(re-sync or re-pair) -- cached UI state is never sufficient authorization.',
          );
        }
      }

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
