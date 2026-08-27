import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Notifications from '../../src/pages/Notifications';
import {
  __resetDevCommercialNotificationsForTests,
  __devFailNextNotificationAction,
  pushDevCommercialNotification,
} from '../../src/api/dev/devCommercialNotificationClient';

describe('Notifications surfaces markRead/acknowledge failures instead of an unhandled rejection', () => {
  beforeEach(() => {
    __resetDevCommercialNotificationsForTests();
  });

  it('shows an error message when markRead fails', async () => {
    pushDevCommercialNotification('PAYMENT_CONFIRMED', null, 'billing.paymentConfirmed');
    __devFailNextNotificationAction('The notification could not be marked read.');
    renderWithProviders(<Notifications />);

    const markReadButton = await screen.findByRole('button', { name: 'Mark read' });
    await userEvent.click(markReadButton);

    expect(await screen.findByText('The notification could not be marked read.')).toBeInTheDocument();
    // The button must still be present -- the notification was not actually marked read.
    expect(screen.getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });

  it('shows an error message when acknowledge fails', async () => {
    pushDevCommercialNotification('PAYMENT_FAILED', null, 'billing.paymentFailed');
    __devFailNextNotificationAction('The notification could not be acknowledged.');
    renderWithProviders(<Notifications />);

    const acknowledgeButton = await screen.findByRole('button', { name: 'Acknowledge' });
    await userEvent.click(acknowledgeButton);

    expect(await screen.findByText('The notification could not be acknowledged.')).toBeInTheDocument();
  });
});
