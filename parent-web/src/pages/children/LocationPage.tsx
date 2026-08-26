import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { config } from '../../config/env';
import { cookieSessionFamilyId } from '../../api/real/realBillingClient';
import type { SafeZone } from '../../api/interfaces';
import {
  SafeZonePolicyAuthoringError,
  VerifiedFamilySafeZonePolicyPublisher,
  validateSafeZonePlaintextDefinition,
  type SafeZonePolicyAuthoringErrorCode,
} from '../../api/safeZonePolicyAuthoring';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

function safeZoneErrorMessageKey(err: unknown): string {
  if (err instanceof SafeZonePolicyAuthoringError) {
    const byCode: Record<SafeZonePolicyAuthoringErrorCode, string> = {
      CRYPTO_REVIEW_REQUIRED: 'location.safeZoneEncryptionUnavailable',
      ENCRYPTION_UNAVAILABLE: 'location.safeZoneEncryptionUnavailable',
      INVALID_DEFINITION: 'location.safeZoneInvalidDefinition',
      FAMILY_AUTHORITY_REQUIRED: 'location.safeZoneFamilyAuthorityRequired',
    };
    return byCode[err.code];
  }
  return 'location.safeZoneSaveFailed';
}

function SafeZoneAuthoring({ childId }: { childId: string }) {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const recipientEndpointId = `device-${childId}`;

  // Demo/dev mode has no authenticated family-session cookie to resolve a
  // real family id from -- same honest posture as Devices.tsx's
  // RealProtectionAdministrationActions gating. A fixed placeholder id is
  // fine here because DevSafeZoneClient's list()/remove() only ever filter
  // an in-memory array that create() can never actually populate in demo
  // mode either (safeZonePolicyAuthoring is UnavailableSafeZonePolicyAuthoring
  // in every mode until a reviewed family-crypto adapter exists).
  const { data: familyId } = useAsync(
    () => (clients.isFixtureBacked ? Promise.resolve('family-dev') : cookieSessionFamilyId(config.apiBaseUrl)),
    [clients.isFixtureBacked],
  );
  const { data: zones, loading, error, reload } = useAsync(async (): Promise<SafeZone[] | null> => {
    if (!familyId) return null;
    const all = await clients.safeZones.list(familyId);
    return all.filter((zone) => zone.recipientEndpointId === recipientEndpointId);
  }, [familyId, recipientEndpointId]);

  const [label, setLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const create = async () => {
    setFormError(null);
    const definition = {
      label,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusMeters: Number(radiusMeters),
      enabled,
    };
    try {
      validateSafeZonePlaintextDefinition(definition);
    } catch {
      setFormError(t('location.safeZoneInvalidDefinition'));
      return;
    }
    if (!familyId) {
      setFormError(t('location.safeZoneSaveFailed'));
      return;
    }
    setSaving(true);
    try {
      const publisher = new VerifiedFamilySafeZonePolicyPublisher(clients.safeZonePolicyAuthoring, clients.safeZones);
      await runFamilyAction('EDIT_CHILD_POLICY', () => publisher.publish(familyId, recipientEndpointId, definition));
      setLabel('');
      setLatitude('');
      setLongitude('');
      setRadiusMeters('');
      setEnabled(true);
      reload();
    } catch (err) {
      setFormError(t(safeZoneErrorMessageKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (zoneId: string) => {
    setRowError(null);
    if (!window.confirm(t('location.safeZoneDeleteConfirm'))) return;
    if (!familyId) {
      setRowError(t('location.safeZoneSaveFailed'));
      return;
    }
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () => clients.safeZones.remove(familyId, zoneId));
      reload();
    } catch (err) {
      setRowError(t(safeZoneErrorMessageKey(err)));
    }
  };

  return (
    <article className="card">
      <h2>{t('location.safeZones')}</h2>
      <p>{t('location.safeZonePrivacy')}</p>
      <p>{t('location.safeZoneBoundaryNotice')}</p>

      <h3>{t('location.safeZoneList')}</h3>
      <p>{t('location.safeZoneContentEncrypted')}</p>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!zones || zones.length === 0) && <p role="status">{t('location.safeZoneEmpty')}</p>}
      {!loading && !error && zones && zones.length > 0 && (
        <ul className="plain-list">
          {zones.map((zone) => (
            <li key={zone.zoneId} className="card">
              <StatusBadge state={zone.deliveryState === 'READY' ? 'ACTIVE' : 'PENDING_DELIVERY'} />
              {' '}
              {zone.deliveryState === 'READY' ? t('location.safeZoneReady') : t('location.safeZonePending')}
              <p>
                {t('location.safeZoneLastUpdated', {
                  value: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(zone.updatedAtUtc),
                  ),
                })}
              </p>
              <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
                <button type="button" className="btn" onClick={() => remove(zone.zoneId)}>
                  {t('common.delete')}
                </button>
              </PermissionGate>
            </li>
          ))}
        </ul>
      )}
      {rowError && (
        <p role="alert" className="field-error">
          {rowError}
        </p>
      )}

      <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
        <h3>{t('location.safeZoneCreate')}</h3>
        <div className="field">
          <label htmlFor="safe-zone-label">{t('location.safeZoneLabel')}</label>
          <input id="safe-zone-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="safe-zone-lat">{t('location.safeZoneLatitude')}</label>
          <input id="safe-zone-lat" type="number" step="any" min={-90} max={90} value={latitude} onChange={(e) => setLatitude(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="safe-zone-lng">{t('location.safeZoneLongitude')}</label>
          <input id="safe-zone-lng" type="number" step="any" min={-180} max={180} value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="safe-zone-radius">{t('location.safeZoneRadius')}</label>
          <input id="safe-zone-radius" type="number" min={1} value={radiusMeters} onChange={(e) => setRadiusMeters(e.target.value)} />
        </div>
        <div className="checkbox-row">
          <input id="safe-zone-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="safe-zone-enabled">{t('location.safeZoneEnabledLabel')}</label>
        </div>
        {formError && (
          <p role="alert" className="field-error">
            {formError}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={create} disabled={saving}>
          {t('location.safeZoneCreate')}
        </button>
      </PermissionGate>
    </article>
  );
}

export default function LocationPage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getLocationStatus(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const lastSeenLabel = data.lastSeenUtc
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastSeenUtc))
    : '--';

  return (
    <>
      <div className="card-grid">
      <article className="card">
        <h2>{t('nav.location')}</h2>
        <StatusBadge state={data.state} />
        <p>
          {t('dashboard.lastSeen')}: <bdi className="iso">{lastSeenLabel}</bdi>
        </p>
        <p>{data.accuracyMeters ? t('location.accuracy', { value: `${data.accuracyMeters}m` }) : t('location.accuracyUnknown')}</p>
        {data.isStale && <p role="status">{t('location.stale')}</p>}
      </article>
      </div>
      <SafeZoneAuthoring childId={childId} />
    </>
  );
}
