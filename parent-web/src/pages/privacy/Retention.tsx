// PCA-FR-093: genuinely wired to the real family privacy-control intake
// endpoints (backend/src/http/routes/retentionRoutes.ts) via
// clients.retention (see ../../api/real/realRetentionClient.ts). Reads
// the real architecture-baseline default from GET
// /v1/retention-policy/defaults and submits a parent's chosen window
// through POST /v1/families/:familyId/retention-policy -- never local-
// only UI state. Outside demo mode this currently surfaces the same
// honest SERVICE_SESSION_UNAVAILABLE gap every other family-scoped real
// client in this app does (no browser-reachable bearer-token/family-
// context issuance flow yet, see realRetentionClient.ts's header); in
// demo mode DevRetentionClient answers with a working in-memory fixture.
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { ErrorState, LoadingState } from '../../components/common/States';
import type { LocationRetentionMode, RetentionWindow } from '../../domain/retention';

export default function Retention() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data: defaults, loading, error, reload } = useAsync(() => clients.retention.getDefaults(), []);
  const [selectedWindow, setSelectedWindow] = useState<RetentionWindow | null>(null);
  const [selectedLocationMode, setSelectedLocationMode] = useState<LocationRetentionMode | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveWindow = selectedWindow ?? defaults?.generalWindow ?? null;
  const effectiveLocationMode = selectedLocationMode ?? defaults?.locationMode ?? 'CURRENT_LAST_ONLY';
  const locationWindow = typeof effectiveLocationMode === 'object' ? effectiveLocationMode.window : null;
  const generalWindowIndex = defaults && effectiveWindow ? defaults.availableWindows.indexOf(effectiveWindow) : -1;
  const locationWindowIndex = defaults && locationWindow ? defaults.availableWindows.indexOf(locationWindow) : -1;
  const locationWindowExceedsGeneral = locationWindowIndex > generalWindowIndex && locationWindowIndex >= 0;

  const save = async () => {
    if (!effectiveWindow) return;
    if (locationWindowExceedsGeneral) {
      setSaveError(t('retention.locationMustNotExceedGeneral'));
      return;
    }
    setSaveError(null);
    setStatus(null);
    setSaving(true);
    try {
          await runFamilyAction('CHANGE_RETENTION', async () => {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const result = await clients.retention.submitPolicy({
              generalWindow: effectiveWindow,
              locationMode: effectiveLocationMode,
              timezone,
            });
        setStatus(t('retention.updatedStatus', { window: t(`retention.windowLabels.${result.policy.generalWindow}`) }));
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="retention-title">
      <h1 id="retention-title">{t('nav.retention')}</h1>
      <p>{t('retention.description')}</p>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {defaults && (
        <div className="card">
          <p>{t('retention.currentDefault', { window: t(`retention.windowLabels.${defaults.generalWindow}`) })}</p>
          <fieldset disabled={saving}>
            <legend>{t('retention.chooseWindow')}</legend>
            {defaults.availableWindows.map((w) => (
              <label key={w} style={{ display: 'block' }}>
                <input type="radio" name="retention-window" value={w} checked={effectiveWindow === w} onChange={() => setSelectedWindow(w)} />
                {t(`retention.windowLabels.${w}`)}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={saving}>
            <legend>{t('retention.chooseLocationWindow')}</legend>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="location-retention-window"
                checked={effectiveLocationMode === 'CURRENT_LAST_ONLY'}
                onChange={() => setSelectedLocationMode('CURRENT_LAST_ONLY')}
              />
              {t('retention.locationCurrentOnly')}
            </label>
            {defaults.availableWindows.map((w, index) => (
              <label key={`location-${w}`} style={{ display: 'block' }}>
                <input
                  type="radio"
                  name="location-retention-window"
                  checked={locationWindow === w}
                  disabled={index > generalWindowIndex}
                  onChange={() => setSelectedLocationMode({ window: w })}
                />
                {t('retention.locationWindowLabel', { window: t(`retention.windowLabels.${w}`) })}
              </label>
            ))}
          </fieldset>
          {locationWindowExceedsGeneral && <p role="alert">{t('retention.locationMustNotExceedGeneral')}</p>}
        </div>
      )}

      {status && <p role="status">{status}</p>}
      {saveError && <ErrorState message={saveError} />}

      <PermissionGate action="CHANGE_RETENTION" showDisabledFallback>
        <button type="button" className="btn btn-primary" disabled={!effectiveWindow || saving} onClick={save}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </section>
  );
}
