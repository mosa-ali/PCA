import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function ChildrenList() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getDashboard(), []);

  return (
    <section aria-labelledby="children-title">
      <h1 id="children-title">{t('nav.children')}</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.children.length === 0 && <EmptyState />}
      {data && data.children.length > 0 && (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('dashboard.children')}</th>
                <th scope="col">{t('dashboard.deviceState')}</th>
                <th scope="col">{t('dashboard.protectionCapability')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {data.children.map((c) => (
                <tr key={c.childId}>
                  <td data-label={t('dashboard.children')}>{c.displayName}</td>
                  <td data-label={t('dashboard.deviceState')}>
                    <StatusBadge state={c.deviceState} />
                  </td>
                  <td data-label={t('dashboard.protectionCapability')}>
                    <StatusBadge state={c.protectionCapabilityState} />
                  </td>
                  <td>
                    <Link to={`/children/${c.childId}/overview`}>{t('nav.childrenOverview')}</Link>
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
