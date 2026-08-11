/**
 * Lane brief Section 13 / doc-equivalent honesty states. A card must never
 * report AVAILABLE merely because its UI exists -- each state names a
 * SPECIFIC reason the feature is or isn't usable right now, so the panel
 * never has to guess or silently assume success.
 */
export type CapabilityState =
  | 'AVAILABLE'
  | 'LIMITED'
  | 'UNAVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'DEVICE_OFFLINE'
  | 'SYNC_STALE'
  | 'MANAGED_DEVICE_REQUIRED'
  | 'EXTERNAL_REVIEW_REQUIRED';

/** doc 18 Section 6's exact navigation list. PCA-10 owns this DOMAIN MODEL only -- each card's data comes from an injected provider backed by the owning lane's feature engine (PCA-3/4/5/6/7/9), never a re-implementation here. */
export type DashboardCardKind =
  | 'FAMILY_DASHBOARD'
  | 'CHILD_OVERVIEW'
  | 'SCREEN_TIME'
  | 'APP_USAGE'
  | 'WEB_FILTERING'
  | 'YOUTUBE'
  | 'LOCATION'
  | 'PRAYER'
  | 'SCHEDULE'
  | 'ALERTS'
  | 'REQUESTS'
  | 'PARENT_MEMBERS'
  | 'PRIVACY_RETENTION'
  | 'SECURITY_RECOVERY'
  | 'SUBSCRIPTION_SETTINGS';

/** doc 18 Section 6: "relevant pending/offline status" -- reuses familyrbac's own delivery-status vocabulary rather than inventing a parallel one, since a card's pending/offline signal IS a ParentAction delivery status in practice. */
export type CardPendingOfflineStatus = 'NONE' | 'PENDING_DELIVERY' | 'DEVICE_OFFLINE' | 'EPOCH_STALE';

/** doc 18 Section 6: "Each card shows capability state, last acknowledged policy revision, and relevant pending/offline status." */
export interface DashboardCard {
  kind: DashboardCardKind;
  capabilityState: CapabilityState;
  lastAcknowledgedPolicyRevision: number | null;
  pendingOrOfflineStatus: CardPendingOfflineStatus;
  /** A short, non-plaintext-activity summary label only -- e.g. "3 alerts", never a URL/location/message excerpt (lane brief Section 14). */
  summaryLabel: string | null;
}

/** The viewer's own scoping, as already resolved by familyrbac's authorization matrix (VIEW_DASHBOARD verdict) -- parentpanel consumes this, it never re-derives RBAC itself. */
export type DashboardViewScope = { kind: 'FULL_FAMILY' } | { kind: 'READ_ONLY_FAMILY' } | { kind: 'OWN_CHILD_ONLY'; childId: string };
