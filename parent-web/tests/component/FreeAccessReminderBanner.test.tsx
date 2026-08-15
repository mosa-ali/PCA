import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { FreeAccessReminderBanner } from '../../src/components/freeaccess/FreeAccessReminderBanner';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('FreeAccessReminderBanner (container, dev-fixture-backed)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the reminder for an authenticated session (dev fixture: TIME_LIMITED, 7 days remaining)', async () => {
    renderWithProviders(<FreeAccessReminderBanner />, { role: 'OWNER' });
    expect(await screen.findByText('7 days remaining in your free access period')).toBeInTheDocument();
  });

  it('dismissing hides the banner immediately', async () => {
    renderWithProviders(<FreeAccessReminderBanner />, { role: 'OWNER' });
    await screen.findByText('7 days remaining in your free access period');
    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss this reminder for today' }).click();
    });
    await waitFor(() => expect(screen.queryByText('7 days remaining in your free access period')).not.toBeInTheDocument());
  });
});
