// V3 -- Protection overview.
//
// One composition bar of every enrolled device by its honest protection state,
// plus a legend that prints the count for each state so the split is readable
// without relying on colour at all.
//
// The four states are kept SEPARATE on purpose. `AUTHORIZATION_REQUIRED` and
// `NOT_SUPPORTED` are the two cases where the console cannot actually enforce
// anything, and folding either of them into the good segment -- or omitting
// them because they are awkward -- is precisely the claim this product must
// never make. They are the same size, the same weight and the same bar as the
// protected segment; there is no `opacity` de-emphasis anywhere.
import { useTranslation } from 'react-i18next';
import type { DeviceProtectionStatus, ProtectionDisplayState } from '../../domain/types';
import { AsyncStates } from '../common/States';
import { formatNumber } from '../../i18n/formatters';
import { BarMeter } from '../charts/BarMeter';
import { MeterFigure } from '../charts/ChartFigure';
import { rampColorToken } from './dashboardModel';

/**
 * Segment order is fixed, best-understood first. Colours come from the status
 * ramp so a bar segment and the pill for the same state match -- except
 * STANDARD, which is `ok` on the ramp but is NOT "protected": it gets the
 * brand accent so the two good-but-different states stay distinguishable in a
 * single bar. The accent is not a status hue, so it cannot be misread as a
 * seventh state.
 */
const SEGMENTS: readonly { state: ProtectionDisplayState; color: string }[] = [
  { state: 'PROTECTED', color: rampColorToken('ok') },
  { state: 'STANDARD', color: 'var(--accent)' },
  { state: 'AUTHORIZATION_REQUIRED', color: rampColorToken('attention') },
  { state: 'NOT_SUPPORTED', color: rampColorToken('unverified') },
];

export interface ProtectionOverviewCardProps {
  devices: DeviceProtectionStatus[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ProtectionOverviewCard({ devices, loading, error, onRetry }: ProtectionOverviewCardProps) {
  const { t, i18n } = useTranslation();
  const title = t('dashboard.protectionOverview');
  const total = devices?.length ?? 0;
  const counts = SEGMENTS.map((segment) => ({
    ...segment,
    label: t(`state.${segment.state}`),
    count: devices?.filter((device) => device.protectionState === segment.state).length ?? 0,
  }));
  const present = counts.filter((entry) => entry.count > 0);

  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
      </div>
      <div className="card-body">
        <AsyncStates loading={loading} error={error} empty={devices !== null && total === 0} onRetry={onRetry}>
          <MeterFigure
            title={title}
            desc={title}
            captionVisible={false}
            rows={counts.map((entry) => ({ label: entry.label, value: formatNumber(entry.count, i18n.language) }))}
            legend={present.map((entry) => ({
              label: entry.label,
              color: entry.color,
              count: formatNumber(entry.count, i18n.language),
            }))}
          >
            <BarMeter
              label={title}
              segments={present.map((entry) => ({
                label: entry.label,
                fraction: total > 0 ? entry.count / total : 0,
                color: entry.color,
              }))}
            />
          </MeterFigure>
        </AsyncStates>
      </div>
    </article>
  );
}
