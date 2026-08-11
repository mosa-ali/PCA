import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function WebProtectionPage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getWebProtection(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.webProtection')}</h2>
        <StatusBadge state={data.state} />
        <p>Filtering level: {data.filteringLevel}</p>
        <p>Blocked categories: {data.blockedCategoryCount}</p>
        <p>Allowlist entries: {data.allowlistCount}</p>
      </article>
    </div>
  );
}
