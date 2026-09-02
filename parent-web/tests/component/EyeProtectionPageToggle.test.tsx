import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EyeProtectionPage from '../../src/pages/children/EyeProtectionPage';
import { renderWithProviders } from '../utils/renderWithProviders';
import { __devFailNextUpdateEyeProtection } from '../../src/api/dev/devParentFamilyDataGateway';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/eye-protection" element={<EyeProtectionPage />} />
    </Routes>
  );
}

describe('EyeProtectionPage reminders toggle', () => {
  it('an Owner can disable and re-enable eye-protection reminders', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/eye-protection', role: 'OWNER' });

    expect(await screen.findByRole('checkbox', { name: 'Enable eye-protection reminders' })).toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable eye-protection reminders' }));
    await screen.findByText('Reminders: Disable');
    expect(await screen.findByRole('checkbox', { name: 'Enable eye-protection reminders' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable eye-protection reminders' }));
    await screen.findByText('Reminders: Enable');
    expect(await screen.findByRole('checkbox', { name: 'Enable eye-protection reminders' })).toBeChecked();
  });

  it('shows an error message when updateEyeProtection fails, and leaves the toggle state unchanged', async () => {
    __devFailNextUpdateEyeProtection('The eye-protection setting could not be updated.');
    renderWithProviders(<TestApp />, { route: '/children/child-amir/eye-protection', role: 'OWNER' });

    const checkbox = await screen.findByRole('checkbox', { name: 'Enable eye-protection reminders' });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    expect(await screen.findByText('The eye-protection setting could not be updated.')).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it('a VIEWER cannot see or use the reminders toggle', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/eye-protection', role: 'VIEWER' });

    await screen.findByText('Reminders: Enable');
    expect(screen.queryByRole('checkbox', { name: 'Enable eye-protection reminders' })).not.toBeInTheDocument();
    expect(screen.getByText('Not permitted for your role')).toBeInTheDocument();
  });
});
