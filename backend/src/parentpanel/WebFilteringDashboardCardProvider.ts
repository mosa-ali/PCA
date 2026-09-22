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
 * Whether the injected repository is a COMPLETE source for this family's block
 * history. The provider cannot determine this for itself and must not guess.
 *
 * Why this is a required constructor argument rather than a default: the
 * previous version assumed completeness unconditionally and reported
 * `capabilityState: 'AVAILABLE'` with the summary "No recent site blocks" for
 * any family it had nothing for. In production nothing ever wrote to the store
 * at all (SafeBrowserNavigationPolicy's recording surface is not wired to a
 * route), so that card told every parent, every time, that their family had no
 * recent site blocks -- a confident factual claim about a child's browsing,
 * derived from an empty in-memory map, and therefore indistinguishable from the
 * truth. dashboard/types.ts states the rule this violated: "A card must never
 * report AVAILABLE merely because its UI exists."
 *
 * `INCOMPLETE_EPHEMERAL` is the honest value for `InMemoryBlockDecisionStateRepository`,
 * which is device-local by contract (BlockDecisionStateStore.ts: full URL/title
 * never leaves the child/parent devices; no MySQL repository is provided
 * precisely so readable browsing history is never centralized server-side).
 * Making that a REQUIRED argument means a future caller that wires a genuinely
 * complete source must say so, and cannot inherit availability by accident.
 */
export type BlockHistoryCompleteness = 'COMPLETE' | 'INCOMPLETE_EPHEMERAL';

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
  private readonly completeness: BlockHistoryCompleteness;
  private readonly now: () => Date;

  constructor(repository: BlockDecisionStateRepository, completeness: BlockHistoryCompleteness, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.completeness = completeness;
    this.now = now;
  }

  async getCard(familyId: string, childId: string | null): Promise<DashboardCard> {
    // An ephemeral source cannot support ANY factual claim about block history,
    // so this returns before reading it. Reading it anyway and reporting its
    // (always-empty) count is the defect this branch removes: a number drawn
    // from a source already known to be incomplete is exactly the
    // confident-looking result the UNAVAILABLE state exists to prevent. A zero
    // and an unknown must not render the same way.
    if (this.completeness === 'INCOMPLETE_EPHEMERAL') {
      return {
        kind: this.kind,
        capabilityState: 'UNAVAILABLE',
        lastAcknowledgedPolicyRevision: null,
        pendingOrOfflineStatus: 'NONE',
        summaryLabel: 'Site block history unavailable',
      };
    }

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
