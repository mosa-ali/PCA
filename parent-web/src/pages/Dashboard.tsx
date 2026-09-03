// The parent console's home screen.
//
// WHAT THIS PAGE IS FOR: a parent should understand their family's protection
// in a few seconds. Six KPIs, a small set of visual cards, then one compact
// card per child. It replaced a flat grid of ten-row definition lists per
// child, which asked a parent to read forty status rows and work it out.
//
// THE FIVE RULES THIS FILE EXISTS TO ENFORCE. Every one of them is a product
// guarantee, not a styling preference:
//
//  1. NEVER SHOW PROTECTION AS ACTIVE WHEN THE SYSTEM CANNOT VERIFY IT.
//     Pending, limited, offline, cached and not-verified are first-class
//     states with the same pill weight and height as the good one. There is no
//     `opacity` de-emphasis anywhere in the dashboard's styling.
//
//  2. A KPI WHOSE SOURCE THREW RENDERS AN EM DASH, NEVER `0`. "Needs
//     attention: 0" is read as reassurance; if the read actually failed, that
//     reassurance is fabricated. See components/dashboard/KpiTile.tsx.
//
//  3. FRESHNESS IS APPLIED MECHANICALLY. `dataFreshnessState !== 'LIVE'`
//     downgrades a child's headline pill to `unverified` via `applyFreshness`,
//     and the label becomes "Last known: <state>". A cached read cannot render
//     green, no matter how good the cached value was.
//
//  4. THERE IS NO WEEKLY/HISTORICAL USAGE DATA IN THIS CODEBASE. The weekly
//     trend card ships as an honest unavailable card. No placeholder curve, no
//     series derived from the single elapsed-minutes value, no flat line at
//     zero. See components/dashboard/WeeklyTrendCard.tsx.
//
//  5. A FAIL-CLOSED READ IS NOT AN ERROR. In real (non-fixture) mode
//     `getDashboard()` always throws EndpointNotTrustedError or
//     CryptoReviewRequiredError BY DESIGN. That renders as the action-needed
//     treatment with a real next step, never as "Something went wrong" -- the
//     console must not announce itself as broken at the moment it is working
//     correctly. `AsyncStates` makes that choice; this page does not re-derive
//     it.
//
// Internal vocabulary -- trust epoch, key epoch, policy revision, device id,
// correlation ids -- appears nowhere on this page. It is not deleted: it lives
// on /security/status, in the security log, and behind the devices page's
// technical-details disclosure, which are its correct homes.
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { AsyncStates, EmptyState, LoadingState } from '../components/common/States';
import { KpiRow } from '../components/dashboard/KpiRow';
import { ChildCard } from '../components/dashboard/ChildCard';
import { ScreenTimeCard } from '../components/dashboard/ScreenTimeCard';
import { WeeklyTrendCard } from '../components/dashboard/WeeklyTrendCard';
import { ProtectionOverviewCard } from '../components/dashboard/ProtectionOverviewCard';
import { DeviceHealthCard } from '../components/dashboard/DeviceHealthCard';
import { ActivityCard, ACTIVITY_PREVIEW_LIMIT } from '../components/dashboard/ActivityCard';
import { ScheduleCard } from '../components/dashboard/ScheduleCard';
import { RequestsAlertsCard } from '../components/dashboard/RequestsAlertsCard';
import type { ScreenTimeReading } from '../components/dashboard/dashboardModel';
import type { ActivityTimelineEntry } from '../domain/activityTimeline';

/** Desktop 12-column spans. Below 1200px the grid ignores them entirely. */
function span(columns: number): CSSProperties {
  return { '--span': columns } as CSSProperties;
}

function HonestNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
      <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" strokeLinejoin="round" />
      <path d="m9 11.75 2.25 2.25L15.25 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const clients = getApiClients();

  const dashboard = useAsync(() => clients.parentFamilyData.getDashboard(), []);
  const devices = useAsync(() => clients.deviceStatus.listDeviceStatuses(), []);
  const alerts = useAsync(() => clients.protectionAlertDelivery.list(), []);

  const childSummaries = useMemo(() => dashboard.data?.children ?? [], [dashboard.data]);
  // A primitive dep: the array identity changes on every dashboard render.
  const childIds = childSummaries.map((child) => child.childId).join(',');

  /**
   * Per-child screen time, settled INDEPENDENTLY. `allSettled` is the point:
   * one child whose device has not reported must not blank the other two, and
   * a rejected read becomes an explicit `UNAVAILABLE` reading rather than a
   * zero that would be drawn as an empty bar.
   */
  const screenTimes = useAsync(async () => {
    const ids = childIds ? childIds.split(',') : [];
    const settled = await Promise.allSettled(ids.map((id) => clients.parentFamilyData.getScreenTime(id)));
    const readings = new Map<string, ScreenTimeReading>();
    settled.forEach((result, index) => {
      readings.set(ids[index], result.status === 'fulfilled' ? { status: 'OK', value: result.value } : { status: 'UNAVAILABLE' });
    });
    return readings as ReadonlyMap<string, ScreenTimeReading>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childIds]);

  /**
   * The activity feed is the opposite case, deliberately. `Promise.all` fails
   * the WHOLE card if any child's timeline read fails: a merged "recent family
   * activity" list that silently omits one child reads as complete when it is
   * not, and a parent would take a missing entry as evidence that nothing
   * happened.
   */
  const activity = useAsync(async () => {
    const ids = childIds ? childIds.split(',') : [];
    const lists = await Promise.all(ids.map((id) => clients.parentFamilyData.getActivityTimeline(id, ACTIVITY_PREVIEW_LIMIT)));
    return lists
      .flat()
      .sort((a, b) => new Date(b.timestampUtc).getTime() - new Date(a.timestampUtc).getTime()) as ActivityTimelineEntry[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childIds]);

  const childNames = useMemo(
    () => new Map(childSummaries.map((child) => [child.childId, child.displayName])),
    [childSummaries],
  );

  const familyReadFailed = dashboard.error !== null;

  return (
    <section aria-labelledby="dashboard-title">
      {/* The accessible name "Dashboard" is pinned by e2e and component tests. */}
      <h1 id="dashboard-title">{t('dashboard.title')}</h1>

      {dashboard.loading ? (
        <LoadingState />
      ) : (
        <>
          {/* The KPI row renders even when the family read failed -- as six em
              dashes with "We can't verify this right now". Hiding it would be
              less honest than showing what we do and do not know. */}
          <KpiRow
            childSummaries={familyReadFailed ? null : childSummaries}
            childSummariesFailed={familyReadFailed}
            devices={devices.data}
            devicesFailed={devices.error !== null}
          />

          {familyReadFailed ? (
            // Not "Something went wrong". AsyncStates routes the three
            // fail-closed conditions to the action-needed treatment with a
            // real next step; anything unrecognised stays a genuine error.
            <AsyncStates error={dashboard.error} onRetry={dashboard.reload} />
          ) : childSummaries.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <section className="dashboard-section" aria-labelledby="dashboard-today-title">
                <h2 className="dashboard-section-title" id="dashboard-today-title">
                  {t('dashboard.sections.today')}
                </h2>
                <div className="dashboard-grid">
                  <div style={span(5)}>
                    <ScreenTimeCard childSummaries={childSummaries} readings={screenTimes.data ?? new Map()} loading={screenTimes.loading} />
                  </div>
                  <div style={span(4)}>
                    <ProtectionOverviewCard
                      devices={devices.data}
                      loading={devices.loading}
                      error={devices.error}
                      onRetry={devices.reload}
                    />
                  </div>
                  <div style={span(3)}>
                    <RequestsAlertsCard
                      childSummaries={childSummaries}
                      feed={alerts.data}
                      loading={alerts.loading}
                      error={alerts.error}
                      onRetry={alerts.reload}
                    />
                  </div>
                  <div style={span(6)}>
                    <DeviceHealthCard childSummaries={childSummaries} devices={devices.data} />
                  </div>
                  <div style={span(6)}>
                    <ScheduleCard childSummaries={childSummaries} />
                  </div>
                  <div style={span(8)}>
                    <ActivityCard
                      entries={activity.data}
                      loading={activity.loading}
                      error={activity.error}
                      onRetry={activity.reload}
                      childNames={childNames}
                    />
                  </div>
                  {/* The slot is reserved so wiring a real series later is a
                      data change, not a re-layout. */}
                  <div style={span(4)}>
                    <WeeklyTrendCard />
                  </div>
                </div>
              </section>

              <section className="dashboard-section" aria-labelledby="dashboard-family-title">
                <h2 className="dashboard-section-title" id="dashboard-family-title">
                  {t('dashboard.sections.family')}
                </h2>
                <div className="children-grid">
                  {childSummaries.map((child) => (
                    <ChildCard key={child.childId} child={child} screenTime={screenTimes.data?.get(child.childId)} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}

      {/* The standing honesty note. Its wording is unchanged; it moved from the
          top of the page to the foot because it is policy, not today's news,
          and giving it the first screenful is part of what made this page read
          as a technical document. `role="note"` -- never upgraded to an alert. */}
      <div className="banner banner-neutral" role="note" style={{ marginBlockStart: 'var(--space-6)' }}>
        <span className="banner-icon" aria-hidden="true">
          <HonestNoteIcon />
        </span>
        <div className="banner-body">
          <p className="banner-text">{t('dashboard.honestNote')}</p>
        </div>
      </div>
    </section>
  );
}
