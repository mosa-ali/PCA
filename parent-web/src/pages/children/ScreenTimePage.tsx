import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useIsOnline } from '../../hooks/useIsOnline';
import { usePolicyStatus } from '../../hooks/usePolicyStatus';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PolicyStatusBadge } from '../../components/common/PolicyStatusBadge';
import { DeviceOfflineNotice } from '../../components/common/DeviceOfflineNotice';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { OfflineDraftNotice } from '../../components/common/OfflineDraftNotice';
import type { ScreenTimeStatus } from '../../domain/types';

interface ScreenTimePageData {
  screenTime: ScreenTimeStatus;
  deviceOffline: boolean;
  lastSuccessfulSyncUtc: string | null;
  lastAppliedPolicyRevision: number | null;
  hasPendingPolicyDelivery: boolean;
}

export default function ScreenTimePage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const online = useIsOnline();
  const policyStatus = usePolicyStatus();
  const { data, loading, error, reload } = useAsync<ScreenTimePageData>(async () => {
    const deviceId = `device-${childId}`;
    const [screenTime, dashboard, device, lastSuccessfulSyncUtc, pendingDelivery] = await Promise.all([
      clients.parentFamilyData.getScreenTime(childId),
      clients.parentFamilyData.getDashboard(),
      clients.deviceStatus.getDeviceStatus(deviceId),
      clients.runtimeSync.getLastSuccessfulSync(),
      clients.runtimeSync.getPendingDeliveryStatus(deviceId),
    ]);
    const child = dashboard.children.find((c) => c.childId === childId);
    return {
      screenTime,
      deviceOffline: child?.deviceState === 'OFFLINE',
      lastSuccessfulSyncUtc,
      lastAppliedPolicyRevision: device?.lastAcknowledgedPolicyRevision ?? null,
      hasPendingPolicyDelivery: pendingDelivery.pendingCount > 0,
    };
  }, [childId]);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [breakMin, setBreakMin] = useState<number | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const effectiveLimit = limit ?? data.screenTime.continuousUseLimitMinutes;
  const effectiveBreak = breakMin ?? data.screenTime.breakDurationMinutes;

  const onSave = async () => {
    setSaving(true);
    const wasOffline = !online;
    // Record the honest in-flight state the instant Save is pressed --
    // see ../../domain/policyStatus.ts. There is no real policy-revision
    // number surfaced by ParentFamilyDataGateway.updateScreenTime yet
    // (it returns only an auditEventId), so policyRevision stays null
    // here rather than fabricating one.
    policyStatus.beginSubmit(wasOffline, null);
    if (wasOffline) {
      // Offline policy authoring is gated pending an external security
      // review of the signing/queuing crypto path -- see
      // ../../domain/offlinePolicyAuthoring.ts. The edit stays a
      // LOCAL_DRAFT and the OfflineDraftNotice above already tells the
      // parent it will sync once reconnected; do not attempt a network
      // call here (a fixture client would silently "succeed" even though
      // a real backend could not be reached while offline).
      setSaving(false);
      return;
    }
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () =>
        clients.parentFamilyData.updateScreenTime(childId, {
          continuousUseLimitMinutes: effectiveLimit,
          breakDurationMinutes: effectiveBreak,
        }),
      );
      // Submission was accepted -- this means at most "queued for
      // delivery to the device", never "applied". APPLIED requires a
      // child-device receipt this repository slice does not have yet
      // (see ../../hooks/usePolicyStatus.ts:applyReceipt).
      policyStatus.markQueuedForDelivery();
      reload();
    } catch {
      policyStatus.markFailed('SUBMIT_FAILED');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <OfflineDraftNotice />
      {data.deviceOffline && (
        <DeviceOfflineNotice
          lastSuccessfulSyncUtc={data.lastSuccessfulSyncUtc}
          lastAppliedPolicyRevision={data.lastAppliedPolicyRevision}
          hasPendingPolicyDelivery={data.hasPendingPolicyDelivery || policyStatus.snapshot?.status === 'PENDING_DELIVERY'}
        />
      )}
      <p>
        {t('dashboard.screenTime')}: <StatusBadge state={data.screenTime.state} /> (
        {data.screenTime.continuousUseElapsedMinutes}m /{data.screenTime.continuousUseLimitMinutes}m)
      </p>
      {policyStatus.snapshot && (
        <p>
          {t('policyStatus.label')} <PolicyStatusBadge status={policyStatus.snapshot.status} />
        </p>
      )}
      <div className="field">
        <label htmlFor="limit">Continuous-use limit (minutes)</label>
        <input
          id="limit"
          type="number"
          min={15}
          max={180}
          value={effectiveLimit}
          disabled={!!error}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="break">Break duration (minutes)</label>
        <input
          id="break"
          type="number"
          min={5}
          max={90}
          value={effectiveBreak}
          onChange={(e) => setBreakMin(Number(e.target.value))}
        />
      </div>
      <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </div>
  );
}
