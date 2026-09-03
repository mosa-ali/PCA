// V2 -- Weekly trend.
//
// ============================================================================
// THIS CARD SHIPS AS AN HONEST "NOT AVAILABLE" AND THAT IS THE FEATURE.
//
// There is no weekly or historical usage data source anywhere in this
// codebase. `ScreenTimeStatus` (src/domain/types.ts) carries a single
// elapsed/limit pair -- one point. The only history-shaped API,
// `getActivityTimeline`, is per-child and category-level, and counting its
// entries per day would produce a chart of "how many events we happened to
// keep", not of how long a child used their device.
//
// So: no seven-day series is derived from the single elapsed-minutes value,
// no placeholder curve is drawn, no flat line at zero is drawn. A flat line at
// zero would be a positive claim that a child used their device for zero
// minutes on six days, which is a lie about a child's device.
//
// The card keeps its real title and its grid slot, so wiring a real series
// later is a data change and not a re-layout. `components/charts/ColumnSeries`
// is built and tested, and is waiting for that data.
// ============================================================================
import { useTranslation } from 'react-i18next';
import { ChartUnavailable } from '../charts/ChartFigure';

export function WeeklyTrendCard() {
  const { t } = useTranslation();
  const title = t('dashboard.weeklyTrend');
  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
      </div>
      <div className="card-body">
        <ChartUnavailable title={title} message={t('dashboard.weeklyTrendUnavailable')} captionVisible={false} />
      </div>
    </article>
  );
}
