import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import DeviceEnrollmentPanel from '../../src/pages/family/DeviceEnrollmentPanel';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { clickCreateInvitation } from '../utils/deviceEnrollmentTestHelpers';

/**
 * jsdom does not perform real CSS layout, so -- matching this codebase's
 * existing responsive-test convention (see tests/responsive/mobileSidebar
 * and Devices.tsx's `table-scroll`/`responsive-cards`/`data-label` pattern)
 * -- these assertions are structural: they confirm the wrap-safe/scroll-safe
 * classes and per-row `data-label`s the actual CSS media queries key off of
 * are present, so long opaque strings (tokens, links, fingerprints) cannot
 * silently regress to an unwrapped/overflowing layout at narrow widths.
 */
describe('DeviceEnrollmentPanel narrow-width layout safety', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
  });

  it('the raw token/link reveal uses the wrap-safe copyable-value class, not a bare long string', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    const tokenEl = await screen.findByTestId('raw-invitation-token');
    expect(tokenEl.closest('.copyable-value')).not.toBeNull();
    const linkEl = screen.getByTestId('enrollment-link');
    expect(linkEl.closest('.copyable-value')).not.toBeNull();
  });

  it('the invitations table uses the responsive-cards/data-table classes shared with the rest of the app', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('raw-invitation-token');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await screen.findByRole('button', { name: 'Revoke' });
    const table = document.querySelector('table.data-table.responsive-cards');
    expect(table).not.toBeNull();
    const cell = table!.querySelector('td[data-label]');
    expect(cell).not.toBeNull();
  });

  it('fingerprint values render inside the wrap-safe copyable-value class', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('raw-invitation-token');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    const { __devKnownPairingDeviceIds } = await import('../../src/api/dev/devDeviceEnrollmentClient');
    const [deviceId] = __devKnownPairingDeviceIds();
    await userEvent.type(screen.getByLabelText('Device ID'), deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));

    await screen.findAllByText('Not yet available');
    const [fingerprintValue] = screen.getAllByText('Not yet available');
    expect(fingerprintValue.closest('.copyable-value')).not.toBeNull();
    expect(document.querySelector('.fingerprint-grid')).not.toBeNull();
  });
});
