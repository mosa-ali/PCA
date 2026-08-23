import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Requests from '../../src/pages/Requests';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevRequestsForTests } from '../../src/api/dev/devRequestClient';
import { getApiClients } from '../../src/api/client';

describe('Requests page -- PCA-FR-130 Bonus Time', () => {
  beforeEach(() => {
    __resetDevRequestsForTests();
  });
  afterEach(() => {
    __resetDevRequestsForTests();
  });

  it('shows the requested minutes for the pending BONUS_TIME fixture request', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    expect(await screen.findByText('30 min requested')).toBeInTheDocument();
  });

  it('an OWNER can approve a BONUS_TIME request, and the granted amount equals the request (bound-checked)', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('30 min requested');
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await userEvent.click(approveButtons[0]);

    await waitFor(() => expect(screen.getByText('30 min granted')).toBeInTheDocument());
  });

  it('an OWNER can counter-offer a SHORTER duration than requested', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('30 min requested');
    const counterInput = screen.getByLabelText('Counter-offer (min)');
    await userEvent.type(counterInput, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Counter-offer' }));

    await waitFor(() => expect(screen.getByText('10 min granted')).toBeInTheDocument());
  });

  it('a counter-offer that is not shorter than the request is rejected with a clear error, and nothing is granted', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('30 min requested');
    const counterInput = screen.getByLabelText('Counter-offer (min)');
    await userEvent.type(counterInput, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Counter-offer' }));

    expect(await screen.findByText(/must be shorter than what the child asked for/i)).toBeInTheDocument();
    expect(screen.queryByText('30 min granted')).not.toBeInTheDocument();
    expect(screen.getByText('30 min requested')).toBeInTheDocument();
  });

  it('a VIEWER cannot see approve/deny/counter-offer controls or the direct-grant form', async () => {
    renderWithProviders(<Requests />, { role: 'VIEWER' });
    await screen.findByText('30 min requested');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Counter-offer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant' })).not.toBeInTheDocument();
  });

  it('a CHILD cannot see approve/deny/counter-offer controls or the direct-grant form', async () => {
    renderWithProviders(<Requests />, { role: 'CHILD' });
    await screen.findByText('30 min requested');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant' })).not.toBeInTheDocument();
  });

  it('an OWNER can grant bonus time directly to a child with no pending request', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('Grant bonus time');
    await screen.findByRole('option', { name: 'Lina (DEV)' });
    await userEvent.selectOptions(screen.getByLabelText('Child'), 'child-lina');
    await userEvent.type(screen.getByLabelText('Minutes'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(screen.getByText('20 min granted')).toBeInTheDocument());
  });


  it('shows a visible error message when approving a request fails, instead of silently doing nothing (regression: catch block previously swallowed this with no user feedback)', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('30 min requested');
    const decideSpy = vi
      .spyOn(getApiClients().requests, 'decide')
      .mockRejectedValueOnce(new Error('RequestClient.decide: mutation path not implemented yet even post-crypto-approval.'));
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await userEvent.click(approveButtons[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('RequestClient.decide: mutation path not implemented yet even post-crypto-approval.');
    // A failed action must never look like it succeeded: the request stays PENDING/unchanged.
    expect(screen.getByText('30 min requested')).toBeInTheDocument();
    decideSpy.mockRestore();
  });

  it('shows a visible error message when a direct bonus-time grant fails, instead of silently doing nothing (regression: catch block previously swallowed this with only a stale comment claiming runFamilyAction already surfaced it)', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('Grant bonus time');
    await screen.findByRole('option', { name: 'Lina (DEV)' });
    const grantSpy = vi
      .spyOn(getApiClients().requests, 'grantBonusTime')
      .mockRejectedValueOnce(new Error('RequestClient.grantBonusTime: mutation path not implemented yet even post-crypto-approval.'));
    await userEvent.selectOptions(screen.getByLabelText('Child'), 'child-lina');
    await userEvent.type(screen.getByLabelText('Minutes'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Grant' }));

    expect(await screen.findByText('RequestClient.grantBonusTime: mutation path not implemented yet even post-crypto-approval.')).toBeInTheDocument();
    expect(screen.queryByText('20 min granted')).not.toBeInTheDocument();
    grantSpy.mockRestore();
  });
});

describe('Requests page -- PCA-FR-131 Install Approval (CAPABILITY_HONEST_INSTALL_APPROVAL)', () => {
  beforeEach(() => {
    __resetDevRequestsForTests();
  });
  afterEach(() => {
    __resetDevRequestsForTests();
  });

  it('shows the target app and the device-reported capability for a still-PENDING install-approval request, without ever implying it is already enforced', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('Puzzle Quest 2 (DEV)');
    expect(screen.getByText('At request: Enforced on device')).toBeInTheDocument();
    // Not yet acknowledged by the device -- the UI must say so, never default to claiming enforced.
    expect(screen.getByText('On device: not yet reported')).toBeInTheDocument();
  });

  it('an already-APPROVED install-approval request whose device cannot enforce it still honestly shows REQUEST_ONLY, never a fabricated ENFORCED', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('ChatterBox (DEV)');
    // "APPROVED" (the decision) and "REQUEST_ONLY" (the device's real capability) coexist in the
    // same row without one being silently upgraded into the other.
    expect(screen.getAllByText('APPROVED').length).toBeGreaterThan(0);
    expect(screen.getByText('Request only (cannot be blocked)')).toBeInTheDocument();
    // No enforcement-outcome badge on the page claims ENFORCED -- req-4 is still PENDING (no
    // outcome reported yet) and req-5's own outcome is REQUEST_ONLY, never upgraded.
    expect(document.querySelector('.status-ENFORCED')).toBeNull();
    expect(
      screen.getByText('This device cannot block installs -- approving or denying only records the family\'s decision; it does not change what is installed on the device.'),
    ).toBeInTheDocument();
  });

  it('a VIEWER can see the install-approval capability state but no approve/deny controls for it', async () => {
    renderWithProviders(<Requests />, { role: 'VIEWER' });
    await screen.findByText('Puzzle Quest 2 (DEV)');
    expect(screen.getByText('At request: Enforced on device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
