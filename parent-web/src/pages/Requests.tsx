import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../components/common/States';
import { PermissionGate } from '../rbac/PermissionGate';
import { useFamilyAction } from '../rbac/useFamilyAction';

export default function Requests() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.requests.listRequests(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.length === 0) return <EmptyState />;

  const decide = async (requestId: string, decision: 'APPROVED' | 'DENIED') => {
    try {
      await runFamilyAction('APPROVE_REQUEST', () => clients.requests.decide(requestId, decision));
      reload();
    } catch {
      // denied/cancelled
    }
  };

  return (
    <section aria-labelledby="requests-title">
      <h1 id="requests-title">{t('requestsPage.title')}</h1>
      <div className="table-scroll">
        <table className="data-table responsive-cards">
          <thead>
            <tr>
              <th scope="col">{t('requestsPage.child')}</th>
              <th scope="col">{t('requestsPage.type')}</th>
              <th scope="col">{t('requestsPage.reason')}</th>
              <th scope="col">{t('requestsPage.created')}</th>
              <th scope="col">{t('requestsPage.status')}</th>
              <th scope="col" aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((req) => (
              <tr key={req.requestId}>
                <td data-label={t('requestsPage.child')}>{req.childDisplayName}</td>
                <td data-label={t('requestsPage.type')}>{req.type}</td>
                <td data-label={t('requestsPage.reason')}>
                  <bdi className="iso">{req.reasonText ?? '--'}</bdi>
                </td>
                <td data-label={t('requestsPage.created')}>
                  {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
                    new Date(req.createdAtUtc),
                  )}
                </td>
                <td data-label={t('requestsPage.status')}>{req.status}</td>
                <td>
                  {req.status === 'PENDING' && (
                    <PermissionGate action="APPROVE_REQUEST" showDisabledFallback>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button type="button" className="btn btn-primary" onClick={() => decide(req.requestId, 'APPROVED')}>
                          {t('common.approve')}
                        </button>
                        <button type="button" className="btn" onClick={() => decide(req.requestId, 'DENIED')}>
                          {t('common.deny')}
                        </button>
                      </div>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
