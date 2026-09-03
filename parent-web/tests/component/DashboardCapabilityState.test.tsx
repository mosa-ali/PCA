// GUARANTEE PRESERVED FROM THE PRE-PPR2 VERSION OF THIS TEST:
// a stale protection capability must render as an explicit NON-ACTIVE state.
//
// The original located the value through `label.nextElementSibling` on the old
// ten-row `<dl>`. The dashboard is now a compact child card, so the selector
// changed -- the assertion did not. `status-EPOCH_STALE` and
// not-`status-ACTIVE` are still asserted verbatim, because that class contract
// is what stops a stale device being painted green.
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


describe('Dashboard capability states', () => {
  it('renders a stale protection capability as an explicit non-active state', async () => {
    renderWithProviders(<Dashboard />);

    const card = within(await childCard('Yousef (DEV)'));
    const protectionLabel = card.getByText('Protection');
    const protectionValue = protectionLabel.nextElementSibling?.querySelector('.status-badge');

    expect(protectionValue).not.toBeNull();
    expect(protectionValue).toHaveClass('status-EPOCH_STALE');
    expect(protectionValue).not.toHaveClass('status-ACTIVE');
  });

  it('never renders an `ok` headline pill for a child whose data is not live', async () => {
    renderWithProviders(<Dashboard />);

    // Lina's three states are LIMITED / PARTIALLY_APPLIED / PENDING_DELIVERY --
    // none of them bad -- but her read is CACHED, so the headline may not claim
    // any of them is current.
    const headline = (await childCard('Lina (DEV)')).querySelector('.child-headline-status .status-badge');

    expect(headline).not.toBeNull();
    expect(headline).toHaveClass('status-unverified');
    expect(headline).not.toHaveClass('status-ok');
    expect(headline?.textContent).toContain('Last known');
  });

  it('keeps a state worse than `unverified` at its own severity rather than softening it', async () => {
    renderWithProviders(<Dashboard />);

    // Yousef's read is UNAVAILABLE, but EPOCH_STALE is already an `attention`
    // state. Being unable to verify must not make a stale device look merely
    // unverified.
    const headline = (await childCard('Yousef (DEV)')).querySelector('.child-headline-status .status-badge');

    expect(headline).toHaveClass('status-EPOCH_STALE');
    expect(headline).not.toHaveClass('status-ok');
  });
});
