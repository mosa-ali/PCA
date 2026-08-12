import { useTranslation } from 'react-i18next';
import type { PolicyStatus } from '../../domain/policyStatus';

/**
 * Renders a policy's real publication/delivery status (see
 * ../../domain/policyStatus.ts). A freshly-saved parent edit must render as
 * PENDING_SYNC/PENDING_DELIVERY here, never APPLIED, until a child-device
 * receipt proves application -- callers must never pass 'APPLIED' just
 * because a save call resolved.
 */
export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge policy-status-${status}`}>
      <span className="dot" aria-hidden="true" />
      {t(`policyStatus.${status}`)}
    </span>
  );
}
