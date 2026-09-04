import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { __devKnownPairingDeviceIds, __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState, __seedDevChildProfile } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, setChildLabel } from '../../src/domain/childLabels';
import { runAddDeviceWizard } from '../utils/deviceEnrollmentTestHelpers';

/**
 * jsdom does not perform real CSS layout, so -- matching this codebase's
 * existing responsive-test convention (see tests/responsive/mobileSidebar and
 * the `table-scroll`/`responsive-cards`/`data-label` pattern) -- these
 * assertions are structural: they confirm the wrap-safe/scroll-safe classes
 * and per-row `data-label`s the actual CSS media queries key off of are
 * present, so long opaque strings (tokens, links, fingerprints, device ids)
 * cannot silently regress to an unwrapped/overflowing layout at narrow widths.
 *
 * The 375px overflow itself is measured for real in e2e/device-enrollment.spec.ts.
 */
describe('Devices page narrow-width layout safety', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'Existing Child (DEV)');
  });

  it('the raw token/link reveal uses the wrap-safe copyable-value class, not a bare long string', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await runAddDeviceWizard();
    const tokenEl = await screen.findByTestId('raw-invitation-token');
    expect(tokenEl.closest('.copyable-value')).not.toBeNull();
    const linkEl = screen.getByTestId('enrollment-link');
    expect(linkEl.closest('.copyable-value')).not.toBeNull();
  });

  it('the setup code itself is in the wrap-safe invite-code block', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await runAddDeviceWizard();
    const code = await screen.findByTestId('invitation-fallback-code');
    expect(code.className).toContain('invite-code');
    expect(code.closest('.invite-code-panel')).not.toBeNull();
  });

  it('the invitations table uses the responsive-cards/data-table classes shared with the rest of the app', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');

    await userEvent.click(screen.getByRole('tab', { name: 'Pending setup' }));
    await screen.findByRole('button', { name: 'Revoke' });
    const table = document.querySelector('table.data-table.responsive-cards');
    expect(table).not.toBeNull();
    const cell = table!.querySelector('td[data-label]');
    expect(cell).not.toBeNull();
  });

  it('the device table is scroll-safe and every cell carries a data-label for the stacked layout', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=devices' });
    const table = await screen.findByRole('table');
    expect(table.className).toContain('responsive-cards');
    expect(table.closest('.table-scroll')).not.toBeNull();
    const bodyCells = Array.from(table.querySelectorAll('tbody td'));
    expect(bodyCells.length).toBeGreaterThan(0);
    for (const cell of bodyCells) expect(cell.getAttribute('data-label')).toBeTruthy();
  });

  it('fingerprint values render inside the wrap-safe copyable-value class', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');
    const [deviceId] = __devKnownPairingDeviceIds();

    await userEvent.click(screen.getByRole('tab', { name: 'Advanced & security' }));
    await userEvent.type(await screen.findByLabelText('Device ID'), deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));

    await screen.findAllByText('Not yet available');
    const [fingerprintValue] = screen.getAllByText('Not yet available');
    expect(fingerprintValue.closest('.copyable-value')).not.toBeNull();
    expect(document.querySelector('.fingerprint-grid')).not.toBeNull();
  });

  it('the tab strip wraps rather than scrolling the page sideways', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });
    const list = await screen.findByRole('tablist');
    expect(list.className).toContain('tab-list');
    // `.tab-list` is `display:flex; flex-wrap: wrap` in global.css -- six tabs
    // at 375px must go onto a second line, never into a horizontal scroller.
    expect(list.closest('.tabs')).not.toBeNull();
  });
});
