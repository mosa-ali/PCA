import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function LocationPage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getLocationStatus(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const lastSeenLabel = data.lastSeenUtc
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastSeenUtc))
    : '--';

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.location')}</h2>
        <StatusBadge state={data.state} />
        <p>
          {t('dashboard.lastSeen')}: <bdi className="iso">{lastSeenLabel}</bdi>
        </p>
        <p>Accuracy: {data.accuracyMeters ? `${data.accuracyMeters}m` : '--'}</p>
        {data.isStale && <p role="status">This location data is stale.</p>}
      </article>
    </div>
  );
}
