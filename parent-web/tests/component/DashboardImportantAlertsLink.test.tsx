// GUARANTEE PRESERVED FROM THE PRE-PPR2 VERSION OF THIS TEST:
// a non-zero important-alert count is a LINK, and a zero count is NOT.
//
// One thing DID change on purpose: the destination. Alerts used to be
// reachable only from inside /security/status; the new information
// architecture gives them a page of their own at /safety/alerts and both the
// child-card badge and the KPI tile point there (design spec Sections 4.2 and
// 5.3). The click-through guarantee -- a count is never a dead-end number --
// is unchanged.
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
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


describe('Dashboard important-alerts click-through', () => {
  it('links a non-zero important-alert count to the alerts page instead of a dead-end number', async () => {
    renderWithProviders(<Dashboard />);

    const card = within(await childCard('Yousef (DEV)'));
    const link = card.getByRole('link', { name: '2 alerts' });
    expect(link.getAttribute('href')).toBe('/safety/alerts');
  });

  it('renders no important-alert badge at all for a zero count, so there is nothing to click', async () => {
    renderWithProviders(<Dashboard />);

    const amirCard = await childCard('Amir (DEV)');
    expect(within(amirCard).queryByRole('link', { name: /^\d+ alerts?$/ })).toBeNull();
    expect(amirCard.textContent).not.toContain('0 alerts');
  });

  it('links the important-alerts KPI to the alerts page once the count is non-zero', async () => {
    renderWithProviders(<Dashboard />);
    await childCard('Yousef (DEV)');

    // 0 + 1 + 2 across the three fixture children.
    const tile = screen.getByText('Important alerts').closest('.kpi-tile') as HTMLElement;
    expect(tile.tagName).toBe('A');
    expect(tile.getAttribute('href')).toBe('/safety/alerts');
    expect(within(tile).getByText('3')).toBeInTheDocument();
  });
});
