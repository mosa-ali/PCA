import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { planRefLabel } from '../../i18n/enumLabels';
import { Link } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { AccountSummaryDto, PagedResult } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';

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
  const [familyIdQuery, setFamilyIdQuery] = useState('');
  const [appliedFamilyIdQuery, setAppliedFamilyIdQuery] = useState('');
  const [sortBy, setSortBy] = useState<AccountSortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PagedResult<AccountSummaryDto>>('/platform-admin/accounts', {
        limit: PAGE_SIZE,
        offset,
        includeDeleted: includeDeleted ? 'true' : undefined,
        familyId: appliedFamilyIdQuery || undefined,
        sortBy,
        sortDir,
      })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on paging/filter/sort change only
  useEffect(load, [offset, includeDeleted, appliedFamilyIdQuery, sortBy, sortDir]);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setAppliedFamilyIdQuery(familyIdQuery.trim());
  };

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
      <h1>{t('nav.accounts')}</h1>

      <form className="filters" onSubmit={onSearchSubmit}>
        <div>
          <label htmlFor="accounts-family-id-search">{t('accounts.familyIdSearchLabel')}</label>
          <input id="accounts-family-id-search" value={familyIdQuery} onChange={(e) => setFamilyIdQuery(e.target.value)} maxLength={128} />
        </div>
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
        <button type="submit" className="btn">
          {t('common.applyFilters')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && items.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}

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
