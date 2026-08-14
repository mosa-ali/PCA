import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import Subscription from '../../src/pages/Subscription';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevBillingStateForTests } from '../../src/api/dev/devBillingClient';

function TestApp() {
  return (
    <Routes>
      <Route path="/subscription" element={<Subscription />} />
    </Routes>
  );
}

describe('Subscription overview (PCA-MYKIDS-BILL-1)', () => {
  beforeEach(() => __resetDevBillingStateForTests());

  it('shows the FREE_STARTER badge, its included device count, and an explicit FREE price -- never a hardcoded upgrade price', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });
    expect(await screen.findByText('Free Starter')).toBeInTheDocument();
    expect(screen.getByText('1 managed device included')).toBeInTheDocument();
    expect(screen.getByText('Price: Free')).toBeInTheDocument();
  });

  it('shows managed-device allowance distinguishing active vs. reserved vs. limit', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });
    await screen.findByText('Managed device allowance');
    expect(screen.getByText('Active devices').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Pending invitations (reserved)').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('Device limit').nextElementSibling?.textContent).toBe('1');
  });

  it('shows parent-member allowance', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });
    await screen.findByText('Parent member allowance');
    expect(screen.getByText('Parent members used').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Parent member limit').nextElementSibling?.textContent).toBe('1');
  });

  it('offers a link to request more devices and to view invoices', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });
    expect(await screen.findByRole('link', { name: 'Request more devices' })).toHaveAttribute('href', '/subscription/increase-devices');
    expect(screen.getByRole('link', { name: 'View invoices and receipts' })).toHaveAttribute('href', '/subscription/invoices');
  });

  it('shows a safe "no payment method" state when none is on file', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });
    expect(await screen.findByText('No payment method on file.')).toBeInTheDocument();
  });
});
