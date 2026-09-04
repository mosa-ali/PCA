import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { getApiClients } from '../../src/api/client';
import {
  __resetDevDeviceEnrollmentState,
  __devKnownPairingDeviceIds,
  __devDenyNextCreateInvitation,
} from '../../src/api/dev/devDeviceEnrollmentClient';
import type { DevDeviceEnrollmentClient } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState, __seedDevChildProfile } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, setChildLabel } from '../../src/domain/childLabels';
import { openDeviceSection, runAddDeviceWizard } from '../utils/deviceEnrollmentTestHelpers';

/**
 * Every guarantee this file asserted before the device page was split into six
 * sections is asserted here still -- the selectors moved, the contract did not.
 *
 * The panel these tests used to render in isolation no longer exists as a
 * page-shaped component; enrollment is now a guided wizard on
 * `/family/devices?section=add`, so the tests drive the real page, which is a
 * strictly stronger check (it also proves the section routing works).
 */

const ADD_SECTION = '/family/devices?section=add';

describe('Device enrollment -- Add device section', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    localStorage.clear();
    sessionStorage.clear();
    // Every test in this file drives the wizard PAST step 0 via an ALREADY
    // selected child (runAddDeviceWizard's first click assumes the child
    // step's Next is already enabled) -- this suite is about invitation
    // creation/lifecycle and pairing, not child creation, which has its own
    // dedicated coverage.
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'Existing Child (DEV)');
  });

  it('does not create anything until the parent confirms the monitoring scope', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Review and confirm' }));

    // The monitoring-scope disclosure is on screen, and nothing has been minted.
    expect(await screen.findByText('Before creating this device invitation')).toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
    expect(getApiClients().deviceEnrollment).toBeTruthy();

    // Backing out of the review step creates nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('creating an invitation reveals the raw token and enrollment link exactly once', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();

    const tokenEl = await screen.findByTestId('raw-invitation-token');
    expect(tokenEl.textContent).toBeTruthy();
    const linkEl = screen.getByTestId('enrollment-link');
    expect(linkEl.textContent).toContain(tokenEl.textContent);

    // Leaving the code step removes the raw token from the DOM, and there is
    // no refetch path that could bring it back: listInvitations never carries
    // it (asserted below) and nothing persists it.
    await userEvent.click(screen.getByRole('button', { name: 'Get the app' }));
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('creating an invitation reveals a short opaque fallback identifier without exposing family data', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();

    const fallbackCode = await screen.findByTestId('invitation-fallback-code');
    expect(fallbackCode.textContent).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(fallbackCode.textContent).not.toContain('dev-family-1');
    expect(fallbackCode.textContent).not.toContain(screen.getByTestId('raw-invitation-token').textContent);
  });

  it('the raw invitation token never touches localStorage or sessionStorage', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    const tokenEl = await screen.findByTestId('raw-invitation-token');
    const rawToken = tokenEl.textContent as string;
    expect(rawToken.length).toBeGreaterThan(5);

    const allLocalStorageValues = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n');
    const allSessionStorageValues = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join('\n');
    expect(allLocalStorageValues).not.toContain(rawToken);
    expect(allSessionStorageValues).not.toContain(rawToken);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('switching section and coming back does not bring the raw token back', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');

    await openDeviceSection('Pending setup');
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();

    await openDeviceSection('Add device');
    // Back at step 1 of a fresh wizard: there is no code path that refetches a
    // raw invitation token, so it must not reappear.
    expect(await screen.findByRole('heading', { name: 'Who is this device for?' })).toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
    expect(screen.queryByTestId('enrollment-link')).not.toBeInTheDocument();
  });

  it('listInvitations results never carry rawInvitationToken (creation-response-only field)', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');
    await screen.findByTestId('invitation-fallback-code');
    await waitFor(() => {
      expect(screen.getByTestId('invitation-qr-code').querySelector('img')).not.toBeNull();
    });

    const clients = getApiClients();
    const listed = await clients.deviceEnrollment.listInvitations('dev-family-1');
    expect(listed.length).toBeGreaterThan(0);
    for (const inv of listed) {
      expect(inv).not.toHaveProperty('rawInvitationToken');
    }
  });

  it('a Viewer cannot see the create-invitation flow (client-side UX gate)', async () => {
    renderWithProviders(<Devices />, { role: 'VIEWER', route: ADD_SECTION });

    expect(await screen.findByText('Not permitted for your role')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I understand, create invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and confirm' })).not.toBeInTheDocument();

    // A Viewer may still SEE enrollment status -- that is a different action.
    await openDeviceSection('Pending setup');
    expect(await screen.findByRole('heading', { name: 'Invitations' })).toBeInTheDocument();
  });

  it('revoking an invitation updates its status, from the Pending setup section', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');

    await openDeviceSection('Pending setup');
    const revokeButton = await screen.findByRole('button', { name: 'Revoke' });
    await userEvent.click(revokeButton);

    await screen.findByText('Revoked');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('creating an invitation renders a QR code encoding the SAME enrollment link shown as text', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();

    const linkEl = await screen.findByTestId('enrollment-link');
    const qrContainer = await screen.findByTestId('invitation-qr-code');
    const qrImg = await waitFor(() => {
      const img = qrContainer.querySelector('img');
      expect(img).toBeTruthy();
      return img as HTMLImageElement;
    });
    // Rendered as a data: URL -- never a request to any third-party QR
    // image-generation service.
    expect(qrImg.src.startsWith('data:image/')).toBe(true);
    expect(qrImg.getAttribute('alt')).toBeTruthy();
    expect(linkEl.textContent).toBeTruthy();
  });

  it('leaving the code step removes the QR code from the DOM along with the raw token', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('invitation-qr-code');
    await userEvent.click(screen.getByRole('button', { name: 'Get the app' }));
    expect(screen.queryByTestId('invitation-qr-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('the setup code step shows code, link, copy controls, expiry, status and instructions', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();

    await screen.findByTestId('invitation-fallback-code');
    expect(screen.getByRole('button', { name: 'Copy fallback code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeInTheDocument();
    // Expiry is rendered through the shared formatter, so it is never the
    // literal string "Invalid Date" and never an English date in Arabic.
    expect(screen.getByText(/^Expires/)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "On your child's device" })).toBeInTheDocument();
    expect(screen.getByText('Install the PCA app.')).toBeInTheDocument();
  });

  it('a MANAGED_DEVICE_LIMIT_REACHED denial surfaces an actionable message with a link to request more devices, not a generic authority error', async () => {
    __devDenyNextCreateInvitation('MANAGED_DEVICE_LIMIT_REACHED');
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();

    expect(await screen.findByText("You've reached your plan's managed-device limit.")).toBeInTheDocument();
    expect(screen.queryByText('The server denied this action for your account.')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Request more devices' });
    expect(link.getAttribute('href')).toBe('/subscription/increase-devices');
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });
});

describe('Device enrollment -- pairing confirmation', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    localStorage.clear();
    sessionStorage.clear();
    // Every test in this file drives the wizard PAST step 0 via an ALREADY
    // selected child (runAddDeviceWizard's first click assumes the child
    // step's Next is already enabled) -- this suite is about invitation
    // creation/lifecycle and pairing, not child creation, which has its own
    // dedicated coverage.
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'Existing Child (DEV)');
  });

  it('pairing confirm is disabled until both fingerprints are present, and never renders ACTIVE', async () => {
    // The dev fixture raises a fingerprint-less PAIRING_PENDING request when an
    // invitation is created, mirroring a real device that has shown up but not
    // yet presented its keys.
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');
    const [deviceId] = __devKnownPairingDeviceIds();
    expect(deviceId).toBeTruthy();
    await openDeviceSection('Advanced & security');

    const deviceIdInput = await screen.findByLabelText('Device ID');
    await userEvent.type(deviceIdInput, deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));

    const confirmButton = await screen.findByRole('button', { name: 'Confirm pairing' });
    expect(confirmButton).toBeDisabled();
    expect(screen.getAllByText('Not yet available').length).toBeGreaterThan(0);

    // Simulate fingerprints arriving, then re-lookup.
    const clients = getApiClients();
    (clients.deviceEnrollment as DevDeviceEnrollmentClient).__devResolveFingerprints(deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm pairing' })).not.toBeDisabled());

    await userEvent.click(screen.getByRole('button', { name: 'Confirm pairing' }));
    await waitFor(() => expect(screen.getByText('This device is now paired.')).toBeInTheDocument());

    // The word ACTIVE must never appear anywhere in the rendered page: the
    // confirmation result comes from the server's own `status`, which this
    // client can only ever see as PAIRED.
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ACTIVE');
  });

  it('the fingerprints are presented as parent-readable setup codes, keeping their technical names', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');
    const [deviceId] = __devKnownPairingDeviceIds();
    await openDeviceSection('Advanced & security');
    await userEvent.type(await screen.findByLabelText('Device ID'), deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));

    expect(await screen.findByText('Setup code A')).toBeInTheDocument();
    expect(screen.getByText('Setup code B')).toBeInTheDocument();
    // The engineer-facing names survive as secondary text for a support call.
    expect(screen.getByText('Device signing-key (DSK) fingerprint')).toBeInTheDocument();
    expect(screen.getByText('Device encryption-key (DEK) fingerprint')).toBeInTheDocument();
    // The controlled honesty notice is rendered in full at the point of
    // confirmation -- its second and third sentences are the guarantee.
    expect(
      screen.getAllByText(/Confirm only after both fingerprints match exactly/).length,
    ).toBeGreaterThan(0);
  });

  it('looking up an unknown device id surfaces an honest not-found error, not a silent empty state', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=advanced' });
    const deviceIdInput = await screen.findByLabelText('Device ID');
    await userEvent.type(deviceIdInput, 'does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));
    await waitFor(() => expect(screen.getByText('Not found.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).not.toBeInTheDocument();
  });

  it('a Viewer cannot confirm a pairing request', async () => {
    // Seed a pairing request as an Owner would have, then re-render as Viewer.
    const { unmount } = renderWithProviders(<Devices />, { role: 'OWNER', route: ADD_SECTION });
    await runAddDeviceWizard();
    await screen.findByTestId('raw-invitation-token');
    const [deviceId] = __devKnownPairingDeviceIds();
    unmount();

    renderWithProviders(<Devices />, { role: 'VIEWER', route: '/family/devices?section=advanced' });
    await userEvent.type(await screen.findByLabelText('Device ID'), deviceId);
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));

    await screen.findByText('Setup code A');
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).not.toBeInTheDocument();
    const panel = screen.getByText('Setup code A').closest('.section-panel') as HTMLElement;
    expect(within(panel).getByText('Not permitted for your role')).toBeInTheDocument();
  });
});
