import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { PagedResult } from '../../domain/accounts';
import type { PendingQuoteRequest } from '../../domain/billing';
import type { EntitlementRequestDto } from '../../domain/entitlements';
import { parseExactMinorUnits, type SupportedCurrencyCode } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useToast } from '../../state/ToastContext';

const PAGE_SIZE = 20;

function IssueQuoteForm({ requestId, onIssued }: { requestId: string; onIssued: (requestId: string) => void }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrencyCode>('USD');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let amountMinor: string;
    try {
      amountMinor = parseExactMinorUnits(amount, currency);
    } catch {
      notify(t('entitlementRequests.invalidAmount'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await platformAdminApi.post<EntitlementRequestDto>(`/platform-admin/entitlement-requests/${encodeURIComponent(requestId)}/quote`, {
        amountMinor,
        currencyCode: currency,
      });
      notify(t('entitlementRequests.quoteIssued'), 'success');
      onIssued(requestId);
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="actions-row" onSubmit={submit}>
      <input aria-label={t('entitlementRequests.amountLabel')} style={{ width: '7rem' }} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
      <select aria-label={t('entitlementRequests.currencyLabel')} style={{ width: '6rem' }} value={currency} onChange={(e) => setCurrency(e.target.value as SupportedCurrencyCode)}>
        <option value="USD">USD</option>
        <option value="SAR">SAR</option>
        <option value="YER">YER</option>
      </select>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {t('entitlementRequests.issueQuote')}
      </button>
    </form>
  );
}

export default function BillingQuotes() {
  const { t } = useTranslation();
  const [items, setItems] = useState<PendingQuoteRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PagedResult<PendingQuoteRequest>>('/platform-admin/quotes/pending', { limit: PAGE_SIZE, offset })
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
  useEffect(load, [offset]);

  const onIssued = (requestId: string) => {
    setItems((prev) => prev.filter((item) => item.requestId !== requestId));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  return (
    <div className="page">
      <h1>{t('nav.billingQuotes')}</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <p className="status-unavailable">{t('billing.noPendingQuotes')}</p>}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('entitlements.requestId')}</th>
                <th scope="col">{t('entitlements.familyIdLabel')}</th>
                <th scope="col">{t('entitlements.limitType')}</th>
                <th scope="col">{t('billing.currentLimit')}</th>
                <th scope="col">{t('entitlements.targetLimit')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((request) => (
                <tr key={request.requestId}>
                  <td>{request.requestId}</td>
                  <td>{request.familyId}</td>
                  <td>{t(`entitlements.limitTypes.${request.limitType}`)}</td>
                  <td>{request.currentLimitAtRequest}</td>
                  <td>{request.targetLimit}</td>
                  <td>
                    <PermissionGate operation="ADMINISTER_BILLING" fallback={<span className="status-unavailable">{t('billing.noQuotePermission')}</span>}>
                      <IssueQuoteForm requestId={request.requestId} onIssued={onIssued} />
                    </PermissionGate>
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
