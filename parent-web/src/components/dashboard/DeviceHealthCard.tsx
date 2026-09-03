// V4 -- Device health.
//
// One row per child: which device, what state it is in, when we last heard
// from it, and how much battery it had.
//
// Two honesty details that are easy to get wrong here:
//   * `batteryPercent === null` renders "Battery unknown", NEVER "0%". A phone
//     reporting nothing and a phone about to die look identical if you print a
//     zero, and only one of them needs a parent to act.
//   * "last seen" always carries its freshness marker. A timestamp with no
//     marker means we verified it; a timestamp with one means we are repeating
//     what we were told earlier.
import { useTranslation } from 'react-i18next';
import type { ChildSummary, DeviceProtectionStatus } from '../../domain/types';
import { StatusBadge } from '../common/StatusBadge';
import { formatRelative } from '../../i18n/formatters';
import { FreshnessMarker } from './FreshnessMarker';

export interface DeviceHealthCardProps {
  childSummaries: ChildSummary[];
  /** Used only for the human device label; a missing list degrades to the child's name. */
  devices: DeviceProtectionStatus[] | null;
}

export function DeviceHealthCard({ childSummaries, devices }: DeviceHealthCardProps) {
  const { t, i18n } = useTranslation();
  const labelFor = (childId: string, fallback: string) =>
    devices?.find((device) => device.childId === childId)?.deviceLabel ?? fallback;

  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{t('dashboard.deviceHealth')}</h3>
      </div>
      <div className="card-body">
        <dl className="child-metrics">
          {childSummaries.map((child) => (
            <div className="child-metric" key={child.childId}>
              <dt className="child-metric-label">
                {/* A device label is family plaintext and may be mixed-script. */}
                <bdi className="iso">{labelFor(child.childId, child.displayName)}</bdi>
              </dt>
              <dd className="child-metric-value" style={{ margin: 0 }}>
                <StatusBadge state={child.deviceState} />
                <bdi className="iso">{formatRelative(child.lastSeenUtc, i18n.language)}</bdi>
                <FreshnessMarker state={child.dataFreshnessState} />
                <span className="text-muted">
                  {child.batteryPercent === null
                    ? t('common.batteryUnknown')
                    : t('common.battery', { percent: child.batteryPercent })}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}
