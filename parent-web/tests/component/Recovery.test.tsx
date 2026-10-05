import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Recovery from '../../src/pages/security/Recovery';
import { renderWithProviders } from '../utils/renderWithProviders';

// Authorized recovery has no HTTP route or browser integration yet, and the
// backend authority fails recovery closed until a real, reviewed flow exists.
// The page must not offer an action that only displays an unavailable notice.
describe('Recovery page', () => {
  it('shows an honest unavailable status without offering a fake recovery action', () => {
    renderWithProviders(<Recovery />, { role: 'OWNER' });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Authorized recovery is not available yet because its verification flow has not been built and reviewed. No recovery action has been taken.',
    );
    expect(screen.getByRole('heading', { name: 'Before you create your Recovery Secret' })).toBeInTheDocument();
    expect(screen.getByText('PCA infrastructure never receives or stores this secret. Keep it offline and available to the account owner.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start recovery transaction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps recovery unavailable for roles without recovery-material authority', () => {
    renderWithProviders(<Recovery />, { role: 'VIEWER' });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start recovery transaction' })).not.toBeInTheDocument();
  });
});
