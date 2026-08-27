import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Sidebar links to the Trusted Browser page', () => {
  it('renders a Trusted Browser nav link pointing at /security/trusted-browser', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Route>
      </Routes>,
      { route: '/dashboard' },
    );

    const link = await screen.findByRole('link', { name: 'Trusted Browser' });
    expect(link.getAttribute('href')).toBe('/security/trusted-browser');
  });
});
