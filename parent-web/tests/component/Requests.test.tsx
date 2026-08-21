import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Requests from '../../src/pages/Requests';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __resetDevRequestsForTests } from '../../src/api/dev/devRequestClient';

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

  it('a direct grant over the bound is rejected with a clear error', async () => {
    renderWithProviders(<Requests />, { role: 'OWNER' });
    await screen.findByText('Grant bonus time');
    await screen.findByRole('option', { name: 'Lina (DEV)' });
    await userEvent.selectOptions(screen.getByLabelText('Child'), 'child-lina');
    await userEvent.type(screen.getByLabelText('Minutes'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Grant' }));

    expect(await screen.findByText(/cannot exceed 120 minutes/i)).toBeInTheDocument();
  });
});
