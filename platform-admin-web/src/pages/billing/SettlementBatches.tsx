import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { SettlementAccountDto, SettlementBatchDto, SettlementBatchItemDto } from '../../domain/settlement';
import { isSettlementPermitted } from '../../domain/settlement';
import type { SupportedCurrencyCode } from '../../money/money';
import { formatMoney, parseExactMinorUnits } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

/**
 * Platform Administration -> Billing -> Settlement Batches
 * (SETTLEMENT_RECONCILIATION_V1). Shows currency/period/expected-gross/
 * fees/net/received/difference/status for every batch, and lets an
 * authorized role open a new batch and attribute existing
 * PaymentTransactionRows into it (with an FX snapshot when the
 * transaction's currency differs from the batch's settlement currency).
 * Reconciliation RESOLUTION itself lives on the dedicated
 * SettlementReconciliation page, not here.
 */
export default function SettlementBatches() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const roles = useCurrentRoles();
  const canRead = isSettlementPermitted(roles, 'VIEW_SETTLEMENT_RECORDS');
  const canCreateBatch = isSettlementPermitted(roles, 'CREATE_SETTLEMENT_BATCH');

  const [accounts, setAccounts] = useState<SettlementAccountDto[]>([]);
  const [batches, setBatches] = useState<SettlementBatchDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemsByBatch, setItemsByBatch] = useState<Record<string, SettlementBatchItemDto[]>>({});
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const [accountId, setAccountId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [expectedGrossInput, setExpectedGrossInput] = useState('0.00');
  const [feesInput, setFeesInput] = useState('0.00');
  const [receivedInput, setReceivedInput] = useState('0.00');
  const [batchProviderRef, setBatchProviderRef] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);

  const [txIdByBatch, setTxIdByBatch] = useState<Record<string, string>>({});
  const [fxRateByBatch, setFxRateByBatch] = useState<Record<string, string>>({});
  const [fxProviderRefByBatch, setFxProviderRefByBatch] = useState<Record<string, string>>({});
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);

  const selectedAccount = accounts.find((a) => a.settlementAccountId === accountId) ?? null;

  const load = () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    Promise.all([platformAdminApi.get<{ items: SettlementAccountDto[] }>('/platform-admin/settlement/accounts'), platformAdminApi.get<{ items: SettlementBatchDto[] }>('/platform-admin/settlement/batches')])
      .then(([accountsRes, batchesRes]) => {
        setAccounts(accountsRes.items);
        setBatches(batchesRes.items);
      })
      .catch((err: unknown) => setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreateBatch = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) {
      notify(t('settlement.batches.selectAccount'), 'error');
      return;
    }
    if (!periodStart || !periodEnd || !batchProviderRef.trim()) {
      notify(t('settlement.batches.formIncomplete'), 'error');
      return;
    }
    const currency = selectedAccount.settlementCurrency as SupportedCurrencyCode;
    let expectedGrossMinor: string;
    let feesMinor: string;
    let receivedMinor: string;
    try {
      expectedGrossMinor = parseExactMinorUnits(expectedGrossInput, currency);
      feesMinor = parseExactMinorUnits(feesInput, currency);
      receivedMinor = parseExactMinorUnits(receivedInput, currency);
    } catch {
      notify(t('billing.invalidAmount'), 'error');
      return;
    }
    setCreatingBatch(true);
    try {
      const stepUpId = await requestStepUp('SETTLEMENT_BANK_CONFIG');
      if (!stepUpId) return;
      const created = await platformAdminApi.post<SettlementBatchDto>('/platform-admin/settlement/batches', {
        settlementAccountRef: selectedAccount.settlementAccountId,
        settlementCurrency: currency,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        expectedGross: { amountMinor: expectedGrossMinor, currencyCode: currency },
        fees: { amountMinor: feesMinor, currencyCode: currency },
        received: { amountMinor: receivedMinor, currencyCode: currency },
        providerRef: batchProviderRef.trim(),
        stepUpId,
      });
      setBatches((prev) => [created, ...(prev ?? [])]);
      setBatchProviderRef('');
      notify(t('settlement.batches.created'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setCreatingBatch(false);
    }
  };

  const toggleExpand = async (batch: SettlementBatchDto) => {
    if (expandedBatchId === batch.settlementBatchId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(batch.settlementBatchId);
    if (!itemsByBatch[batch.settlementBatchId]) {
      try {
        const res = await platformAdminApi.get<{ items: SettlementBatchItemDto[] }>(`/platform-admin/settlement/batches/${encodeURIComponent(batch.settlementBatchId)}/items`);
        setItemsByBatch((prev) => ({ ...prev, [batch.settlementBatchId]: res.items }));
      } catch (err) {
        notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
      }
    }
  };

  const onAttribute = async (batch: SettlementBatchDto) => {
    const paymentTransactionId = (txIdByBatch[batch.settlementBatchId] ?? '').trim();
    if (!paymentTransactionId) {
      notify(t('settlement.batches.transactionIdRequired'), 'error');
      return;
    }
    const rate = (fxRateByBatch[batch.settlementBatchId] ?? '').trim();
    const fxProviderRef = (fxProviderRefByBatch[batch.settlementBatchId] ?? '').trim();
    setBusyBatchId(batch.settlementBatchId);
    try {
      const stepUpId = await requestStepUp('SETTLEMENT_BANK_CONFIG');
      if (!stepUpId) return;
      const item = await platformAdminApi.post<SettlementBatchItemDto>(`/platform-admin/settlement/batches/${encodeURIComponent(batch.settlementBatchId)}/items`, {
        paymentTransactionId,
        fx: rate ? { recordedRate: rate, effectiveTimestamp: new Date().toISOString(), providerRef: fxProviderRef || 'admin-recorded' } : null,
        stepUpId,
      });
      setItemsByBatch((prev) => ({ ...prev, [batch.settlementBatchId]: [...(prev[batch.settlementBatchId] ?? []), item] }));
      setTxIdByBatch((prev) => ({ ...prev, [batch.settlementBatchId]: '' }));
      notify(t('settlement.batches.attributed'), 'success');
    } catch (err) {
      if (err instanceof PlatformAdminApiError && err.status === 409) {
        notify(t('settlement.batches.alreadyAttributed'), 'error');
      } else {
        notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
      }
    } finally {
      setBusyBatchId(null);
    }
  };

  if (!canRead) {
    return (
      <div className="page">
        <h1>{t('nav.settlementBatches')}</h1>
        <p className="status-unavailable">{t('settlement.notAuthorized')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t('nav.settlementBatches')}</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {batches && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settlement.currency')}</th>
                <th scope="col">{t('settlement.batches.period')}</th>
                <th scope="col">{t('settlement.batches.expectedGross')}</th>
                <th scope="col">{t('settlement.batches.fees')}</th>
                <th scope="col">{t('settlement.batches.net')}</th>
                <th scope="col">{t('settlement.batches.received')}</th>
                <th scope="col">{t('settlement.batches.difference')}</th>
                <th scope="col">{t('settlement.batches.status')}</th>
                <th scope="col">{t('complimentaryCapacity.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr>
                  <td colSpan={9} className="status-unavailable">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
              {batches.map((b) => (
                <Fragment key={b.settlementBatchId}>
                  <tr key={b.settlementBatchId}>
                    <td>{b.settlementCurrency}</td>
                    <td>
                      {b.periodStart ? new Date(b.periodStart).toLocaleDateString() : '—'} – {b.periodEnd ? new Date(b.periodEnd).toLocaleDateString() : '—'}
                    </td>
                    <td>{formatMoney(b.expectedGross)}</td>
                    <td>{formatMoney(b.fees)}</td>
                    <td>{formatMoney(b.net)}</td>
                    <td>{formatMoney(b.received)}</td>
                    <td>{formatMoney({ amountMinor: b.differenceMinor, currencyCode: b.net.currencyCode })}</td>
                    <td>
                      <span className={`badge ${b.status === 'MATCHED' ? 'badge-success' : b.status === 'RESOLVED' ? 'badge-success' : 'badge-danger'}`}>
                        {t(`settlement.reconciliation.statuses.${b.status}`)}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn" onClick={() => toggleExpand(b)}>
                        {expandedBatchId === b.settlementBatchId ? t('common.hide') : t('settlement.batches.viewItems')}
                      </button>
                    </td>
                  </tr>
                  {expandedBatchId === b.settlementBatchId && (
                    <tr>
                      <td colSpan={9}>
                        <div className="table-wrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th scope="col">{t('billing.paymentTransactionId')}</th>
                                <th scope="col">{t('billing.amount')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(itemsByBatch[b.settlementBatchId] ?? []).length === 0 && (
                                <tr>
                                  <td colSpan={2} className="status-unavailable">
                                    {t('common.empty')}
                                  </td>
                                </tr>
                              )}
                              {(itemsByBatch[b.settlementBatchId] ?? []).map((item) => (
                                <tr key={item.settlementBatchItemId}>
                                  <td>{item.paymentTransactionId}</td>
                                  <td>{formatMoney(item.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {canCreateBatch && (
                          <div className="actions-row" style={{ marginTop: '0.5rem' }}>
                            <input
                              aria-label={t('billing.paymentTransactionId')}
                              placeholder={t('billing.paymentTransactionId')}
                              value={txIdByBatch[b.settlementBatchId] ?? ''}
                              onChange={(e) => setTxIdByBatch((prev) => ({ ...prev, [b.settlementBatchId]: e.target.value }))}
                            />
                            <input
                              aria-label={t('settlement.batches.fxRate')}
                              placeholder={t('settlement.batches.fxRateHint')}
                              value={fxRateByBatch[b.settlementBatchId] ?? ''}
                              onChange={(e) => setFxRateByBatch((prev) => ({ ...prev, [b.settlementBatchId]: e.target.value }))}
                            />
                            <input
                              aria-label={t('settlement.batches.fxProviderRef')}
                              placeholder={t('settlement.batches.fxProviderRef')}
                              value={fxProviderRefByBatch[b.settlementBatchId] ?? ''}
                              onChange={(e) => setFxProviderRefByBatch((prev) => ({ ...prev, [b.settlementBatchId]: e.target.value }))}
                            />
                            <button type="button" className="btn btn-primary" disabled={busyBatchId === b.settlementBatchId} onClick={() => onAttribute(b)}>
                              {t('settlement.batches.attribute')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreateBatch && (
        <section className="card">
          <h2 className="section-title">{t('settlement.batches.createTitle')}</h2>
          <form className="form-grid" onSubmit={onCreateBatch}>
            <label htmlFor="sb-account">{t('settlement.batches.account')}</label>
            <select id="sb-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {accounts.map((a) => (
                <option key={a.settlementAccountId} value={a.settlementAccountId}>
                  {a.displayLabel} ({a.settlementCurrency})
                </option>
              ))}
            </select>

            <label htmlFor="sb-period-start">{t('settlement.batches.periodStart')}</label>
            <input id="sb-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />

            <label htmlFor="sb-period-end">{t('settlement.batches.periodEnd')}</label>
            <input id="sb-period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />

            <label htmlFor="sb-expected-gross">{t('settlement.batches.expectedGross')}</label>
            <input id="sb-expected-gross" value={expectedGrossInput} onChange={(e) => setExpectedGrossInput(e.target.value)} required />

            <label htmlFor="sb-fees">{t('settlement.batches.fees')}</label>
            <input id="sb-fees" value={feesInput} onChange={(e) => setFeesInput(e.target.value)} required />

            <label htmlFor="sb-received">{t('settlement.batches.received')}</label>
            <input id="sb-received" value={receivedInput} onChange={(e) => setReceivedInput(e.target.value)} required />

            <label htmlFor="sb-provider-ref">{t('settlement.batches.providerRef')}</label>
            <input id="sb-provider-ref" maxLength={128} value={batchProviderRef} onChange={(e) => setBatchProviderRef(e.target.value)} required />

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={creatingBatch}>
                {t('settlement.batches.create')}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
