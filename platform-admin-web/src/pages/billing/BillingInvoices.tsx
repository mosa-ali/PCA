import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { PagedResult } from '../../domain/accounts';
import type { InvoiceDto, SubscriptionDto } from '../../domain/billing';

const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'] as const;
const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const;
const INVOICE_BADGE: Record<string, string> = {
  DRAFT: 'badge-warning',
  OPEN: 'badge-warning',
  PAID: 'badge-success',
  VOID: 'badge-danger',
  UNCOLLECTIBLE: 'badge-danger',
};
const SUBSCRIPTION_BADGE: Record<string, string> = {
  TRIALING: 'badge-warning',
  ACTIVE: 'badge-success',
  PAST_DUE: 'badge-danger',
  CANCELED: 'badge-danger',
  EXPIRED: 'badge-danger',
};
import { formatMoney } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';

const PAGE_SIZE = 20;
type Tab = 'subscriptions' | 'invoices';

export default function BillingInvoices() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('invoices');
  const [accountRef, setAccountRef] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const path = tab === 'invoices' ? '/platform-admin/billing/invoices' : '/platform-admin/billing/subscriptions';
    platformAdminApi
      .get<PagedResult<InvoiceDto | SubscriptionDto>>(path, { limit: PAGE_SIZE, offset, accountRef: accountRef || undefined, status: status || undefined })
      .then((res) => {
        if (tab === 'invoices') setInvoices(res.items as InvoiceDto[]);
        else setSubscriptions(res.items as SubscriptionDto[]);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [tab, offset]);

  const applyFilters = () => {
    setOffset(0);
    load();
  };

  return (
    <div className="page">
      <h1>{t('nav.billingInvoices')}</h1>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'invoices'} className={`tab-btn ${tab === 'invoices' ? 'active' : ''}`} onClick={() => { setTab('invoices'); setOffset(0); setStatus(''); }}>
          {t('nav.billingInvoices')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'subscriptions'} className={`tab-btn ${tab === 'subscriptions' ? 'active' : ''}`} onClick={() => { setTab('subscriptions'); setOffset(0); setStatus(''); }}>
          {t('billing.subscriptions')}
        </button>
      </div>

      <div className="filters">
        <div>
          <label htmlFor="bi-account-ref">{t('billing.accountRef')}</label>
          <input id="bi-account-ref" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bi-status">{t('billing.status')}</label>
          <select id="bi-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('billing.anyStatus')}</option>
            {(tab === 'invoices' ? INVOICE_STATUSES : SUBSCRIPTION_STATUSES).map((s) => (
              <option key={s} value={s}>
                {t(`billing.${tab === 'invoices' ? 'invoiceStatuses' : 'subscriptionStatuses'}.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn" onClick={applyFilters}>
          {t('common.applyFilters')}
        </button>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && tab === 'invoices' && (
        invoices.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.invoiceId')}</th>
                  <th scope="col">{t('billing.accountRef')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('billing.total')}</th>
                  <th scope="col">{t('billing.dueAt')}</th>
                  <th scope="col">{t('accounts.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.invoiceId}>
                    <td>{inv.invoiceId}</td>
                    <td>{inv.accountRef}</td>
                    <td>
                      <span className={`badge ${INVOICE_BADGE[inv.status] ?? 'badge-warning'}`}>{t(`billing.invoiceStatuses.${inv.status}`, inv.status)}</span>
                    </td>
                    <td>{inv.total ? formatMoney(inv.total) : '—'}</td>
                    <td>{inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : '—'}</td>
                    <td>{inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && tab === 'subscriptions' && (
        subscriptions.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.subscriptionId')}</th>
                  <th scope="col">{t('billing.accountRef')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('accounts.currentPeriod')}</th>
                  <th scope="col">{t('billing.canceledAt')}</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.subscriptionId}>
                    <td>{sub.subscriptionId}</td>
                    <td>{sub.accountRef}</td>
                    <td>
                      <span className={`badge ${SUBSCRIPTION_BADGE[sub.status] ?? 'badge-warning'}`}>{t(`billing.subscriptionStatuses.${sub.status}`, sub.status)}</span>
                    </td>
                    <td>
                      {sub.currentPeriodStart ? new Date(sub.currentPeriodStart).toLocaleDateString() : '—'} – {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : '—'}
                    </td>
                    <td>{sub.canceledAt ? new Date(sub.canceledAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
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
