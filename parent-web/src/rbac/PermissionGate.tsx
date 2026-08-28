import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FamilyAction } from '../domain/roles';
import { evaluatePermission } from '../domain/roles';
import { useCurrentRole } from '../state/AuthContext';

interface PermissionGateProps {
  action: FamilyAction;
  children: ReactNode;
  /** When true, render a disabled control + explanation instead of hiding entirely. */
  showDisabledFallback?: boolean;
}

/**
 * UI-level convenience only -- hiding/disabling here is NOT the security
 * boundary. Every actual mutation still goes through useFamilyAction, which
 * re-checks permission at the gateway. See docs/architecture/18 Section 1.
 */
export function PermissionGate({ action, children, showDisabledFallback = false }: PermissionGateProps) {
  const { t } = useTranslation();
  const role = useCurrentRole();
  const result = evaluatePermission(role, action);

  if (result.allowed) return <>{children}</>;
  if (!showDisabledFallback) return null;

  // The tooltip is user-facing copy, so it must be the localized reason
  // (result.reasonKey), never result.reason -- that field is the English
  // developer diagnostic (see domain/roles.ts).
  return (
    <div
      className="permission-disabled"
      aria-disabled="true"
      title={result.reasonKey ? t(result.reasonKey) : t('rbac.denied')}
    >
      <span className="permission-disabled-badge">{t('rbac.denied')}</span>
    </div>
  );
}
