import type { DashboardCardProvider } from './DashboardCardProvider.js';
import type { DashboardCard } from './types.js';
import type { BlockDecisionStateRepository } from '../safebrowser/BlockDecisionStateStore.js';

/**
 * How far back a WEB_FILTERING card's summary looks. Long enough to be a
 * meaningful "recent activity" signal, short enough that a stale in-memory
 * record from long ago never quietly inflates today's count -- see
 * BlockDecisionStateStore.ts's own doc comment: this is device-local,
 * in-memory-only storage today, not a durable history browser.
 */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Bounded query size -- a dashboard card summarizes, it never streams an unbounded decision log. */
const RECENT_QUERY_LIMIT = 500;

/**
 * Adapts BlockDecisionStateService's already-recorded BlockDecisionState
 * data -- SafeBrowserNavigationPolicy's own persisted BLOCK/REVIEW outcomes
 * -- into a WEB_FILTERING DashboardCard (doc 18 Section 6). This provider
 * deliberately reads ONLY the repository: it never calls
 * SafeBrowserNavigationPolicy.evaluateNavigation itself, which is a live
 * per-navigation decision, not a dashboard summary.
 *
 * Privacy discipline (doc 14's visibility matrix / BlockDecisionState's own
 * doc comment): a BlockDecisionState carries the full url/pageTitle/domain/
 * reasonCode, but DashboardCard.summaryLabel's own doc comment is explicit
 * that a card may only ever carry "a short, non-plaintext-activity summary
 * label... never a URL/location/message excerpt" -- so this provider
 * surfaces COUNTS only, never a domain, url, pageTitle, or reason string.
 */
export class WebFilteringDashboardCardProvider implements DashboardCardProvider {
  readonly kind = 'WEB_FILTERING' as const;

  private readonly repository: BlockDecisionStateRepository;
  private readonly now: () => Date;

  constructor(repository: BlockDecisionStateRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async getCard(familyId: string, childId: string | null): Promise<DashboardCard> {
    const recent = await this.repository.listRecentForFamily(familyId, childId, RECENT_QUERY_LIMIT);
    const cutoff = this.now().getTime() - RECENT_WINDOW_MS;
    const withinWindow = recent.filter((state) => state.createdAt.getTime() >= cutoff);

    const blockedCount = withinWindow.filter((state) => state.outcome === 'BLOCK').length;
    const reviewCount = withinWindow.filter((state) => state.outcome === 'REVIEW').length;

    return {
      kind: this.kind,
      capabilityState: 'AVAILABLE',
      lastAcknowledgedPolicyRevision: null,
      pendingOrOfflineStatus: 'NONE',
      summaryLabel: formatSummaryLabel(blockedCount, reviewCount),
    };
  }
}

function formatSummaryLabel(blockedCount: number, reviewCount: number): string {
  const total = blockedCount + reviewCount;
  if (total === 0) return 'No recent site blocks';
  if (reviewCount === 0) return `${blockedCount} recent site block${blockedCount === 1 ? '' : 's'}`;
  return `${total} recent site block${total === 1 ? '' : 's'} (${reviewCount} pending review)`;
}
