import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { SettlementAccountDto } from '../../domain/settlement';
import { isSettlementPermitted } from '../../domain/settlement';
import { SUPPORTED_CURRENCIES, type SupportedCurrencyCode } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

/**
 * Platform Administration -> Billing -> Settlement Accounts
 * (SETTLEMENT_RECONCILIATION_V1). Every account shown here is the MASKED
 * view the backend sends -- there is no `providerRef` field anywhere in
 * `SettlementAccountDto` (PlatformAdminSettlementService's masked-read
 * boundary), so this page structurally cannot render a raw provider
 * secret even by accident. Mutations are hidden for UX only when the role
 * is denied -- the server independently enforces the same frozen matrix.
 */
export default function SettlementAccounts() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const roles = useCurrentRoles();
  const canRead = isSettlementPermitted(roles, 'VIEW_SETTLEMENT_RECORDS');
  const canMutate = isSettlementPermitted(roles, 'MUTATE_SETTLEMENT_ACCOUNT');

  const [accounts, setAccounts] = useState<SettlementAccountDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providerRef, setProviderRef] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrencyCode>('USD');
  const [creating, setCreating] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const load = () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<{ items: SettlementAccountDto[] }>('/platform-admin/settlement/accounts')
      .then((res) => setAccounts(res.items))
      .catch((err: unknown) => setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!providerRef.trim() || !displayLabel.trim()) {
      notify(t('settlement.accounts.formIncomplete'), 'error');
      return;
    }
    setCreating(true);
    try {
      const stepUpId = await requestStepUp('SETTLEMENT_BANK_CONFIG');
      if (!stepUpId) return;
      const created = await platformAdminApi.post<SettlementAccountDto>('/platform-admin/settlement/accounts', {
        providerRef: providerRef.trim(),
        displayLabel: displayLabel.trim(),
        settlementCurrency: currency,
        stepUpId,
      });
      setAccounts((prev) => [created, ...(prev ?? [])]);
      setProviderRef('');
      setDisplayLabel('');
      notify(t('settlement.accounts.created'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const onToggleStatus = async (account: SettlementAccountDto) => {
    const nextStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setBusyAccountId(account.settlementAccountId);
    try {
      const stepUpId = await requestStepUp('SETTLEMENT_BANK_CONFIG');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<SettlementAccountDto>(`/platform-admin/settlement/accounts/${encodeURIComponent(account.settlementAccountId)}/status`, {
        status: nextStatus,
        stepUpId,
      });
      setAccounts((prev) => (prev ?? []).map((a) => (a.settlementAccountId === updated.settlementAccountId ? updated : a)));
      notify(t('settlement.accounts.statusChanged'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setBusyAccountId(null);
    }
  };

  if (!canRead) {
    return (
      <div className="page">
        <h1>{t('nav.settlementAccounts')}</h1>
        <p className="status-unavailable">{t('settlement.notAuthorized')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t('nav.settlementAccounts')}</h1>
      <p className="status-unavailable">{t('settlement.accounts.hint')}</p>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {accounts && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settlement.accounts.displayLabel')}</th>
                <th scope="col">{t('settlement.currency')}</th>
                <th scope="col">{t('settlement.accounts.status')}</th>
                <th scope="col">{t('settlement.accounts.createdAt')}</th>
                {canMutate && <th scope="col">{t('complimentaryCapacity.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="status-unavailable">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.settlementAccountId}>
                  <td>{a.displayLabel}</td>
                  <td>{a.settlementCurrency}</td>
                  <td>{t(`settlement.accounts.statuses.${a.status}`)}</td>
                  <td>{a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
                  {canMutate && (
                    <td>
                      <button type="button" className="btn" disabled={busyAccountId === a.settlementAccountId} onClick={() => onToggleStatus(a)}>
                        {a.status === 'ACTIVE' ? t('settlement.accounts.deactivate') : t('settlement.accounts.activate')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canMutate && (
        <section className="card">
          <h2 className="section-title">{t('settlement.accounts.createTitle')}</h2>
          <p className="status-unavailable">{t('settlement.accounts.createHint')}</p>
          <form className="form-grid" onSubmit={onCreate}>
            <label htmlFor="sa-provider-ref">{t('settlement.accounts.providerRef')}</label>
            <input id="sa-provider-ref" maxLength={128} value={providerRef} onChange={(e) => setProviderRef(e.target.value)} required />

            <label htmlFor="sa-display-label">{t('settlement.accounts.displayLabel')}</label>
            <input id="sa-display-label" maxLength={64} placeholder="****1234" value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} required />

            <label htmlFor="sa-currency">{t('settlement.currency')}</label>
            <select id="sa-currency" value={currency} onChange={(e) => setCurrency(e.target.value as SupportedCurrencyCode)}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {t('settlement.accounts.create')}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
