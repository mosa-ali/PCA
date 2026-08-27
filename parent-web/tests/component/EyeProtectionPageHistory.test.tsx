import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import EyeProtectionPage from '../../src/pages/children/EyeProtectionPage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/eye-protection" element={<EyeProtectionPage />} />
    </Routes>
  );
}

describe('EyeProtectionPage surfaces lastReminderUtc and real EYE_PROTECTION history', () => {
  it('shows the last-reminder timestamp instead of only the on/off status', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/eye-protection', role: 'OWNER' });
    await screen.findByText('Reminders: Enable');
    expect(screen.queryByText('No reminder has been shown yet.')).not.toBeInTheDocument();
    expect(screen.getByText(/Last reminder shown:/)).toBeInTheDocument();
  });

  it('renders the real EYE_PROTECTION activity-timeline entries as this page\'s own history section', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/eye-protection', role: 'OWNER' });
    expect(await screen.findByText('Reminder history')).toBeInTheDocument();
    expect(await screen.findByText('An eye-rest reminder was shown')).toBeInTheDocument();
    // A non-eye-protection timeline entry must never leak into this section.
    expect(screen.queryByText('Used an Education app for 22 minutes')).not.toBeInTheDocument();
  });
});
