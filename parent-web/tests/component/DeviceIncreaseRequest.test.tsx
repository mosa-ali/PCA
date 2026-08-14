import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import DeviceIncreaseRequest from '../../src/pages/billing/DeviceIncreaseRequest';
import CheckoutReturn from '../../src/pages/billing/CheckoutReturn';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevBillingStateForTests } from '../../src/api/dev/devBillingClient';

function TestApp() {
  return (
    <Routes>
      <Route path="/subscription/increase-devices" element={<DeviceIncreaseRequest />} />
      <Route path="/subscription/checkout-return" element={<CheckoutReturn />} />
    </Routes>
  );
}

describe('Device increase request flow (PCA_ADDENDUM_002 Section 18.1)', () => {
  beforeEach(() => __resetDevBillingStateForTests());

  it('offers suggested targets above the current limit plus a custom quantity field', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    await screen.findByText('Choose a new total managed-device limit');
    expect(screen.getByRole('button', { name: '2 devices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 devices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 devices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Or enter a custom total')).toBeInTheDocument();
  });

  it('a standard quantity resolves an exact price before any payment happens', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    await userEvent.click(await screen.findByRole('button', { name: '2 devices' }));

    expect(await screen.findByText('Price')).toBeInTheDocument();
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed to payment' })).toBeEnabled();
  });

  it('a custom quantity with no standard price shows PENDING_ADMIN_QUOTE and never a price, and payment cannot start', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    const input = await screen.findByLabelText('Or enter a custom total');
    await userEvent.type(input, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Request this quantity' }));

    expect(await screen.findByText('Pending quote review')).toBeInTheDocument();
    expect(
      screen.getByText(/does not have a standard price/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Price')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proceed to payment' })).not.toBeInTheDocument();
  });

  it('rejects a target at or below the current allowance', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    const input = await screen.findByLabelText('Or enter a custom total');
    await userEvent.type(input, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Request this quantity' }));

    expect(await screen.findByText(/greater than your current limit/i)).toBeInTheDocument();
  });

  it('beginning checkout hands off to the checkout-return page, which shows Payment pending and never immediately Approved', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    await userEvent.click(await screen.findByRole('button', { name: '2 devices' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Proceed to payment' }));

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeInTheDocument());
    expect(
      screen.getByText("We're confirming your payment. Please don't close this page -- we'll update your allowance automatically once payment is confirmed by the server."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  }, 10_000);

  it('once the server (simulated) confirms payment, the checkout-return page reflects Approved without any client-side action claiming success itself', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    await userEvent.click(await screen.findByRole('button', { name: '2 devices' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Proceed to payment' }));
    await waitFor(() => expect(screen.getByText('Payment pending')).toBeInTheDocument());

    // The dev fixture schedules its "server webhook" confirmation ~900ms
    // after checkout begins; this page polls on its own (no test-only hook
    // is called here) -- proving the UI discovers APPROVED purely by
    // re-reading state, exactly as it would against a real webhook.
    // Generous timeout: this waits on a real 900ms setTimeout plus a 1000ms
    // poll interval, which can slip further under a fully-parallel test-file
    // run's CPU contention -- not a race in the app code itself (already
    // covered deterministically by tests/unit/devBillingClient.test.ts).
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument(), { timeout: 15_000, interval: 250 });
    expect(screen.getByText('Payment confirmed. Your allowance has been updated.')).toBeInTheDocument();
  }, 20_000);

  it('an open request can be cancelled from PENDING/QUOTED', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-devices', role: 'OWNER' });
    await userEvent.click(await screen.findByRole('button', { name: '2 devices' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel this request' }));

    expect(await screen.findByText('This request was cancelled.')).toBeInTheDocument();
  });
});
