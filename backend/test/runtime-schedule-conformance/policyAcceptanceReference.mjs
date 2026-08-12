/**
 * TS-side reference implementation of the schedule-runtime policy-acceptance gate
 * (contracts/schedule-runtime/SchedulePolicyV1.md "Policy-acceptance state machine").
 *
 * Deliberately NOT part of backend/src/schedule -- that package is read-only reference for this
 * mission (PCA-RUNTIME-SCHEDULE-1 owns contracts/schedule-runtime/**, android runtime/schedule,
 * and backend/test/runtime-schedule-conformance only). This module exists purely so the shared
 * vectors in contracts/schedule-runtime/vectors/policy-acceptance-v1.json have a TS-side
 * conformance check alongside the Kotlin production implementation
 * (android/.../runtime/schedule/SchedulePolicyValidator.kt), which mirrors this file's logic
 * field-for-field. There is no pre-existing TS production version of this state machine to
 * defer to -- both language implementations are new for this mission and must stay in lock-step
 * via the same vector file, per mission section 16 ("no second authority").
 */

export const ScheduleRuntimeState = Object.freeze({
  CURRENT: 'CURRENT',
  STALE_REMOTE: 'STALE_REMOTE',
  INVALID: 'INVALID',
  EPOCH_STALE: 'EPOCH_STALE',
  NO_ACCEPTED_POLICY: 'NO_ACCEPTED_POLICY',
});

const VALID_WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

function isValidTimeOfDay(tod) {
  return (
    Number.isInteger(tod?.hour) && tod.hour >= 0 && tod.hour <= 23 &&
    Number.isInteger(tod?.minute) && tod.minute >= 0 && tod.minute <= 59
  );
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Mirrors backend/src/schedule/policy.ts's validateScheduleWindow structural checks. */
function isStructurallyValidWindow(window) {
  if (!isValidTimeOfDay(window.start) || !isValidTimeOfDay(window.end)) return false;
  if (!Array.isArray(window.daysOfWeek) || window.daysOfWeek.length === 0) return false;
  if (!window.daysOfWeek.every((day) => VALID_WEEKDAYS.has(day))) return false;
  if (!isValidTimezone(window.timezone)) return false;
  return true;
}

function isStructurallyValidPolicy(policy) {
  if (!policy) return false;
  if (!Number.isInteger(policy.policyRevision) || policy.policyRevision <= 0) return false;
  if (!Array.isArray(policy.windows)) return false;
  return policy.windows.every(isStructurallyValidWindow);
}

function isExpired(policy, nowUtc) {
  return policy.expiresAt != null && nowUtc.getTime() >= new Date(policy.expiresAt).getTime();
}

function isEpochBehind(policy, deviceTrustSetEpoch, deviceKeyEpoch) {
  return policy.trustSetEpoch < deviceTrustSetEpoch || policy.keyEpoch < deviceKeyEpoch;
}

/**
 * @param {{
 *   candidatePolicy: object|null,
 *   lastKnownGoodPolicy: object|null,
 *   nowUtc: Date,
 *   deviceTrustSetEpoch: number,
 *   deviceKeyEpoch: number,
 *   connectivity: 'ONLINE'|'OFFLINE',
 *   lastPolicySyncAtUtc: Date|null,
 *   remoteStalenessThresholdMillis: number,
 * }} input
 * @returns {{ state: string, effectivePolicy: object|null }}
 */
export function evaluatePolicyAcceptance(input) {
  const { candidatePolicy, lastKnownGoodPolicy, nowUtc, deviceTrustSetEpoch, deviceKeyEpoch, connectivity, lastPolicySyncAtUtc, remoteStalenessThresholdMillis } = input;

  if (!candidatePolicy) {
    return { state: ScheduleRuntimeState.NO_ACCEPTED_POLICY, effectivePolicy: null };
  }

  if (!isStructurallyValidPolicy(candidatePolicy)) {
    return { state: ScheduleRuntimeState.INVALID, effectivePolicy: lastKnownGoodPolicy ?? null };
  }

  if (isExpired(candidatePolicy, nowUtc)) {
    return { state: ScheduleRuntimeState.INVALID, effectivePolicy: lastKnownGoodPolicy ?? null };
  }

  if (isEpochBehind(candidatePolicy, deviceTrustSetEpoch, deviceKeyEpoch)) {
    return { state: ScheduleRuntimeState.EPOCH_STALE, effectivePolicy: lastKnownGoodPolicy ?? candidatePolicy };
  }

  if (connectivity === 'OFFLINE') {
    const staleByThreshold =
      lastPolicySyncAtUtc == null ||
      nowUtc.getTime() - lastPolicySyncAtUtc.getTime() > remoteStalenessThresholdMillis;
    if (staleByThreshold) {
      return { state: ScheduleRuntimeState.STALE_REMOTE, effectivePolicy: candidatePolicy };
    }
  }

  return { state: ScheduleRuntimeState.CURRENT, effectivePolicy: candidatePolicy };
}

/** Local defense-in-depth revision-monotonicity check; see SchedulePolicyV1.md "Revision acceptance". */
export function isAcceptableRevision(candidateRevision, previouslyAcceptedRevision) {
  return previouslyAcceptedRevision == null || candidateRevision > previouslyAcceptedRevision;
}
