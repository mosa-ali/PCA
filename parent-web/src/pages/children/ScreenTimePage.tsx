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
import {
  BREAK_DURATION_MAX_MINUTES,
  BREAK_DURATION_MIN_MINUTES,
  CONTINUOUS_USE_LIMIT_MAX_MINUTES,
  CONTINUOUS_USE_LIMIT_MIN_MINUTES,
  describeScreenTimePolicyError,
  isBaselineCompliantScreenTimePolicy,
  validateScreenTimePolicy,
} from '../../domain/screenTimePolicy';
import { DEFAULT_NIGHT_PROTECTION } from '../../domain/nightProtection';

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
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const effectiveLimit = limit ?? data.screenTime.continuousUseLimitMinutes;
  const effectiveBreak = breakMin ?? data.screenTime.breakDurationMinutes;
  // PCA-SCREEN-BASELINE-1: a policy loaded from storage may predate the 60/30 baseline (e.g.
  // legacy/demo fixture data authored before this rule existed). It is surfaced honestly here --
  // never silently treated as compliant -- but is not mutated in place; the parent must
  // explicitly strengthen and re-save it, at which point the same validator below applies.
  const loadedPolicyPredatesBaseline = !isBaselineCompliantScreenTimePolicy({
    continuousUseLimitMinutes: data.screenTime.continuousUseLimitMinutes,
    breakDurationMinutes: data.screenTime.breakDurationMinutes,
  });

  const onSave = async () => {
    // PCA-SCREEN-BASELINE-1: real validation, run on the actual submission path -- never rely on
    // the <input min/max> attributes alone, since those are trivially bypassable.
    const result = validateScreenTimePolicy({
      continuousUseLimitMinutes: effectiveLimit,
      breakDurationMinutes: effectiveBreak,
    });
    if (!result.valid) {
      setValidationErrors(result.errors.map(describeScreenTimePolicyError));
      return;
    }
    setValidationErrors([]);
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
      <section aria-labelledby="night-protection-title" className="field">
        <h2 id="night-protection-title">{t('screenTime.nightProtection')}</h2>
        <p>{t('screenTime.nightProtectionWindow', DEFAULT_NIGHT_PROTECTION)}</p>
        <p>{t('screenTime.nightProtectionCommunication')}</p>
      </section>
      {policyStatus.snapshot && (
        <p>
          {t('policyStatus.label')} <PolicyStatusBadge status={policyStatus.snapshot.status} />
        </p>
      )}
      {loadedPolicyPredatesBaseline && (
        <p role="alert" className="field-warning">
          {t('screenTime.baselineWarning')}
        </p>
      )}
      <div className="field">
        <label htmlFor="limit">{t('screenTime.continuousLimit')}</label>
        <input
          id="limit"
          type="number"
          min={CONTINUOUS_USE_LIMIT_MIN_MINUTES}
          max={CONTINUOUS_USE_LIMIT_MAX_MINUTES}
          value={effectiveLimit}
          disabled={!!error}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="break">{t('screenTime.breakDuration')}</label>
        <input
          id="break"
          type="number"
          min={BREAK_DURATION_MIN_MINUTES}
          max={BREAK_DURATION_MAX_MINUTES}
          value={effectiveBreak}
          onChange={(e) => setBreakMin(Number(e.target.value))}
        />
      </div>
      {validationErrors.length > 0 && (
        <p role="alert" className="field-error">
          {validationErrors.map((message) => (
            <span key={message} style={{ display: 'block' }}>
              {message}
            </span>
          ))}
        </p>
      )}
      <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </div>
  );
}
