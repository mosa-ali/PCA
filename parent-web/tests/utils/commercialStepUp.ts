import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import i18n from '../../src/i18n';

/**
 * Completes the PCA-DEC-037 commercial step-up dialog (fresh authenticator
 * code) that every billing mutation now opens first. The dev fixture accepts
 * any 6-digit code except 000000.
 */
export async function confirmCommercialStepUp(code = '123456'): Promise<void> {
  const input = await screen.findByLabelText(i18n.t('mfa.codeLabel'));
  await userEvent.type(input, code);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('stepUp.commercial.confirm') }));
  await waitFor(() => expect(screen.queryByLabelText(i18n.t('mfa.codeLabel'))).not.toBeInTheDocument(), { timeout: 5000 });
}
