import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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

describe('night protection presentation', () => {
  it('shows the default night window and communication safety floor', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });

    expect(await screen.findByRole('heading', { name: 'Night protection' })).toBeInTheDocument();
    expect(screen.getByText('21:30 - 07:00')).toBeInTheDocument();
    expect(screen.getByText('Calls remain available during night protection.')).toBeInTheDocument();
    expect(screen.getByText('Emergency access remains available.')).toBeInTheDocument();
    expect(screen.getByText('SMS delivery remains available; Messages app use is not automatically unlocked.')).toBeInTheDocument();
  });
});
