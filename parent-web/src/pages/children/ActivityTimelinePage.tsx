// PCA-FR-092: consolidated, chronological, category-level activity
// timeline for one child -- distinct from security/Audit.tsx, which is a
// policy-CHANGE audit log only (who changed what setting), not activity
// content. Composed entirely from the same decrypted client-side family-
// data path every other child page already reads through
// (clients.parentFamilyData); see ../../domain/activityTimeline.ts's file
// header for exactly what this is (and deliberately is not -- no new
// backend endpoint, no raw URL/precise-location/message content).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import type { ActivityTimelineCategory } from '../../domain/activityTimeline';

const CATEGORY_ICON: Record<ActivityTimelineCategory, string> = {
  APP_USAGE: '📱',
  WEB_BROWSING: '🌐',
  CONTENT_BLOCK: '⛔',
  LOCATION: '📍',
  BREAK_SESSION: '⏸️',
  EYE_PROTECTION: '👁️',
  PRAYER_REMINDER: '🕌',
};

const CATEGORIES: ActivityTimelineCategory[] = [
  'APP_USAGE', 'WEB_BROWSING', 'CONTENT_BLOCK', 'LOCATION', 'BREAK_SESSION', 'EYE_PROTECTION', 'PRAYER_REMINDER',
];

const PAGE_SIZE = 10;

/**
 * This whole timeline is fetched as one already-decrypted array (see file
 * header) -- there is no backend to page against. Filter/pagination here
 * are therefore genuinely client-side slicing over data already in hand,
 * not a server query, unlike Platform Admin's list pages.
 */
export default function ActivityTimelinePage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();

  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getActivityTimeline(childId), [childId]);
  const [categoryFilter, setCategoryFilter] = useState<ActivityTimelineCategory | ''>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!data) return [];
    return categoryFilter ? data.filter((entry) => entry.category === categoryFilter) : data;
  }, [data, categoryFilter]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <section aria-labelledby="activity-timeline-title">
      <h1 id="activity-timeline-title">{t('activityTimeline.title')}</h1>
      <p>{t('activityTimeline.description')}</p>

      {!loading && !error && data && data.length > 0 && (
        <div className="field" style={{ maxWidth: '20rem' }}>
          <label htmlFor="activity-category-filter">{t('activityTimeline.filterLabel')}</label>
          <select
            id="activity-category-filter"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value as ActivityTimelineCategory | '');
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="">{t('activityTimeline.filterAll')}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`activityTimeline.category.${category}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && data && data.length === 0 && <EmptyState message={t('activityTimeline.empty')} />}
      {!loading && !error && data && data.length > 0 && filtered.length === 0 && <EmptyState message={t('activityTimeline.emptyForFilter')} />}

      {!loading && !error && filtered.length > 0 && (
        <>
          <ol className="plain-list" aria-label={t('activityTimeline.title')}>
            {visible.map((entry) => (
              <li key={entry.entryId} className="card" style={{ marginBlockEnd: '0.5rem' }}>
                <span aria-hidden="true">{CATEGORY_ICON[entry.category]}</span>{' '}
                <strong>{t(`activityTimeline.category.${entry.category}`)}</strong>
                <div>{entry.summary}</div>
                <div style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(entry.timestampUtc).toLocaleString(i18n.language)}
                  {entry.detail && ` · ${entry.detail}`}
                </div>
              </li>
            ))}
          </ol>
          {visibleCount < filtered.length && (
            <button type="button" className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              {t('activityTimeline.showMore', { count: filtered.length - visibleCount })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
