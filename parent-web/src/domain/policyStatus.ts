// Policy publication lifecycle -- models the fact that a parent clicking
// "Save" on a child policy edit is NOT the same event as that policy being
// in force on the child's device. A published policy is only ever
// DELIVERED once the runtime sync layer (see ../api/runtimeSyncClient.ts)
// has handed the signed/encrypted envelope to the child endpoint, and only
// APPLIED once the child device has sent back a receipt proving it
// actually applied that policy revision. The UI must never render APPLIED
// on the strength of the parent's own "Save" action alone
// (docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5,
// docs/architecture/18_PARENT_CONTROL_PANEL_RBAC.md Section 1: UI state is
// not the security or truth boundary).
//
// Mirrors the style of ./trustedBrowser.ts: explicit allowed-transitions
// table + canTransition helper, no implicit/ad-hoc status strings anywhere
// else in the app.

export type PolicyStatus =
  | 'LOCAL_DRAFT'
  | 'PENDING_SYNC'
  | 'PENDING_DELIVERY'
  | 'DELIVERED'
  | 'APPLIED'
  | 'FAILED'
  | 'EXPIRED'
  | 'STALE';

export interface PolicyStatusSnapshot {
  status: PolicyStatus;
  policyRevision: number | null;
  /** Revision id the child device has actually acknowledged applying, if any. */
  lastAppliedRevision: number | null;
  updatedAtUtc: string;
  /** Present only for FAILED -- a short, non-sensitive reason category, never raw error text with family content. */
  failureReason: string | null;
}

const ALLOWED_TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  // A parent edit made in the UI but not yet handed to the sync layer
  // (e.g. authored while offline -- see PARENT_OFFLINE_POLICY_SIGNING).
  LOCAL_DRAFT: ['PENDING_SYNC'],
  // Handed to the runtime sync client; waiting for it to accept/queue the
  // envelope for the target device.
  PENDING_SYNC: ['PENDING_DELIVERY', 'FAILED', 'LOCAL_DRAFT'],
  // Queued for delivery to the child device (device may be offline).
  PENDING_DELIVERY: ['DELIVERED', 'FAILED', 'EXPIRED'],
  // Device has fetched/received the envelope but has not yet confirmed
  // that it applied it.
  DELIVERED: ['APPLIED', 'FAILED', 'STALE'],
  // Device confirmed application via a receipt. Can still go STALE if a
  // newer revision has since been queued/authored, so the UI never implies
  // this specific revision is still the "current" one once superseded.
  APPLIED: ['STALE'],
  FAILED: ['PENDING_SYNC', 'LOCAL_DRAFT'],
  EXPIRED: ['PENDING_SYNC', 'LOCAL_DRAFT'],
  // A previously DELIVERED/APPLIED revision that is no longer known-fresh
  // (device has gone quiet past a staleness threshold, or trust epoch went
  // stale) -- can recover once a fresh delivery/application is confirmed.
  STALE: ['APPLIED', 'PENDING_DELIVERY'],
};

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True for any status the UI must never render as "protection is currently guaranteed active for this revision". */
export function isUnconfirmedStatus(status: PolicyStatus): boolean {
  return status !== 'APPLIED';
}

/**
 * A published (non-draft) policy edit must never render as APPLIED purely
 * because the parent submitted it -- this returns the honest initial status
 * a freshly-submitted-for-sync edit should carry.
 */
export function initialStatusAfterSubmit(wasOffline: boolean): PolicyStatus {
  return wasOffline ? 'LOCAL_DRAFT' : 'PENDING_SYNC';
}

/**
 * Seam for a future child-application receipt (Agent 16's backend relay is
 * not landed in this repository slice -- see ../api/runtimeSyncClient.ts).
 * No caller in this codebase invokes this today; it exists so a later
 * integration can flip a snapshot to APPLIED without inventing a second
 * status model or bypassing the transition table above. Given a current
 * snapshot and a receipt confirming a specific revision was applied
 * on-device, returns the updated snapshot -- APPLIED only when the
 * receipt's revision matches the snapshot's policyRevision AND the
 * transition is legal from the snapshot's current status; otherwise the
 * snapshot is returned unchanged (never optimistically applied).
 */
export function applyChildApplicationReceipt(
  snapshot: PolicyStatusSnapshot,
  receipt: { appliedRevision: number; acknowledgedAtUtc: string },
): PolicyStatusSnapshot {
  if (snapshot.policyRevision === null || snapshot.policyRevision !== receipt.appliedRevision) return snapshot;
  if (!canTransition(snapshot.status, 'APPLIED')) return snapshot;
  return {
    ...snapshot,
    status: 'APPLIED',
    lastAppliedRevision: receipt.appliedRevision,
    updatedAtUtc: receipt.acknowledgedAtUtc,
  };
}
