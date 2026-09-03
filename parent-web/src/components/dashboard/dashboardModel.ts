// Pure derivation shared by the dashboard's cards. No JSX, no fetching.
//
// It lives beside the components rather than in src/domain/ because it
// introduces no new domain data -- every function here only re-reads values
// that are already on the wire (src/domain/types.ts) and classifies them
// through the shared ramp in src/domain/dashboardStatus.ts. Keeping it in one
// non-component module is also what lets each *.tsx in this folder export
// components and nothing else.
import type { ChildSummary, DataFreshnessState, ScreenTimeStatus } from '../../domain/types';
import { applyFreshness, needsParentAttention, rampForStatus, worstOf, type RampState, type StatusEnum } from '../../domain/dashboardStatus';

/**
 * Where "Important alerts" leads. The standalone Alerts page in the new
 * information architecture (design spec Sections 4.2 / 5.3); alerts used to be
 * reachable only from inside /security/status.
 */
export const ALERTS_ROUTE = '/safety/alerts';
export const REQUESTS_ROUTE = '/requests';

/**
 * A per-child screen-time read that either produced a number or honestly did
 * not. There is no third "assume zero" case on purpose: a zero-length bar is a
 * measurement claim, and we do not have one to make.
 */
export type ScreenTimeReading =
  | { status: 'OK'; value: ScreenTimeStatus }
  | { status: 'UNAVAILABLE' };

/** True when any of a child's three headline states is one a parent must act on. */
export function childNeedsAttention(child: ChildSummary): boolean {
  return [child.deviceState, child.protectionCapabilityState, child.policyDeliveryState]
    .map(rampForStatus)
    .some(needsParentAttention);
}

/**
 * The worst freshness across several records. `UNAVAILABLE` beats `CACHED`
 * beats `LIVE`: an aggregate is only as verified as its least verified
 * contributor, so a KPI counting three children where one is cached is a
 * cached KPI.
 */
export function worstFreshness(states: readonly DataFreshnessState[]): DataFreshnessState {
  if (states.some((state) => state === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (states.some((state) => state === 'CACHED')) return 'CACHED';
  return 'LIVE';
}

export interface ChildHeadline {
  /** The worst of the three states -- kept as the ORIGINAL enum so its own honest label is used. */
  state: StatusEnum;
  /** The ramp the pill is painted with, AFTER the freshness override. */
  ramp: RampState;
  /**
   * True when freshness, not status, decided the ramp. The pill then reads
   * "Last known: <state>" instead of asserting the state is current.
   */
  downgradedByFreshness: boolean;
}

/**
 * THE MECHANICAL ENFORCEMENT OF "never show protection as ACTIVE when the
 * system cannot verify it".
 *
 * One pill leads the child card. It is the worst of device / protection /
 * policy-delivery, and then a non-LIVE read collapses it to `unverified`. A
 * cached read can therefore never render green, no matter how good the cached
 * value was -- which is the whole point.
 *
 * A state that is ALREADY worse than `unverified` (revoked, needs attention,
 * offline) survives untouched: being unable to verify does not make a revoked
 * device less revoked.
 */
export function childHeadline(child: ChildSummary): ChildHeadline {
  const state = worstOf(child.deviceState, child.protectionCapabilityState, child.policyDeliveryState) ?? child.deviceState;
  const base = rampForStatus(state);
  const ramp = applyFreshness(base, child.dataFreshnessState);
  return { state, ramp, downgradedByFreshness: ramp !== base };
}

/**
 * The screen-time numbers we are actually entitled to show, or `null`.
 *
 * TWO gates, and the second one is the subtle one. A read can SUCCEED and
 * still carry `state: 'UNAVAILABLE'` / `NOT_SUPPORTED` / `PLATFORM_LIMITED` --
 * that is the device honestly saying "I am not measuring this right now", and
 * the elapsed/limit numbers that come with it are last-known at best. Drawing
 * a bar from them would present a stale or meaningless figure as today's
 * usage, which is exactly the failure a resolved promise makes easy to miss.
 *
 * (The dev fixtures do exactly this for the offline child: the read resolves
 * with `state: 'UNAVAILABLE'` and a stale minute count.)
 */
export function usableScreenTime(reading: ScreenTimeReading | undefined): ScreenTimeStatus | null {
  if (!reading || reading.status !== 'OK') return null;
  return rampForStatus(reading.value.state) === 'unverified' ? null : reading.value;
}

/**
 * The 0..1 share of the allowance used, or `null` when there is no usable
 * reading. `null` means "draw no bar", never "draw an empty bar".
 */
export function screenTimeFraction(reading: ScreenTimeReading | undefined): number | null {
  const value = usableScreenTime(reading);
  if (!value) return null;
  const { continuousUseElapsedMinutes: used, continuousUseLimitMinutes: limit } = value;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(1, Math.max(0, used / limit));
}

/** The ramp colour token for a bar/segment, so a chart segment and its pill match. */
export function rampColorToken(ramp: RampState): string {
  return `var(--status-${ramp}-fg)`;
}

/**
 * A screen-time bar is coloured by how close the child is to the limit, not by
 * a capability enum: `attention` once the allowance is spent, `limited` in the
 * last fifth, `ok` otherwise.
 */
export function screenTimeRamp(fraction: number): RampState {
  if (fraction >= 1) return 'attention';
  if (fraction >= 0.8) return 'limited';
  return 'ok';
}
