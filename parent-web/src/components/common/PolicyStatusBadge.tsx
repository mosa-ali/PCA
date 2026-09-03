import { useTranslation } from 'react-i18next';
import type { PolicyStatus } from '../../domain/policyStatus';
import { rampForPolicyStatus } from '../../domain/dashboardStatus';
import { StatusRampIcon } from './StatusBadge';

/**
 * Renders a policy's real publication/delivery status (see
 * ../../domain/policyStatus.ts). A freshly-saved parent edit must render as
 * PENDING_SYNC/PENDING_DELIVERY here, never APPLIED, until a child-device
 * receipt proves application -- callers must never pass 'APPLIED' just
 * because a save call resolved.
 *
 * The publication lifecycle is a second vocabulary mapped onto the SAME seven
 * -state ramp as `StatusBadge` (see ../../domain/dashboardStatus.ts), with the
 * same glyphs and the same pill weight, so "queued, pending delivery" carries
 * exactly as much visual presence as "applied on device". A pending state
 * rendered lighter than an applied one reads as a footnote, which is how a
 * parent ends up believing a change is in force when it is not.
 */
export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge policy-status-${status}`}>
      <StatusRampIcon ramp={rampForPolicyStatus(status)} />
      {t(`policyStatus.${status}`)}
    </span>
  );
}
