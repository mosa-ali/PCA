import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../../api/platformAdminApiClient';
import type { FamilyEntitlement, LimitType } from '../../domain/entitlements';
import { LIMIT_TYPES } from '../../domain/entitlements';
import type { EntitlementRequestDto } from '../../domain/entitlements';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

export default function Entitlements() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [familyIdInput, setFamilyIdInput] = useState(searchParams.get('familyId') ?? '');
  const [familyId, setFamilyId] = useState(searchParams.get('familyId') ?? '');
  const [entitlement, setEntitlement] = useState<FamilyEntitlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [limitType, setLimitType] = useState<LimitType>('MANAGED_DEVICE_LIMIT');
  const [limitValue, setLimitValue] = useState('');
  const [limitSubmitting, setLimitSubmitting] = useState(false);

  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  const load = (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    platformAdminApi
      .get<FamilyEntitlement>(`/platform-admin/families/${encodeURIComponent(id)}/entitlement`)
      .then(setEntitlement)
      .catch((err: unknown) => {
        if (isNotFoundError(err)) {
          setNotFound(true);
          return;
        }
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (familyId) load(familyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = familyIdInput.trim();
    setFamilyId(trimmed);
    setSearchParams(trimmed ? { familyId: trimmed } : {});
  };

  const onSetLimit = async (e: FormEvent) => {
    e.preventDefault();
    if (!familyId) return;
    const targetLimit = Number.parseInt(limitValue, 10);
    if (!Number.isInteger(targetLimit) || targetLimit < 0) {
      notify(t('entitlements.invalidLimit'), 'error');
      return;
    }
    setLimitSubmitting(true);
    try {
      const updated = await platformAdminApi.post<FamilyEntitlement>(`/platform-admin/families/${encodeURIComponent(familyId)}/entitlement/limit`, {
        limitType,
        targetLimit,
      });
      setEntitlement(updated);
      setLimitValue('');
      notify(t('entitlements.limitUpdated'), 'success');
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

  return (
    <div className="page">
      <h1>{t('nav.entitlements')}</h1>

      <form className="filters" onSubmit={onSearch}>
        <div>
          <label htmlFor="entitlements-family-id">{t('entitlements.familyIdLabel')}</label>
          <input id="entitlements-family-id" value={familyIdInput} onChange={(e) => setFamilyIdInput(e.target.value)} maxLength={128} required />
        </div>
        <button type="submit" className="btn btn-primary">
          {t('entitlements.lookup')}
        </button>
      </form>

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
              <form className="form-grid" onSubmit={onSetLimit}>
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
                  <button type="submit" className="btn btn-primary" disabled={limitSubmitting}>
                    {t('entitlements.setLimit')}
                  </button>
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
