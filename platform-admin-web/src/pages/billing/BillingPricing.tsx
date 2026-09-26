import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import { COMMERCIAL_MARKETS, type CommercialMarket } from '../../domain/settings';
import type { PriceBookDto } from '../../domain/billing';
import type { PagedResult } from '../../domain/accounts';
import { formatMoney, parseExactMinorUnits, type SupportedCurrencyCode } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { BillingPermissionGate } from '../../rbac/BillingPermissionGate';
import { useToast } from '../../state/ToastContext';

const PAGE_SIZE = 20;
const EMPTY_FILTERS = { market: '', currency: '', targetDeviceLimit: '', activeOnly: true };
const DEFAULT_PUBLISH_KEY = { market: 'GLOBAL_OTHER' as CommercialMarket, currency: 'USD' as SupportedCurrencyCode, targetDeviceLimit: '1' };

type PriceFilters = typeof EMPTY_FILTERS;

export default function BillingPricing() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [filters, setFilters] = useState<PriceFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<PriceFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<PriceBookDto[]>([]);
  const [total, setTotal] = useState(0);
  const [databaseEmpty, setDatabaseEmpty] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [publishMarket, setPublishMarket] = useState<CommercialMarket>(DEFAULT_PUBLISH_KEY.market);
  const [publishCurrency, setPublishCurrency] = useState<SupportedCurrencyCode>(DEFAULT_PUBLISH_KEY.currency);
  const [publishTargetLimit, setPublishTargetLimit] = useState(DEFAULT_PUBLISH_KEY.targetDeviceLimit);
  const [newAmount, setNewAmount] = useState('');
  const [publishing, setPublishing] = useState(false);

  const loadPrices = useCallback(async (activeFilters = appliedFilters, pageOffset = offset) => {
    setLoading(true);
    setError(null);
    setDatabaseEmpty(false);
    try {
      const response = await platformAdminApi.get<PagedResult<PriceBookDto>>('/platform-admin/billing/price-book', {
        limit: PAGE_SIZE,
        offset: pageOffset,
        commercialMarket: activeFilters.market || undefined,
        currencyCode: activeFilters.currency || undefined,
        targetDeviceLimit: activeFilters.targetDeviceLimit ? Number(activeFilters.targetDeviceLimit) : undefined,
        activeOnly: activeFilters.activeOnly ? 'true' : 'false',
      });
      setItems(response.items);
      setTotal(response.total ?? response.items.length);
      setOffset(response.offset ?? pageOffset);
      if ((response.total ?? response.items.length) === 0) {
        const inventory = await platformAdminApi.get<PagedResult<PriceBookDto>>('/platform-admin/billing/price-book', {
          limit: 1,
          offset: 0,
          activeOnly: 'false',
        });
        setDatabaseEmpty(inventory.total === 0);
      }
    } catch (err) {
      setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, offset, t]);

  useEffect(() => { void loadPrices(); }, [loadPrices]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    if (filters.targetDeviceLimit && (!Number.isInteger(Number(filters.targetDeviceLimit)) || Number(filters.targetDeviceLimit) < 1)) {
      notify(t('billing.invalidTargetLimit'), 'error');
      return;
    }
    setOffset(0);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setAppliedFilters({ ...EMPTY_FILTERS });
  };

  const onPublish = async (event: FormEvent) => {
    event.preventDefault();
    const limit = Number.parseInt(publishTargetLimit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      notify(t('billing.invalidTargetLimit'), 'error');
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parseExactMinorUnits(newAmount, publishCurrency);
    } catch {
      notify(t('billing.invalidAmount'), 'error');
      return;
    }
    setPublishing(true);
    try {
      const published = await platformAdminApi.post<PriceBookDto>('/platform-admin/billing/price-book', {
        commercialMarket: publishMarket,
        currencyCode: publishCurrency,
        targetDeviceLimit: limit,
        amountMinor,
      });
      const createdKey: PriceFilters = {
        market: published.commercialMarket,
        currency: published.currencyCode,
        targetDeviceLimit: String(published.targetDeviceLimit),
        activeOnly: true,
      };
      setPublishTargetLimit(String(published.targetDeviceLimit));
      setFilters(createdKey);
      setAppliedFilters(createdKey);
      setOffset(0);
      setNewAmount('');
      notify(t('billing.pricePublishedVersion', { version: published.priceBookVersion }), 'success');
    } catch (err) {
      if (err instanceof PlatformAdminApiError && err.status === 409) {
        notify(t('billing.publicationConflict'), 'error');
      } else {
        notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="page">
      <h2>{t('nav.billingPricing')}</h2>

      <form className="filters" onSubmit={applyFilters}>
        <div>
          <label htmlFor="pb-filter-market">{t('settings.commercialMarket')}</label>
          <select id="pb-filter-market" value={filters.market} onChange={(e) => setFilters({ ...filters, market: e.target.value })}>
            <option value="">{t('billing.anyMarket')}</option>
            {COMMERCIAL_MARKETS.map((market) => <option key={market} value={market}>{t(`settings.markets.${market}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-currency">{t('entitlementRequests.currencyLabel')}</label>
          <select id="pb-filter-currency" value={filters.currency} onChange={(e) => setFilters({ ...filters, currency: e.target.value })}>
            <option value="">{t('billing.anyCurrency')}</option>
            <option value="USD">USD</option><option value="SAR">SAR</option><option value="YER">YER</option>
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-target-limit">{t('billing.targetDeviceLimit')}</label>
          <input id="pb-filter-target-limit" type="number" min={1} step={1} value={filters.targetDeviceLimit} onChange={(e) => setFilters({ ...filters, targetDeviceLimit: e.target.value })} />
        </div>
        <label htmlFor="pb-active-only" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input id="pb-active-only" type="checkbox" style={{ width: 'auto' }} checked={filters.activeOnly} onChange={(e) => setFilters({ ...filters, activeOnly: e.target.checked })} />
          {t('billing.activeOnly')}
        </label>
        <button type="submit" className="btn btn-primary">{t('common.search')}</button>
        <button type="button" className="btn" onClick={clearFilters}>{t('common.clear')}</button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={() => void loadPrices()} />}
      {!loading && !error && items.length === 0 && <p className="status-unavailable">{databaseEmpty ? t('billing.noPriceBookEntries') : t('billing.noMatchingPrices')}</p>}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th scope="col">{t('settings.commercialMarket')}</th>
              <th scope="col">{t('entitlementRequests.currencyLabel')}</th>
              <th scope="col">{t('billing.targetDeviceLimit')}</th>
              <th scope="col">{t('billing.priceBookVersion')}</th>
              <th scope="col">{t('billing.price')}</th>
              <th scope="col">{t('billing.status')}</th>
              <th scope="col">{t('billing.effectiveFrom')}</th>
              <th scope="col">{t('billing.effectiveTo')}</th>
            </tr></thead>
            <tbody>{items.map((row) => (
              <tr key={row.priceBookId}>
                <td>{t(`settings.markets.${row.commercialMarket}`, row.commercialMarket)}</td>
                <td>{row.currencyCode}</td>
                <td>{row.targetDeviceLimit}</td>
                <td>{row.priceBookVersion}</td>
                <td>{row.price ? formatMoney(row.price) : '—'}</td>
                <td><span className={`badge ${row.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{t(`billing.planStatuses.${row.status}`, row.status)}</span></td>
                <td>{row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleDateString() : '—'}</td>
                <td>{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString() : t('billing.noExpiry')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!loading && !error && items.length > 0 && <div className="pagination">
        <button type="button" className="btn" disabled={offset === 0} onClick={() => void loadPrices(appliedFilters, Math.max(0, offset - PAGE_SIZE))}>{t('common.previous')}</button>
        <span>{t('common.pageInfo', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
        <button type="button" className="btn" disabled={offset + PAGE_SIZE >= total} onClick={() => void loadPrices(appliedFilters, offset + PAGE_SIZE)}>{t('common.next')}</button>
      </div>}

      <BillingPermissionGate operation="MUTATE_PRICE_BOOK">
        <section className="card">
          <h2 className="section-title">{t('billing.publishPriceTitle')}</h2>
          <p className="field-hint">{t('billing.publishPriceHint')}</p>
          <form className="form-grid" onSubmit={onPublish}>
            <div className="filters">
              <div><label htmlFor="pb-publish-market">{t('settings.commercialMarket')}</label>
                <select id="pb-publish-market" value={publishMarket} onChange={(e) => setPublishMarket(e.target.value as CommercialMarket)}>
                  {COMMERCIAL_MARKETS.map((market) => <option key={market} value={market}>{t(`settings.markets.${market}`)}</option>)}
                </select>
              </div>
              <div><label htmlFor="pb-publish-currency">{t('entitlementRequests.currencyLabel')}</label>
                <select id="pb-publish-currency" value={publishCurrency} onChange={(e) => setPublishCurrency(e.target.value as SupportedCurrencyCode)}>
                  <option value="USD">USD</option><option value="SAR">SAR</option><option value="YER">YER</option>
                </select>
              </div>
              <div><label htmlFor="pb-publish-limit">{t('billing.targetDeviceLimit')}</label>
                <input id="pb-publish-limit" type="number" min={1} step={1} value={publishTargetLimit} onChange={(e) => setPublishTargetLimit(e.target.value)} required />
              </div>
            </div>
            <p className="field-hint">{t('billing.publishKeySummary', { market: t(`settings.markets.${publishMarket}`), currency: publishCurrency, limit: publishTargetLimit })}</p>
            <label htmlFor="pb-new-amount">{t('entitlementRequests.amountLabel')}</label>
            <input id="pb-new-amount" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0.00" required />
            <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={publishing}>{t('billing.publish')}</button></div>
          </form>
        </section>
      </BillingPermissionGate>
    </div>
  );
}
