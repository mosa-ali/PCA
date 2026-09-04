import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState, __seedDevChildProfile } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, setChildLabel } from '../../src/domain/childLabels';

/**
 * Enrollment honesty: the Add-device journey must not offer iOS -- at all.
 *
 * The create path mints a REAL enrollment token plus a scannable QR code, and
 * the backend now refuses `platform=IOS` outright with
 * `PLATFORM_ENROLLMENT_UNAVAILABLE` (iOS host-app composition is deferred
 * POST_V1, and no iOS app exists on the App Store). So iOS is not a selectable
 * control, and it is not a DISABLED control either: a greyed-out option still
 * reads as "a thing I could try". One sentence states it plainly instead.
 *
 * Deliberately NOT asserted here (each is correct and must stay):
 *  - the `deviceEnrollment.platformIos` / `mode.IOS_STANDARD` i18n keys, still
 *    used by the pending-setup list, which may render EXISTING invitation rows
 *    that legitimately carry IOS,
 *  - `devicesTable.osFamily.IOS`, used by the device table for the same reason.
 */
describe('Add device -- platform step', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    localStorage.clear();
    sessionStorage.clear();
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'Existing Child (DEV)');
  });

  it('offers Android only, and states plainly that iPhone/iPad are not supported yet', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));

    expect(await screen.findByRole('heading', { name: 'Android' })).toBeInTheDocument();
    expect(
      screen.getByText('PCA supports Android phones and tablets today. iPhone and iPad are not supported yet.'),
    ).toBeInTheDocument();

    // No control of any kind offers iOS -- not enabled, not disabled.
    for (const control of [
      ...screen.queryAllByRole('radio'),
      ...screen.queryAllByRole('option'),
      ...screen.queryAllByRole('button'),
    ]) {
      expect((control as HTMLElement).textContent ?? '').not.toMatch(/iOS|iPhone|iPad/);
      expect((control as HTMLInputElement).value ?? '').not.toMatch(/^IOS/);
    }
  });

  it('the protection step never presents the iOS-only mode', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));

    const modes = screen.getAllByRole('radio', { name: /Android/ }) as HTMLInputElement[];
    expect(modes.map((input) => input.value)).toEqual(['ANDROID_STANDARD', 'ANDROID_PROTECTED']);
    expect(screen.queryByRole('radio', { name: /iOS/ })).toBeNull();
    expect(document.body.textContent).not.toContain('IOS_STANDARD');
  });

  it('selecting Protected always shows the "request only" honesty notice', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));

    expect(screen.queryByText(/Protected mode is only a REQUEST/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Android -- Protected (requested)' }));
    expect(screen.getByText(/Protected mode is only a REQUEST/)).toBeInTheDocument();
  });
});
