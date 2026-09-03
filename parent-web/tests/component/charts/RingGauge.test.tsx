// THE RING GAUGE MUST NOT MIRROR.
//
// Clockwise is a clock convention, not a reading direction. Mirroring the
// sweep under `dir="rtl"` would show an Arabic-reading parent a gauge that
// runs backwards -- docs/architecture/20: never mirror an icon "whose semantic
// direction would become false".
//
// `transform: scaleX(-1)` is banned outright, in either direction: it would
// also mirror the numerals drawn inside the ring.
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../../src/i18n';
import { RingGauge } from '../../../src/components/charts/RingGauge';

const CIRCUMFERENCE = 2 * Math.PI * 48;

function renderGauge(fraction: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RingGauge
        title="Screen time today"
        desc="67 of 180 minutes"
        fraction={fraction}
        centerLabel="67"
        color="var(--status-ok-fg)"
        rows={[
          { label: 'Amir', value: '12 of 60 minutes' },
          { label: 'Lina', value: '55 of 60 minutes' },
        ]}
      />
    </I18nextProvider>,
  );
}

describe('RingGauge', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('sweeps the arc in proportion to the fraction', () => {
    const { container } = renderGauge(0.5);
    const arcs = container.querySelectorAll('circle');
    // Track plus progress arc.
    expect(arcs).toHaveLength(2);
    const [swept, total] = (arcs[1].getAttribute('stroke-dasharray') as string).split(' ').map(Number);
    expect(total).toBeCloseTo(CIRCUMFERENCE, 4);
    expect(swept).toBeCloseTo(CIRCUMFERENCE / 2, 4);
  });

  it('starts the sweep at 12 o\'clock', () => {
    const { container } = renderGauge(0.25);
    expect(container.querySelector('g')?.getAttribute('transform')).toBe('rotate(-90 60 60)');
  });

  it('draws no arc at all for a zero fraction rather than a hairline claiming zero', () => {
    const { container } = renderGauge(0);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('clamps a fraction beyond the limit instead of overdrawing the ring', () => {
    const { container } = renderGauge(1.8);
    const [swept] = (container.querySelectorAll('circle')[1].getAttribute('stroke-dasharray') as string)
      .split(' ')
      .map(Number);
    expect(swept).toBeCloseTo(CIRCUMFERENCE, 4);
  });

  it('renders identically under rtl -- the geometry does not mirror', async () => {
    // `useId` differs per render, and it is the only thing allowed to.
    const withoutIds = (svg?: string) => (svg ?? '').replace(/:r[0-9a-z]+:/g, ':id:');

    const ltr = withoutIds(renderGauge(0.3).container.querySelector('svg')?.outerHTML);

    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const rtl = withoutIds(renderGauge(0.3).container.querySelector('svg')?.outerHTML);

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(rtl).toBe(ltr);
  });

  it('never uses a scale transform, which would flip the numerals too', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = renderGauge(0.6);
    expect(container.innerHTML).not.toContain('scaleX');
    expect(container.innerHTML).not.toContain('scale(-1');
  });

  it('carries the mandatory title, desc and tabular equivalent', () => {
    const { container } = renderGauge(0.4);

    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    const [titleId, descId] = (svg.getAttribute('aria-labelledby') as string).split(' ');
    expect(container.querySelector(`#${CSS.escape(titleId)}`)?.tagName.toLowerCase()).toBe('title');
    expect(container.querySelector(`#${CSS.escape(descId)}`)?.textContent).toBe('67 of 180 minutes');

    const table = container.querySelector('table.chart-data') as HTMLElement;
    expect(table).not.toBeNull();
    expect(table.classList.contains('visually-hidden')).toBe(true);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('55 of 60 minutes')).toBeInTheDocument();
  });
});
