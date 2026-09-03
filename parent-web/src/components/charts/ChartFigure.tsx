// The container every chart on this console is drawn inside.
//
// Charts here are hand-rolled inline SVG and there is deliberately no chart
// library (see the design spec, Section 3.9.4): nothing chart-shaped is
// installed, the three shapes needed are ~40 lines each, and the two contracts
// that matter most -- the accessible tabular equivalent and the RTL rules --
// are properties of markup we control rather than something retro-fitted onto
// a library's generated DOM.
//
// THE ACCESSIBILITY CONTRACT IS NOT OPTIONAL. Every chart carries:
//   * `<title>` and `<desc>` inside the `<svg>`, wired with `aria-labelledby`;
//   * a `visually-hidden` `<table>` holding the same numbers as text.
// docs/architecture/26_ACCESSIBILITY_CHILD_UX.md: "A chart or timeline has an
// accessible tabular/text equivalent." A picture of a number is not a number.
//
// RTL, stated once here because every chart in this folder obeys it:
//   * the ring gauge sweep does NOT mirror -- clockwise is a clock convention,
//     not a reading direction;
//   * the column-series time axis does NOT mirror -- oldest to newest stays
//     left-to-right in both locales, or time appears to run backwards;
//   * the bar-meter fill DOES mirror -- it grows from the inline-start edge,
//     which `inline-size` gives us for free.
//   * `transform: scaleX(-1)` is banned everywhere in this folder: it would
//     mirror the numerals and labels drawn inside the chart too.
import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** One row of the mandatory tabular equivalent. Both fields are already localized. */
export interface ChartDataRow {
  label: string;
  value: string;
}

/** One legend entry. `color` is always a design token, never a literal hex. */
export interface ChartLegendEntry {
  label: string;
  color: string;
  /** Optional already-formatted count rendered after the label. */
  count?: string;
}

export interface ChartFigureProps {
  /** Visible caption AND the `<title>` of the svg -- one string, one meaning. */
  title: string;
  /** The textual summary a screen reader hears instead of the drawing. */
  desc: string;
  viewBox: string;
  /** The tabular equivalent. Never empty: a chart with nothing to say renders `ChartUnavailable` instead. */
  rows: ChartDataRow[];
  legend?: ChartLegendEntry[];
  /** Extra class on the `<svg>` (`chart-ring`, `chart-columns`). */
  svgVariant?: 'chart-ring' | 'chart-columns';
  svgStyle?: CSSProperties;
  /**
   * False when the enclosing card already shows this title as its own heading.
   * The `<figcaption>` is still emitted -- a figure without one is an unlabelled
   * figure -- it is just not painted twice.
   */
  captionVisible?: boolean;
  children: ReactNode;
}

/** `.chart-title` when the caption is the card's visible title, hidden when the card already shows it. */
function captionClass(visible: boolean): string {
  return visible ? 'chart-title' : 'chart-title visually-hidden';
}

export function ChartFigure({ title, desc, viewBox, rows, legend, svgVariant, svgStyle, captionVisible = true, children }: ChartFigureProps) {
  const { t } = useTranslation();
  const id = useId();
  const titleId = `${id}-t`;
  const descId = `${id}-d`;
  return (
    <figure className="chart">
      <figcaption className={captionClass(captionVisible)}>{title}</figcaption>
      <svg
        className={svgVariant ? `chart-svg ${svgVariant}` : 'chart-svg'}
        style={svgStyle}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        {children}
      </svg>
      <table className="chart-data visually-hidden">
        <caption>{t('dashboard.chartTableCaption')}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {legend && legend.length > 0 && (
        <ul className="chart-legend">
          {legend.map((entry) => (
            // The swatch is `background: currentColor`, so colouring the item
            // colours the swatch AND its label. Colour is never the only
            // encoding here: the label text is always present, and where a
            // count exists it is printed too.
            <li key={entry.label} className="chart-legend-item" style={{ color: entry.color }}>
              {entry.label}
              {entry.count !== undefined && (
                <>
                  {' '}
                  <bdi className="iso">{entry.count}</bdi>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export interface MeterFigureProps {
  title: string;
  /** The accessible name of the bar -- the textual summary, same role as `<desc>`. */
  desc: string;
  rows: ChartDataRow[];
  legend?: ChartLegendEntry[];
  captionVisible?: boolean;
  /** The `<BarMeter>` for this figure. */
  children: ReactNode;
}

/**
 * The same figure contract for the bar meter, which is DOM rather than SVG (it
 * has to be: `.chart-meter`'s fill uses `inline-size`, which is what makes it
 * mirror correctly under `dir="rtl"` without a scale transform).
 *
 * `<title>`/`<desc>` are svg-only constructs, so the meter's accessible name
 * is carried by `role="img"` + `aria-label` on the bar itself (supplied by the
 * caller as `desc`). The mandatory tabular equivalent is unchanged and still
 * not optional.
 */
export function MeterFigure({ title, rows, legend, captionVisible = true, children }: MeterFigureProps) {
  const { t } = useTranslation();
  return (
    <figure className="chart">
      <figcaption className={captionClass(captionVisible)}>{title}</figcaption>
      {children}
      <table className="chart-data visually-hidden">
        <caption>{t('dashboard.chartTableCaption')}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {legend && legend.length > 0 && (
        <ul className="chart-legend">
          {legend.map((entry) => (
            <li key={entry.label} className="chart-legend-item" style={{ color: entry.color }}>
              {entry.label}
              {entry.count !== undefined && (
                <>
                  {' '}
                  <bdi className="iso">{entry.count}</bdi>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/**
 * A chart that has NOTHING HONEST TO DRAW.
 *
 * This is the treatment for "no data source exists" and "the read did not
 * succeed" -- never a zero-value baseline, never a flat line, never a sample
 * curve. A flat line at zero is a positive claim that the value was zero, and
 * on this product that claim would be a lie about a child's device.
 *
 * It renders at the chart's own height so adding real data later does not
 * move the grid.
 */
export function ChartUnavailable({ title, message, captionVisible = true }: { title: string; message: string; captionVisible?: boolean }) {
  return (
    <figure className="chart">
      <figcaption className={captionClass(captionVisible)}>{title}</figcaption>
      <div className="chart-unavailable">
        <span className="state-icon" aria-hidden="true">
          {/* A shield with a question mark: "we cannot vouch for this", not "something broke". */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
            <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" strokeLinejoin="round" />
            <path d="M10.25 9.75a1.85 1.85 0 1 1 2.6 1.7c-.55.27-.85.75-.85 1.3v.5M12 16.5h.01" strokeLinecap="round" />
          </svg>
        </span>
        <p className="state-text">{message}</p>
      </div>
    </figure>
  );
}
