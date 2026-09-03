// GUARANTEE PRESERVED FROM THE PRE-PPR2 VERSION OF THIS TEST:
// a non-zero pending-request count is a LINK to /requests, and a zero count is
// NOT a link (it used to be a dead-end number a parent could not act on).
//
// On the compact child card a zero count is not rendered at all -- which is a
// stronger form of "not a link" -- so that is what is asserted there. The KPI
// tile still shows the zero, because the row always shows all six figures, and
// it too is asserted not to be a link.
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


describe('Dashboard pending-requests click-through', () => {
  it('links a non-zero pending-request count to /requests instead of a dead-end number', async () => {
    renderWithProviders(<Dashboard />);

    const card = within(await childCard('Amir (DEV)'));
    const link = card.getByRole('link', { name: '1 request' });
    expect(link.getAttribute('href')).toBe('/requests');
  });

  it('renders no pending-request badge at all for a zero count, so there is nothing to click', async () => {
    renderWithProviders(<Dashboard />);

    const yousefCard = await childCard('Yousef (DEV)');
    expect(within(yousefCard).queryByRole('link', { name: /^\d+ requests?$/ })).toBeNull();
    expect(yousefCard.textContent).not.toContain('0 requests');
  });

  it('links the pending-requests KPI to /requests once the count is non-zero', async () => {
    renderWithProviders(<Dashboard />);
    await childCard('Yousef (DEV)');

    // 1 + 2 + 0 across the three fixture children.
    const tile = screen.getByText('Pending requests').closest('.kpi-tile') as HTMLElement;
    expect(tile.tagName).toBe('A');
    expect(tile.getAttribute('href')).toBe('/requests');
    expect(within(tile).getByText('3')).toBeInTheDocument();
  });
});
