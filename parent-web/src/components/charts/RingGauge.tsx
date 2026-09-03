// Ring gauge -- "how much of the allowance is used".
//
// RTL: THE SWEEP DOES NOT MIRROR. It starts at 12 o'clock and runs clockwise
// in both `ltr` and `rtl`. Clockwise is a clock convention, not a reading
// direction; mirroring it would show an Arabic-reading parent a gauge that
// runs backwards. SVG user coordinates are unaffected by `direction`, so the
// arc geometry below is direction-independent by construction -- and there is
// deliberately no `scaleX(-1)` anywhere, which would also mirror the numerals.
import { ChartFigure, type ChartDataRow, type ChartLegendEntry } from './ChartFigure';

const SIZE = 120;
const CENTER = SIZE / 2;
const RADIUS = 48;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface RingGaugeProps {
  title: string;
  desc: string;
  /** 0..1. Clamped, and NaN/Infinity is treated as 0 sweep -- see the caller contract below. */
  fraction: number;
  /**
   * The already-formatted string drawn in the middle. The caller formats it
   * through i18n/formatters so digit shape follows the locale.
   */
  centerLabel: string;
  /** A design token, e.g. `var(--status-ok-fg)`. */
  color: string;
  rows: ChartDataRow[];
  legend?: ChartLegendEntry[];
  /** False when the enclosing card already shows this title as its own heading. */
  captionVisible?: boolean;
}

/**
 * CALLER CONTRACT: only render this when there IS a reading. A gauge drawn at
 * zero is a claim that the measured value was zero, which is not the same
 * thing as "we could not measure it" -- for that, render `ChartUnavailable`.
 */
export function RingGauge({ title, desc, fraction, centerLabel, color, rows, legend, captionVisible }: RingGaugeProps) {
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const swept = CIRCUMFERENCE * safe;
  return (
    <ChartFigure
      title={title}
      desc={desc}
      rows={rows}
      legend={legend}
      captionVisible={captionVisible}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      svgVariant="chart-ring"
      svgStyle={{ maxInlineSize: '9rem' }}
    >
      {/* -90deg puts the start of the arc at 12 o'clock. The rotation is about
          the gauge's own centre, so it is identical in both directions. */}
      <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--surface-raised)" strokeWidth={STROKE} />
        {swept > 0 && (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${swept} ${CIRCUMFERENCE}`}
          />
        )}
      </g>
      <text
        x={CENTER}
        y={CENTER}
        dy="0.35em"
        textAnchor="middle"
        fontSize="22"
        fontWeight="600"
        fill="var(--text-primary)"
        // The <title>/<desc> and the hidden table already carry this value as
        // real text; the drawn numeral would otherwise be read twice.
        aria-hidden="true"
      >
        {centerLabel}
      </text>
    </ChartFigure>
  );
}
