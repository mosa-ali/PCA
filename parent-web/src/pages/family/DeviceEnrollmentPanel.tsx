import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { config } from '../../config/env';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useAuth } from '../../state/AuthContext';
import { DeviceEnrollmentError } from '../../api/deviceEnrollmentClient';
import InvitationQrCode from './InvitationQrCode';
import type {
  InvitationDto,
  InvitationPlatform,
  PairingRequestDto,
  RequestedProtectionMode,
} from '../../api/deviceEnrollmentClient';

const HINT_STYLE = { color: 'var(--color-text-muted)', fontSize: '0.85rem' } as const;

function errorMessageKey(err: unknown): string {
  if (err instanceof DeviceEnrollmentError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        return 'deviceEnrollment.errors.unauthorized';
      case 'FORBIDDEN':
        return 'deviceEnrollment.errors.forbidden';
      case 'NOT_FOUND':
        return 'deviceEnrollment.errors.notFound';
      case 'CONFLICT':
        return 'deviceEnrollment.errors.conflict';
      case 'RATE_LIMITED':
        return 'deviceEnrollment.errors.rateLimited';
      case 'NETWORK_ERROR':
        return 'deviceEnrollment.errors.network';
      case 'SERVICE_SESSION_UNAVAILABLE':
        return 'deviceEnrollment.errors.sessionUnavailable';
      case 'INVALID_REQUEST':
        return 'deviceEnrollment.errors.invalidRequest';
      default:
        return 'deviceEnrollment.errors.unknown';
    }
  }
  return 'deviceEnrollment.errors.unknown';
}

/**
 * Extends the Family -> Devices surface with child-device enrollment:
 * invitation creation/list/revoke and pairing-request lookup/confirm. This
 * is intentionally NOT a new IA branch -- it renders inside the existing
 * family/devices route (see ../Devices.tsx).
 *
 * Security invariants enforced here (see api/deviceEnrollmentClient.ts and
 * api/real/realDeviceEnrollmentClient.ts for the server-side contract this
 * mirrors):
 *  - The raw invitation token/link is held only in this component's local
 *    `justCreated` state (never localStorage/sessionStorage), is shown only
 *    immediately after creation, and this component never attempts to
 *    refetch it after navigating away or reloading.
 *  - confirmPairing is never invoked automatically; it requires an explicit
 *    button click, and the button is disabled unless BOTH fingerprints are
 *    present on a PAIRING_PENDING request.
 *  - Confirmation results are rendered from the server's own `status`
 *    field, which can only ever be PAIRED (or REVOKED/etc. via other
 *    endpoints) -- this component never has any code path that renders
 *    "ACTIVE".
 */
