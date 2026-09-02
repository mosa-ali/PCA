import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import { BILLING_CADENCES, PLAN_STATUSES, type BillingCadence, type PlanDto, type PlanStatus } from '../../domain/billing';
import type { PagedResult } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { ConfirmButton } from '../../components/common/ConfirmButton';
import { BillingPermissionGate } from '../../rbac/BillingPermissionGate';
import { useToast } from '../../state/ToastContext';

const PLAN_BADGE: Record<string, string> = {
  DRAFT: 'badge-warning',
  ACTIVE: 'badge-success',
  RETIRED: 'badge-danger',
};

const BROWSE_PAGE_SIZE = 20;

export default function BillingPlans() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [planCodeQuery, setPlanCodeQuery] = useState('');
  const [items, setItems] = useState<PlanDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [browseStatus, setBrowseStatus] = useState('');
  const [browseCadence, setBrowseCadence] = useState('');
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseItems, setBrowseItems] = useState<PlanDto[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [newPlanCode, setNewPlanCode] = useState('');
  const [status, setStatus] = useState<PlanStatus>('DRAFT');
  const [cadence, setCadence] = useState<BillingCadence>('MONTHLY');
  const [parentLimit, setParentLimit] = useState('');
  const [deviceLimit, setDeviceLimit] = useState('');
  const [priceBookId, setPriceBookId] = useState('');
  const [creating, setCreating] = useState(false);

  const loadBrowse = () => {
    setBrowseLoading(true);
    setBrowseError(null);
    platformAdminApi
      .get<PagedResult<PlanDto>>('/platform-admin/billing/plans', {
        limit: BROWSE_PAGE_SIZE,
        offset: browseOffset,
        status: browseStatus || undefined,
        billingCadence: browseCadence || undefined,
      })
      .then((res) => {
        setBrowseItems(res.items);
        setBrowseTotal(res.total);
      })
      .catch((err: unknown) => {
        setBrowseError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setBrowseLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadBrowse, [browseOffset]);

  const applyBrowseFilters = () => {
    setBrowseOffset(0);
    loadBrowse();
  };

  const runSearch = () => {
    if (!planCodeQuery.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    platformAdminApi
      .get<{ items: PlanDto[] }>(`/platform-admin/billing/plans/${encodeURIComponent(planCodeQuery.trim())}`)
      .then((res) => setItems(res.items))
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  const onCreate = async (e?: FormEvent) => {
    e?.preventDefault();
    const defaultParentMemberLimit = Number.parseInt(parentLimit, 10);
    const defaultManagedDeviceLimit = Number.parseInt(deviceLimit, 10);
    if (!newPlanCode.trim() || !Number.isInteger(defaultParentMemberLimit) || defaultParentMemberLimit < 0 || !Number.isInteger(defaultManagedDeviceLimit) || defaultManagedDeviceLimit < 0) {
      notify(t('billing.invalidPlanForm'), 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await platformAdminApi.post<PlanDto>('/platform-admin/billing/plans', {
        planCode: newPlanCode.trim(),
        status,
        billingCadence: cadence,
        defaultParentMemberLimit,
        defaultManagedDeviceLimit,
        priceBookId: priceBookId.trim() || undefined,
      });
      notify(t('billing.planCreated', { planCode: created.planCode }), 'success');
      if (planCodeQuery.trim() === created.planCode) setItems((prev) => [...prev, created]);
      setNewPlanCode('');
      setParentLimit('');
      setDeviceLimit('');
      setPriceBookId('');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <h1>{t('nav.billingPlans')}</h1>

      <section className="card">
        <h2 className="section-title">{t('billing.browseAllPlans')}</h2>
        <div className="filters">
          <div>
            <label htmlFor="browse-plan-status">{t('billing.status')}</label>
            <select id="browse-plan-status" value={browseStatus} onChange={(e) => setBrowseStatus(e.target.value)}>
              <option value="">{t('billing.anyStatus')}</option>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`billing.planStatuses.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="browse-plan-cadence">{t('billing.billingCadence')}</label>
            <select id="browse-plan-cadence" value={browseCadence} onChange={(e) => setBrowseCadence(e.target.value)}>
              <option value="">{t('billing.anyCadence')}</option>
              {BILLING_CADENCES.map((c) => (
                <option key={c} value={c}>
                  {t(`billing.cadences.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={applyBrowseFilters}>
            {t('common.applyFilters')}
          </button>
        </div>

        {browseLoading && <LoadingState />}
        {browseError && <ErrorState message={browseError} onRetry={loadBrowse} />}

        {!browseLoading && !browseError && (
          browseItems.length === 0 ? (
            <p className="status-unavailable">{t('common.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('billing.planCode')}</th>
                    <th scope="col">{t('billing.planVersion')}</th>
                    <th scope="col">{t('billing.status')}</th>
                    <th scope="col">{t('billing.billingCadence')}</th>
                    <th scope="col">{t('accounts.parentMembers')}</th>
                    <th scope="col">{t('accounts.devices')}</th>
                    <th scope="col">{t('billing.priceBookId')}</th>
                    <th scope="col">{t('accounts.createdAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {browseItems.map((plan) => (
                    <tr key={plan.planId}>
                      <td>{plan.planCode}</td>
                      <td>{plan.planVersion}</td>
                      <td>
                        <span className={`badge ${PLAN_BADGE[plan.status] ?? 'badge-warning'}`}>{t(`billing.planStatuses.${plan.status}`, plan.status)}</span>
                      </td>
                      <td>{t(`billing.cadences.${plan.billingCadence}`, plan.billingCadence)}</td>
                      <td>{plan.defaultParentMemberLimit}</td>
                      <td>{plan.defaultManagedDeviceLimit}</td>
                      <td>{plan.priceBookId ?? '—'}</td>
                      <td>{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <div className="pagination">
          <button type="button" className="btn" disabled={browseOffset === 0 || browseLoading} onClick={() => setBrowseOffset(Math.max(0, browseOffset - BROWSE_PAGE_SIZE))}>
            {t('common.previous')}
          </button>
          <span>{t('common.pageInfo', { from: browseTotal === 0 ? 0 : browseOffset + 1, to: Math.min(browseOffset + BROWSE_PAGE_SIZE, browseTotal), total: browseTotal })}</span>
          <button type="button" className="btn" disabled={browseOffset + BROWSE_PAGE_SIZE >= browseTotal || browseLoading} onClick={() => setBrowseOffset(browseOffset + BROWSE_PAGE_SIZE)}>
            {t('common.next')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">{t('billing.exactCodeSearch')}</h2>
        <form className="filters" onSubmit={search}>
          <div>
            <label htmlFor="plan-code-search">{t('billing.planCode')}</label>
            <input id="plan-code-search" value={planCodeQuery} onChange={(e) => setPlanCodeQuery(e.target.value)} maxLength={64} required />
          </div>
          <button type="submit" className="btn btn-primary">
            {t('common.search')}
          </button>
        </form>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={runSearch} />}
        {searched && !loading && !error && items.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}

        {!loading && !error && items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.planCode')}</th>
                  <th scope="col">{t('billing.planVersion')}</th>
                  <th scope="col">{t('billing.status')}</th>
                  <th scope="col">{t('billing.billingCadence')}</th>
                  <th scope="col">{t('accounts.parentMembers')}</th>
                  <th scope="col">{t('accounts.devices')}</th>
                  <th scope="col">{t('billing.priceBookId')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((plan) => (
                  <tr key={plan.planId}>
                    <td>{plan.planCode}</td>
                    <td>{plan.planVersion}</td>
                    <td>
                      <span className={`badge ${PLAN_BADGE[plan.status] ?? 'badge-warning'}`}>{t(`billing.planStatuses.${plan.status}`, plan.status)}</span>
                    </td>
                    <td>{t(`billing.cadences.${plan.billingCadence}`, plan.billingCadence)}</td>
                    <td>{plan.defaultParentMemberLimit}</td>
                    <td>{plan.defaultManagedDeviceLimit}</td>
                    <td>{plan.priceBookId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BillingPermissionGate operation="ADMINISTER_BILLING_RECORDS">
        <section className="card">
          <h2 className="section-title">{t('billing.createPlanTitle')}</h2>
          <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="new-plan-code">{t('billing.planCode')}</label>
            <input id="new-plan-code" value={newPlanCode} onChange={(e) => setNewPlanCode(e.target.value)} maxLength={64} required />
            <label htmlFor="new-plan-status">{t('billing.status')}</label>
            <select id="new-plan-status" value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`billing.planStatuses.${s}`)}
                </option>
              ))}
            </select>
            <label htmlFor="new-plan-cadence">{t('billing.billingCadence')}</label>
            <select id="new-plan-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as BillingCadence)}>
              {BILLING_CADENCES.map((c) => (
                <option key={c} value={c}>
                  {t(`billing.cadences.${c}`)}
                </option>
              ))}
            </select>
            <label htmlFor="new-plan-parent-limit">{t('settings.parentMemberLimit')}</label>
            <input id="new-plan-parent-limit" type="number" min={0} step={1} value={parentLimit} onChange={(e) => setParentLimit(e.target.value)} required />
            <label htmlFor="new-plan-device-limit">{t('settings.managedDeviceLimit')}</label>
            <input id="new-plan-device-limit" type="number" min={0} step={1} value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} required />
            <label htmlFor="new-plan-price-book">{t('billing.priceBookId')}</label>
            <input id="new-plan-price-book" value={priceBookId} onChange={(e) => setPriceBookId(e.target.value)} />
            <div className="actions-row">
              <ConfirmButton
                className="btn btn-primary"
                label={t('billing.createPlan')}
                disabled={creating}
                onConfirm={() => void onCreate()}
              />
            </div>
          </form>
        </section>
      </BillingPermissionGate>
    </div>
  );
}
