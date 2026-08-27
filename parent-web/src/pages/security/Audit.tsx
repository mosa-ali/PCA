import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';

/**
 * PCA product-completion programme, Writer P0-D: renders the family's real,
 * decrypted-once-available audit trail, delivered as opaque
 * FamilyAuditEventLedger envelopes and decrypted only on this trusted
 * browser -- see AUDIT_EVENT_MODEL in
 * docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md.
 * `PENDING_TRUSTED_DECRYPTION` is the honest state until a real production
 * decryption boundary exists, mirroring ProtectionAlertPanel.tsx's
 * established pattern exactly -- never a fabricated empty list. Every
 * actionType/targetScope value is rendered through a real i18n label
 * (audit.actionTypes / audit.targetScopeKinds), never a raw enum dump --
 * the exact anti-pattern already fixed once this session in
 * ProtectionAlertPanel.tsx must not recur here.
 */
export default function Audit() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.familyAuditDelivery.list(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title">{t('nav.audit')}</h1>
      {data.status === 'PENDING_TRUSTED_DECRYPTION' && <p role="status">{t('audit.pendingDecryption')}</p>}
      {data.status === 'READY' && data.entries.length === 0 && <p>{t('common.emptyTitle')}</p>}
      {data.status === 'READY' && data.entries.length > 0 && (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('audit.action')}</th>
                <th scope="col">{t('audit.targetScope')}</th>
                <th scope="col">{t('audit.result')}</th>
                <th scope="col">{t('audit.timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.eventId}>
                  <td data-label={t('audit.action')}>{t(`audit.actionTypes.${entry.actionType}`, { defaultValue: entry.actionType })}</td>
                  <td data-label={t('audit.targetScope')}>{t(`audit.targetScopeKinds.${entry.targetScope}`, { defaultValue: entry.targetScope })}</td>
                  <td data-label={t('audit.result')}>{t(`audit.resultStatuses.${entry.resultStatus}`, { defaultValue: entry.resultStatus })}</td>
                  <td data-label={t('audit.timestamp')}>
                    {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.timestampUtc))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: 'var(--color-text-muted)' }}>{t('audit.note')}</p>
    </section>
  );
}
