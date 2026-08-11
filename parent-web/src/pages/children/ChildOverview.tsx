import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function ChildOverview() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(async () => {
    const dashboard = await clients.parentFamilyData.getDashboard();
    return dashboard.children.find((c) => c.childId === childId) ?? null;
  }, [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState message={t('common.emptyTitle')} />;

  return (
    <div className="card-grid">
      <article className="card">
        <h3>{t('dashboard.deviceState')}</h3>
        <StatusBadge state={data.deviceState} />
      </article>
      <article className="card">
        <h3>{t('dashboard.protectionCapability')}</h3>
        <StatusBadge state={data.protectionCapabilityState} />
      </article>
      <article className="card">
        <h3>{t('dashboard.policyDelivery')}</h3>
        <StatusBadge state={data.policyDeliveryState} />
      </article>
      <article className="card">
        <h3>{t('dashboard.pendingRequests')}</h3>
        <p>{data.pendingRequestCount}</p>
      </article>
    </div>
  );
}
