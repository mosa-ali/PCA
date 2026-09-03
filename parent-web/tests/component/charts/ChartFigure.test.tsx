// THE TABULAR EQUIVALENT IS NOT OPTIONAL.
//
// docs/architecture/26_ACCESSIBILITY_CHILD_UX.md: "A chart or timeline has an
// accessible tabular/text equivalent." A picture of a number is not a number,
// and a `<title>` alone does not let anyone read the values.
//
// These tests pin the container contract every chart in this folder inherits,
// including the "nothing honest to draw" case, which must never fall back to
// drawing a zero baseline.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../src/i18n';
import { ChartFigure, ChartUnavailable, MeterFigure } from '../../../src/components/charts/ChartFigure';
import { BarMeter } from '../../../src/components/charts/BarMeter';

const ROWS = [
  { label: 'Protected', value: '1' },
  { label: 'Not supported', value: '2' },
];

function wrap(node: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe('ChartFigure', () => {
  it('wires the svg to its own title and desc', () => {
    const { container } = wrap(
      <ChartFigure title="Protection overview" desc="One of three devices" viewBox="0 0 10 10" rows={ROWS}>
        <rect x="0" y="0" width="1" height="1" />
      </ChartFigure>,
    );

    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    const ids = (svg.getAttribute('aria-labelledby') as string).split(' ');
    expect(ids).toHaveLength(2);
    expect(container.querySelector('title')?.id).toBe(ids[0]);
    expect(container.querySelector('desc')?.id).toBe(ids[1]);
    expect(container.querySelector('desc')?.textContent).toBe('One of three devices');
  });

  it('emits a visually-hidden data table carrying every value as text', () => {
    const { container } = wrap(
      <ChartFigure title="t" desc="d" viewBox="0 0 10 10" rows={ROWS}>
        <rect x="0" y="0" width="1" height="1" />
      </ChartFigure>,
    );

    const table = container.querySelector('table.chart-data') as HTMLElement;
    expect(table.classList.contains('visually-hidden')).toBe(true);
    expect(table.querySelector('caption')?.textContent).toBe('Data shown in this chart');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(table.querySelectorAll('th[scope="row"]')).toHaveLength(2);
    expect(screen.getByText('Not supported')).toBeInTheDocument();
  });

  it('hides the duplicate caption when the enclosing card already shows the title', () => {
    const { container } = wrap(
      <ChartFigure title="t" desc="d" viewBox="0 0 10 10" rows={ROWS} captionVisible={false}>
        <rect x="0" y="0" width="1" height="1" />
      </ChartFigure>,
    );
    // Still emitted -- a figure without a caption is an unlabelled figure --
    // just not painted twice.
    expect(container.querySelector('figcaption')?.className).toBe('chart-title visually-hidden');
  });

  it('gives each legend entry its own swatch colour and label text, never colour alone', () => {
    const { container } = wrap(
      <ChartFigure
        title="t"
        desc="d"
        viewBox="0 0 10 10"
        rows={ROWS}
        legend={[{ label: 'Protected', color: 'var(--status-ok-fg)', count: '1' }]}
      >
        <rect x="0" y="0" width="1" height="1" />
      </ChartFigure>,
    );

    const item = container.querySelector('.chart-legend-item') as HTMLElement;
    expect(item.style.color).toBe('var(--status-ok-fg)');
    expect(item.textContent).toContain('Protected');
    expect(item.textContent).toContain('1');
  });
});

describe('MeterFigure', () => {
  it('keeps the tabular equivalent for the DOM-based bar, which has no svg title/desc', () => {
    const { container } = wrap(
      <MeterFigure title="Protection overview" desc="One of three" rows={ROWS}>
        <BarMeter label="One of three" segments={[{ label: 'a', fraction: 0.33, color: 'var(--status-ok-fg)' }]} />
      </MeterFigure>,
    );

    expect(container.querySelector('table.chart-data')?.querySelectorAll('tbody tr')).toHaveLength(2);
    // The bar itself carries the accessible name in place of <title>/<desc>.
    expect(container.querySelector('.chart-meter')?.getAttribute('aria-label')).toBe('One of three');
  });
});

describe('ChartUnavailable', () => {
  it('draws nothing that could be read as data', () => {
    const { container } = wrap(<ChartUnavailable title="Weekly trend" message="Weekly history isn't available yet." />);

    expect(container.querySelector('.chart-unavailable')).not.toBeNull();
    expect(screen.getByText("Weekly history isn't available yet.")).toBeInTheDocument();
    // No plotted geometry, and specifically no zero baseline: a flat line at
    // zero is a positive claim that the value was zero.
    expect(container.querySelectorAll('.chart-svg')).toHaveLength(0);
    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
    expect(container.querySelectorAll('.chart-meter')).toHaveLength(0);
  });
});
