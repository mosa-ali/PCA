import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { planRefLabel } from '../../i18n/enumLabels';
import { Link } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { AccountSummaryDto, PagedResult } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { ParentEmailFamilyLookup, type ParentEmailLookupResult } from '../../components/common/ParentEmailFamilyLookup';

const PAGE_SIZE = 20;

/** B103/B105: the two columns AccountsReadModel.list() can sort by server-side (see its own doc comment for why the joined entitlement/subscription columns can't be). */
type AccountSortField = 'createdAt' | 'familyId';
type SortDirection = 'asc' | 'desc';

export default function AccountsList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AccountSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [appliedParentEmailQuery, setAppliedParentEmailQuery] = useState('');
  const [parentEmailLookupActive, setParentEmailLookupActive] = useState(false);
  const [parentEmailLookupResult, setParentEmailLookupResult] = useState<ParentEmailLookupResult | null>(null);
  const [sortBy, setSortBy] = useState<AccountSortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (parentEmailLookupActive && (!parentEmailLookupResult || parentEmailLookupResult.outcome === 'ACCOUNT_NOT_FOUND' || parentEmailLookupResult.familyIds.length === 0)) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const request = parentEmailLookupActive
      ? platformAdminApi.post<PagedResult<AccountSummaryDto>>('/platform-admin/accounts/search', {
        limit: PAGE_SIZE,
        offset,
        includeDeleted: includeDeleted ? 'true' : undefined,
        parentEmail: appliedParentEmailQuery || undefined,
        sortBy,
        sortDir,
      })
      : platformAdminApi.get<PagedResult<AccountSummaryDto>>('/platform-admin/accounts', {
        limit: PAGE_SIZE,
        offset,
        includeDeleted: includeDeleted ? 'true' : undefined,
        sortBy,
        sortDir,
      });
    request
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on paging/filter/search/sort change only
  useEffect(load, [offset, includeDeleted, appliedParentEmailQuery, parentEmailLookupActive, parentEmailLookupResult, sortBy, sortDir]);

  /** Clicking the already-active column reverses direction; clicking the other column switches to it, defaulting to descending (matches this list's original default order). */
  const toggleSort = (field: AccountSortField) => {
    setOffset(0);
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field: AccountSortField) => (sortBy === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSortFor = (field: AccountSortField): 'ascending' | 'descending' | 'none' =>
    sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <div className="page">
      <h2>{t('nav.accounts')}</h2>

      <ParentEmailFamilyLookup id="accounts" familyId="" includeDeleted={includeDeleted} showAccountSummary
        onLookupStart={() => {
          setParentEmailLookupActive(true);
          setParentEmailLookupResult(null);
          setAppliedParentEmailQuery('');
          setItems([]);
          setTotal(0);
          setLoading(false);
          setError(null);
          setOffset(0);
        }}
        onResult={(result, normalizedEmail) => {
          setParentEmailLookupResult(result);
          setAppliedParentEmailQuery(result.outcome !== 'ACCOUNT_NOT_FOUND' && result.familyIds.length > 0 ? normalizedEmail : '');
        }}
        onFamilyIdChange={() => {}} />

      <div className="filters enrollment-filter-row">
        <label htmlFor="accounts-include-deleted" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            id="accounts-include-deleted"
            type="checkbox"
            style={{ width: 'auto' }}
            checked={includeDeleted}
            onChange={(e) => {
              setOffset(0);
              setIncludeDeleted(e.target.checked);
            }}
          />
          {t('accounts.includeDeleted')}
        </label>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && items.length === 0 && (!parentEmailLookupActive || (parentEmailLookupResult !== null && parentEmailLookupResult.outcome !== 'ACCOUNT_NOT_FOUND' && parentEmailLookupResult.familyIds.length > 0)) && (
        <p className="status-unavailable">{parentEmailLookupActive ? t('accounts.parentEmailNoFamilyRows') : t('common.empty')}</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSortFor('familyId')}>
                  <button type="button" className="sort-btn" onClick={() => toggleSort('familyId')}>
                    {t('accounts.familyId')}
                    {sortIndicator('familyId')}
                  </button>
                </th>
                <th scope="col" aria-sort={ariaSortFor('createdAt')}>
                  <button type="button" className="sort-btn" onClick={() => toggleSort('createdAt')}>
                    {t('accounts.createdAt')}
                    {sortIndicator('createdAt')}
                  </button>
                </th>
                <th scope="col">{t('accounts.status')}</th>
                <th scope="col">{t('accounts.plan')}</th>
                <th scope="col">{t('accounts.parentMembers')}</th>
                <th scope="col">{t('accounts.devices')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((account) => (
                <tr key={account.familyId}>
                  <td>
                    <Link to={`/accounts/${encodeURIComponent(account.familyId)}`}>{account.familyId}</Link>
                  </td>
                  <td>{account.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    {account.deletedAt ? (
                      <span className="badge badge-danger">{t('accounts.deleted')}</span>
                    ) : (
                      <span className={`badge ${account.status === 'SUSPENDED' ? 'badge-danger' : 'badge-success'}`}>
                        {t(`accounts.statuses.${account.status}`)}
                      </span>
                    )}
                  </td>
                  <td>{account.entitlement?.planRef ? planRefLabel(t, account.entitlement.planRef) : '—'}</td>
                  <td>
                    {account.entitlement ? `${account.entitlement.parentMemberUsedCount}/${account.entitlement.parentMemberLimit}` : '—'}
                    {account.entitlement?.overLimitParentMember && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
                  </td>
                  <td>
                    {account.entitlement ? `${account.entitlement.managedDeviceActiveCount}/${account.entitlement.managedDeviceLimit}` : '—'}
                    {account.entitlement?.overLimitManagedDevice && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(!parentEmailLookupActive || (parentEmailLookupResult !== null && parentEmailLookupResult.outcome !== 'ACCOUNT_NOT_FOUND' && parentEmailLookupResult.familyIds.length > 0)) && <div className="pagination">
        <button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          {t('common.previous')}
        </button>
        <span>{t('common.pageInfo', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
        <button type="button" className="btn" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t('common.next')}
        </button>
      </div>}
    </div>
  );
}
