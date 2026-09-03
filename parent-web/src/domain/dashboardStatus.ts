// The single source of truth for "how bad is this state, really".
//
// Every honest-status decision in the parent console reduces to two questions:
//
//   1. which of the seven ramp states does this enum value mean?
//   2. when a card shows several states at once, which one is the headline?
//
// Both used to be answered ad hoc, inline, per component -- four separate
// comparisons on a child card, a different set on the devices table. That is
// how "protection is fine" starts being shown next to a device the console
// cannot currently reach. The order below is written ONCE, exported, and unit
// tested (tests/unit/statusRamp.test.ts).
//
// Two rules in here are honesty controls, not styling:
//
//   * PENDING_DELIVERY and PARTIALLY_APPLIED are `pending`/`limited`. They are
//     deliberately NOT escalated into `attention`. A queued policy change is
//     not an alarm, and inflating it into one is a lie in the other direction.
//   * REQUEST_ONLY is `limited`, never `ok`. It means "we can ask, we cannot
//     block" -- an honest capability boundary, not a lesser-but-still-good
//     outcome. (Mirrors the long-standing note in global.css.)
//
// This module deliberately introduces NO new domain type in ./types.ts: no new
// data exists, so nothing there needs to change. It only classifies values
// that are already on the wire.

import type { CapabilityState, DataFreshnessState, InstallApprovalCapabilityState, ProtectionDisplayState } from './types';
import type { PolicyStatus } from './policyStatus';

/** The seven-state ramp every status colour, icon and label maps onto. */
export type RampState = 'ok' | 'pending' | 'limited' | 'unverified' | 'offline' | 'attention' | 'error';

/** Any enum value `StatusBadge` accepts. */
export type StatusEnum = CapabilityState | ProtectionDisplayState | InstallApprovalCapabilityState;

/**
 * Severity, worst first. `worstOf` walks this array in order, so changing it
 * changes what a card leads with -- it is a product decision, not a detail.
 */
export const RAMP_SEVERITY_ORDER: readonly RampState[] = [
  'error', // REVOKED
  'attention', // NEEDS_ATTENTION, EPOCH_STALE, AUTHORIZATION_REQUIRED
  'offline', // OFFLINE
  'unverified', // UNAVAILABLE, NOT_SUPPORTED, PLATFORM_LIMITED
  'limited', // LIMITED, PARTIALLY_APPLIED, REQUEST_ONLY
  'pending', // PENDING_DELIVERY
  'ok', // ACTIVE, STANDARD, PROTECTED, ENFORCED
] as const;

/** Every value of every status vocabulary the badge renders. No value is dropped or merged. */
const RAMP_BY_STATUS: Readonly<Record<StatusEnum, RampState>> = {
  ACTIVE: 'ok',
  LIMITED: 'limited',
  UNAVAILABLE: 'unverified',
  NEEDS_ATTENTION: 'attention',
  OFFLINE: 'offline',
  PENDING_DELIVERY: 'pending',
  PARTIALLY_APPLIED: 'limited',
  EPOCH_STALE: 'attention',
  REVOKED: 'error',
  STANDARD: 'ok',
  PROTECTED: 'ok',
  AUTHORIZATION_REQUIRED: 'attention',
  NOT_SUPPORTED: 'unverified',
  ENFORCED: 'ok',
  REQUEST_ONLY: 'limited',
  PLATFORM_LIMITED: 'unverified',
};

/** The policy publication lifecycle is a second vocabulary onto the same ramp. */
const RAMP_BY_POLICY_STATUS: Readonly<Record<PolicyStatus, RampState>> = {
  LOCAL_DRAFT: 'offline',
  PENDING_SYNC: 'pending',
  PENDING_DELIVERY: 'pending',
  DELIVERED: 'pending',
  APPLIED: 'ok',
  FAILED: 'error',
  EXPIRED: 'attention',
  STALE: 'attention',
};

/**
 * The ramp state for a capability/protection/install-approval value.
 * Falls back to `unverified` (never `ok`) for a value this build does not
 * know: an unrecognised state is precisely a state we cannot vouch for.
 */
export function rampForStatus(state: StatusEnum | null | undefined): RampState {
  if (!state) return 'unverified';
  return RAMP_BY_STATUS[state] ?? 'unverified';
}

/** The ramp state for a policy publication status. */
export function rampForPolicyStatus(status: PolicyStatus | null | undefined): RampState {
  if (!status) return 'unverified';
  return RAMP_BY_POLICY_STATUS[status] ?? 'unverified';
}

/** Position in `RAMP_SEVERITY_ORDER`; lower is worse. */
export function severityRank(ramp: RampState): number {
  return RAMP_SEVERITY_ORDER.indexOf(ramp);
}

/**
 * The single headline state for a card that shows several at once, e.g.
 * `worstOf(deviceState, protectionCapabilityState, policyDeliveryState)`.
 *
 * Returns the ORIGINAL enum value, not the ramp, so the caller still renders
 * that value's own honest `state.*` label rather than a generic word. Ties
 * keep the first argument, so the caller controls precedence within one
 * severity band. Returns `null` only when given nothing at all.
 */
export function worstOf(...states: readonly (StatusEnum | null | undefined)[]): StatusEnum | null {
  let worst: StatusEnum | null = null;
  let worstRank = Number.POSITIVE_INFINITY;
  for (const state of states) {
    if (!state) continue;
    const rank = severityRank(rampForStatus(state));
    if (rank < worstRank) {
      worst = state;
      worstRank = rank;
    }
  }
  return worst;
}

/**
 * The honesty override, and the mechanical enforcement of "never show
 * protection as ACTIVE if the system cannot verify it".
 *
 * Data freshness is a SEPARATE axis from status -- it says how fresh a number
 * is, not what the number says. But a state read from a cached or unavailable
 * source cannot be presented as verified-good, so a non-LIVE read collapses
 * the headline ramp to `unverified`. A cached read can never render `ok`.
 *
 * The caller pairs this with `dashboard.lastKnownState` so the label reads
 * "Last known: <state>" rather than asserting the state is current.
 */
export function applyFreshness(ramp: RampState, freshness: DataFreshnessState | null | undefined): RampState {
  if (freshness === 'LIVE') return ramp;
  // Already worse than `unverified` (error/attention/offline) stays worse:
  // being unable to verify does not make a REVOKED device less revoked.
  return severityRank(ramp) < severityRank('unverified') ? ramp : 'unverified';
}

/** True when the ramp state is one a parent is expected to act on. */
export function needsParentAttention(ramp: RampState): boolean {
  return ramp === 'attention' || ramp === 'error';
}
