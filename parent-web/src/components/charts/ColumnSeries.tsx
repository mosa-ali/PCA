// Column series -- a short, categorical/temporal series of bars.
//
// ============================================================================
// THIS COMPONENT HAS NO DASHBOARD CALL SITE, ON PURPOSE.
//
// There is NO weekly or historical usage data anywhere in this codebase.
// `ScreenTimeStatus` (src/domain/types.ts) carries a single elapsed/limit pair
// -- one point, not a series -- and the only history-shaped API,
// `getActivityTimeline`, is per-child and category-level.
//
// So the dashboard's "Weekly trend" card ships as an honest UNAVAILABLE card
// (see components/dashboard/WeeklyTrendCard.tsx). Deriving seven days from one
// elapsed-minutes value, or drawing a placeholder curve, would fabricate a
// claim about a child's device. That is the one thing this product must never
// do, so this component is deliberately left unfed rather than fed something
// invented.
//
// It exists, and is unit-tested, so that wiring a real series later is a data
// change and not a re-layout. It renders ONLY what it is handed.
// ============================================================================
//
// RTL: THE TIME AXIS DOES NOT MIRROR. Points render in the order given,
// left-to-right, in both locales -- docs/architecture/20_I18N_ARABIC_RTL.md:
// "layout RTL alone must not make time appear to run backwards". Localise the
// tick labels; never reverse them. SVG user coordinates ignore `direction`, so
// the geometry below is direction-independent by construction.
import { ChartFigure, type ChartDataRow, type ChartLegendEntry } from './ChartFigure';

const WIDTH = 320;
const HEIGHT = 160;
const PAD_BLOCK_END = 24; // room for the tick labels
const PAD_BLOCK_START = 8;
const GAP = 8;

export interface ColumnPoint {
  /** Tick label, already localized (a weekday, a date). */
  label: string;
  value: number;
  /** The already-formatted value, for the tabular equivalent. */
  valueLabel: string;
}

export interface ColumnSeriesProps {
  title: string;
  desc: string;
  /** Oldest first. Rendered in this order, left to right, in BOTH directions. */
  points: ColumnPoint[];
  /** A design token, e.g. `var(--accent)`. */
  color: string;
  /**
   * The axis top. Defaults to the largest point. Pass the real limit when one
   * exists so the columns are read against it rather than against each other.
   */
  maxValue?: number;
  legend?: ChartLegendEntry[];
  /** False when the enclosing card already shows this title as its own heading. */
  captionVisible?: boolean;
}

/**
 * CALLER CONTRACT: `points` must be measured values. An all-zero series draws
 * a flat baseline, which is a positive claim that every period was zero -- for
 * "we have no series", render `ChartUnavailable`.
 */
export function ColumnSeries({ title, desc, points, color, maxValue, legend, captionVisible }: ColumnSeriesProps) {
  const top = Math.max(maxValue ?? 0, ...points.map((p) => (Number.isFinite(p.value) ? p.value : 0)), 1);
  const plotHeight = HEIGHT - PAD_BLOCK_END - PAD_BLOCK_START;
  const slot = points.length > 0 ? WIDTH / points.length : WIDTH;
  const barWidth = Math.max(slot - GAP, 1);
  const baseline = HEIGHT - PAD_BLOCK_END;

  return (
    <ChartFigure
      title={title}
      desc={desc}
      rows={points.map((p) => ({ label: p.label, value: p.valueLabel }) satisfies ChartDataRow)}
      legend={legend}
      captionVisible={captionVisible}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      svgVariant="chart-columns"
    >
      <line x1={0} y1={baseline} x2={WIDTH} y2={baseline} stroke="var(--border)" strokeWidth={1} />
      {points.map((point, index) => {
        const value = Number.isFinite(point.value) ? Math.max(0, point.value) : 0;
        const height = (value / top) * plotHeight;
        const x = index * slot + GAP / 2;
        return (
          <g key={point.label}>
            <rect x={x} y={baseline - height} width={barWidth} height={height} rx={3} fill={color} />
            <text
              x={x + barWidth / 2}
              y={baseline + 15}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-tertiary)"
              aria-hidden="true"
            >
              {point.label}
            </text>
          </g>
        );
      })}
    </ChartFigure>
  );
}
