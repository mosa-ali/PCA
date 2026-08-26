import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Recovery from '../../src/pages/security/Recovery';
import { renderWithProviders } from '../utils/renderWithProviders';

// PCA-13 Section 13: authorized recovery is a real, documented cryptographic
// ceremony (offline Recovery Secret + KDF + envelope open + family-trust-set
// epoch acceptance) with its own extensive backend domain layer, but no HTTP
// route or browser integration exists yet, and backend/src/familyrbac/
// UnavailableAuthorizedRecoveryAuthority.ts fails every recovery attempt
// closed by design until a real, reviewed authority is wired -- the same
// posture as UnavailableTrustSetRoleResolver elsewhere. This page must
// therefore never claim to start a real recovery transaction.
describe('Recovery page', () => {
  it('requires the loss-disclosure acknowledgement before the button is enabled', async () => {
    renderWithProviders(<Recovery />, { role: 'OWNER' });
    expect(screen.getByRole('button', { name: 'Start recovery transaction' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Start recovery transaction' })).toBeEnabled();
  });

  it('clicking the enabled button honestly reports that no recovery action is available, never a fabricated success', async () => {
    renderWithProviders(<Recovery />, { role: 'OWNER' });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Start recovery transaction' }));

    expect(
      await screen.findByText(
        'Recovery transactions are not available yet: the authorized-recovery verification this action requires has not been built and reviewed. No recovery action is performed, and no recovery material is exposed by starting this.',
      ),
    ).toBeInTheDocument();
  });

  it('a role without REVEAL_RECOVERY_MATERIAL sees the button disabled rather than able to submit', async () => {
    renderWithProviders(<Recovery />, { role: 'VIEWER' });
    expect(screen.queryByRole('button', { name: 'Start recovery transaction' })).not.toBeInTheDocument();
  });
});
