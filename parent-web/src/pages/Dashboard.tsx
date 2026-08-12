import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../components/common/States';
import { StatusBadge } from '../components/common/StatusBadge';
import { DeviceOfflineNotice } from '../components/common/DeviceOfflineNotice';
import type { ChildSummary } from '../domain/types';

function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return '--';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(-days, 'day');
}

/** Fetches and shows the child-offline notice for a specific device. Kept separate from the main dashboard fetch so one offline child does not delay the others. */
function ChildOfflineSyncNotice({ deviceId }: { deviceId: string }) {
  const clients = getApiClients();
  const { data } = useAsync(async () => {
    const [lastSuccessfulSyncUtc, device, pending] = await Promise.all([
      clients.runtimeSync.getLastSuccessfulSync(),
      clients.deviceStatus.getDeviceStatus(deviceId),
      clients.runtimeSync.getPendingDeliveryStatus(deviceId),
    ]);
    return {
      lastSuccessfulSyncUtc,
      lastAppliedPolicyRevision: device?.lastAcknowledgedPolicyRevision ?? null,
      hasPendingPolicyDelivery: pending.pendingCount > 0,
    };
  }, [deviceId]);
  if (!data) return null;
  return (
    <DeviceOfflineNotice
      lastSuccessfulSyncUtc={data.lastSuccessfulSyncUtc}
      lastAppliedPolicyRevision={data.lastAppliedPolicyRevision}
      hasPendingPolicyDelivery={data.hasPendingPolicyDelivery}
    />
  );
}

function ChildCard({ child }: { child: ChildSummary }) {
  const { t, i18n } = useTranslation();
  return (
    <article className="card">
      <h2>
        <Link to={`/children/${child.childId}/overview`}>{child.displayName}</Link>
      </h2>
      {child.deviceState === 'OFFLINE' && <ChildOfflineSyncNotice deviceId={`device-${child.childId}`} />}
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: '0.4rem', margin: 0 }}>
        <dt>{t('dashboard.deviceState')}</dt>
        <dd><StatusBadge state={child.deviceState} /></dd>
        <dt>{t('dashboard.screenTime')}</dt>
        <dd><StatusBadge state={child.screenTimeState} /></dd>
        <dt>{t('dashboard.breakStatus')}</dt>
        <dd><StatusBadge state={child.breakState} /></dd>
        <dt>{t('dashboard.battery')}</dt>
        <dd>
          {child.batteryPercent === null ? (
            <span>{t('common.batteryUnknown')}</span>
          ) : (
            <span>{t('common.battery', { percent: child.batteryPercent })}</span>
          )}{' '}
          <StatusBadge state={child.batteryState} />
        </dd>
        <dt>{t('dashboard.lastSeen')}</dt>
        <dd>
          <bdi className="iso">{relativeTime(child.lastSeenUtc, i18n.language)}</bdi>{' '}
          <StatusBadge state={child.lastSeenState} />
        </dd>
        <dt>{t('dashboard.protectionCapability')}</dt>
        <dd><StatusBadge state={child.protectionCapabilityState} /></dd>
        <dt>{t('dashboard.policyDelivery')}</dt>
        <dd><StatusBadge state={child.policyDeliveryState} /></dd>
        <dt>{t('dashboard.pendingRequests')}</dt>
        <dd>{child.pendingRequestCount}</dd>
        <dt>{t('dashboard.importantAlerts')}</dt>
        <dd>{child.importantAlertCount}</dd>
      </dl>
    </article>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getDashboard(), []);

  return (
    <section aria-labelledby="dashboard-title">
      <h1 id="dashboard-title">{t('dashboard.title')}</h1>
      <p className="card" style={{ marginBottom: '1rem' }}>{t('dashboard.honestNote')}</p>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.children.length === 0 && <EmptyState />}
      {data && data.children.length > 0 && (
        <div className="card-grid">
          {data.children.map((child) => (
            <ChildCard key={child.childId} child={child} />
          ))}
        </div>
      )}
    </section>
  );
}
