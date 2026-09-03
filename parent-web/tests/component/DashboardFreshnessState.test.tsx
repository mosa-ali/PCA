// GUARANTEE PRESERVED FROM THE PRE-PPR2 VERSION OF THIS TEST:
// all three data-freshness states must remain visibly distinguishable.
//
// The original asserted three "Data freshness" rows carrying the words Live /
// Cached / Unavailable. The dashboard now treats freshness as a separate axis
// from status: LIVE renders NO marker at all, which is a strictly stronger
// contract -- a marker on screen now always means "not verified right now".
// So the test asserts the same three-way distinction through the marker's
// presence, absence, and variant.
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

/**
 * The child card, located by its own name link. A child's display name also
 * appears in the visual cards and in every chart's hidden data table, so
 * `findByText` is ambiguous by design -- the card's link carries the
 * `dashboard.viewChild` accessible name, which is unique per child.
 */
async function childCard(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole('link', {
    name: (accessibleName: string) => accessibleName.startsWith(`Open ${name}`),
  });
  return link.closest('article') as HTMLElement;
}




describe('Dashboard data freshness state', () => {
  it('renders live, cached, and unavailable freshness states distinctly', async () => {
    renderWithProviders(<Dashboard />);

    // LIVE: absence of a marker IS the "verified" signal.
    expect((await childCard('Amir (DEV)')).querySelectorAll('.freshness-marker')).toHaveLength(0);

    // CACHED: an amber marker reading "Cached".
    const cached = (await childCard('Lina (DEV)')).querySelector('.freshness-marker');
    expect(cached).not.toBeNull();
    expect(cached).toHaveClass('freshness-cached');
    expect(cached).not.toHaveClass('freshness-unavailable');
    expect(cached?.textContent).toContain('Cached');

    // UNAVAILABLE: a violet marker reading "Not verified".
    const unavailable = (await childCard('Yousef (DEV)')).querySelector('.freshness-marker');
    expect(unavailable).not.toBeNull();
    expect(unavailable).toHaveClass('freshness-unavailable');
    expect(unavailable).not.toHaveClass('freshness-cached');
    expect(unavailable?.textContent).toContain('Not verified');
  });

  it('marks the KPI row unverified when any contributing child record is not live', async () => {
    const { container } = renderWithProviders(<Dashboard />);
    await childCard('Yousef (DEV)');

    // One child is CACHED and another UNAVAILABLE, so the aggregate is only as
    // verified as its least verified contributor: "Not verified", not "Cached".
    const activeDevices = screen.getByText('Active devices').closest('.kpi-tile') as HTMLElement;
    const marker = activeDevices.querySelector('.freshness-marker');
    expect(marker).toHaveClass('freshness-unavailable');

    // The plain child count is not a device-reported figure, so it carries no marker.
    const childrenTile = container.querySelectorAll('.kpi-tile')[0];
    expect(childrenTile.querySelectorAll('.freshness-marker')).toHaveLength(0);
  });
});