export default function DeviceEnrollmentPanel() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { session } = useAuth();
  const familyId = session?.familyId ?? '';

  const {
    data: invitations,
    loading: invitationsLoading,
    error: invitationsError,
    reload: reloadInvitations,
  } = useAsync(() => clients.deviceEnrollment.listInvitations(familyId), [familyId]);

  const [platform, setPlatform] = useState<InvitationPlatform>('ANDROID');
  const [protectionMode, setProtectionMode] = useState<RequestedProtectionMode>('ANDROID_STANDARD');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ invitation: InvitationDto; rawInvitationToken: string } | null>(
    null,
  );

  const [actionError, setActionError] = useState<string | null>(null);

  const [lookupDeviceId, setLookupDeviceId] = useState('');
  const [pairing, setPairing] = useState<PairingRequestDto | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const protectionModeOptions: RequestedProtectionMode[] =
    platform === 'ANDROID' ? ['ANDROID_STANDARD', 'ANDROID_PROTECTED'] : ['IOS_STANDARD'];

  const handlePlatformChange = (next: InvitationPlatform) => {
    setPlatform(next);
    setProtectionMode(next === 'ANDROID' ? 'ANDROID_STANDARD' : 'IOS_STANDARD');
  };

  const create = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const created = await clients.deviceEnrollment.createInvitation(familyId, {
        platform,
        requestedProtectionMode: protectionMode,
      });
      const { rawInvitationToken, ...invitation } = created;
      setJustCreated({ invitation, rawInvitationToken });
      reloadInvitations();
    } catch (e) {
      setCreateError(t(errorMessageKey(e)));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (invitationId: string) => {
    setActionError(null);
    try {
      await clients.deviceEnrollment.revokeInvitation(familyId, invitationId);
      reloadInvitations();
    } catch (e) {
      setActionError(t(errorMessageKey(e)));
    }
  };

  const lookupPairing = async () => {
    const deviceId = lookupDeviceId.trim();
    if (!deviceId) return;
    setPairingError(null);
    setPairingLoading(true);
    setPairing(null);
    try {
      const view = await clients.deviceEnrollment.getPairingRequest(familyId, deviceId);
      setPairing(view);
    } catch (e) {
      setPairingError(t(errorMessageKey(e)));
    } finally {
      setPairingLoading(false);
    }
  };

  const confirmPairing = async () => {
    if (!pairing) return;
    setPairingError(null);
    setConfirming(true);
    try {
      const result = await clients.deviceEnrollment.confirmPairing(familyId, pairing.deviceId);
      setPairing(result);
    } catch (e) {
      setPairingError(t(errorMessageKey(e)));
    } finally {
      setConfirming(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable in this context -- the value remains
      // visible/selectable in the <code> element as a fallback.
    }
  };

  const enrollmentLink = justCreated
    ? `${config.deviceEnrollmentLinkBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(justCreated.rawInvitationToken)}`
    : null;

  const canConfirmPairing =
    !!pairing && pairing.status === 'PAIRING_PENDING' && !!pairing.dskFingerprint && !!pairing.dekFingerprint;

  return (
    <section className="enrollment-panel" aria-labelledby="device-enrollment-title">
      <h2 id="device-enrollment-title">{t('deviceEnrollment.title')}</h2>

      <PermissionGate action="CREATE_DEVICE_INVITATION" showDisabledFallback>
        <div className="field">
          <label htmlFor="enrollment-platform">{t('deviceEnrollment.platform')}</label>
          <select
            id="enrollment-platform"
            value={platform}
            onChange={(e) => handlePlatformChange(e.target.value as InvitationPlatform)}
          >
            <option value="ANDROID">{t('deviceEnrollment.platformAndroid')}</option>
            <option value="IOS">{t('deviceEnrollment.platformIos')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="enrollment-protection-mode">{t('deviceEnrollment.protectionMode')}</label>
          <select
            id="enrollment-protection-mode"
            value={protectionMode}
            onChange={(e) => setProtectionMode(e.target.value as RequestedProtectionMode)}
          >
            {protectionModeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {t(`deviceEnrollment.mode.${mode}`)}
              </option>
            ))}
          </select>
        </div>
        {protectionMode === 'ANDROID_PROTECTED' && <p style={HINT_STYLE}>{t('deviceEnrollment.protectedModeNote')}</p>}
        <button type="button" className="btn btn-primary" onClick={create} disabled={creating || !familyId}>
          {creating ? t('deviceEnrollment.creating') : t('deviceEnrollment.createInvitation')}
        </button>
        {createError && <ErrorState message={createError} />}
      </PermissionGate>

      {justCreated && enrollmentLink && (
        <div className="token-reveal-once" role="region" aria-labelledby="token-reveal-title">
          <h3 id="token-reveal-title">{t('deviceEnrollment.tokenRevealTitle')}</h3>
          <p>{t('deviceEnrollment.tokenRevealBody')}</p>
          <InvitationQrCode value={enrollmentLink} />
          <div className="copyable-value">
            <code data-testid="enrollment-link">{enrollmentLink}</code>
            <button type="button" className="btn" onClick={() => copy(enrollmentLink)}>
              {t('deviceEnrollment.copyLink')}
            </button>
          </div>
          <div className="copyable-value">
            <code data-testid="raw-invitation-token">{justCreated.rawInvitationToken}</code>
            <button type="button" className="btn" onClick={() => copy(justCreated.rawInvitationToken)}>
              {t('deviceEnrollment.copyToken')}
            </button>
          </div>
          <p style={HINT_STYLE}>{t('deviceEnrollment.tokenNeverAgain')}</p>
          <button type="button" className="btn" onClick={() => setJustCreated(null)}>
            {t('common.close')}
          </button>
        </div>
      )}

      <h3>{t('deviceEnrollment.invitationsListTitle')}</h3>
      {invitationsLoading && <LoadingState />}
      {invitationsError && <ErrorState message={invitationsError} onRetry={reloadInvitations} />}
      {!invitationsLoading && !invitationsError && (!invitations || invitations.length === 0) && <EmptyState />}
      {!invitationsLoading && !invitationsError && invitations && invitations.length > 0 && (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('deviceEnrollment.platform')}</th>
                <th scope="col">{t('deviceEnrollment.protectionMode')}</th>
                <th scope="col">{t('family.status')}</th>
                <th scope="col">{t('deviceEnrollment.expiresAt')}</th>
                <th scope="col" aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.invitationId}>
                  <td data-label={t('deviceEnrollment.platform')}>
                    {inv.platform === 'ANDROID' ? t('deviceEnrollment.platformAndroid') : t('deviceEnrollment.platformIos')}
                  </td>
                  <td data-label={t('deviceEnrollment.protectionMode')}>
                    {t(`deviceEnrollment.mode.${inv.requestedProtectionMode}`)}
                  </td>
                  <td data-label={t('family.status')}>{inv.status}</td>
                  <td data-label={t('deviceEnrollment.expiresAt')}>{new Date(inv.expiresAt).toLocaleString()}</td>
                  <td>
                    {inv.status !== 'REVOKED' && (
                      <PermissionGate action="REVOKE_DEVICE_INVITATION" showDisabledFallback>
                        <button type="button" className="btn" onClick={() => revoke(inv.invitationId)}>
                          {t('deviceEnrollment.revoke')}
                        </button>
                      </PermissionGate>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {actionError && <ErrorState message={actionError} />}

      <h3>{t('deviceEnrollment.pairingTitle')}</h3>
      <div className="field">
        <label htmlFor="pairing-device-id">{t('deviceEnrollment.deviceId')}</label>
        <input
          id="pairing-device-id"
          type="text"
          value={lookupDeviceId}
          onChange={(e) => setLookupDeviceId(e.target.value)}
        />
      </div>
      <button type="button" className="btn" onClick={lookupPairing} disabled={pairingLoading || !lookupDeviceId.trim()}>
        {t('deviceEnrollment.lookupPairing')}
      </button>
      {pairingLoading && <LoadingState />}
      {pairingError && <ErrorState message={pairingError} />}
      {pairing && (
        <div className="enrollment-panel">
          <p>
            {t('deviceEnrollment.devicePlatformLabel')}: {pairing.platform}
          </p>
          <p>
            {t('family.status')}: {pairing.status}
          </p>
          <div className="fingerprint-grid">
            <div className="copyable-value">
              <span>{t('deviceEnrollment.dskFingerprint')}:</span>
              <code>{pairing.dskFingerprint ?? t('deviceEnrollment.fingerprintPending')}</code>
            </div>
            <div className="copyable-value">
              <span>{t('deviceEnrollment.dekFingerprint')}:</span>
              <code>{pairing.dekFingerprint ?? t('deviceEnrollment.fingerprintPending')}</code>
            </div>
          </div>
          <p style={HINT_STYLE}>{t('deviceEnrollment.fingerprintCompareInstruction')}</p>
          <PermissionGate action="CONFIRM_DEVICE_PAIRING" showDisabledFallback>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirmPairing}
              disabled={!canConfirmPairing || confirming}
            >
              {confirming ? t('deviceEnrollment.confirming') : t('deviceEnrollment.confirmPairing')}
            </button>
          </PermissionGate>
          {pairing.status === 'PAIRED' && <p role="status">{t('deviceEnrollment.paired')}</p>}
        </div>
      )}
    </section>
  );
}
