import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

/**
 * Toggle control note (P2 finding): ParentFamilyDataGateway has no
 * updateEyeProtection-shaped method anywhere (real or dev) -- unlike
 * screen-time/apps, this is not a hidden-but-real wire contract waiting
 * to be wired (no SchedulePolicyPlaintextDefinition variant, no Android
 * contract found for it). Adding a real toggle would mean designing a new
 * write capability (interface method + backend route + device-side
 * contract), which is a genuine new-feature scope decision, not a P2
 * wiring fix -- left NOT_STARTED, not forced. This page still surfaces
 * everything the read model already provides: lastReminderUtc (defined on
 * the type but previously unrendered) and the real EYE_PROTECTION
 * activity-timeline entries (the same real category ActivityTimelinePage
 * already renders) as this page's own history section.
 */
export default function EyeProtectionPage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getEyeProtectionStatus(childId), [childId]);
  const { data: timeline } = useAsync(() => clients.parentFamilyData.getActivityTimeline(childId), [childId]);
  const history = (timeline ?? []).filter((entry) => entry.category === 'EYE_PROTECTION');

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.eyeProtection')}</h2>
        <StatusBadge state={data.state} />
        <p>{t('eyeProtection.reminders', { status: data.remindersEnabled ? t('common.enable') : t('common.disable') })}</p>
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
