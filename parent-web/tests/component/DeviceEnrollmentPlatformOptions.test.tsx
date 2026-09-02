import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import DeviceEnrollmentPanel from '../../src/pages/family/DeviceEnrollmentPanel';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';

/**
 * Enrollment honesty: the platform selector must not offer iOS.
 *
 * Selecting iOS used to be reachable here, and the create path mints a REAL
 * enrollment token plus a scannable QR code -- for an app that does not exist
 * on the App Store (iOS host-app composition is deferred POST_V1). That is a
 * promise the product cannot keep, so the option is removed at the source of
 * the promise: the parent can no longer ask for an iOS invitation at all.
 *
 * Deliberately NOT asserted here (each is correct and must stay):
 *  - the IOS/IOS_STANDARD branches inside the component (dead else-branches
 *    kept so re-enablement is a one-line revert),
 *  - the invitations table rendering `inv.platform` for EXISTING rows, which
 *    may legitimately be IOS,
 *  - the `deviceEnrollment.platformIos` / `deviceEnrollment.mode.IOS_STANDARD`
 *    i18n keys, still used by that table and by Devices.tsx.
 */
describe('DeviceEnrollmentPanel platform selector', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('offers Android only -- no iOS option while the iOS app does not exist', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });

    const platformSelect = await screen.findByLabelText('Platform');
    const options = within(platformSelect).getAllByRole('option') as HTMLOptionElement[];

    expect(options.map((o) => o.value)).toEqual(['ANDROID']);
    expect(within(platformSelect).queryByRole('option', { name: 'iOS' })).toBeNull();
  });

  it('cannot be left holding a non-Android platform value', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });

    const platformSelect = (await screen.findByLabelText('Platform')) as HTMLSelectElement;
    expect(platformSelect.value).toBe('ANDROID');

    // The protection-mode selector is derived from the platform, so it must
    // likewise never present the iOS-only mode.
    const modeSelect = await screen.findByLabelText('Protection mode');
    const modeValues = (within(modeSelect).getAllByRole('option') as HTMLOptionElement[]).map((o) => o.value);
    expect(modeValues).not.toContain('IOS_STANDARD');
  });
});
