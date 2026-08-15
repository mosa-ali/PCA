import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { SettlementBatchDto } from '../../domain/settlement';
import { isSettlementPermitted } from '../../domain/settlement';
import { formatMoney } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

/**
 * Platform Administration -> Billing -> Reconciliation
 * (SETTLEMENT_RECONCILIATION_V1). Shows every batch currently
 * UNDER_INVESTIGATION (never treated as final/closed) and every already-
 * RESOLVED batch with its reason/actor/timestamp, and lets an authorized,
 * step-up-verified role resolve an investigation with a required reason.
 * MATCHED batches (nothing to investigate) are intentionally not listed
 * here -- see SettlementBatches for the full batch list.
 */
export default function SettlementReconciliation() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const roles = useCurrentRoles();
  const canRead = isSettlementPermitted(roles, 'VIEW_SETTLEMENT_RECORDS');
  const canResolve = isSettlementPermitted(roles, 'RESOLVE_RECONCILIATION');

  const [batches, setBatches] = useState<SettlementBatchDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonByBatch, setReasonByBatch] = useState<Record<string, string>>({});
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);

  const load = () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<{ items: SettlementBatchDto[] }>('/platform-admin/settlement/batches')
      .then((res) => setBatches(res.items))
      .catch((err: unknown) => setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResolve = async (batch: SettlementBatchDto) => {
    const reason = (reasonByBatch[batch.settlementBatchId] ?? '').trim();
    if (!reason) {
      notify(t('settlement.reconciliation.reasonRequired'), 'error');
      return;
    }
    setBusyBatchId(batch.settlementBatchId);
    try {
      const stepUpId = await requestStepUp('SETTLEMENT_BANK_CONFIG');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<SettlementBatchDto>(`/platform-admin/settlement/batches/${encodeURIComponent(batch.settlementBatchId)}/resolve`, { reason, stepUpId });
      setBatches((prev) => (prev ?? []).map((b) => (b.settlementBatchId === updated.settlementBatchId ? updated : b)));
      notify(t('settlement.reconciliation.resolved'), 'success');
    } catch (err) {
      if (err instanceof PlatformAdminApiError && err.status === 409) {
        notify(t('settlement.reconciliation.alreadyResolved'), 'error');
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
        <h1>{t('nav.settlementReconciliation')}</h1>
        <p className="status-unavailable">{t('settlement.notAuthorized')}</p>
      </div>
    );
  }

  const underInvestigation = (batches ?? []).filter((b) => b.status === 'UNDER_INVESTIGATION');
  const resolved = (batches ?? []).filter((b) => b.status === 'RESOLVED');

  return (
    <div className="page">
      <h1>{t('nav.settlementReconciliation')}</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {batches && (
        <>
          <section className="card">
            <h2 className="section-title">{t('settlement.reconciliation.underInvestigationTitle')}</h2>
            {underInvestigation.length === 0 ? (
              <p className="status-unavailable">{t('common.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('settlement.currency')}</th>
                      <th scope="col">{t('settlement.batches.net')}</th>
                      <th scope="col">{t('settlement.batches.received')}</th>
                      <th scope="col">{t('settlement.batches.difference')}</th>
                      {canResolve && <th scope="col">{t('settlement.reconciliation.resolveTitle')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {underInvestigation.map((b) => (
                      <tr key={b.settlementBatchId}>
                        <td>{b.settlementCurrency}</td>
                        <td>{formatMoney(b.net)}</td>
                        <td>{formatMoney(b.received)}</td>
                        <td>{b.differenceMinor}</td>
                        {canResolve && (
                          <td>
                            <div className="actions-row">
                              <input
                                aria-label={t('settlement.reconciliation.reasonLabel')}
                                placeholder={t('settlement.reconciliation.reasonLabel')}
                                maxLength={500}
                                value={reasonByBatch[b.settlementBatchId] ?? ''}
                                onChange={(e) => setReasonByBatch((prev) => ({ ...prev, [b.settlementBatchId]: e.target.value }))}
                              />
                              <button type="button" className="btn btn-primary" disabled={busyBatchId === b.settlementBatchId} onClick={() => onResolve(b)}>
                                {t('settlement.reconciliation.resolve')}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="section-title">{t('settlement.reconciliation.resolvedTitle')}</h2>
            {resolved.length === 0 ? (
              <p className="status-unavailable">{t('common.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('settlement.currency')}</th>
                      <th scope="col">{t('settlement.batches.difference')}</th>
                      <th scope="col">{t('settlement.reconciliation.resolutionReason')}</th>
                      <th scope="col">{t('settlement.reconciliation.resolvedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map((b) => (
                      <tr key={b.settlementBatchId}>
                        <td>{b.settlementCurrency}</td>
                        <td>{b.differenceMinor}</td>
                        <td>{b.resolutionReason}</td>
                        <td>{b.resolvedAt ? new Date(b.resolvedAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
