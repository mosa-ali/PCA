import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { resolveChildDeviceId } from '../../api/real/realParentFamilyDataGateway';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { DeviceOfflineNotice } from '../../components/common/DeviceOfflineNotice';
import type { CapabilityState } from '../../domain/types';

interface ChildOverviewData {
  childId: string;
  displayName: string;
  deviceState: CapabilityState;
  protectionCapabilityState: CapabilityState;
  policyDeliveryState: CapabilityState;
  pendingRequestCount: number;
  lastAppliedPolicyRevision: number | null;
  lastSuccessfulSyncUtc: string | null;
  hasPendingPolicyDelivery: boolean;
}

export default function ChildOverview() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(async (): Promise<ChildOverviewData | null> => {
    const dashboard = await clients.parentFamilyData.getDashboard();
    const child = dashboard.children.find((c) => c.childId === childId);
    if (!child) return null;
    // The child's REAL device id, never a `device-${childId}` synthetic one
    // (which can never match a real device row) -- throws honestly when no
    // device is enrolled, surfacing as this page's ErrorState rather than
    // three lookups quietly answering about a device that cannot exist.
    const deviceId = await resolveChildDeviceId(clients.deviceStatus, childId);
    const [device, lastSuccessfulSyncUtc, pendingDelivery] = await Promise.all([
      clients.deviceStatus.getDeviceStatus(deviceId),
      clients.runtimeSync.getLastSuccessfulSync(deviceId),
      clients.runtimeSync.getPendingDeliveryStatus(deviceId),
    ]);
    return {
      childId: child.childId,
      displayName: child.displayName,
      deviceState: child.deviceState,
      protectionCapabilityState: child.protectionCapabilityState,
      policyDeliveryState: child.policyDeliveryState,
      pendingRequestCount: child.pendingRequestCount,
      lastAppliedPolicyRevision: device?.lastAcknowledgedPolicyRevision ?? null,
      lastSuccessfulSyncUtc,
      hasPendingPolicyDelivery: pendingDelivery.pendingCount > 0,
    };
  }, [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState message={t('common.emptyTitle')} />;

  return (
    <div className="card-grid">
      {data.deviceState === 'OFFLINE' && (
        <DeviceOfflineNotice
          lastSuccessfulSyncUtc={data.lastSuccessfulSyncUtc}
          lastAppliedPolicyRevision={data.lastAppliedPolicyRevision}
          hasPendingPolicyDelivery={data.hasPendingPolicyDelivery}
        />
      )}
      <article className="card">
        <h2>{t('dashboard.deviceState')}</h2>
        <StatusBadge state={data.deviceState} />
      </article>
      <article className="card">
        <h2>{t('dashboard.protectionCapability')}</h2>
        <StatusBadge state={data.protectionCapabilityState} />
      </article>
      <article className="card">
        <h2>{t('dashboard.policyDelivery')}</h2>
        <StatusBadge state={data.policyDeliveryState} />
      </article>
      <article className="card">
        <h2>{t('dashboard.pendingRequests')}</h2>
        <p>{data.pendingRequestCount > 0 ? <Link to="/requests">{data.pendingRequestCount}</Link> : data.pendingRequestCount}</p>
      </article>
    </div>
  );
}
