import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import type { SafeZone } from '../../api/interfaces';

function SafeZoneAuthoring({ childId }: { childId: string }) {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data: session } = useAsync(() => clients.serviceAuth.getSession(), []);
  const { data: zones, loading, error, reload } = useAsync(() => session?.familyId ? clients.safeZones.list(session.familyId) : Promise.resolve([]), [session?.familyId]);
  const [label, setLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('100');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const childZones = (zones ?? []).filter((zone) => zone.childProfileId === childId);
  const createZone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.familyId) return;
    setSaving(true);
    setActionError(null);
    try {
      await clients.safeZones.create(session.familyId, { childProfileId: childId, label: label.trim(), latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radiusMeters), enabled: true });
      setLabel('');
      setLatitude('');
      setLongitude('');
      setRadiusMeters('100');
      reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('location.safeZoneSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (zone: SafeZone, enabled: boolean) => {
    if (!session?.familyId) return;
    setSaving(true);
    setActionError(null);
    try {
      await clients.safeZones.update(session.familyId, zone.zoneId, { enabled });
      reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('location.safeZoneSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (zone: SafeZone) => {
    if (!session?.familyId || !window.confirm(t('location.safeZoneDeleteConfirm'))) return;
    setSaving(true);
    setActionError(null);
    try {
      await clients.safeZones.remove(session.familyId, zone.zoneId);
      reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('location.safeZoneSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="card">
      <h2>{t('location.safeZones')}</h2>
      <p>{t('location.safeZonePrivacy')}</p>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {actionError && <p role="alert">{actionError}</p>}
      {!loading && childZones.length === 0 && <p>{t('location.safeZoneEmpty')}</p>}
      {childZones.length > 0 && <ul className="plain-list">{childZones.map((zone) => <li key={zone.zoneId}>
        <strong>{zone.label}</strong>{' '}
        <span>{zone.radiusMeters}m</span>{' '}
        <span>{zone.deliveryState === 'PENDING_OFFLINE' ? t('location.safeZonePending') : t('location.safeZoneReady')}</span>{' '}
        <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void setEnabled(zone, !zone.enabled)}>{zone.enabled ? t('location.safeZoneDisable') : t('location.safeZoneEnable')}</button>{' '}
        <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void remove(zone)}>{t('common.delete')}</button>
      </li>)}</ul>}
      <form onSubmit={(event) => void createZone(event)}>
        <div className="field"><label htmlFor="safe-zone-label">{t('location.safeZoneLabel')}</label><input id="safe-zone-label" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} /></div>
        <div className="field"><label htmlFor="safe-zone-latitude">{t('location.safeZoneLatitude')}</label><input id="safe-zone-latitude" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></div>
        <div className="field"><label htmlFor="safe-zone-longitude">{t('location.safeZoneLongitude')}</label><input id="safe-zone-longitude" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></div>
        <div className="field"><label htmlFor="safe-zone-radius">{t('location.safeZoneRadius')}</label><input id="safe-zone-radius" type="number" min="50" max="100000" value={radiusMeters} onChange={(event) => setRadiusMeters(event.target.value)} required /></div>
        <button type="submit" className="btn" disabled={saving || !session?.familyId}>{t('location.safeZoneCreate')}</button>
      </form>
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
