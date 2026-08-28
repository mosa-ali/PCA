import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import type { AuditEntrySummary } from '../../domain/types';

const PAGE_SIZE = 10;
type ResultFilter = '' | AuditEntrySummary['resultStatus'];

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
 *
 * The result-status filter and "show more" pagination below apply only to
 * entries already decrypted and held locally, exactly like
 * Notifications.tsx's read/unread filter and ActivityTimelinePage.tsx's
 * category filter (see those files' headers) -- this is genuine
 * client-side slicing over data already in hand, never a fabricated
 * server-side query (AUDIT_EVENT_MODEL: "pagination/filtering only over
 * what's actually locally decrypted").
 */
export default function Audit() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.familyAuditDelivery.list(), []);
  const [resultFilter, setResultFilter] = useState<ResultFilter>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const entries = useMemo(() => (data?.status === 'READY' ? data.entries : []), [data]);
  const filteredEntries = useMemo(
    () => (resultFilter === '' ? entries : entries.filter((entry) => entry.resultStatus === resultFilter)),
    [entries, resultFilter],
  );
  const visibleEntries = filteredEntries.slice(0, visibleCount);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title">{t('nav.audit')}</h1>
      {data.status === 'PENDING_TRUSTED_DECRYPTION' && <p role="status">{t('audit.pendingDecryption')}</p>}
      {data.status === 'READY' && entries.length === 0 && <p>{t('common.emptyTitle')}</p>}

      {data.status === 'READY' && entries.length > 0 && (
        <div className="field" style={{ maxWidth: '20rem' }}>
          <label htmlFor="audit-result-filter">{t('audit.filterLabel')}</label>
          <select
            id="audit-result-filter"
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value as ResultFilter);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="">{t('audit.filterAll')}</option>
            <option value="SUCCESS">{t('audit.filterSuccess')}</option>
            <option value="DENIED">{t('audit.filterDenied')}</option>
            <option value="PENDING">{t('audit.filterPending')}</option>
          </select>
        </div>
      )}

      {data.status === 'READY' && entries.length > 0 && filteredEntries.length === 0 && <p>{t('audit.emptyForFilter')}</p>}

      {data.status === 'READY' && filteredEntries.length > 0 && (
        <>
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
                {visibleEntries.map((entry) => (
                  <tr key={entry.eventId}>
                    <td data-label={t('audit.action')}>{t(`audit.actionTypes.${entry.actionType}`, { defaultValue: entry.actionType })}</td>
                    <td data-label={t('audit.actor')}>{entry.actorMemberId ?? '--'}</td>
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
          {visibleCount < filteredEntries.length && (
            <button type="button" className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              {t('audit.showMore', { count: filteredEntries.length - visibleCount })}
            </button>
          )}
        </>
      )}
      <p style={{ color: 'var(--color-text-muted)' }}>{t('audit.note')}</p>
    </section>
  );
}
