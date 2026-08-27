import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import AppsPage from '../../src/pages/children/AppsPage';
import { __devFailNextUpdateAppRule } from '../../src/api/dev/devParentFamilyDataGateway';

describe('AppsPage surfaces action failures instead of silently swallowing them', () => {
  it('shows an error message when updateAppRule fails, and leaves the toggle state unchanged', async () => {
    __devFailNextUpdateAppRule('The app rule could not be updated.');
    renderWithProviders(
      <Routes>
        <Route path="/children/:childId/apps" element={<AppsPage />} />
      </Routes>,
      { route: '/children/child-amir/apps', role: 'OWNER' },
    );

    const checkbox = await screen.findByRole('checkbox', { name: /Puzzle Quest \(DEV\)/ });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    expect(await screen.findByText('The app rule could not be updated.')).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });
});
