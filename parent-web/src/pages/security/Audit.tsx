import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';

export default function Audit() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.familyAuthority.listAuditTrail(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.length === 0) return <EmptyState />;

  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title">{t('nav.audit')}</h1>
      <div className="table-scroll">
        <table className="data-table responsive-cards">
          <thead>
            <tr>
              <th scope="col">{t('audit.action')}</th>
              <th scope="col">{t('audit.actor')}</th>
              <th scope="col">{t('audit.targetScope')}</th>
              <th scope="col">{t('audit.result')}</th>
              <th scope="col">{t('audit.timestamp')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.eventId}>
                <td data-label={t('audit.action')}>{a.actionType}</td>
                <td data-label={t('audit.actor')}>{a.actorMemberId}</td>
                <td data-label={t('audit.targetScope')}>
                  <bdi className="iso">{a.targetScope}</bdi>
                </td>
                <td data-label={t('audit.result')}>{a.resultStatus}</td>
                <td data-label={t('audit.timestamp')}>
                  {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
                    new Date(a.timestampUtc),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('audit.note')}</p>
    </section>
  );
}
