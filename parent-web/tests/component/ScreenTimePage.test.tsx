import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import ScreenTimePage from '../../src/pages/children/ScreenTimePage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/screen-time" element={<ScreenTimePage />} />
    </Routes>
  );
}

describe('ScreenTimePage policy-status wiring', () => {
  it('shows no policy-status badge before any save has been made', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
    expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
  });

  it('performing a real save transitions the visible PolicyStatusBadge to PENDING_DELIVERY, never APPLIED', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const saveButton = await screen.findByRole('button', { name: 'Save' });

    await userEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText('Queued -- pending delivery')).toBeInTheDocument());
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('shows PENDING_DELIVERY together with the child-offline notice when the target device is offline -- never APPLIED', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-yousef/screen-time', role: 'OWNER' });
    const saveButton = await screen.findByRole('button', { name: 'Save' });

    expect(await screen.findByText("This child's device is offline")).toBeInTheDocument();

    await userEvent.click(saveButton);

    // Saving reloads the underlying screen-time/device data (a real refetch,
    // not a no-op), so the page briefly returns to its loading state before
    // settling again -- assert on the final settled state rather than an
    // intermediate render.
    await waitFor(() => {
      expect(screen.getByText('Queued -- pending delivery')).toBeInTheDocument();
      expect(screen.getByText("This child's device is offline")).toBeInTheDocument();
    });
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });
});
