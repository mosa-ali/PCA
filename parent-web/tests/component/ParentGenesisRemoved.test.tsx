import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Parent Genesis removal', () => {
  it('does not expose a Genesis page or redirect route', async () => {
    renderWithProviders(<App />, { route: '/genesis' });

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /account setup|authenticator|welcome/i })).not.toBeInTheDocument();
  });
});
