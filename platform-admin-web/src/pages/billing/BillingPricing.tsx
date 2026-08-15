import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import { COMMERCIAL_MARKETS, type CommercialMarket } from '../../domain/settings';
import type { PriceBookDto } from '../../domain/billing';
import { formatMoney, parseExactMinorUnits, type SupportedCurrencyCode } from '../../money/money';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { BillingPermissionGate } from '../../rbac/BillingPermissionGate';
import { useToast } from '../../state/ToastContext';

export default function BillingPricing() {
  const { t } = useTranslation();
  const { notify } = useToast();

  const [market, setMarket] = useState<CommercialMarket>('GLOBAL_OTHER');
  const [currency, setCurrency] = useState<SupportedCurrencyCode>('USD');
  const [targetDeviceLimit, setTargetDeviceLimit] = useState('1');
  const [activeOnly, setActiveOnly] = useState(true);
  const [items, setItems] = useState<PriceBookDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [newAmount, setNewAmount] = useState('');
  const [publishing, setPublishing] = useState(false);

  const runSearch = () => {
    const limit = Number.parseInt(targetDeviceLimit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      notify(t('billing.invalidTargetLimit'), 'error');
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    platformAdminApi
      .get<{ item: PriceBookDto | null } | { items: PriceBookDto[] }>('/platform-admin/billing/price-book', {
        commercialMarket: market,
        currencyCode: currency,
        targetDeviceLimit: limit,
        asOf: activeOnly ? 'active' : undefined,
      })
      .then((res) => {
        if ('item' in res) setItems(res.item ? [res.item] : []);
        else setItems(res.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  const onPublish = async (e: FormEvent) => {
    e.preventDefault();
    const limit = Number.parseInt(targetDeviceLimit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      notify(t('billing.invalidTargetLimit'), 'error');
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parseExactMinorUnits(newAmount, currency);
    } catch {
      notify(t('billing.invalidAmount'), 'error');
      return;
    }
    setPublishing(true);
    try {
      const published = await platformAdminApi.post<PriceBookDto>('/platform-admin/billing/price-book', {
        commercialMarket: market,
        currencyCode: currency,
        targetDeviceLimit: limit,
        amountMinor,
      });
      notify(t('billing.pricePublished'), 'success');
      setItems((prev) => [published, ...prev]);
      setNewAmount('');
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
      <h1>{t('nav.billingPricing')}</h1>

      <form className="filters" onSubmit={search}>
        <div>
          <label htmlFor="pb-market">{t('settings.commercialMarket')}</label>
          <select id="pb-market" value={market} onChange={(e) => setMarket(e.target.value as CommercialMarket)}>
            {COMMERCIAL_MARKETS.map((m) => (
              <option key={m} value={m}>
                {t(`settings.markets.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb-currency">{t('entitlementRequests.currencyLabel')}</label>
          <select id="pb-currency" value={currency} onChange={(e) => setCurrency(e.target.value as SupportedCurrencyCode)}>
            <option value="USD">USD</option>
            <option value="SAR">SAR</option>
            <option value="YER">YER</option>
          </select>
        </div>
        <div>
          <label htmlFor="pb-target-limit">{t('billing.targetDeviceLimit')}</label>
          <input id="pb-target-limit" type="number" min={1} step={1} value={targetDeviceLimit} onChange={(e) => setTargetDeviceLimit(e.target.value)} required />
        </div>
        <label htmlFor="pb-active-only" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input id="pb-active-only" type="checkbox" style={{ width: 'auto' }} checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          {t('billing.activeOnly')}
        </label>
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
                <th scope="col">{t('billing.priceBookVersion')}</th>
                <th scope="col">{t('billing.price')}</th>
                <th scope="col">{t('billing.status')}</th>
                <th scope="col">{t('billing.effectiveFrom')}</th>
                <th scope="col">{t('billing.effectiveTo')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.priceBookId}>
                  <td>{row.priceBookVersion}</td>
                  <td>{row.price ? formatMoney(row.price) : '—'}</td>
                  <td>{row.status}</td>
                  <td>{row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleDateString() : '—'}</td>
                  <td>{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString() : t('billing.noExpiry')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BillingPermissionGate operation="MUTATE_PRICE_BOOK">
        <section className="card">
          <h2 className="section-title">{t('billing.publishPriceTitle')}</h2>
          <p className="field-hint">{t('billing.publishPriceHint')}</p>
          <form className="form-grid" onSubmit={onPublish}>
            <label htmlFor="pb-new-amount">{t('entitlementRequests.amountLabel')}</label>
            <input id="pb-new-amount" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0.00" required />
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={publishing}>
                {t('billing.publish')}
              </button>
            </div>
          </form>
        </section>
      </BillingPermissionGate>
    </div>
  );
}
