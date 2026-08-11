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
