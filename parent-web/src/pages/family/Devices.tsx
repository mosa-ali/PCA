import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { config } from '../../config/env';
import { cookieSessionFamilyId } from '../../api/real/realBillingClient';
import { RealProtectionAdministrationActions } from '../../api/real/realProtectionAdministrationActions';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import DeviceEnrollmentPanel from './DeviceEnrollmentPanel';
import ProtectionAdministrationPanel, { type ProtectionTargetOption } from './ProtectionAdministrationPanel';

export default function Devices() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.deviceStatus.listDeviceStatuses(), []);
  const { data: dashboard } = useAsync(() => clients.parentFamilyData.getDashboard(), []);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const targets: ProtectionTargetOption[] = (data ?? []).map((device) => ({
    childId: device.childId,
    childLabel: dashboard?.children.find((child) => child.childId === device.childId)?.displayName ?? device.childId,
    deviceId: device.deviceId,
    deviceLabel: device.deviceLabel,
    protectionLevel: device.protectionState,
  }));

  // Demo mode has no authenticated family-session cookie to bind against, so
  // the panel is left in its honest "binding not installed" state there,
  // exactly as its own doc comment describes -- never a fabricated demo
  // implementation of a real authenticated family action.
  const protectionActions = useMemo(
    () =>
      clients.isFixtureBacked
        ? undefined
        : new RealProtectionAdministrationActions(
            config.apiBaseUrl,
            () => cookieSessionFamilyId(config.apiBaseUrl),
            () => targets,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients.isFixtureBacked],
  );

  const removeDevice = async (deviceId: string, childId: string, protectionLevel: ProtectionTargetOption['protectionLevel']) => {
    if (!protectionActions) return;
    setRemoveError(null);
    setRemovingDeviceId(deviceId);
    try {
      await protectionActions.requestApproval({
        childId,
        deviceId,
        protectionLevel,
        operation: 'REMOVE_REVOKE_DEVICE',
        reasonCategory: null,
      });
    } catch {
      setRemoveError(t('devicesTable.removeRequestFailed', { defaultValue: 'The removal request could not be created.' }));
    } finally {
      setRemovingDeviceId(null);
    }
  };

  return (
    <section aria-labelledby="devices-title">
      <h1 id="devices-title">{t('nav.devices')}</h1>

      <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
        <DeviceEnrollmentPanel />
        <ProtectionAdministrationPanel targets={targets} actions={protectionActions} />
      </PermissionGate>
      {removeError && <p role="alert">{removeError}</p>}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState />}
      {!loading && !error && data && data.length > 0 && (
      <div className="table-scroll">
        <table className="data-table responsive-cards">
          <thead>
            <tr>
              <th scope="col">{t('devicesTable.device')}</th>
              <th scope="col">{t('devicesTable.os')}</th>
              <th scope="col">{t('devicesTable.protection')}</th>
              <th scope="col">{t('devicesTable.policyRevision')}</th>
              <th scope="col">{t('devicesTable.epoch')}</th>
              <th scope="col" aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.deviceId}>
                <td data-label={t('devicesTable.device')}>{d.deviceLabel}</td>
                <td data-label={t('devicesTable.os')}>{d.osFamily}</td>
                <td data-label={t('devicesTable.protection')}>
                  <StatusBadge state={d.protectionState} />
                </td>
                <td data-label={t('devicesTable.policyRevision')}>{d.lastAcknowledgedPolicyRevision}</td>
                <td data-label={t('devicesTable.epoch')}>
                  {t('devicesTable.epochValue', { trust: d.trustSetEpoch, key: d.keyEpoch })}
                </td>
                <td>
                  <PermissionGate action="REMOVE_OR_REVOKE_DEVICE" showDisabledFallback>
                    <button
                      type="button"
                      className="btn"
                      disabled={!protectionActions || removingDeviceId === d.deviceId}
                      onClick={() => void removeDevice(d.deviceId, d.childId, d.protectionState)}
                    >
                      {t('common.delete')}
                    </button>
                  </PermissionGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
