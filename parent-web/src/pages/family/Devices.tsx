import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import DeviceEnrollmentPanel from './DeviceEnrollmentPanel';

export default function Devices() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.deviceStatus.listDeviceStatuses(), []);

  return (
    <section aria-labelledby="devices-title">
      <h1 id="devices-title">{t('nav.devices')}</h1>

      <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
        <DeviceEnrollmentPanel />
      </PermissionGate>

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
                    <button type="button" className="btn">
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
