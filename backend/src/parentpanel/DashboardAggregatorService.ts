import type { DashboardCardProvider } from './DashboardCardProvider.js';
import type { DashboardCard, DashboardCardKind, DashboardViewScope } from './types.js';

/** doc 18 Section 2: a Child has "own transparency only" -- these are the card kinds a CHILD-scoped view may ever include; parent-administrative surfaces are never assembled for that scope at all, not merely hidden client-side. */
const CHILD_VISIBLE_CARD_KINDS: ReadonlySet<DashboardCardKind> = new Set([
  'CHILD_OVERVIEW',
  'SCREEN_TIME',
  'APP_USAGE',
  'WEB_FILTERING',
  'YOUTUBE',
  'PRAYER',
  'SCHEDULE',
  'ALERTS',
  'REQUESTS',
]);

/**
 * Aggregates registered DashboardCardProvider results into one dashboard.
 * Two safety properties this class alone is responsible for: (1) a
 * provider that throws or otherwise fails NEVER takes down the whole
 * dashboard -- it becomes a single UNAVAILABLE card, fault-isolated from
 * every other card; (2) for an OWN_CHILD_ONLY scope, parent-administrative
 * card kinds (PARENT_MEMBERS/PRIVACY_RETENTION/SECURITY_RECOVERY/
 * SUBSCRIPTION_SETTINGS/FAMILY_DASHBOARD/LOCATION) are never even
 * requested from their providers, matching doc 18's "own transparency
 * only" -- this is an allow-list of what IS assembled, not a client-side
 * filter applied after the fact.
 *
 * WHAT "THE DASHBOARD" ACTUALLY CONTAINS, stated because it is not what a
 * reader of doc 18 Section 6's 15-kind navigation list would assume: the
 * visible set is derived FROM the registered providers (`resolveVisibleKinds`
 * returns `this.providers.keys()`), not from the declared card kinds. So a
 * capability whose lane has no provider wired is ABSENT from the dashboard
 * entirely -- no tile, no card, and nothing saying so. A parent therefore
 * cannot distinguish "this capability is unavailable" from "this capability is
 * not part of this build", which is the same silent-absence-vs-honest-
 * unavailability distinction WebFilteringDashboardCardProvider was already
 * fixed to respect. IT IS NOT FIXED HERE, deliberately: emitting a card for
 * every declared kind would add 13 new UNAVAILABLE tiles to the parent
 * dashboard, which is a product/UX decision rather than an implementation
 * tidy-up. Recorded as PCA-DEC-029, and pinned by an explicit test so the
 * behaviour cannot be mistaken for the honest-unavailable one.
 *
 * Consequently the `provider === undefined` branch in getDashboard is
 * UNREACHABLE in this design: kinds are enumerated from the provider map, so a
 * kind is only ever requested when its provider exists. It is kept as the
 * correct behaviour for a future declared-kind design -- but no test may claim
 * to cover it, which is why the test that claimed to was rewritten.
 */
export class DashboardAggregatorService {
  private readonly providers: ReadonlyMap<DashboardCardKind, DashboardCardProvider>;

  constructor(providers: readonly DashboardCardProvider[]) {
    this.providers = new Map(providers.map((p) => [p.kind, p]));
  }

  async getDashboard(familyId: string, scope: DashboardViewScope): Promise<DashboardCard[]> {
    const kinds = this.resolveVisibleKinds(scope);
    const childId = scope.kind === 'OWN_CHILD_ONLY' ? scope.childId : null;

    const cards = await Promise.all(
      kinds.map(async (kind) => {
        const provider = this.providers.get(kind);
        // Unreachable while kinds are enumerated from the provider map (see this
        // class's doc comment); correct behaviour for a declared-kind design.
        if (provider === undefined) return this.unavailableCard(kind);
        try {
          return await provider.getCard(familyId, childId);
        } catch {
          return this.unavailableCard(kind);
        }
      }),
    );
    return cards;
  }

  private resolveVisibleKinds(scope: DashboardViewScope): DashboardCardKind[] {
    const allKinds = [...this.providers.keys()];
    if (scope.kind !== 'OWN_CHILD_ONLY') return allKinds;
    return allKinds.filter((kind) => CHILD_VISIBLE_CARD_KINDS.has(kind));
  }

  private unavailableCard(kind: DashboardCardKind): DashboardCard {
    return {
      kind,
      capabilityState: 'UNAVAILABLE',
      lastAcknowledgedPolicyRevision: null,
      pendingOrOfflineStatus: 'NONE',
      summaryLabel: null,
    };
  }
}
