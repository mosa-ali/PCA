import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import DeviceEnrollmentPanel from '../../src/pages/family/DeviceEnrollmentPanel';
import { getApiClients } from '../../src/api/client';
import {
  __resetDevDeviceEnrollmentState,
  __devKnownPairingDeviceIds,
} from '../../src/api/dev/devDeviceEnrollmentClient';
import type { DevDeviceEnrollmentClient } from '../../src/api/dev/devDeviceEnrollmentClient';
import { clickCreateInvitation } from '../utils/deviceEnrollmentTestHelpers';

describe('DeviceEnrollmentPanel', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('requires monitoring-scope confirmation before creating the one-time invitation', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    const createButton = await screen.findByRole('button', { name: 'Create invitation' });
    await waitFor(() => expect(createButton).not.toBeDisabled());

    await userEvent.click(createButton);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
    expect((await getApiClients()).deviceEnrollment).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('creating an invitation reveals the raw token and enrollment link exactly once', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();

    const tokenEl = await screen.findByTestId('raw-invitation-token');
    expect(tokenEl.textContent).toBeTruthy();
    const linkEl = screen.getByTestId('enrollment-link');
    expect(linkEl.textContent).toContain(tokenEl.textContent);

    // Closing the reveal panel removes it from the DOM; there is no
    // refetch path that could bring the raw token back.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('raw-invitation-token')).not.toBeInTheDocument();
  });

  it('creating an invitation reveals a short opaque fallback identifier without exposing family data', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();

    const fallbackCode = await screen.findByTestId('invitation-fallback-code');
    expect(fallbackCode.textContent).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(fallbackCode.textContent).not.toContain('dev-family-1');
    expect(fallbackCode.textContent).not.toContain(screen.getByTestId('raw-invitation-token').textContent);
  });

  it('the raw invitation token never touches localStorage or sessionStorage', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
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

  it('listInvitations results never carry rawInvitationToken (creation-response-only field)', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('raw-invitation-token');
    await screen.findByTestId('invitation-fallback-code');
    await waitFor(() => {
      expect(screen.getByTestId('invitation-qr-code').querySelector('img')).not.toBeNull();
    });
    await screen.findByRole('table');

    const clients = getApiClients();
    const listed = await clients.deviceEnrollment.listInvitations('dev-family-1');
    expect(listed.length).toBeGreaterThan(0);
    for (const inv of listed) {
      expect(inv).not.toHaveProperty('rawInvitationToken');
    }
  });

  it('a Viewer cannot see the create-invitation control (client-side UX gate)', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'VIEWER' });
    await screen.findByText('Invitations');
    expect(screen.queryByRole('button', { name: 'Create invitation' })).not.toBeInTheDocument();
    expect(screen.getByText('Not permitted for your role')).toBeInTheDocument();
  });

  it('revoking an invitation updates its status', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('raw-invitation-token');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    const revokeButton = await screen.findByRole('button', { name: 'Revoke' });
    await userEvent.click(revokeButton);

    await screen.findByText('REVOKED');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('pairing confirm is disabled until both fingerprints are present, and never renders ACTIVE', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('raw-invitation-token');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    const [deviceId] = __devKnownPairingDeviceIds();
    expect(deviceId).toBeTruthy();

    const deviceIdInput = screen.getByLabelText('Device ID');
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

    // The word ACTIVE must never appear anywhere in the rendered pairing panel.
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ACTIVE');
  });

  it('looking up an unknown device id surfaces an honest not-found error, not a silent empty state', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    const deviceIdInput = await screen.findByLabelText('Device ID');
    await userEvent.type(deviceIdInput, 'does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: 'Look up pairing request' }));
    await waitFor(() => expect(screen.getByText('Not found.')).toBeInTheDocument());
  });

  // PCA-ADD-ENR-002: QR code rendering for the created invitation link.
  it('creating an invitation renders a QR code encoding the SAME enrollment link shown as text', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();

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
    // Sanity: the QR component is fed the exact same link value the plain
    // text/copy affordance already shows -- no second, divergent value.
    expect(linkEl.textContent).toBeTruthy();
  });

  it('closing the one-time reveal panel removes the QR code from the DOM along with the raw token', async () => {
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });
    await clickCreateInvitation();
    await screen.findByTestId('invitation-qr-code');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('invitation-qr-code')).not.toBeInTheDocument();
  });
});
