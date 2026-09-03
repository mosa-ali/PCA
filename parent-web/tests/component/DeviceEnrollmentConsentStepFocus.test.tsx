import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';

/**
 * REPLACES tests/component/DeviceEnrollmentConsentDialogFocus.test.tsx.
 *
 * The monitoring-scope disclosure used to be a `role="dialog" aria-modal="true"`
 * overlay, and that file guarded the accessibility fix it needed: focus into
 * the dialog on open, Escape to dismiss, focus restored to the trigger. The
 * recorded failure it prevented was a keyboard/screen-reader user being left
 * with focus BEHIND an overlay with no way out except the mouse.
 *
 * The consent content is now an inline review step of the guided wizard, so
 * there is no overlay and that failure mode cannot occur. The underlying
 * guarantees are unchanged and are asserted here against the new shape:
 *
 *   1. a keyboard user LANDS in the step that just appeared (they are not left
 *      focused on a button that no longer exists),
 *   2. the exact monitoring-scope copy is shown BEFORE anything is created,
 *   3. leaving the step is always possible and creates nothing,
 *   4. no token is revealed until the parent explicitly confirms.
 *
 * Nothing here is weaker than the dialog contract; it is the same contract
 * without a modal.
 */
async function openReviewStep(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
  await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Review and confirm' }));
  await screen.findByRole('heading', { level: 3, name: 'Review and confirm' });
}

describe('Add device -- review/consent step focus management', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('moves focus into each step as it appears, so a keyboard user is never stranded', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
    const platformHeading = await screen.findByRole('heading', { level: 3, name: 'What kind of device?' });
    await waitFor(() => expect(document.activeElement).toBe(platformHeading));

    await userEvent.click(screen.getByRole('button', { name: 'How much protection?' }));
    const protectionHeading = await screen.findByRole('heading', { level: 3, name: 'How much protection?' });
    await waitFor(() => expect(document.activeElement).toBe(protectionHeading));

    await userEvent.click(screen.getByRole('button', { name: 'Review and confirm' }));
    const reviewHeading = await screen.findByRole('heading', { level: 3, name: 'Review and confirm' });
    await waitFor(() => expect(document.activeElement).toBe(reviewHeading));
  });

  it('shows the full monitoring-scope disclosure before anything is created', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await openReviewStep();

    expect(screen.getByRole('heading', { name: 'Before creating this device invitation' })).toBeInTheDocument();
    expect(screen.getByText(/Review this monitoring summary/)).toBeInTheDocument();
    expect(screen.getByText(/category-level app and website activity/)).toBeInTheDocument();
    expect(screen.getByText(/PCA does not receive message or call content/)).toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('Back leaves the review step without creating an invitation', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await openReviewStep();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));

    await screen.findByRole('heading', { level: 3, name: 'How much protection?' });
    expect(screen.queryByRole('heading', { name: 'Before creating this device invitation' })).not.toBeInTheDocument();
    // Backing out is a cancel, never an implicit confirm.
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('switching to another device section abandons the review step and creates nothing', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await openReviewStep();

    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));

    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByRole('heading', { name: 'Before creating this device invitation' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });
});
