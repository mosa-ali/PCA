import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../api/platformAdminApiClient';
import { COMMERCIAL_MARKETS, type CommercialMarket, type CurrencyMetadataRow, type FreeStarterDefaults, type MarketMappingRow } from '../domain/settings';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';
import { PermissionGate } from '../rbac/PermissionGate';
import { useToast } from '../state/ToastContext';

export default function Settings() {
  const { t } = useTranslation();
  const { notify } = useToast();

  const [defaults, setDefaults] = useState<FreeStarterDefaults | null>(null);
  const [defaultsMissing, setDefaultsMissing] = useState(false);
  const [currencies, setCurrencies] = useState<CurrencyMetadataRow[]>([]);
  const [marketRules, setMarketRules] = useState<MarketMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [parentLimit, setParentLimit] = useState('');
  const [deviceLimit, setDeviceLimit] = useState('');
  const [defaultsSubmitting, setDefaultsSubmitting] = useState(false);

  const [countryCode, setCountryCode] = useState('');
  const [market, setMarket] = useState<CommercialMarket>('GLOBAL_OTHER');
  const [mappingSubmitting, setMappingSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    setDefaultsMissing(false);
    Promise.all([
      platformAdminApi.get<FreeStarterDefaults>('/platform-admin/settings/free-starter-defaults').catch((err: unknown) => {
        if (isNotFoundError(err)) {
          setDefaultsMissing(true);
          return null;
        }
        throw err;
      }),
      platformAdminApi.get<{ items: CurrencyMetadataRow[] }>('/platform-admin/settings/currencies'),
      platformAdminApi.get<{ items: MarketMappingRow[] }>('/platform-admin/settings/market-mapping'),
    ])
      .then(([defaultsResult, currenciesResult, marketResult]) => {
        if (defaultsResult) {
          setDefaults(defaultsResult);
          setParentLimit(String(defaultsResult.parentMemberLimit));
          setDeviceLimit(String(defaultsResult.managedDeviceLimit));
        }
        setCurrencies(currenciesResult.items);
        setMarketRules(marketResult.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const onSaveDefaults = async (e: FormEvent) => {
    e.preventDefault();
    const parentMemberLimit = Number.parseInt(parentLimit, 10);
    const managedDeviceLimit = Number.parseInt(deviceLimit, 10);
    if (!Number.isInteger(parentMemberLimit) || parentMemberLimit < 0 || !Number.isInteger(managedDeviceLimit) || managedDeviceLimit < 0) {
      notify(t('settings.invalidLimits'), 'error');
      return;
    }
    setDefaultsSubmitting(true);
    try {
      const result = await platformAdminApi.put<{ tier: string; parentMemberLimit: number; managedDeviceLimit: number }>('/platform-admin/settings/free-starter-defaults', {
        parentMemberLimit,
        managedDeviceLimit,
      });
      setDefaults((prev) => (prev ? { ...prev, parentMemberLimit: result.parentMemberLimit, managedDeviceLimit: result.managedDeviceLimit } : prev));
      setDefaultsMissing(false);
      notify(t('settings.defaultsSaved'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setDefaultsSubmitting(false);
    }
  };

  const onSaveMapping = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z]{2}$/.test(countryCode)) {
      notify(t('settings.invalidCountryCode'), 'error');
      return;
    }
    setMappingSubmitting(true);
    try {
      const result = await platformAdminApi.put<MarketMappingRow>('/platform-admin/settings/market-mapping', { countryCode, commercialMarket: market });
      setMarketRules((prev) => {
        const withoutExisting = prev.filter((r) => r.countryCode !== result.countryCode);
        return [...withoutExisting, result].sort((a, b) => a.countryCode.localeCompare(b.countryCode));
      });
      setCountryCode('');
      notify(t('settings.mappingSaved'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setMappingSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>{t('nav.settings')}</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <section className="card">
            <h2 className="section-title">{t('settings.freeStarterTitle')}</h2>
            {defaultsMissing && <p className="status-unavailable">{t('settings.defaultsNotConfigured')}</p>}
            {defaults && (
              <dl className="kv-list">
                <dt>{t('settings.parentMemberLimit')}</dt>
                <dd>{defaults.parentMemberLimit}</dd>
                <dt>{t('settings.managedDeviceLimit')}</dt>
                <dd>{defaults.managedDeviceLimit}</dd>
                <dt>{t('settings.updatedAt')}</dt>
                <dd>{defaults.updatedAt ? new Date(defaults.updatedAt).toLocaleString() : '—'}</dd>
              </dl>
            )}
            <PermissionGate operation="ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS">
              <form className="form-grid" onSubmit={onSaveDefaults}>
                <label htmlFor="free-starter-parent">{t('settings.parentMemberLimit')}</label>
                <input id="free-starter-parent" type="number" min={0} step={1} value={parentLimit} onChange={(e) => setParentLimit(e.target.value)} required />
                <label htmlFor="free-starter-device">{t('settings.managedDeviceLimit')}</label>
                <input id="free-starter-device" type="number" min={0} step={1} value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} required />
                <div className="actions-row">
                  <button type="submit" className="btn btn-primary" disabled={defaultsSubmitting}>
                    {t('common.save')}
                  </button>
                </div>
              </form>
            </PermissionGate>
          </section>

          <section className="card">
            <h2 className="section-title">{t('settings.currenciesTitle')}</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('settings.currencyCode')}</th>
                    <th scope="col">{t('settings.minorUnitExponent')}</th>
                    <th scope="col">{t('settings.enabled')}</th>
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((c) => (
                    <tr key={c.currencyCode}>
                      <td>{c.currencyCode}</td>
                      <td>{c.minorUnitExponent}</td>
                      <td>{c.enabled ? t('common.yes') : t('common.no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">{t('settings.marketMappingTitle')}</h2>
            {marketRules.length === 0 ? (
              <p className="status-unavailable">{t('common.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('settings.countryCode')}</th>
                      <th scope="col">{t('settings.commercialMarket')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketRules.map((r) => (
                      <tr key={r.countryCode}>
                        <td>{r.countryCode}</td>
                        <td>{t(`settings.markets.${r.commercialMarket}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PermissionGate operation="ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS">
              <form className="form-grid" onSubmit={onSaveMapping}>
                <label htmlFor="mapping-country">{t('settings.countryCode')}</label>
                <input id="mapping-country" value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} maxLength={2} required />
                <label htmlFor="mapping-market">{t('settings.commercialMarket')}</label>
                <select id="mapping-market" value={market} onChange={(e) => setMarket(e.target.value as CommercialMarket)}>
                  {COMMERCIAL_MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {t(`settings.markets.${m}`)}
                    </option>
                  ))}
                </select>
                <div className="actions-row">
                  <button type="submit" className="btn btn-primary" disabled={mappingSubmitting}>
                    {t('common.save')}
                  </button>
                </div>
              </form>
            </PermissionGate>
          </section>

          <section className="card">
            <h2 className="section-title">{t('settings.sensitiveSettingsTitle')}</h2>
            <p className="status-unavailable">{t('settings.sensitiveSettingsUnavailable')}</p>
          </section>
        </>
      )}
    </div>
  );
}
