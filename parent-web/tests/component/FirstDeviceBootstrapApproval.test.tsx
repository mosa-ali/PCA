import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { getApiClients } from '../../src/api/client';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import FirstDeviceBootstrapApprovalPanel from '../../src/pages/family/devices/FirstDeviceBootstrapApprovalPanel';
import PendingSetupSection from '../../src/pages/family/devices/PendingSetupSection';
import { renderWithProviders } from '../utils/renderWithProviders';

const ceremony = {
  ceremonyId: 'ceremony-001',
  deviceId: 'device-001',
  dskFingerprint: 'sha256:11:22:33:44',
  status: 'PENDING' as const,
  createdAt: '2026-10-05T10:00:00.000Z',
  expiresAt: '2099-10-05T10:10:00.000Z',
  approvedAt: null,
};

describe('FirstDeviceBootstrapApprovalPanel', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    localStorage.clear();
    sessionStorage.clear();
    const clients = getApiClients();
    vi.spyOn(clients.deviceEnrollment, 'listFirstDeviceBootstrapCeremonies').mockResolvedValue([ceremony]);
    vi.spyOn(clients.deviceEnrollment, 'approveFirstDeviceBootstrap').mockResolvedValue({
      ...ceremony,
      status: 'APPROVED',
      approvedAt: '2026-10-05T10:01:00.000Z',
    });
    vi.spyOn(clients.serviceAuth, 'issueSensitiveStepUp').mockResolvedValue({
      stepUpToken: 'one-use-bootstrap-grant',
      operation: 'family.device.bootstrap.root',
      expiresAt: '2099-10-05T10:02:00.000Z',
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('requires an explicit exact-fingerprint comparison before fresh TOTP and displays approval as still inactive', async () => {
    const user = userEvent.setup();
    const clients = getApiClients();
    renderWithProviders(<FirstDeviceBootstrapApprovalPanel familyId="family-1" />, { role: 'OWNER' });

    expect(await screen.findByText('sha256:11:22:33:44')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve this security key' })).toBeDisabled();
    expect(clients.serviceAuth.issueSensitiveStepUp).not.toHaveBeenCalled();
    expect(clients.deviceEnrollment.approveFirstDeviceBootstrap).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: 'I compared both fingerprints and they match exactly.' }));
    await user.click(screen.getByRole('button', { name: 'Approve this security key' }));
    await user.type(await screen.findByLabelText('6-digit authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm change' }));

    await waitFor(() => {
      expect(clients.serviceAuth.issueSensitiveStepUp).toHaveBeenCalledWith('family.device.bootstrap.root', '123456');
      expect(clients.deviceEnrollment.approveFirstDeviceBootstrap).toHaveBeenCalledWith(
        'family-1',
        'ceremony-001',
        'one-use-bootstrap-grant',
      );
    });
    expect(await screen.findByText(/Approval recorded\./)).toHaveTextContent('It is not active yet.');
    expect(screen.queryByText(/^Active$/)).not.toBeInTheDocument();
  });

  it('does not submit or consume step-up when the owner cancels the TOTP prompt', async () => {
    const user = userEvent.setup();
    const clients = getApiClients();
    renderWithProviders(<FirstDeviceBootstrapApprovalPanel familyId="family-1" />, { role: 'OWNER' });

    await screen.findByText('sha256:11:22:33:44');
    await user.click(screen.getByRole('checkbox', { name: 'I compared both fingerprints and they match exactly.' }));
    await user.click(screen.getByRole('button', { name: 'Approve this security key' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(clients.serviceAuth.issueSensitiveStepUp).not.toHaveBeenCalled();
    expect(clients.deviceEnrollment.approveFirstDeviceBootstrap).not.toHaveBeenCalled();
  });

  it('is reachable from the existing Pending setup device section', async () => {
    const clients = getApiClients();
    vi.spyOn(clients.deviceEnrollment, 'listInvitations').mockResolvedValue([]);
    renderWithProviders(
      <PendingSetupSection familyId="family-1" onGoToSection={vi.fn()} />,
      { role: 'OWNER' },
    );

    expect(await screen.findByRole('heading', { name: "Approve the first device's security key" })).toBeInTheDocument();
    expect(await screen.findByText('sha256:11:22:33:44')).toBeInTheDocument();
  });

  it('renders the approval and non-activation guidance in native Arabic RTL', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const clients = getApiClients();
    vi.mocked(clients.deviceEnrollment.listFirstDeviceBootstrapCeremonies).mockResolvedValueOnce([{
      ...ceremony,
      status: 'APPROVED',
      approvedAt: '2026-10-05T10:01:00.000Z',
    }]);
    renderWithProviders(<FirstDeviceBootstrapApprovalPanel familyId="family-1" />, { role: 'OWNER' });

    expect(await screen.findByRole('heading', { name: 'الموافقة على مفتاح الأمان لأول جهاز' })).toBeInTheDocument();
    expect(await screen.findByText(/سُجّلت الموافقة/)).toHaveTextContent('لم يُفعّل بعد.');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText('sha256:11:22:33:44').closest('bdi')).toHaveAttribute('dir', 'ltr');
  });
});
