import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { PagedResult } from '../../domain/accounts';
import type { DisputeDto, PaymentAttemptDto, PaymentTransactionDto, RefundDto } from '../../domain/billing';
import type { SupportedCurrencyCode } from '../../money/money';
import { formatMoney, parseExactMinorUnits } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { BillingPermissionGate } from '../../rbac/BillingPermissionGate';
import { isBillingPermitted } from '../../domain/billingRbac';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

const REASON_CODE_MAX_LENGTH = 32;

interface RefundMutationResult {
  refundId?: string;
  error?: string;
  refundOperationId?: string;
}

interface PendingRefundFinalization {
  amount: string;
  amountMinor: string;
  reasonCode: string;
  idempotencyKey: string;
  refundOperationId?: string;
  state: 'CREATED' | 'PROVIDER_CONFIRMED' | 'OUTCOME_UNKNOWN';
}

interface RefundRecoveryDto {
  refundOperationId: string;
  paymentTransactionId: string;
  amountMinor: string;
  currencyCode: SupportedCurrencyCode;
  reasonCode: string;
  idempotencyKey: string;
  state: 'CREATED' | 'PROVIDER_CONFIRMED';
  createdAt: string;
  updatedAt: string;
}

function nextIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Issues a refund against a settled PaymentTransaction via the already-live
 * backend orchestration route (POST /billing/admin/refund,
 * backend/src/http/routes/billingRefundRoutes.ts) -- this route existed and
 * was fully wired (step-up, idempotency, audit) before this form did,
 * unused by any Platform Administration UI. Gated the same way every other
 * sensitive Platform Administration mutation is: a fresh step-up
 * (`REFUND` scope, mirroring the backend's own `consumeStepUp` call) rather
 * than ConfirmButton, per this app's established rule that step-up-gated
 * actions don't also need the two-click ConfirmButton pattern.
 */
function RefundForm({
  transaction,
  pendingFinalization,
  onPendingFinalization,
  onClearPendingFinalization,
  onIssued,
}: {
  transaction: PaymentTransactionDto;
  pendingFinalization?: PendingRefundFinalization;
  onPendingFinalization: (attempt: PendingRefundFinalization) => void;
  onClearPendingFinalization: () => void;
  onIssued: () => void;
}) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const [amount, setAmount] = useState(() => pendingFinalization?.amount ?? '');
  const [reasonCode, setReasonCode] = useState(() => pendingFinalization?.reasonCode ?? '');
  const [submitting, setSubmitting] = useState(false);
  // Reused across a failed/retried attempt so a retry after a lost response
  // is a safe idempotent resume rather than a second real refund attempt at
  // the provider (see billingRefundRoutes.ts's IDEMPOTENCY KEY doc comment)
  // -- only rotated after a confirmed success, for the next distinct refund.
  const [idempotencyKey, setIdempotencyKey] = useState(() => pendingFinalization?.idempotencyKey ?? nextIdempotencyKey());

  if (!transaction.amount) return null;
  const currencyCode = transaction.amount.currencyCode;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reasonCode.trim()) {
      notify(t('billing.refundReasonRequired'), 'error');
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = pendingFinalization?.amountMinor ?? parseExactMinorUnits(amount, currencyCode);
    } catch {
      notify(t('billing.invalidAmount'), 'error');
      return;
    }
    if (BigInt(amountMinor) <= 0n) {
      notify(t('billing.invalidAmount'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const stepUpId = await requestStepUp('REFUND');
      if (!stepUpId) return;
      // Pin the exact inputs before the network call. If the browser loses the
      // response after the backend has durably claimed the key, editing these
      // fields under the same key could make the UI disagree with the actual
      // refund operation. The recoveries endpoint below discovers the server
      // operation again after a reload or route change.
      onPendingFinalization({
        amount,
        amountMinor,
        reasonCode: reasonCode.trim(),
        idempotencyKey,
        state: 'OUTCOME_UNKNOWN',
      });
      const result = await platformAdminApi.post<RefundMutationResult>('/billing/admin/refund', {
        paymentTransactionId: transaction.paymentTransactionId,
        amountMinor,
        currencyCode,
        reasonCode: reasonCode.trim(),
        stepUpId,
        idempotencyKey,
      });

      if (result.error === 'refund_pending_finalization') {
        // The provider has confirmed the refund, but the backend could not
        // finish recording it locally. Keep the exact refund inputs and key
        // so a retry resumes this operation instead of creating a new one.
        // Each retry obtains a fresh one-time step-up grant.
        onPendingFinalization({
          amount,
          amountMinor,
          reasonCode: reasonCode.trim(),
          idempotencyKey,
          refundOperationId: result.refundOperationId,
          state: 'PROVIDER_CONFIRMED',
        });
        return;
      }
      if (!result.refundId) throw new Error('refund_response_incomplete');

      notify(t('billing.refundIssued'), 'success');
      setAmount('');
      setReasonCode('');
      setIdempotencyKey(nextIdempotencyKey());
      onIssued();
    } catch (err) {
      if (err instanceof PlatformAdminApiError && err.status === 502 && err.code === 'provider_refund_failed' && !err.refundOperationId) {
        // The backend explicitly reports a terminal provider rejection and
        // no longer lists this operation as recoverable. A new key is safe
        // for a later, distinct attempt after the cause is addressed.
        onClearPendingFinalization();
        setIdempotencyKey(nextIdempotencyKey());
      } else if (err instanceof PlatformAdminApiError && err.status < 500) {
        // A client/authorization/conflict response proves the request did not
        // leave an unresolved provider operation.
        onClearPendingFinalization();
      } else {
        // A provider timeout, server error, or lost network response may have
        // created or advanced the durable operation. Keep the exact key and
        // inputs locked; the Platform recovery list is the durable authority.
        onPendingFinalization({
          amount,
          amountMinor,
          reasonCode: reasonCode.trim(),
          idempotencyKey,
          refundOperationId: err instanceof PlatformAdminApiError ? err.refundOperationId : undefined,
          state: 'OUTCOME_UNKNOWN',
        });
      }
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="actions-row" onSubmit={submit} aria-label={t('billing.issueRefund')}>
      {pendingFinalization && (
        <p className="status-unavailable" role="alert">
          {t(pendingFinalization.state === 'PROVIDER_CONFIRMED'
            ? 'billing.refundPendingFinalization'
            : 'billing.refundOutcomeUnknown')}
          {pendingFinalization.refundOperationId ? ` (${pendingFinalization.refundOperationId})` : ''}
        </p>
      )}
      <input
        aria-label={t('entitlementRequests.amountLabel')}
        style={{ width: '7rem' }}
        value={amount}
        disabled={!!pendingFinalization}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        required
      />
      <input
        aria-label={t('billing.reasonCode')}
        style={{ width: '10rem' }}
        maxLength={REASON_CODE_MAX_LENGTH}
        value={reasonCode}
        disabled={!!pendingFinalization}
        onChange={(e) => setReasonCode(e.target.value)}
        placeholder={t('billing.reasonCode')}
        required
      />
      <button type="submit" className="btn" disabled={submitting}>
        {pendingFinalization
          ? t(pendingFinalization.state === 'PROVIDER_CONFIRMED' ? 'billing.retryRefundFinalization' : 'billing.retryRefundOperation')
          : t('billing.issueRefund')}
      </button>
    </form>
  );
}

const PAGE_SIZE = 20;
type Tab = 'attempts' | 'transactions' | 'refunds' | 'disputes';

const TAB_PATHS: Record<Tab, string> = {
  attempts: '/platform-admin/billing/payment-attempts',
  transactions: '/platform-admin/billing/payment-transactions',
  refunds: '/platform-admin/billing/refunds',
  disputes: '/platform-admin/billing/disputes',
};

const ATTEMPT_BADGE: Record<string, string> = {
  CREATED: 'badge-warning',
  PENDING: 'badge-warning',
  CONFIRMED: 'badge-success',
  FAILED: 'badge-danger',
  CANCELLED: 'badge-danger',
};
const REFUND_BADGE: Record<string, string> = { RECORDED: 'badge-success', FAILED: 'badge-danger' };
const DISPUTE_BADGE: Record<string, string> = {
  OPEN: 'badge-danger',
  UNDER_REVIEW: 'badge-warning',
  WON: 'badge-success',
  LOST: 'badge-danger',
};

export default function BillingPayments() {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const { notify } = useToast();
  const mayIssueRefund = isBillingPermitted(useCurrentRoles(), 'ISSUE_REFUND');
  const [tab, setTab] = useState<Tab>('attempts');
  const [accountRef, setAccountRef] = useState('');
  const [offset, setOffset] = useState(0);
  const [attempts, setAttempts] = useState<PaymentAttemptDto[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransactionDto[]>([]);
  const [refunds, setRefunds] = useState<RefundDto[]>([]);
  const [disputes, setDisputes] = useState<DisputeDto[]>([]);
  const [pendingRefunds, setPendingRefunds] = useState<Record<string, PendingRefundFinalization>>({});
  const [refundRecoveries, setRefundRecoveries] = useState<RefundRecoveryDto[]>([]);
  const [refundRecoveryTotal, setRefundRecoveryTotal] = useState(0);
  const [refundRecoveryOffset, setRefundRecoveryOffset] = useState(0);
  const [refundRecoveryLoading, setRefundRecoveryLoading] = useState(false);
  const [refundRecoveryError, setRefundRecoveryError] = useState<string | null>(null);
  const [retryingRefundOperationId, setRetryingRefundOperationId] = useState<string | null>(null);
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

  const loadRefundRecoveries = () => {
    if (!mayIssueRefund) return;
    setRefundRecoveryLoading(true);
    setRefundRecoveryError(null);
    platformAdminApi
      .get<PagedResult<RefundRecoveryDto>>('/platform-admin/billing/refund-recoveries', {
        limit: PAGE_SIZE,
        offset: refundRecoveryOffset,
      })
      .then((res) => {
        setRefundRecoveries(res.items);
        setRefundRecoveryTotal(res.total);
      })
      .catch((err: unknown) => {
        setRefundRecoveryError(err instanceof PlatformAdminApiError
          ? t(`errors.${err.status}`, t('common.unexpectedError'))
          : t('common.unexpectedError'));
      })
      .finally(() => setRefundRecoveryLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadRefundRecoveries, [refundRecoveryOffset, mayIssueRefund]);

  const retryRefundRecovery = async (operation: RefundRecoveryDto) => {
    setRetryingRefundOperationId(operation.refundOperationId);
    try {
      const stepUpId = await requestStepUp('REFUND');
      if (!stepUpId) return;
      const result = await platformAdminApi.post<RefundMutationResult>('/billing/admin/refund', {
        paymentTransactionId: operation.paymentTransactionId,
        amountMinor: operation.amountMinor,
        currencyCode: operation.currencyCode,
        reasonCode: operation.reasonCode,
        stepUpId,
        idempotencyKey: operation.idempotencyKey,
      });
      if (result.error === 'refund_pending_finalization') {
        notify(t('billing.refundPendingFinalization'), 'info');
        return;
      }
      if (!result.refundId) throw new Error('refund_response_incomplete');
      notify(t('billing.refundIssued'), 'success');
      load();
    } catch (err) {
      notify(err instanceof PlatformAdminApiError
        ? t(`errors.${err.status}`, t('common.unexpectedError'))
        : t('common.unexpectedError'), 'error');
    } finally {
      setRetryingRefundOperationId(null);
      loadRefundRecoveries();
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setOffset(0);
  };

  return (
    <div className="page">
      <h1>{t('nav.billingPayments')}</h1>

      {mayIssueRefund && (
        <section className="card" aria-labelledby="refund-recoveries-title">
          <h2 id="refund-recoveries-title" className="card-title">{t('billing.refundRecoveriesTitle')}</h2>
          <p className="card-body">{t('billing.refundRecoveriesDescription')}</p>
          {refundRecoveryLoading && <LoadingState />}
          {refundRecoveryError && <ErrorState message={refundRecoveryError} onRetry={loadRefundRecoveries} />}
          {!refundRecoveryLoading && !refundRecoveryError && refundRecoveries.length === 0 && (
            <p className="status-unavailable">{t('billing.noRefundRecoveries')}</p>
          )}
          {!refundRecoveryError && refundRecoveries.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('billing.refundOperationId')}</th>
                    <th scope="col">{t('billing.paymentTransactionId')}</th>
                    <th scope="col">{t('billing.amount')}</th>
                    <th scope="col">{t('billing.reasonCode')}</th>
                    <th scope="col">{t('billing.status')}</th>
                    <th scope="col">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {refundRecoveries.map((operation) => (
                    <tr key={operation.refundOperationId}>
                      <td>{operation.refundOperationId}</td>
                      <td>{operation.paymentTransactionId}</td>
                      <td>{formatMoney({ amountMinor: operation.amountMinor, currencyCode: operation.currencyCode })}</td>
                      <td>{operation.reasonCode}</td>
                      <td>
                        <span className="badge badge-warning">{t(`billing.refundOperationStates.${operation.state}`)}</span>
                        <p className="field-hint">
                          {t(operation.state === 'PROVIDER_CONFIRMED'
                            ? 'billing.refundPendingFinalization'
                            : 'billing.refundOperationOutcomeUnknown')}
                        </p>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={retryingRefundOperationId !== null}
                          onClick={() => void retryRefundRecovery(operation)}
                        >
                          {retryingRefundOperationId === operation.refundOperationId
                            ? t('billing.retryingRefund')
                            : t(operation.state === 'PROVIDER_CONFIRMED'
                              ? 'billing.retryRefundFinalization'
                              : 'billing.retryRefundOperation')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <button type="button" className="btn" disabled={refundRecoveryOffset === 0 || refundRecoveryLoading} onClick={() => setRefundRecoveryOffset(Math.max(0, refundRecoveryOffset - PAGE_SIZE))}>
              {t('common.previous')}
            </button>
            <span>{t('common.pageInfo', { from: refundRecoveryTotal === 0 ? 0 : refundRecoveryOffset + 1, to: Math.min(refundRecoveryOffset + PAGE_SIZE, refundRecoveryTotal), total: refundRecoveryTotal })}</span>
            <button type="button" className="btn" disabled={refundRecoveryOffset + PAGE_SIZE >= refundRecoveryTotal || refundRecoveryLoading} onClick={() => setRefundRecoveryOffset(refundRecoveryOffset + PAGE_SIZE)}>
              {t('common.next')}
            </button>
          </div>
        </section>
      )}

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
                    <td>
                      <span className={`badge ${ATTEMPT_BADGE[a.status] ?? 'badge-warning'}`}>{t(`billing.paymentAttemptStatuses.${a.status}`, a.status)}</span>
                    </td>
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
                  <th scope="col">{t('common.actions')}</th>
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
                    <td>
                      <BillingPermissionGate operation="ISSUE_REFUND" fallback={<span className="status-unavailable">{t('billing.noRefundPermission')}</span>}>
                        <RefundForm
                          transaction={tx}
                          pendingFinalization={pendingRefunds[tx.paymentTransactionId]}
                          onPendingFinalization={(attempt) => {
                            setPendingRefunds((current) => ({ ...current, [tx.paymentTransactionId]: attempt }));
                            loadRefundRecoveries();
                          }}
                          onClearPendingFinalization={() => setPendingRefunds((current) => {
                            const next = { ...current };
                            delete next[tx.paymentTransactionId];
                            return next;
                          })}
                          onIssued={() => {
                            setPendingRefunds((current) => {
                              const next = { ...current };
                              delete next[tx.paymentTransactionId];
                              return next;
                            });
                            loadRefundRecoveries();
                            load();
                          }}
                        />
                      </BillingPermissionGate>
                    </td>
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
                    <td>
                      <span className={`badge ${REFUND_BADGE[r.status] ?? 'badge-warning'}`}>{t(`billing.refundStatuses.${r.status}`, r.status)}</span>
                    </td>
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
                    <td>
                      <span className={`badge ${DISPUTE_BADGE[d.status] ?? 'badge-warning'}`}>{t(`billing.disputeStatuses.${d.status}`, d.status)}</span>
                    </td>
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
