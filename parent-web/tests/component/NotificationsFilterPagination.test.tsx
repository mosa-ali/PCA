import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Notifications from '../../src/pages/Notifications';
import { renderWithProviders } from '../utils/renderWithProviders';
import {
  __resetDevCommercialNotificationsForTests,
  pushDevCommercialNotification,
} from '../../src/api/dev/devCommercialNotificationClient';

describe('Notifications read/unread filter and pagination beyond the fetch cap', () => {
  beforeEach(() => {
    __resetDevCommercialNotificationsForTests();
  });

  it('filters the commercial-notification list by read/unread status client-side', async () => {
    // Both fixtures exist before the initial fetch; "Payment confirmed" is then marked read
    // through the page's own Mark-read action (which reloads from the fixture store), leaving
    // one genuinely read and one genuinely unread notification to filter between.
    pushDevCommercialNotification('PAYMENT_CONFIRMED', null, 'billing.paymentConfirmed');
    pushDevCommercialNotification('PAYMENT_FAILED', null, 'billing.paymentFailed');
    renderWithProviders(<Notifications />);

    await screen.findByText('Payment confirmed');
    const confirmedRow = screen.getByText('Payment confirmed').closest('li') as HTMLElement;
    await userEvent.click(within(confirmedRow).getByRole('button', { name: 'Mark read' }));

    // The row's own "Mark read" button disappears once the reload (a real async round-trip
    // through the dev fixture client, not a synchronous state change) reflects readAtUtc being
    // set -- so this must be polled, not asserted immediately after the click resolves.
    await waitFor(() => {
      expect(
        within(screen.getByText('Payment confirmed').closest('li') as HTMLElement).queryByRole('button', { name: 'Mark read' }),
      ).not.toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Unread');
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Read');
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Payment failed')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'All');
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument();
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
  });

  it('shows an honest empty-for-filter state when the read/unread filter matches nothing, not the overall-empty message', async () => {
    pushDevCommercialNotification('PAYMENT_CONFIRMED', null, 'billing.paymentConfirmed');
    renderWithProviders(<Notifications />);
    await screen.findByText('Payment confirmed');

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Read');

    expect(await screen.findByText('No billing notifications match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('You have no billing notifications yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
  });

  it('paginates with a show-more control instead of rendering every fetched notification at once', async () => {
    for (let i = 0; i < 11; i += 1) {
      pushDevCommercialNotification('PAYMENT_CONFIRMED', null, 'billing.paymentConfirmed');
    }
    renderWithProviders(<Notifications />);

    // 11 fixtures, page size 10 -- only 10 rows (each still unread, so each has its own "Mark
    // read" button) are rendered until "Show more" is used.
    await screen.findAllByText('Payment confirmed');
    expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(10);

    const showMore = screen.getByRole('button', { name: /Show \d+ more/ });
    await userEvent.click(showMore);

    expect(await screen.findAllByRole('button', { name: 'Mark read' })).toHaveLength(11);
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it('resets pagination back to the first page when the filter changes', async () => {
    for (let i = 0; i < 11; i += 1) {
      pushDevCommercialNotification('PAYMENT_CONFIRMED', null, 'billing.paymentConfirmed');
    }
    renderWithProviders(<Notifications />);
    await screen.findAllByText('Payment confirmed');

    await userEvent.click(screen.getByRole('button', { name: /Show \d+ more/ }));
    expect(await screen.findAllByRole('button', { name: 'Mark read' })).toHaveLength(11);

    // Switching to "Read" (nothing matches yet, since all 11 fixtures are unread) and back to
    // "All" must not leave the expanded page size stuck -- it should re-collapse to the first
    // page for the newly selected filter.
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Read');
    expect(await screen.findByText('No billing notifications match this filter.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'All');
    expect(await screen.findAllByRole('button', { name: 'Mark read' })).toHaveLength(10);
  });
});
