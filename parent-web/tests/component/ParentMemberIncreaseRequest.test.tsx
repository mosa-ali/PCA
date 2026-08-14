import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import ParentMemberIncreaseRequest from '../../src/pages/billing/ParentMemberIncreaseRequest';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevBillingStateForTests, simulateAdminApproveParentMemberRequest } from '../../src/api/dev/devBillingClient';

function TestApp() {
  return (
    <Routes>
      <Route path="/subscription/increase-parent-members" element={<ParentMemberIncreaseRequest />} />
    </Routes>
  );
}

describe('Parent-member increase request flow (PCA-ADD-PA-054: never billable)', () => {
  beforeEach(() => __resetDevBillingStateForTests());

  it('states plainly that parent-member increases are never priced or charged', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-parent-members', role: 'OWNER' });
    expect(await screen.findByText(/never priced or charged/i)).toBeInTheDocument();
  });

  it('submitting a request never shows a price and never routes through a payment step', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-parent-members', role: 'OWNER' });
    const input = await screen.findByLabelText('New total parent-member limit');
    await userEvent.type(input, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('Price')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proceed to payment' })).not.toBeInTheDocument();
  });

  it('reflects a Platform-Administration approval once it happens, without the parent taking any payment action', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription/increase-parent-members', role: 'OWNER' });
    const input = await screen.findByLabelText('New total parent-member limit');
    await userEvent.type(input, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    const request = await screen.findByText('Pending');
    void request;

    // Simulate Platform Administration's out-of-band, no-charge decision --
    // never something this page itself triggers.
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    const entitlement = await clients.billing.getEntitlement();
    const openRequest = entitlement.openRequests.find((r) => r.limitType === 'PARENT_MEMBER_LIMIT');
    if (!openRequest) throw new Error('expected an open parent-member request');
    await simulateAdminApproveParentMemberRequest(openRequest.requestId);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Your request was approved\. Your parent-member limit is now 2\./)).toBeInTheDocument();
  });
});
