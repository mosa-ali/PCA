import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import TrustedBrowser from '../../src/pages/security/TrustedBrowser';
import { getApiClients } from '../../src/api/client';

describe('retired Parent Trusted Browser route', () => {
  it('redirects a legacy deep link without reading trust state or exposing pairing controls', async () => {
    const clients = getApiClients();
    const originalGetSnapshot = clients.trustedBrowser.getSnapshot;
    const getSnapshot = vi.fn(originalGetSnapshot);
    clients.trustedBrowser.getSnapshot = getSnapshot;
    try {
      renderWithProviders(
        <Routes>
          <Route path="/security/trusted-browser" element={<TrustedBrowser />} />
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>,
        { route: '/security/trusted-browser' },
      );

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pair|trust this browser/i })).not.toBeInTheDocument();
      expect(getSnapshot).not.toHaveBeenCalled();
    } finally {
      clients.trustedBrowser.getSnapshot = originalGetSnapshot;
    }
  });
});
