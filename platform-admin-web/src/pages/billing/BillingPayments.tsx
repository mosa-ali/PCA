import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { PagedResult } from '../../domain/accounts';
import type { DisputeDto, PaymentAttemptDto, PaymentTransactionDto, RefundDto } from '../../domain/billing';
import { formatMoney } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';

const PAGE_SIZE = 20;
type Tab = 'attempts' | 'transactions' | 'refunds' | 'disputes';

const TAB_PATHS: Record<Tab, string> = {
  attempts: '/platform-admin/billing/payment-attempts',
  transactions: '/platform-admin/billing/payment-transactions',
  refunds: '/platform-admin/billing/refunds',
  disputes: '/platform-admin/billing/disputes',
};

export default function BillingPayments() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('attempts');
  const [accountRef, setAccountRef] = useState('');
  const [offset, setOffset] = useState(0);
  const [attempts, setAttempts] = useState<PaymentAttemptDto[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransactionDto[]>([]);
  const [refunds, setRefunds] = useState<RefundDto[]>([]);
  const [disputes, setDisputes] = useState<DisputeDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PagedResult<PaymentAttemptDto | PaymentTransactionDto | RefundDto | DisputeDto>>(TAB_PATHS[tab], {
        limit: PAGE_SIZE,
        offset,
        accountRef: tab === 'attempts' || tab === 'transactions' ? accountRef || undefined : undefined,
      })
      .then((res) => {
        if (tab === 'attempts') setAttempts(res.items as PaymentAttemptDto[]);
        else if (tab === 'transactions') setTransactions(res.items as PaymentTransactionDto[]);
        else if (tab === 'refunds') setRefunds(res.items as RefundDto[]);
        else setDisputes(res.items as DisputeDto[]);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [tab, offset]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setOffset(0);
  };

  return (
    <div className="page">
      <h1>{t('nav.billingPayments')}</h1>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'attempts'} className={`tab-btn ${tab === 'attempts' ? 'active' : ''}`} onClick={() => switchTab('attempts')}>
          {t('billing.paymentAttempts')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'transactions'} className={`tab-btn ${tab === 'transactions' ? 'active' : ''}`} onClick={() => switchTab('transactions')}>
          {t('billing.paymentTransactions')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'refunds'} className={`tab-btn ${tab === 'refunds' ? 'active' : ''}`} onClick={() => switchTab('refunds')}>
          {t('billing.refunds')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'disputes'} className={`tab-btn ${tab === 'disputes' ? 'active' : ''}`} onClick={() => switchTab('disputes')}>
          {t('billing.disputes')}
        </button>
      </div>

      {(tab === 'attempts' || tab === 'transactions') && (
        <div className="filters">
          <div>
            <label htmlFor="bp-account-ref">{t('billing.accountRef')}</label>
            <input id="bp-account-ref" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOffset(0);
              load();
            }}
          >
            {t('common.applyFilters')}
          </button>
        </div>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && tab === 'attempts' && (
        attempts.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.paymentAttemptId')}</th>
                  <th scope="col">{t('billing.accountRef')}</th>
                  <th scope="col">{t('billing.amount')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('billing.provider')}</th>
                  <th scope="col">{t('accounts.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.paymentAttemptId}>
                    <td>{a.paymentAttemptId}</td>
                    <td>{a.accountRef}</td>
                    <td>{a.amount ? formatMoney(a.amount) : '—'}</td>
                    <td>{a.status}</td>
                    <td>{a.provider}</td>
                    <td>{a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && tab === 'transactions' && (
        transactions.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.paymentTransactionId')}</th>
                  <th scope="col">{t('billing.accountRef')}</th>
                  <th scope="col">{t('billing.amount')}</th>
                  <th scope="col">{t('billing.provider')}</th>
                  <th scope="col">{t('billing.confirmedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.paymentTransactionId}>
                    <td>{tx.paymentTransactionId}</td>
                    <td>{tx.accountRef}</td>
                    <td>{tx.amount ? formatMoney(tx.amount) : '—'}</td>
                    <td>{tx.provider}</td>
                    <td>{tx.confirmedAt ? new Date(tx.confirmedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && tab === 'refunds' && (
        refunds.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.refundId')}</th>
                  <th scope="col">{t('billing.amount')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('billing.reasonCode')}</th>
                  <th scope="col">{t('accounts.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.refundId}>
                    <td>{r.refundId}</td>
                    <td>{r.amount ? formatMoney(r.amount) : '—'}</td>
                    <td>{r.status}</td>
                    <td>{r.reasonCode}</td>
                    <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && tab === 'disputes' && (
        disputes.length === 0 ? (
          <p className="status-unavailable">{t('common.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.disputeId')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('billing.evidenceDueAt')}</th>
                  <th scope="col">{t('accounts.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((d) => (
                  <tr key={d.disputeId}>
                    <td>{d.disputeId}</td>
                    <td>{d.status}</td>
                    <td>{d.evidenceDueAt ? new Date(d.evidenceDueAt).toLocaleString() : '—'}</td>
                    <td>{d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}</td>
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
