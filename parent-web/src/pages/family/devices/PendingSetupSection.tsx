import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AsyncStates } from '../../../components/common/States';
import { Disclosure } from '../../../components/common/Disclosure';
import { PermissionGate } from '../../../rbac/PermissionGate';
import { getApiClients } from '../../../api/client';
import { formatDateTime } from '../../../i18n/formatters';
import { PairingConfirmation, RampPill } from '../DeviceEnrollmentPanel';
import { errorMessageKey, invitationStatusRamp, useInvitations } from './enrollmentState';
import type { DevicesSectionId } from './DevicesTabs';

/**
 * Section 3 -- every enrollment that has been started but is not finished, in
 * one list.
 *
 * The manual "type a Device ID and look it up" form is no longer a primary
 * affordance here; it survives on the Advanced & security section as a support
 * and recovery tool. What a parent gets here instead is the pairing
 * confirmation folded into the row that needs it.
 *
 * PRODUCT GAP, RAISED NOT DESIGNED AROUND: `InvitationDto` carries no device
 * id, and there is no route that maps an invitation to the pairing request its
 * device will raise. So even the row-scoped confirmation has to ask for the id
 * the CHILD DEVICE displays on its own setup screen. That is honest -- it is
 * genuinely where the number comes from -- but it is not automatic, and it
 * cannot be until such a mapping exists.
 */
export default function PendingSetupSection({
  familyId,
  onGoToSection,
}: {
  familyId: string;
  onGoToSection: (section: DevicesSectionId) => void;
}) {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { invitations, loading, error, reload } = useInvitations(familyId);
  const [actionError, setActionError] = useState<string | null>(null);

  const revoke = async (invitationId: string) => {
    setActionError(null);
    try {
      await clients.deviceEnrollment.revokeInvitation(familyId, invitationId);
      reload();
    } catch (e) {
      setActionError(t(errorMessageKey(e)));
    }
  };

  return (
    <section className="device-section" aria-labelledby="devices-pending-title">
      <div className="section-panel-head">
        <h2 className="section-panel-title" id="devices-pending-title">
          {t('deviceEnrollment.invitationsListTitle')}
        </h2>
      </div>

      <AsyncStates
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!invitations || invitations.length === 0}
      >
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
              {(invitations ?? []).map((inv) => (
                <tr key={inv.invitationId}>
                  <td data-label={t('deviceEnrollment.platform')}>
                    {/* Existing rows may legitimately carry IOS even though no
                        new iOS invitation can be created. */}
                    {inv.platform === 'ANDROID'
                      ? t('deviceEnrollment.platformAndroid')
                      : t('deviceEnrollment.platformIos')}
                  </td>
                  <td data-label={t('deviceEnrollment.protectionMode')}>
                    {t(`deviceEnrollment.mode.${inv.requestedProtectionMode}`)}
                  </td>
                  <td data-label={t('family.status')}>
                    <RampPill
                      ramp={invitationStatusRamp(inv.status)}
                      label={t(`deviceEnrollment.invitationStatuses.${inv.status}`, { defaultValue: inv.status })}
                    />
                  </td>
                  <td data-label={t('deviceEnrollment.expiresAt')}>
                    <bdi className="iso">{formatDateTime(inv.expiresAt, i18n.language)}</bdi>
                  </td>
                  <td>
                    {inv.status !== 'REVOKED' && (
                      <PermissionGate action="REVOKE_DEVICE_INVITATION" showDisabledFallback>
                        <button type="button" className="btn btn-sm" onClick={() => void revoke(inv.invitationId)}>
                          {t('deviceEnrollment.revoke')}
                        </button>
                      </PermissionGate>
                    )}
                    {inv.status === 'AUTHORIZATION_REQUIRED' && (
                      <Disclosure summary={t('deviceEnrollment.confirmPairing')}>
                        <p>{t('deviceEnrollment.pairingPlain')}</p>
                        <PairingConfirmation familyId={familyId} idSuffix={inv.invitationId} />
                      </Disclosure>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncStates>

      {actionError && (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="wizard-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onGoToSection('add')}>
          {t('devicesPage.tabAddDevice')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onGoToSection('advanced')}>
          {t('devicesPage.tabAdvanced')}
        </button>
      </div>
    </section>
  );
}
