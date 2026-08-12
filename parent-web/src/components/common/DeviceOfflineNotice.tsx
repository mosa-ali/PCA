import { useTranslation } from 'react-i18next';

export interface DeviceOfflineNoticeProps {
  lastSuccessfulSyncUtc: string | null;
  lastAppliedPolicyRevision: number | null;
  hasPendingPolicyDelivery: boolean;
}

/**
 * Honest child/device-offline messaging. When a device is reported
 * offline, the UI must never imply protection is disabled -- existing
 * on-device policy keeps enforcing locally even though the parent console
 * cannot currently confirm freshness or deliver new changes. See task spec
 * "child offline UX": show OFFLINE, last successful sync time, last known
 * applied policy revision, that remote data may be stale, and that any new
 * parent policy is pending delivery.
 */
export function DeviceOfflineNotice({
  lastSuccessfulSyncUtc,
  lastAppliedPolicyRevision,
  hasPendingPolicyDelivery,
}: DeviceOfflineNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="offline-notice card" role="status">
      <p>
        <strong>{t('offline.deviceOfflineTitle')}</strong>
      </p>
      <p>{t('offline.staleDataNote')}</p>
      <p>{t('offline.protectionContinuesNote')}</p>
      <dl>
        <dt>{t('offline.lastSuccessfulSync')}</dt>
        <dd>
          {lastSuccessfulSyncUtc ? <bdi className="iso">{lastSuccessfulSyncUtc}</bdi> : t('offline.neverSynced')}
        </dd>
        <dt>{t('offline.lastAppliedRevision')}</dt>
        <dd>{lastAppliedPolicyRevision ?? t('offline.unknown')}</dd>
      </dl>
      {hasPendingPolicyDelivery && <p>{t('offline.pendingDeliveryNote')}</p>}
    </div>
  );
}
