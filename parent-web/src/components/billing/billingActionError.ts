import type { TFunction } from 'i18next';
import { BillingApiError } from '../../api/real/realBillingClient';

/**
 * User-facing message for a failed commercial mutation. The two PCA-DEC-037
 * refusals get their own honest copy: a missing/expired/already-used step-up
 * grant asks for a new authenticator code (it is never a role problem), and a
 * plain 403 says the action is Administrator-only. Everything else keeps the
 * page's previous behaviour.
 */
export function billingActionErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof BillingApiError && error.serverCode === 'STEP_UP_REQUIRED') return t('stepUp.commercial.expired');
  if (error instanceof BillingApiError && error.code === 'FORBIDDEN') return t('stepUp.commercial.notPermitted');
  return error instanceof Error ? error.message : t('common.errorGeneric');
}
