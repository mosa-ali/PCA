import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { planRefLabel } from '../i18n/enumLabels';
/** Mirrors backend/src/entitlements/types.ts's FREE_STARTER_TIER constant. */
const FREE_STARTER_TIER = 'FREE_STARTER';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../api/platformAdminApiClient';
import {
  COMMERCIAL_MARKETS,
  MASKED_DISPLAY_MAX_LENGTH,
  SETTING_KEY_PATTERN,
  isMaskedSettingRow,
  isSensitiveSettingCategory,
  type CommercialMarket,
  type CurrencyMetadataRow,
  type FreeStarterDefaults,
  type MarketMappingRow,
  type PlatformAdminSettingCategory,
  type PlatformAdminSettingRow,
} from '../domain/settings';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';
import { PermissionGate } from '../rbac/PermissionGate';
import { useToast } from '../state/ToastContext';

/**
 * One card per named settings category served by
 * backend/src/http/routes/platformadmin/settingsRoutes.ts
 * (GET /platform-admin/settings/category/:category, PUT /settings/key/:settingKey).
 *
 * RBAC is reused VERBATIM from that backend, never widened here: reads are
 * VIEW_SUPPORT_ACCOUNT_METADATA (ALLOW for every role; the page's own
 * App.tsx route guard now uses this same operation -- it used to require
 * the stricter ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS, which blocked
 * FINANCE_ADMIN/SUPPORT_ADMIN/AUDITOR_READ_ONLY from reads the backend
 * would legitimately serve them), writes are
 * ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS for every ordinary category and
 * ADMINISTER_SENSITIVE_PLATFORM_SETTINGS (APP_OWNER only) for the sensitive
 * PAYMENT_PROVIDER category -- exactly the split
 * PlatformAdminSettingsService.requireMutate enforces.
 *
 * A sensitive category is READ MASKED: the response carries maskedDisplay
 * and no `value` field at all, so this card renders no value column for it
 * and never attempts to pre-fill one.
 */
function CategorySettingsCard({ category, title }: { category: PlatformAdminSettingCategory; title: string }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const sensitive = isSensitiveSettingCategory(category);
  const [rows, setRows] = useState<PlatformAdminSettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingKey, setSettingKey] = useState('');
  const [valueJson, setValueJson] = useState('');
  const [maskedDisplay, setMaskedDisplay] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setError(null);
    platformAdminApi
      .get<{ items: PlatformAdminSettingRow[] }>(`/platform-admin/settings/category/${encodeURIComponent(category)}`)
      .then((res) => setRows(res.items))
      .catch((err: unknown) => {
        setRows(null);
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [category]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!SETTING_KEY_PATTERN.test(settingKey)) {
      notify(t('settings.invalidSettingKey'), 'error');
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(valueJson) as unknown;
    } catch {
      notify(t('settings.invalidSettingValue'), 'error');
      return;
    }
    if (sensitive && (maskedDisplay.trim().length === 0 || maskedDisplay.trim().length > MASKED_DISPLAY_MAX_LENGTH)) {
      notify(t('settings.maskedDisplayRequired'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      // maskedDisplay is REQUIRED for a sensitive category and REJECTED for
      // any other one (PlatformAdminSettingsService.put) -- send it only here.
      const saved = await platformAdminApi.put<PlatformAdminSettingRow>(`/platform-admin/settings/key/${encodeURIComponent(settingKey)}`, {
        category,
        value,
        ...(sensitive ? { maskedDisplay: maskedDisplay.trim() } : {}),
      });
      setRows((prev) => [...(prev ?? []).filter((r) => r.settingKey !== saved.settingKey), saved].sort((a, b) => a.settingKey.localeCompare(b.settingKey)));
      setSettingKey('');
      setValueJson('');
      setMaskedDisplay('');
      notify(t('settings.settingSaved'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const keyInputId = `setting-key-${category}`;
  const valueInputId = `setting-value-${category}`;
  const maskedInputId = `setting-masked-${category}`;

  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      {sensitive && <p className="status-unavailable">{t('settings.sensitiveSettingsMaskedNote')}</p>}
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && rows && rows.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}
      {!error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settings.settingKey')}</th>
                <th scope="col">{sensitive ? t('settings.maskedValue') : t('settings.settingValue')}</th>
                <th scope="col">{t('settings.updatedAt')}</th>
                <th scope="col">{t('settings.updatedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.settingKey}>
                  <td>{row.settingKey}</td>
                  <td>{isMaskedSettingRow(row) ? row.maskedDisplay : JSON.stringify(row.value)}</td>
                  <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
                  <td>{row.updatedByAdminId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PermissionGate operation={sensitive ? 'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS' : 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS'}>
        <form className="form-grid" onSubmit={onSave}>
          <label htmlFor={keyInputId}>{t('settings.settingKey')}</label>
          <input id={keyInputId} value={settingKey} onChange={(e) => setSettingKey(e.target.value)} maxLength={128} required />
          <label htmlFor={valueInputId}>{t('settings.settingValue')}</label>
          <textarea id={valueInputId} rows={2} value={valueJson} onChange={(e) => setValueJson(e.target.value)} required />
          <p className="field-hint">{t('settings.settingValueHint')}</p>
          {sensitive && (
            <>
              <label htmlFor={maskedInputId}>{t('settings.maskedValue')}</label>
              <input id={maskedInputId} value={maskedDisplay} onChange={(e) => setMaskedDisplay(e.target.value)} maxLength={MASKED_DISPLAY_MAX_LENGTH} required />
            </>
          )}
          <div className="actions-row">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </PermissionGate>
    </section>
  );
}

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
      notify(t('settings.defaultsSaved', { plan: planRefLabel(t, FREE_STARTER_TIER) }), 'success');
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
            <h2 className="section-title">{t('settings.freeStarterTitle', { plan: planRefLabel(t, FREE_STARTER_TIER) })}</h2>
            {defaultsMissing && (
              <p className="status-unavailable">
                {t('settings.defaultsNotConfigured', { plan: planRefLabel(t, FREE_STARTER_TIER) })}
              </p>
            )}
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

          <CategorySettingsCard category="BRANDING" title={t('settings.categories.BRANDING')} />
          <CategorySettingsCard category="NOTIFICATION" title={t('settings.categories.NOTIFICATION')} />
          <CategorySettingsCard category="MAINTENANCE" title={t('settings.categories.MAINTENANCE')} />
          <CategorySettingsCard category="FEATURE_FLAG" title={t('settings.categories.FEATURE_FLAG')} />
          <CategorySettingsCard category="PAYMENT_PROVIDER" title={t('settings.sensitiveSettingsTitle')} />
        </>
      )}
    </div>
  );
}
