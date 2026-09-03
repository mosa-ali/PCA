// THE BAR-METER FILL *DOES* MIRROR -- but never with a scale transform.
//
// It grows from the inline-start edge, which is the left under `ltr` and the
// right under `rtl`. That comes from `inline-size` on the segments
// (`.chart-meter` in global.css), so the markup is direction-agnostic and the
// browser does the mirroring. `transform: scaleX(-1)` would achieve the same
// visual flip while also mirroring every numeral and label drawn inside, which
// is why it is banned.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BarMeter } from '../../../src/components/charts/BarMeter';

describe('BarMeter', () => {
  it('sets each segment width from its fraction, as a percentage', () => {
    const { container } = render(
      <BarMeter
        label="Protection overview"
        segments={[
          { label: 'Protected', fraction: 0.25, color: 'var(--status-ok-fg)' },
          { label: 'Not supported', fraction: 0.75, color: 'var(--status-unverified-fg)' },
        ]}
      />,
    );

    const spans = container.querySelectorAll('.chart-meter > span');
    expect(spans).toHaveLength(2);
    expect((spans[0] as HTMLElement).style.getPropertyValue('--meter-fill')).toBe('25%');
    expect((spans[1] as HTMLElement).style.getPropertyValue('--meter-fill')).toBe('75%');
  });

  it('colours segments from status-ramp tokens, never a literal hex', () => {
    const { container } = render(
      <BarMeter segments={[{ label: 'a', fraction: 1, color: 'var(--status-attention-fg)' }]} label="x" />,
    );
    const span = container.querySelector('.chart-meter > span') as HTMLElement;
    expect(span.style.getPropertyValue('--meter-color')).toBe('var(--status-attention-fg)');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('clamps out-of-range fractions instead of overflowing the bar', () => {
    const { container } = render(
      <BarMeter
        segments={[
          { label: 'over', fraction: 4, color: 'var(--status-ok-fg)' },
          { label: 'under', fraction: -2, color: 'var(--status-ok-fg)' },
          { label: 'nan', fraction: Number.NaN, color: 'var(--status-ok-fg)' },
        ]}
        label="x"
      />,
    );
    const fills = Array.from(container.querySelectorAll('.chart-meter > span')).map((span) =>
      (span as HTMLElement).style.getPropertyValue('--meter-fill'),
    );
    expect(fills).toEqual(['100%', '0%', '0%']);
  });

  it('never uses a scale transform to mirror', () => {
    const { container } = render(
      <BarMeter segments={[{ label: 'a', fraction: 0.5, color: 'var(--status-ok-fg)' }]} label="x" />,
    );
    expect(container.innerHTML).not.toContain('scaleX');
    expect(container.innerHTML).not.toContain('transform');
  });

  it('is announced as an image when it is the only carrier of its value', () => {
    const { container } = render(
      <BarMeter label="12 of 60 minutes" segments={[{ label: 'a', fraction: 0.2, color: 'var(--status-ok-fg)' }]} />,
    );
    const meter = container.querySelector('.chart-meter') as HTMLElement;
    expect(meter.getAttribute('role')).toBe('img');
    expect(meter.getAttribute('aria-label')).toBe('12 of 60 minutes');
  });

  it('is hidden from assistive technology when adjacent text already states the value', () => {
    // Otherwise a screen reader announces "12 of 60 minutes" twice in a row.
    const { container } = render(
      <BarMeter segments={[{ label: 'a', fraction: 0.2, color: 'var(--status-ok-fg)' }]} />,
    );
    const meter = container.querySelector('.chart-meter') as HTMLElement;
    expect(meter.getAttribute('aria-hidden')).toBe('true');
    expect(meter.getAttribute('role')).toBeNull();
  });
});
