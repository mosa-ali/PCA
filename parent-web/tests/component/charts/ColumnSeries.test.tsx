// A TIME AXIS DOES NOT MIRROR.
//
// docs/architecture/20_I18N_ARABIC_RTL.md: "A time series remains chronological
// left-to-right unless a tested product design deliberately reverses the
// temporal axis... layout RTL alone must not make time appear to run
// backwards." Localise the tick labels; never reverse them.
//
// NOTE ON THIS COMPONENT'S STATUS: it has no dashboard call site, and that is
// deliberate -- there is no weekly/historical usage source in this codebase,
// so the "Weekly trend" card ships as an honest unavailable card rather than
// being fed an invented series. These tests exist so the component is a
// finished, correct thing waiting for real data, not a half-built one.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../../src/i18n';
import { ColumnSeries, type ColumnPoint } from '../../../src/components/charts/ColumnSeries';

const POINTS: ColumnPoint[] = [
  { label: 'Mon', value: 30, valueLabel: '30 minutes' },
  { label: 'Tue', value: 60, valueLabel: '60 minutes' },
  { label: 'Wed', value: 15, valueLabel: '15 minutes' },
];

function renderSeries(points: ColumnPoint[] = POINTS) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ColumnSeries title="Weekly trend" desc="Three days" points={points} color="var(--accent)" />
    </I18nextProvider>,
  );
}

function columnOrder(container: HTMLElement): { label: string; x: number }[] {
  return Array.from(container.querySelectorAll('g')).map((group) => ({
    label: group.querySelector('text')?.textContent ?? '',
    x: Number(group.querySelector('rect')?.getAttribute('x')),
  }));
}

describe('ColumnSeries', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('keeps oldest to newest left-to-right under ltr', () => {
    const { container } = renderSeries();
    const order = columnOrder(container);
    expect(order.map((c) => c.label)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(order[0].x).toBeLessThan(order[1].x);
    expect(order[1].x).toBeLessThan(order[2].x);
  });

  it('keeps oldest to newest left-to-right under rtl too -- time does not run backwards', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    const { container } = renderSeries();
    const order = columnOrder(container);
    expect(order.map((c) => c.label)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(order[0].x).toBeLessThan(order[1].x);
    expect(order[1].x).toBeLessThan(order[2].x);
    expect(container.innerHTML).not.toContain('scaleX');
  });

  it('scales column heights against the largest point', () => {
    const { container } = renderSeries();
    const heights = Array.from(container.querySelectorAll('rect')).map((rect) => Number(rect.getAttribute('height')));
    // Tue is the tallest; Wed is a quarter of it; Mon a half.
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[0]).toBeCloseTo(heights[1] / 2, 4);
    expect(heights[2]).toBeCloseTo(heights[1] / 4, 4);
  });

  it('scales against an explicit maximum when one is supplied', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ColumnSeries title="t" desc="d" points={POINTS} color="var(--accent)" maxValue={120} />
      </I18nextProvider>,
    );
    const heights = Array.from(container.querySelectorAll('rect')).map((rect) => Number(rect.getAttribute('height')));
    // Against a 120-minute ceiling, Tue's 60 is half the plot height (128px).
    expect(heights[1]).toBeCloseTo(64, 4);
  });

  it('carries the tabular equivalent in the same chronological order', () => {
    const { container } = renderSeries();
    const rows = Array.from(container.querySelectorAll('table.chart-data tbody tr')).map((row) => [
      row.querySelector('th')?.textContent,
      row.querySelector('td')?.textContent,
    ]);
    expect(rows).toEqual([
      ['Mon', '30 minutes'],
      ['Tue', '60 minutes'],
      ['Wed', '15 minutes'],
    ]);
  });
});
