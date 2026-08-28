import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import DeviceEnrollmentPanel from '../../src/pages/family/DeviceEnrollmentPanel';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';

/**
 * The monitoring-consent dialog is a real `role="dialog" aria-modal="true"`
 * surface, so it must behave like every other dialog in this app
 * (privacy/DeleteNow.tsx, state/StepUpContext.tsx,
 * wellbeing/CustomMessageForm.tsx): focus moves into it on open, Escape
 * dismisses it, and focus returns to the control that opened it. Without
 * that, a keyboard/screen-reader user opening this dialog is left with
 * focus behind the overlay and no way out except the mouse.
 */
async function openConsentDialog(): Promise<HTMLElement> {
  const createButton = await screen.findByRole('button', { name: 'Create invitation' });
  await waitFor(() => expect(createButton).not.toBeDisabled());
  await userEvent.click(createButton);
  await screen.findByRole('dialog');
  return createButton;
}

describe('DeviceEnrollmentPanel consent dialog focus management', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('moves focus into the dialog when it opens', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await openConsentDialog();

    const dialog = screen.getByRole('dialog');
    const continueButton = screen.getByRole('button', { name: 'I understand, create invitation' });
    expect(document.activeElement).toBe(continueButton);
    expect(dialog).toContainElement(continueButton);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('names the dialog with an h2, matching the app\'s other dialogs', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await openConsentDialog();

    const title = screen.getByRole('heading', { level: 2, name: 'Before creating this device invitation' });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', title.id);
  });

  it('closes on Escape and restores focus to the trigger, without creating an invitation', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    const createButton = await openConsentDialog();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(createButton);
    // Escape is a cancel, never an implicit confirm: no token may be revealed.
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger when the dialog is cancelled with the button', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    const createButton = await openConsentDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(createButton);
  });
});
