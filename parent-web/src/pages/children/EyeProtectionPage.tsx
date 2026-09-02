import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

/**
 * Toggle control: enables/disables the on-device, reminder-only
 * eye-protection prompt for this child -- no dimming, blocking overlay, or
 * forced break, just an on/off preference (see
 * ParentFamilyDataGateway.updateEyeProtection's own doc comment, and
 * backend migrations/0032_eye_protection_settings.sql for the storage
 * side). Same EDIT_CHILD_POLICY-gated toggle pattern AppsPage.tsx already
 * establishes: useFamilyAction() re-checks permission (and any required
 * step-up) before calling the gateway, and PermissionGate hides/disables
 * the control for a role that cannot edit child policy.
 */
export default function EyeProtectionPage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getEyeProtectionStatus(childId), [childId]);
  const { data: timeline } = useAsync(() => clients.parentFamilyData.getActivityTimeline(childId), [childId]);
  const history = (timeline ?? []).filter((entry) => entry.category === 'EYE_PROTECTION');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const toggleReminders = async (remindersEnabled: boolean) => {
    setActionError(null);
    setPending(true);
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () => clients.parentFamilyData.updateEyeProtection(childId, remindersEnabled));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('requestsPage.actionErrorFallback'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.eyeProtection')}</h2>
        <StatusBadge state={data.state} />
        {actionError && <ErrorState message={actionError} />}
        <p>{t('eyeProtection.reminders', { status: data.remindersEnabled ? t('common.enable') : t('common.disable') })}</p>
        <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={data.remindersEnabled}
              disabled={pending}
              onChange={(e) => toggleReminders(e.target.checked)}
              aria-label={t('eyeProtection.toggleLabel')}
            />
            {t('eyeProtection.toggleLabel')}
          </label>
        </PermissionGate>
        <p>
          {data.lastReminderUtc
            ? t('eyeProtection.lastReminder', { time: new Date(data.lastReminderUtc).toLocaleString(i18n.language) })
            : t('eyeProtection.noReminderYet')}
        </p>
      </article>
      <article className="card">
        <h2>{t('eyeProtection.historyTitle')}</h2>
        {history.length === 0 ? (
          <EmptyState message={t('eyeProtection.historyEmpty')} />
        ) : (
          <ol className="plain-list">
            {history.map((entry) => (
              <li key={entry.entryId}>
                {entry.summary}{' '}
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(entry.timestampUtc).toLocaleString(i18n.language)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </article>
    </div>
  );
}
