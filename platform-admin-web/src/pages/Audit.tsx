import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../api/platformAdminApiClient';
import type { PagedResult } from '../domain/accounts';
import { AUDIT_RESULTS, type AuditEvent, type AuditResult } from '../domain/audit';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';

const PAGE_SIZE = 25;

/**
 * The "To date" input yields a bare YYYY-MM-DD. The backend parses it with
 * `new Date(value)` (backend/src/http/routes/platformadmin/auditRoutes.ts's
 * parseDate) -- which resolves a date-only string to UTC MIDNIGHT -- and
 * then filters `occurred_at <= <that instant>` (AuditReadModel.query). A
 * bare date therefore excludes every event that actually occurred ON the
 * selected end date. Sending the last representable instant of that UTC day
 * makes the filter mean what its label says (inclusive), and mirrors
 * `since`, whose UTC-midnight lower bound is already inclusive as-is.
 */
function toInclusiveEndOfDayInstant(yyyyMmDd: string): string {
  return `${yyyyMmDd}T23:59:59.999Z`;
}

export default function Audit() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventType, setEventType] = useState('');
  const [actorAdminId, setActorAdminId] = useState('');
  const [targetRef, setTargetRef] = useState('');
  const [result, setResult] = useState<AuditResult | ''>('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    eventType: '',
    actorAdminId: '',
    targetRef: '',
    result: '' as AuditResult | '',
    since: '',
    until: '',
  });

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PagedResult<AuditEvent>>('/platform-admin/audit', {
        limit: PAGE_SIZE,
        offset,
        eventType: appliedFilters.eventType || undefined,
        actorAdminId: appliedFilters.actorAdminId || undefined,
        targetRef: appliedFilters.targetRef || undefined,
        result: appliedFilters.result || undefined,
        since: appliedFilters.since || undefined,
        until: appliedFilters.until ? toInclusiveEndOfDayInstant(appliedFilters.until) : undefined,
      })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [offset, appliedFilters]);

  const onFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setAppliedFilters({ eventType, actorAdminId, targetRef, result, since, until });
  };

  return (
    <div className="page">
      <h1>{t('nav.audit')}</h1>

      <form className="filters" onSubmit={onFilterSubmit}>
        <div>
          <label htmlFor="audit-event-type">{t('audit.eventType')}</label>
          <input id="audit-event-type" value={eventType} onChange={(e) => setEventType(e.target.value)} />
        </div>
        <div>
          <label htmlFor="audit-actor">{t('audit.actorAdminId')}</label>
          <input id="audit-actor" value={actorAdminId} onChange={(e) => setActorAdminId(e.target.value)} />
        </div>
        <div>
          <label htmlFor="audit-target">{t('audit.targetRef')}</label>
          <input id="audit-target" value={targetRef} onChange={(e) => setTargetRef(e.target.value)} />
        </div>
        <div>
          <label htmlFor="audit-result">{t('audit.result')}</label>
          <select id="audit-result" value={result} onChange={(e) => setResult(e.target.value as AuditResult | '')}>
            <option value="">{t('common.all')}</option>
            {AUDIT_RESULTS.map((r) => (
              <option key={r} value={r}>
                {t(`audit.results.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-since">{t('audit.since')}</label>
          <input id="audit-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div>
          <label htmlFor="audit-until">{t('audit.until')}</label>
          <input id="audit-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <button type="submit" className="btn">
          {t('common.applyFilters')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('audit.occurredAt')}</th>
                <th scope="col">{t('audit.eventType')}</th>
                <th scope="col">{t('audit.actorAdminId')}</th>
                <th scope="col">{t('audit.actorRole')}</th>
                <th scope="col">{t('audit.targetRef')}</th>
                <th scope="col">{t('audit.result')}</th>
                <th scope="col">{t('audit.metadata')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((event) => (
                <tr key={event.eventId}>
                  <td>{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : '—'}</td>
                  <td>{event.eventType}</td>
                  <td>{event.actorAdminId}</td>
                  <td>{event.actorRole ?? '—'}</td>
                  <td>{event.targetRef ?? '—'}</td>
                  <td>
                    <span className={`badge ${event.result === 'SUCCESS' ? 'badge-success' : 'badge-danger'}`}>{t(`audit.results.${event.result}`)}</span>
                  </td>
                  <td>
                    {/* Rendered as plain text (React auto-escapes), never dangerouslySetInnerHTML -- metadata is operator/system-supplied and must never be interpreted as markup. Pretty-printed (2-space indent) and wrapped so multi-field metadata doesn't collapse into an unreadable single line. */}
                    <pre className="audit-metadata">{event.metadata ? JSON.stringify(event.metadata, null, 2) : '—'}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          {t('common.previous')}
        </button>
        <span>{t('common.pageInfo', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
        <button type="button" className="btn" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}
