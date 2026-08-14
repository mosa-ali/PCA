import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Invoices from '../../src/pages/billing/Invoices';
import InvoiceDetail from '../../src/pages/billing/InvoiceDetail';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevBillingStateForTests, simulateServerPaymentConfirmation } from '../../src/api/dev/devBillingClient';
import { getApiClients } from '../../src/api/client';

function TestApp() {
  return (
    <Routes>
      <Route path="/subscription/invoices" element={<Invoices />} />
      <Route path="/subscription/invoices/:invoiceId" element={<InvoiceDetail />} />
    </Routes>
  );
}

describe('Invoices and receipts', () => {
  beforeEach(() => __resetDevBillingStateForTests());

  it('shows an empty state when there are no invoices yet', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/invoices', role: 'OWNER' });
    expect(await screen.findByText('You have no invoices yet.')).toBeInTheDocument();
  });

  it('lists a paid device-increase invoice with its exact total, and its detail view shows the line item', async () => {
    const clients = getApiClients();
    const quoted = await clients.billing.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    await clients.billing.beginCheckout(quoted.requestId, 'https://example.test/return');
    await simulateServerPaymentConfirmation(quoted.requestId);

    renderWithProviders(<TestApp />, { route: '/subscription/invoices', role: 'OWNER' });
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('$4.99')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'View' }));
    await waitFor(() => expect(screen.getByText('Line items')).toBeInTheDocument());
    expect(screen.getByText(/Managed device allowance increase to 2/)).toBeInTheDocument();
  });

  it('shows a clear not-found state for an invoice that does not exist', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/invoices/does-not-exist', role: 'OWNER' });
    expect(await screen.findByText('This invoice could not be found.')).toBeInTheDocument();
  });
});
