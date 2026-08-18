import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Dashboard data freshness state', () => {
  it('renders live, cached, and unavailable freshness states distinctly', async () => {
    renderWithProviders(<Dashboard />);

    expect((await screen.findAllByText('Data freshness')).length).toBe(3);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });
});
