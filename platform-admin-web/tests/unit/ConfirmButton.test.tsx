// Entitlements/EntitlementRequests/BillingPlans mutations used to fire
// immediately on click with no confirmation. This proves the shared
// two-click ConfirmButton pattern actually gates the callback behind an
// explicit second click, and that Cancel resets it without firing.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { ConfirmButton } from '../../src/components/common/ConfirmButton';

function renderButton(onConfirm: () => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ConfirmButton label="Set limit" onConfirm={onConfirm} />
    </I18nextProvider>,
  );
}

describe('ConfirmButton', () => {
  it('does not fire onConfirm on the first click, only after an explicit Confirm click', async () => {
    const onConfirm = vi.fn();
    renderButton(onConfirm);

    await userEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('resets to unarmed and never fires onConfirm when Cancel is clicked', async () => {
    const onConfirm = vi.fn();
    renderButton(onConfirm);

    await userEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set limit' })).toBeInTheDocument();
  });
});
