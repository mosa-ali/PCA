// V1 -- Screen time today.
//
// One aggregate ring for the children we actually have a reading for, then a
// per-child meter list so it is immediately visible WHICH children those are.
// A child with no usable reading is listed with its own honest pill and no
// bar; it is never quietly folded into the aggregate as a zero, and it is
// never omitted from the list or from the tabular equivalent.
//
// When no child has a usable reading the card renders `ChartUnavailable`
// rather than a ring at 0%. A gauge sitting at zero is a claim that no screen
// time was used today.
import { useTranslation } from 'react-i18next';
import type { ChildSummary } from '../../domain/types';
import { StatusBadge } from '../common/StatusBadge';
import { LoadingState } from '../common/States';
import { formatNumber } from '../../i18n/formatters';
import { BarMeter } from '../charts/BarMeter';
import { ChartUnavailable } from '../charts/ChartFigure';
import { RingGauge } from '../charts/RingGauge';
import { rampColorToken, screenTimeFraction, screenTimeRamp, usableScreenTime, type ScreenTimeReading } from './dashboardModel';

export interface ScreenTimeCardProps {
  childSummaries: ChildSummary[];
  readings: ReadonlyMap<string, ScreenTimeReading>;
  loading: boolean;
}

export function ScreenTimeCard({ childSummaries, readings, loading }: ScreenTimeCardProps) {
  const { t, i18n } = useTranslation();
  const title = t('dashboard.screenTimeToday');

  const ofLimit = (used: number, limit: number) =>
    t('dashboard.screenTimeOfLimit', {
      used: formatNumber(used, i18n.language),
      limit: formatNumber(limit, i18n.language),
    });

  const perChild = childSummaries.map((child) => {
    const reading = readings.get(child.childId);
    // NOT `reading.value`: a read can resolve and still be a state we cannot
    // vouch for. See `usableScreenTime`.
    const value = usableScreenTime(reading);
    return {
      child,
      value,
      fraction: screenTimeFraction(reading),
      text: value ? ofLimit(value.continuousUseElapsedMinutes, value.continuousUseLimitMinutes) : t(`state.${child.screenTimeState}`),
    };
  });

  const totalUsed = perChild.reduce((sum, row) => sum + (row.value?.continuousUseElapsedMinutes ?? 0), 0);
  const totalLimit = perChild.reduce((sum, row) => sum + (row.value?.continuousUseLimitMinutes ?? 0), 0);
  const aggregate = totalLimit > 0 ? Math.min(1, totalUsed / totalLimit) : null;
  const summary = ofLimit(totalUsed, totalLimit);

  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <LoadingState />
        ) : aggregate === null ? (
          <ChartUnavailable title={title} message={t('dashboard.kpi.cannotVerify')} captionVisible={false} />
        ) : (
          <>
            <RingGauge
              title={title}
              desc={summary}
              fraction={aggregate}
              centerLabel={formatNumber(totalUsed, i18n.language)}
              color={rampColorToken(screenTimeRamp(aggregate))}
              captionVisible={false}
              // Every child is in the table, including the ones with no
              // reading -- otherwise the table would quietly agree with a
              // ring that only counted some of them.
              rows={perChild.map((row) => ({ label: row.child.displayName, value: row.text }))}
            />
            <p className="text-muted" style={{ textAlign: 'center', marginBlock: 'var(--space-2) 0' }}>
              <bdi className="iso">{summary}</bdi>
            </p>
            <dl className="child-metrics">
              {perChild.map((row) => (
                <div className="child-metric" key={row.child.childId}>
                  <dt className="child-metric-label">
                    <bdi className="iso">{row.child.displayName}</bdi>
                  </dt>
                  <dd className="child-metric-value" style={{ margin: 0 }}>
                    {row.fraction === null ? (
                      <StatusBadge state={row.child.screenTimeState} />
                    ) : (
                      <div style={{ flex: '1 1 4rem', minInlineSize: '3rem' }}>
                        <BarMeter
                          segments={[{ label: row.child.childId, fraction: row.fraction, color: rampColorToken(screenTimeRamp(row.fraction)) }]}
                          label={row.text}
                        />
                      </div>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </article>
  );
}
