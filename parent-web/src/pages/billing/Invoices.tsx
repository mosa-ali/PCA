import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { formatMoney } from '../../domain/billing';

const PAGE_SIZE = 10;

/**
 * clients.billing.listInvoices() returns the family's full invoice list in
 * one call -- there is no server-side paging endpoint to page against, so
 * the date-range filter and pagination below are genuine client-side
 * slicing over data already in hand (same pattern as ActivityTimelinePage).
 */
export default function Invoices() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.billing.listInvoices(), []);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((invoice) => {
      const createdAt = invoice.createdAtUtc.slice(0, 10);
      if (fromDate && createdAt < fromDate) return false;
      if (toDate && createdAt > toDate) return false;
      return true;
    });
  }, [data, fromDate, toDate]);
  const visible = filtered.slice(0, visibleCount);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="invoices-title">
      <h1 id="invoices-title">{t('subscription.invoices.title')}</h1>

      {data.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBlockEnd: '1rem' }}>
          <div className="field">
            <label htmlFor="invoices-from-date">{t('subscription.invoices.fromDate')}</label>
            <input
              id="invoices-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="invoices-to-date">{t('subscription.invoices.toDate')}</label>
            <input
              id="invoices-to-date"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
            />
          </div>
        </div>
      )}

      {data.length === 0 ? (
        // A plain paragraph, not the shared h3-level EmptyState component --
        // this section has no h2 between it and the h1 above, so an h3 here
        // would skip a heading level (WCAG 1.3.1/axe heading-order).
        <p>{t('subscription.invoices.empty')}</p>
      ) : filtered.length === 0 ? (
        <EmptyState message={t('subscription.invoices.emptyForFilter')} />
      ) : (
        <>
          {/* Explicit pagination status -- previously the only pagination
              affordance was the "Show more" button below, which renders
              nothing at all once every row is already visible (e.g. a
              family with only 1-2 invoices), leaving no indication
              pagination exists or how many rows there are in total. */}
          <p aria-live="polite" style={{ color: 'var(--color-text-muted)' }}>
            {t('subscription.invoices.showingCount', { shown: visible.length, total: filtered.length })}
          </p>
          <div className="table-scroll">
            <table className="data-table responsive-cards">
              <thead>
                <tr>
                  <th scope="col">{t('subscription.invoices.date')}</th>
                  <th scope="col">{t('subscription.invoices.statusLabel')}</th>
                  <th scope="col">{t('subscription.invoices.total')}</th>
                  <th scope="col" aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {visible.map((invoice) => (
                  <tr key={invoice.invoiceId}>
                    <td data-label={t('subscription.invoices.date')}>{new Date(invoice.createdAtUtc).toLocaleDateString(i18n.language)}</td>
                    <td data-label={t('subscription.invoices.statusLabel')}>{t(`subscription.invoices.status.${invoice.status}`)}</td>
                    <td data-label={t('subscription.invoices.total')}>{formatMoney(invoice.total, i18n.language)}</td>
                    <td>
                      <Link to={`/subscription/invoices/${invoice.invoiceId}`}>{t('subscription.invoices.viewDetail')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleCount < filtered.length && (
            <button type="button" className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              {t('subscription.invoices.showMore', { count: filtered.length - visibleCount })}
            </button>
          )}
        </>
      )}
      <p>
        <Link to="/subscription">{t('common.back')}</Link>
      </p>
    </section>
  );
}
