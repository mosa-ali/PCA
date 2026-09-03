// Horizontal bar meter -- a progress bar (one segment) or a composition bar
// (several segments).
//
// RTL: THE FILL DOES MIRROR. It grows from the INLINE-START edge, which is the
// left under `ltr` and the right under `rtl`. That is achieved with
// `inline-size` on the segments (see `.chart-meter` in global.css), NOT with
// `transform: scaleX(-1)` -- a scale transform would also mirror any numeral
// or label drawn inside, which is exactly the bug the spec calls out.
//
// A segment's width comes from `--meter-fill`, its colour from `--meter-color`
// (always a status-ramp token, never a literal hex), so a bar segment and the
// pill for the same state are the same colour.
import type { CSSProperties } from 'react';

export interface MeterSegment {
  /** Stable key; also what a caller puts in the legend. Already localized. */
  label: string;
  /** Share of the whole, 0..1. Clamped. */
  fraction: number;
  /** A design token, e.g. `var(--status-attention-fg)`. */
  color: string;
}

export interface BarMeterProps {
  segments: MeterSegment[];
  /**
   * The accessible name. Omit ONLY when the exact same value is already
   * visible as adjacent text -- then the bar is decoration and is hidden from
   * assistive technology rather than announced twice.
   */
  label?: string;
}

function clamp(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

/**
 * CALLER CONTRACT: do not render a bar whose only content is a zero-width
 * fill in order to represent "unknown". An empty bar reads as "zero used",
 * which is a measurement claim. Render the honest `unverified` pill instead.
 */
export function BarMeter({ segments, label }: BarMeterProps) {
  const accessibility = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  return (
    // `display:flex` is set inline rather than as a new class: `.chart-meter`
    // is shared with the single-segment case, where the default block flow is
    // what makes one fill start at the inline-start edge.
    <div className="chart-meter" style={{ display: 'flex' }} {...accessibility}>
      {segments.map((segment) => (
        <span
          key={segment.label}
          style={
            {
              '--meter-fill': `${clamp(segment.fraction) * 100}%`,
              '--meter-color': segment.color,
              // The container's own radius + `overflow: hidden` shapes the ends;
              // rounding each segment would leave gaps between them.
              borderRadius: 0,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
