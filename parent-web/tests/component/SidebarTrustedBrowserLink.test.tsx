import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Sidebar retires Parent Trusted Browser navigation', () => {
  it('does not advertise browser pairing and keeps child-device and recovery links available', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Route>
      </Routes>,
      { route: '/dashboard' },
    );

    expect(screen.queryByRole('link', { name: 'Trusted Browser' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Devices' })).toHaveAttribute('href', '/family/devices');
    expect(screen.getByRole('link', { name: 'Recovery' })).toHaveAttribute('href', '/security/recovery');
  });
});
