import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import { BILLING_CADENCES, PLAN_STATUSES, type BillingCadence, type PlanDto, type PlanStatus } from '../../domain/billing';
import type { PagedResult } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { ConfirmButton } from '../../components/common/ConfirmButton';
import { BillingPermissionGate } from '../../rbac/BillingPermissionGate';
import { useToast } from '../../state/ToastContext';

const PLAN_BADGE: Record<string, string> = { DRAFT: 'badge-warning', ACTIVE: 'badge-success', RETIRED: 'badge-danger' };
const PAGE_SIZE = 20;
const EMPTY_FILTERS = { planCode: '', status: '', billingCadence: '' };

export default function BillingPlans() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSubtab = searchParams.get('plansView') === 'create' ? 'create' : 'all';
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseItems, setBrowseItems] = useState<PlanDto[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseDatabaseEmpty, setBrowseDatabaseEmpty] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [newPlanCode, setNewPlanCode] = useState('');
  const [status, setStatus] = useState<PlanStatus>('DRAFT');
  const [cadence, setCadence] = useState<BillingCadence>('MONTHLY');
  const [parentLimit, setParentLimit] = useState('');
  const [deviceLimit, setDeviceLimit] = useState('');
  const [priceBookId, setPriceBookId] = useState('');
  const [creating, setCreating] = useState(false);

  const setSubtab = (subtab: 'all' | 'create') => {
    const next = new URLSearchParams(searchParams);
    next.set('plansView', subtab);
    setSearchParams(next);
  };

  const loadBrowse = useCallback(async (activeFilters = appliedFilters, offset = browseOffset) => {
    setBrowseLoading(true);
    setBrowseError(null);
    setBrowseDatabaseEmpty(false);
    try {
      const result = await platformAdminApi.get<PagedResult<PlanDto>>('/platform-admin/billing/plans', {
        limit: PAGE_SIZE,
        offset,
        planCode: activeFilters.planCode.trim() || undefined,
        status: activeFilters.status || undefined,
        billingCadence: activeFilters.billingCadence || undefined,
      });
      setBrowseItems(result.items);
      setBrowseTotal(result.total);
      setBrowseOffset(result.offset);
      if (result.total === 0) {
        const hasFilters = Boolean(activeFilters.planCode.trim() || activeFilters.status || activeFilters.billingCadence);
        if (!hasFilters) {
          setBrowseDatabaseEmpty(true);
        } else {
          const inventory = await platformAdminApi.get<PagedResult<PlanDto>>('/platform-admin/billing/plans', { limit: 1, offset: 0 });
          setBrowseDatabaseEmpty(inventory.total === 0);
        }
      }
    } catch (err) {
      setBrowseError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
    } finally {
      setBrowseLoading(false);
    }
  }, [appliedFilters, browseOffset, t]);

  useEffect(() => { void loadBrowse(); }, [loadBrowse]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setBrowseOffset(0);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setBrowseOffset(0);
    setAppliedFilters({ ...EMPTY_FILTERS });
  };

  const openCreateVersion = (planCode: string) => {
    setNewPlanCode(planCode);
    setSubtab('create');
  };

  const onCreate = async (event?: FormEvent) => {
    event?.preventDefault();
    const defaultParentMemberLimit = Number.parseInt(parentLimit, 10);
    const defaultManagedDeviceLimit = Number.parseInt(deviceLimit, 10);
    if (!newPlanCode.trim() || !Number.isInteger(defaultParentMemberLimit) || defaultParentMemberLimit < 0 || !Number.isInteger(defaultManagedDeviceLimit) || defaultManagedDeviceLimit < 0) {
      notify(t('billing.invalidPlanForm'), 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await platformAdminApi.post<PlanDto>('/platform-admin/billing/plans', {
        planCode: newPlanCode.trim(), status, billingCadence: cadence,
        defaultParentMemberLimit, defaultManagedDeviceLimit, priceBookId: priceBookId.trim() || undefined,
      });
      notify(t('billing.planCreated', { planCode: created.planCode }), 'success');
      setFilters(EMPTY_FILTERS);
      setAppliedFilters({ ...EMPTY_FILTERS });
      setBrowseOffset(0);
      setNewPlanCode(''); setParentLimit(''); setDeviceLimit(''); setPriceBookId('');
      setSubtab('all');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <h2>{t('nav.billingPlans')}</h2>
      <div className="filters" role="tablist" aria-label={t('billing.planTabsLabel')}>
        <button type="button" role="tab" aria-selected={activeSubtab === 'all'} onClick={() => setSubtab('all')} className={activeSubtab === 'all' ? 'btn btn-primary' : 'btn'}>{t('billing.allPlansTab')}</button>
        <button type="button" role="tab" aria-selected={activeSubtab === 'create'} onClick={() => setSubtab('create')} className={activeSubtab === 'create' ? 'btn btn-primary' : 'btn'}>{t('billing.createPlanTab')}</button>
      </div>

      {activeSubtab === 'all' ? (
        <section role="tabpanel" className="workspace-page-panel">
          <form className="filters" onSubmit={applyFilters}>
            <div><label htmlFor="browse-plan-code">{t('billing.planCodeExact')}</label>
              <input id="browse-plan-code" value={filters.planCode} onChange={(e) => setFilters({ ...filters, planCode: e.target.value })} maxLength={64} /></div>
            <div><label htmlFor="browse-plan-status">{t('billing.status')}</label>
              <select id="browse-plan-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">{t('billing.anyStatus')}</option>{PLAN_STATUSES.map((item) => <option key={item} value={item}>{t(`billing.planStatuses.${item}`)}</option>)}
              </select></div>
            <div><label htmlFor="browse-plan-cadence">{t('billing.billingCadence')}</label>
              <select id="browse-plan-cadence" value={filters.billingCadence} onChange={(e) => setFilters({ ...filters, billingCadence: e.target.value })}>
                <option value="">{t('billing.anyCadence')}</option>{BILLING_CADENCES.map((item) => <option key={item} value={item}>{t(`billing.cadences.${item}`)}</option>)}
              </select></div>
            <button type="submit" className="btn btn-primary">{t('common.applyFilters')}</button>
            <button type="button" className="btn" onClick={clearFilters}>{t('common.clear')}</button>
          </form>
          {browseLoading && <LoadingState />}
          {browseError && <ErrorState message={browseError} onRetry={() => void loadBrowse()} />}
          {!browseLoading && !browseError && browseItems.length === 0 && <p className="status-unavailable">{browseDatabaseEmpty ? t('billing.noPlansExist') : t('billing.noPlansMatch')}</p>}
          {!browseLoading && !browseError && browseItems.length > 0 && <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{t('billing.planCode')}</th><th scope="col">{t('billing.planVersion')}</th><th scope="col">{t('billing.status')}</th>
              <th scope="col">{t('billing.billingCadence')}</th><th scope="col">{t('accounts.parentMembers')}</th><th scope="col">{t('accounts.devices')}</th>
              <th scope="col">{t('billing.priceBookId')}</th><th scope="col">{t('accounts.createdAt')}</th><th scope="col">{t('common.actions')}</th>
            </tr></thead>
            <tbody>{browseItems.map((plan) => <tr key={plan.planId}>
              <td>{plan.planCode}</td><td>{plan.planVersion}</td>
              <td><span className={`badge ${PLAN_BADGE[plan.status] ?? 'badge-warning'}`}>{t(`billing.planStatuses.${plan.status}`, plan.status)}</span></td>
              <td>{t(`billing.cadences.${plan.billingCadence}`, plan.billingCadence)}</td><td>{plan.defaultParentMemberLimit}</td>
              <td>{plan.defaultManagedDeviceLimit}</td><td>{plan.priceBookId ?? '—'}</td><td>{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '—'}</td>
              <td><BillingPermissionGate operation="ADMINISTER_BILLING_RECORDS"><button type="button" className="btn" onClick={() => openCreateVersion(plan.planCode)}>{t('billing.createNextVersion')}</button></BillingPermissionGate></td>
            </tr>)}</tbody>
          </table></div>}
          <div className="pagination">
            <button type="button" className="btn" disabled={browseOffset === 0 || browseLoading} onClick={() => void loadBrowse(appliedFilters, Math.max(0, browseOffset - PAGE_SIZE))}>{t('common.previous')}</button>
            <span>{t('common.pageInfo', { from: browseTotal === 0 ? 0 : browseOffset + 1, to: Math.min(browseOffset + PAGE_SIZE, browseTotal), total: browseTotal })}</span>
            <button type="button" className="btn" disabled={browseOffset + PAGE_SIZE >= browseTotal || browseLoading} onClick={() => void loadBrowse(appliedFilters, browseOffset + PAGE_SIZE)}>{t('common.next')}</button>
          </div>
        </section>
      ) : (
        <section role="tabpanel" className="workspace-page-panel">
          <BillingPermissionGate operation="ADMINISTER_BILLING_RECORDS">
            <h3>{t('billing.createPlanTitle')}</h3>
            <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
              <section className="card"><h4>{t('billing.planIdentity')}</h4>
                <label htmlFor="new-plan-code">{t('billing.planCode')}</label>
                <input id="new-plan-code" value={newPlanCode} onChange={(e) => setNewPlanCode(e.target.value)} maxLength={64} required />
                <label htmlFor="new-plan-status">{t('billing.status')}</label>
                <select id="new-plan-status" value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>{PLAN_STATUSES.map((item) => <option key={item} value={item}>{t(`billing.planStatuses.${item}`)}</option>)}</select>
                <label htmlFor="new-plan-cadence">{t('billing.billingCadence')}</label>
                <select id="new-plan-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as BillingCadence)}>{BILLING_CADENCES.map((item) => <option key={item} value={item}>{t(`billing.cadences.${item}`)}</option>)}</select>
              </section>
              <section className="card"><h4>{t('billing.planLimitsAndPrice')}</h4>
                <label htmlFor="new-plan-parent-limit">{t('settings.parentMemberLimit')}</label>
                <input id="new-plan-parent-limit" type="number" min={0} step={1} value={parentLimit} onChange={(e) => setParentLimit(e.target.value)} required />
                <label htmlFor="new-plan-device-limit">{t('settings.managedDeviceLimit')}</label>
                <input id="new-plan-device-limit" type="number" min={0} step={1} value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} required />
                <label htmlFor="new-plan-price-book">{t('billing.priceBookId')}</label>
                <input id="new-plan-price-book" value={priceBookId} onChange={(e) => setPriceBookId(e.target.value)} />
              </section>
              <div className="actions-row"><ConfirmButton className="btn btn-primary" label={t('billing.createPlan')} disabled={creating} onConfirm={() => void onCreate()} /></div>
            </form>
          </BillingPermissionGate>
        </section>
      )}
    </div>
  );
}
