import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import CommercialPricing from '../../src/pages/CommercialPricing';

const { mockRoles } = vi.hoisted(() => ({ mockRoles: { current: ['APP_OWNER'] as string[] } }));

vi.mock('../../src/state/AuthContext', () => ({ useCurrentRoles: () => mockRoles.current }));
vi.mock('../../src/pages/entitlements/FreeAccessPolicy', () => ({ default: () => <h2>Free access panel</h2> }));
vi.mock('../../src/pages/billing/BillingPlans', () => ({ default: () => <h2>Plans panel</h2> }));
vi.mock('../../src/pages/billing/BillingPricing', () => ({ default: () => <h2>Price book panel</h2> }));
vi.mock('../../src/pages/billing/BillingQuotes', () => ({ default: () => <h2>Custom quotes panel</h2> }));

function LocationAndHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current URL">{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/commercial-pricing', element: <><CommercialPricing /><LocationAndHistory /></> },
      { path: '/elsewhere', element: <p>Elsewhere</p> },
    ],
    { initialEntries: ['/elsewhere', url], initialIndex: 1 },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe('Commercial & Pricing tab shell', () => {
  afterEach(() => {
    cleanup();
    mockRoles.current = ['APP_OWNER'];
    vi.clearAllMocks();
  });

  it('selects a deep-linked tab and normalizes an unknown tab to the default', async () => {
    renderAt('/commercial-pricing?tab=price-book');
    expect(await screen.findByText('Price book panel')).toBeTruthy();
    expect(screen.getByLabelText('Current URL').textContent).toBe('/commercial-pricing?tab=price-book');

    cleanup();
    renderAt('/commercial-pricing?tab=not-a-tab');
    expect(await screen.findByText('Free access panel')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Current URL').textContent).toBe('/commercial-pricing?tab=free-access-policy'));
  });

  it('updates the URL and supports browser back and forward between tabs', async () => {
    const user = userEvent.setup();
    renderAt('/commercial-pricing?tab=free-access-policy');

    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    expect(await screen.findByText('Plans panel')).toBeTruthy();
    expect(screen.getByLabelText('Current URL').textContent).toBe('/commercial-pricing?tab=plans');

    await user.click(screen.getByRole('tab', { name: 'Price Book' }));
    expect(await screen.findByText('Price book panel')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Plans panel')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(await screen.findByText('Price book panel')).toBeTruthy();
  });

  it('hides tabs outside the current role and redirects an unauthorized deep link to the first allowed tab', async () => {
    mockRoles.current = ['SUPPORT_ADMIN'];
    renderAt('/commercial-pricing?tab=plans');

    expect(await screen.findByText('Free access panel')).toBeTruthy();
    expect(screen.getByLabelText('Current URL').textContent).toBe('/commercial-pricing?tab=free-access-policy');
    expect(screen.queryByRole('tab', { name: 'Plans' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Price Book' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Free Access Policy' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Custom Quotes' })).toBeTruthy();
  });

  it('renders no tabs when the identity has no allowed roles', async () => {
    mockRoles.current = [];
    renderAt('/commercial-pricing?tab=plans');

    expect(await screen.findByText('Not permitted')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Commercial and pricing sections' })).toBeNull();
  });

  it('exposes the selected tab and supports arrow-key navigation', async () => {
    const user = userEvent.setup();
    renderAt('/commercial-pricing?tab=free-access-policy');
    const freeAccess = screen.getByRole('tab', { name: 'Free Access Policy' });
    expect(freeAccess.getAttribute('aria-selected')).toBe('true');
    await user.click(freeAccess);
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByText('Plans panel')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true');
  });
});
