// V5 -- Recent activity.
//
// PRIVACY BOUNDARY, and it is a hard one. Only `entry.summary` and the coarse
// `entry.detail` bucket are rendered. Never a URL, never a coordinate, never a
// message excerpt -- see src/domain/activityTimeline.ts's header and
// docs/architecture/26. The timeline type is already category-level by
// contract; this card must not widen it, and must not add a field of its own.
//
// COMPLETENESS. If any child's timeline read fails, the whole card shows the
// action-needed treatment. A merged "recent activity" list that silently drops
// one child reads as complete when it is not, and a parent would take the
// absence of an entry as evidence that nothing happened.
import { useTranslation } from 'react-i18next';
import type { ActivityTimelineEntry } from '../../domain/activityTimeline';
import { AsyncStates } from '../common/States';
import { formatRelative } from '../../i18n/formatters';

/** Enough to be a glance, not a log. The full log lives at /children/:childId/activity. */
export const ACTIVITY_PREVIEW_LIMIT = 8;

export interface ActivityCardProps {
  /** Already merged across children and sorted most-recent-first, or null. */
  entries: ActivityTimelineEntry[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** childId -> display name, for attributing an entry without exposing the id. */
  childNames: ReadonlyMap<string, string>;
}

export function ActivityCard({ entries, loading, error, onRetry, childNames }: ActivityCardProps) {
  const { t, i18n } = useTranslation();
  const shown = entries?.slice(0, ACTIVITY_PREVIEW_LIMIT) ?? [];

  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{t('dashboard.recentActivity')}</h3>
      </div>
      <div className="card-body">
        <AsyncStates loading={loading} error={error} empty={entries !== null && shown.length === 0} onRetry={onRetry}>
          <ul className="plain-list">
            {shown.map((entry) => (
              <li key={entry.entryId} className="child-metric">
                <span className="child-metric-value">
                  <bdi className="iso">{entry.summary}</bdi>
                </span>
                <span className="text-muted">
                  <bdi className="iso">{childNames.get(entry.childId) ?? ''}</bdi>{' '}
                  <bdi className="iso">{formatRelative(entry.timestampUtc, i18n.language)}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </AsyncStates>
      </div>
    </article>
  );
}
