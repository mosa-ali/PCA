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
              <th scope="col">Action</th>
              <th scope="col">Actor</th>
              <th scope="col">Target scope</th>
              <th scope="col">Result</th>
              <th scope="col">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.eventId}>
                <td data-label="Action">{a.actionType}</td>
                <td data-label="Actor">{a.actorMemberId}</td>
                <td data-label="Target scope">
                  <bdi className="iso">{a.targetScope}</bdi>
                </td>
                <td data-label="Result">{a.resultStatus}</td>
                <td data-label="Timestamp">
                  {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
                    new Date(a.timestampUtc),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Audit entries never carry URLs, locations, activity detail, or recovery secrets.
      </p>
    </section>
  );
}
