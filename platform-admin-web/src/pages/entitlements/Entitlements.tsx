import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../../api/platformAdminApiClient';
import type { FamilyEntitlement, LimitType } from '../../domain/entitlements';
import type { AccountSummaryDto, PagedResult } from '../../domain/accounts';
import { planRefLabel } from '../../i18n/enumLabels';
import { LIMIT_TYPES } from '../../domain/entitlements';
import type { EntitlementRequestDto } from '../../domain/entitlements';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { ConfirmButton } from '../../components/common/ConfirmButton';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

export default function Entitlements() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [familyId, setFamilyId] = useState(searchParams.get('familyId') ?? '');
  const [entitlement, setEntitlement] = useState<FamilyEntitlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [directory, setDirectory] = useState<AccountSummaryDto[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [directoryOffset, setDirectoryOffset] = useState(0);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [email, setEmail] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ from: '', to: '', email: '' });
  const requestSequence = useRef(0);
  const directoryPageSize = 20;

  useEffect(() => {
    let active = true;
    setDirectoryLoading(true);
    setDirectoryError(null);
    const params = { limit: directoryPageSize, offset: directoryOffset, createdFrom: appliedFilters.from || undefined, createdTo: appliedFilters.to || undefined };
    const request = appliedFilters.email
      ? platformAdminApi.post<PagedResult<AccountSummaryDto>>('/platform-admin/accounts/search', { ...params, parentEmail: appliedFilters.email })
      : platformAdminApi.get<PagedResult<AccountSummaryDto>>('/platform-admin/accounts', params);
    request.then((result) => {
      if (!active) return;
      setDirectory(result.items);
      setDirectoryTotal(result.total);
    }).catch(() => {
      if (active) { setDirectory([]); setDirectoryTotal(0); setDirectoryError(t('common.unexpectedError')); }
    }).finally(() => { if (active) setDirectoryLoading(false); });
    return () => { active = false; };
  }, [directoryOffset, appliedFilters, directoryRetry, t]);

  const [limitType, setLimitType] = useState<LimitType>('MANAGED_DEVICE_LIMIT');
  const [limitValue, setLimitValue] = useState('');
  const [limitSubmitting, setLimitSubmitting] = useState(false);

  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  const load = (id: string) => {
    if (!id) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setEntitlement(null);
    platformAdminApi
      .get<FamilyEntitlement>(`/platform-admin/families/${encodeURIComponent(id)}/entitlement`)
      .then((result) => { if (sequence === requestSequence.current) setEntitlement(result); })
      .catch((err: unknown) => {
        if (sequence !== requestSequence.current) return;
        setEntitlement(null);
        if (isNotFoundError(err)) {
          setNotFound(true);
          return;
        }
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => { if (sequence === requestSequence.current) setLoading(false); });
  };

  useEffect(() => {
    if (familyId) load(familyId);
    else {
      requestSequence.current += 1;
      setEntitlement(null);
      setLoading(false);
      setError(null);
      setNotFound(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const onSetLimit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!familyId) return;
    const targetLimit = Number.parseInt(limitValue, 10);
    if (!Number.isInteger(targetLimit) || targetLimit < 0) {
      notify(t('entitlements.invalidLimit'), 'error');
      return;
    }
    setLimitSubmitting(true);
    try {
      // POST .../entitlement/limit answers with the FLAT usage record
      // (parentMemberUsedCount/managedDeviceActiveCount/revision, and no
      // pendingRequestSummary at all -- backend/src/http/routes/platformadmin/
      // entitlementRoutes.ts), NOT the read model this page renders. Feeding
      // that response straight into setEntitlement used to crash the whole SPA
      // on a SUCCESSFUL set-limit (entitlement.pendingRequestSummary.length on
      // undefined). The mutation response is therefore deliberately discarded:
      // the page re-reads through GET .../entitlement, the one route that
      // actually returns FamilyEntitlement (same discipline onDeviceOverride
      // below already follows).
      await platformAdminApi.post(`/platform-admin/families/${encodeURIComponent(familyId)}/entitlement/limit`, {
        limitType,
        targetLimit,
      });
      setLimitValue('');
      notify(t('entitlements.limitUpdated'), 'success');
      load(familyId);
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setLimitSubmitting(false);
    }
  };

  const onDeviceOverride = async (e: FormEvent) => {
    e.preventDefault();
    if (!familyId) return;
    const targetLimit = Number.parseInt(overrideValue, 10);
    if (!Number.isInteger(targetLimit) || targetLimit < 0) {
      notify(t('entitlements.invalidLimit'), 'error');
      return;
    }
    if (!overrideReason.trim()) {
      notify(t('entitlements.reasonRequired'), 'error');
      return;
    }
    setOverrideSubmitting(true);
    try {
      const stepUpId = await requestStepUp('ENTITLEMENT_LIMIT_OVERRIDE');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<EntitlementRequestDto>(`/platform-admin/families/${encodeURIComponent(familyId)}/entitlement/device-override`, {
        targetLimit,
        reason: overrideReason.trim(),
        stepUpId,
      });
      notify(t('entitlements.overrideApplied', { requestId: updated.requestId }), 'success');
      setOverrideValue('');
      setOverrideReason('');
      load(familyId);
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const selectFamily = (id: string) => {
    setFamilyId(id);
    const next = new URLSearchParams(searchParams);
    next.set('familyId', id);
    setSearchParams(next);
  };

  return (
    <div className="page">
      <h2>{t('nav.entitlements')}</h2>

      <form className="filters enrollment-filter-row" onSubmit={(event) => {
        event.preventDefault();
        setDirectoryOffset(0);
        setAppliedFilters({ from: createdFrom, to: createdTo, email: email.trim() });
      }}>
        <label htmlFor="entitlements-email">{t('accounts.emailFilterLabel')}<input id="entitlements-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label htmlFor="entitlements-created-from">{t('common.createdFrom', 'Created from')}<input id="entitlements-created-from" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} /></label>
        <label htmlFor="entitlements-created-to">{t('common.createdTo', 'Created to')}<input id="entitlements-created-to" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} /></label>
        <button className="btn btn-primary" type="submit">{t('common.applyFilters', 'Apply filters')}</button>
        <button className="btn" type="button" onClick={() => { setEmail(''); setCreatedFrom(''); setCreatedTo(''); setAppliedFilters({ from: '', to: '', email: '' }); setDirectoryOffset(0); }}>{t('common.clear', 'Clear')}</button>
      </form>
      {directoryLoading ? <LoadingState /> : directoryError ? <ErrorState message={directoryError} onRetry={() => setDirectoryRetry((retry) => retry + 1)} /> : directory.length === 0 ? <p className="status-unavailable">{t('accounts.directoryEmpty', 'No accounts found.')}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('accounts.familyId')}</th><th>{t('accounts.createdAt')}</th><th>{t('accounts.status')}</th><th>{t('accounts.plan')}</th><th>{t('accounts.parentMembers')}</th><th>{t('accounts.devices')}</th><th>{t('common.actions')}</th></tr></thead>
            <tbody>{directory.map((account) => <tr key={account.familyId}>
              <td>{account.familyId}</td><td>{account.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—'}</td>
              <td>{account.deletedAt ? t('accounts.deleted') : t(`accounts.statuses.${account.status}`)}</td>
              <td>{account.entitlement?.planRef ? planRefLabel(t, account.entitlement.planRef) : '—'}</td>
              <td>{account.entitlement ? `${account.entitlement.parentMemberUsedCount}/${account.entitlement.parentMemberLimit}` : '—'}</td>
              <td>{account.entitlement ? `${account.entitlement.managedDeviceActiveCount}/${account.entitlement.managedDeviceLimit} (${t('accounts.reserved')}: ${account.entitlement.managedDeviceReservedCount})` : '—'}</td>
              <td><button type="button" className="btn" aria-pressed={familyId === account.familyId} onClick={() => selectFamily(account.familyId)}>{t('common.view', 'View')}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <button type="button" className="btn" disabled={directoryOffset === 0 || directoryLoading} onClick={() => setDirectoryOffset(Math.max(0, directoryOffset - directoryPageSize))}>{t('common.previous')}</button>
        <span>{t('common.pageInfo', { from: directoryTotal === 0 ? 0 : directoryOffset + 1, to: Math.min(directoryOffset + directoryPageSize, directoryTotal), total: directoryTotal })}</span>
        <button type="button" className="btn" disabled={directoryOffset + directoryPageSize >= directoryTotal || directoryLoading} onClick={() => setDirectoryOffset(directoryOffset + directoryPageSize)}>{t('common.next')}</button>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={() => load(familyId)} />}
      {notFound && <p className="status-unavailable">{t('entitlements.familyNotFound')}</p>}

      {entitlement && (
        <>
          <section className="card">
            <h2 className="section-title">{t('entitlements.overview')}</h2>
            <dl className="kv-list">
              <dt>{t('accounts.plan')}</dt>
              <dd>{entitlement.planRef ?? '—'}</dd>
              <dt>{t('accounts.parentMembers')}</dt>
              <dd>
                {entitlement.parentMemberUsed}/{entitlement.parentMemberLimit}
                {entitlement.overLimitParentMember && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
              </dd>
              <dt>{t('accounts.devices')}</dt>
              <dd>
                {entitlement.managedDeviceActive}/{entitlement.managedDeviceLimit} ({t('entitlements.available')}: {entitlement.availableDeviceSlots}, {t('accounts.reserved')}: {entitlement.managedDeviceReserved})
                {entitlement.overLimitManagedDevice && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
              </dd>
            </dl>
          </section>

          <section className="card">
            <h2 className="section-title">{t('entitlements.pendingRequests')}</h2>
            {entitlement.pendingRequestSummary.length === 0 ? (
              <p className="status-unavailable">{t('common.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('entitlements.requestId')}</th>
                      <th scope="col">{t('entitlements.limitType')}</th>
                      <th scope="col">{t('entitlements.state')}</th>
                      <th scope="col">{t('entitlements.targetLimit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entitlement.pendingRequestSummary.map((r) => (
                      <tr key={r.requestId}>
                        <td>{r.requestId}</td>
                        <td>{t(`entitlements.limitTypes.${r.limitType}`)}</td>
                        <td>
                          {t(`entitlements.states.${r.state}`)}
                          {r.state === 'PENDING' && r.awaitingAdminQuote && <span className="badge">{t('entitlements.awaitingQuote')}</span>}
                        </td>
                        <td>{r.targetLimit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <PermissionGate operation="ADMINISTER_ENTITLEMENT_QUANTITY">
            <section className="card">
              <h2 className="section-title">{t('entitlements.setLimitTitle')}</h2>
              <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
                <label htmlFor="limit-type">{t('entitlements.limitType')}</label>
                <select id="limit-type" value={limitType} onChange={(e) => setLimitType(e.target.value as LimitType)}>
                  {LIMIT_TYPES.map((lt) => (
                    <option key={lt} value={lt}>
                      {t(`entitlements.limitTypes.${lt}`)}
                    </option>
                  ))}
                </select>
                <label htmlFor="limit-value">{t('entitlements.targetLimit')}</label>
                <input id="limit-value" type="number" min={0} step={1} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} required />
                <div className="actions-row">
                  <ConfirmButton
                    className="btn btn-primary"
                    label={t('entitlements.setLimit')}
                    disabled={limitSubmitting}
                    onConfirm={() => void onSetLimit()}
                  />
                </div>
              </form>
            </section>
          </PermissionGate>

          <PermissionGate operation="ADMINISTER_ENTITLEMENT_QUANTITY">
            <section className="card">
              <h2 className="section-title">{t('entitlements.deviceOverrideTitle')}</h2>
              <p className="status-unavailable">{t('entitlements.deviceOverrideHint')}</p>
              <form className="form-grid" onSubmit={onDeviceOverride}>
                <label htmlFor="override-value">{t('entitlements.targetLimit')}</label>
                <input id="override-value" type="number" min={0} step={1} value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} required />
                <label htmlFor="override-reason">{t('entitlements.reason')}</label>
                <input id="override-reason" maxLength={255} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} required />
                <div className="actions-row">
                  <button type="submit" className="btn btn-primary" disabled={overrideSubmitting}>
                    {t('entitlements.applyOverride')}
                  </button>
                </div>
              </form>
            </section>
          </PermissionGate>
        </>
      )}
    </div>
  );
}
