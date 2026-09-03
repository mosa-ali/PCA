// V6 -- Bedtime and schedules.
//
// THE QUALIFIER IS MANDATORY. What this card shows is the CONFIGURED policy
// window, which is not the same thing as a window that is in force on a
// child's phone. It may be presented as actually in effect only for a child
// whose policy delivery is confirmed; for anyone else the row carries its real
// pending/limited/attention pill AND the words "Set, but not yet confirmed on
// the device".
//
// Showing a bedtime as active when the device never acknowledged it is exactly
// the failure this product exists to avoid: a parent would believe a phone
// switches off at 21:30 when it does not.
import { useTranslation } from 'react-i18next';
import type { ChildSummary } from '../../domain/types';
import { rampForStatus } from '../../domain/dashboardStatus';
import { DEFAULT_NIGHT_PROTECTION } from '../../domain/nightProtection';
import { StatusBadge } from '../common/StatusBadge';

export interface ScheduleCardProps {
  childSummaries: ChildSummary[];
}

export function ScheduleCard({ childSummaries }: ScheduleCardProps) {
  const { t } = useTranslation();
  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{t('dashboard.scheduleTitle')}</h3>
      </div>
      <div className="card-body">
        {/* The AR form of this key is `من {{start}} إلى {{end}}`; the bare
            `{{start}} - {{end}}` shape is a pinned bidi bug. Do not reformat. */}
        <p>{t('screenTime.nightProtectionWindow', DEFAULT_NIGHT_PROTECTION)}</p>
        <dl className="child-metrics">
          {childSummaries.map((child) => {
            const confirmed = rampForStatus(child.policyDeliveryState) === 'ok';
            return (
              <div className="child-metric" key={child.childId}>
                <dt className="child-metric-label">
                  <bdi className="iso">{child.displayName}</bdi>
                </dt>
                <dd className="child-metric-value" style={{ margin: 0 }}>
                  <StatusBadge state={child.policyDeliveryState} />
                  {!confirmed && <span className="text-muted">{t('dashboard.scheduleNotConfirmed')}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </article>
  );
}
