import { appScopeIncludes, isWindowActive, validateScheduleWindow } from './policy.js';
import { toZonedWallClock } from './timezone.js';
import type { ScheduleDecision, ScheduleDecisionKind, ScheduleEvaluationInput } from './types.js';

/**
 * Deterministic precedence, highest first (PCA-4 "policy precedence"):
 *   1. An active parent exception overrides everything, including bedtime
 *      and school mode (PCA-FR-043A: exceptions exist specifically to
 *      unlock a currently-locked window).
 *   2. Bedtime blocks unconditionally for its app scope.
 *   3. School mode allows an app only if EVERY simultaneously-active
 *      SCHOOL_MODE window's allow-scope includes it (intersection /
 *      most-restrictive-wins across overlapping school windows), blocking
 *      everything else. This is a deliberate policy derivation, not a doc
 *      quote: doc 03 FR-043/FR-043A describe school mode as a
 *      time-window-based override but do not specify how two
 *      simultaneously-active school windows with different allow scopes
 *      combine. Every other ambiguous-overlap case in this engine already
 *      resolves toward the more restrictive outcome (bedtime blocks
 *      unconditionally, enforcement-unavailable never silently allows,
 *      offline never relaxes control) -- intersection is the same
 *      philosophy applied to school mode, and it is commutative, so it is
 *      independent of the order windows appear in `input.windows`.
 *   4. An explicit block period blocks its app scope.
 *   5. An explicit allow period restricts its app scope to only inside
 *      that window (outside it, blocked).
 *   6. The daily minute limit, bonus-extended if an active grant applies.
 *   7. Default allow.
 *
 * Pure and offline-safe: it only ever reads the policy data handed to it
 * (already synced/cached on-device) and `nowUtc` -- it never fetches
 * anything, so identical inputs always produce identical output whether
 * the device is online or offline (PCA-4 "offline behavior": control is
 * never silently relaxed just because connectivity is lost).
 */
export function evaluateSchedule(input: ScheduleEvaluationInput): ScheduleDecision {
  const configErrors = input.windows.flatMap(validateScheduleWindow);
  if (configErrors.length > 0) {
    return { decision: 'INVALID_CONFIG', reason: 'One or more schedule windows failed validation.', configErrors };
  }

  const intended = evaluateIntendedDecision(input);

  if (input.enforcementCapability !== 'ENFORCED' && isRestrictive(intended.decision)) {
    return {
      decision: 'ENFORCEMENT_UNAVAILABLE',
      reason: `Intended decision ${intended.decision} cannot be confirmed enforced (capability: ${input.enforcementCapability}).`,
      intendedDecision: intended.decision,
      matchedWindowId: intended.matchedWindowId,
      matchedWindowIds: intended.matchedWindowIds,
    };
  }

  return intended;
}

function isRestrictive(decision: ScheduleDecisionKind): boolean {
  return (
    decision === 'BLOCKED_BEDTIME' ||
    decision === 'BLOCKED_SCHOOL_MODE' ||
    decision === 'BLOCKED_PERIOD' ||
    decision === 'BLOCKED_OUTSIDE_ALLOW_PERIOD' ||
    decision === 'BLOCKED_LIMIT_REACHED'
  );
}

function evaluateIntendedDecision(input: ScheduleEvaluationInput): ScheduleDecision {
  const { nowUtc, appToken, windows, bonusGrants, exceptions, dailyLimit } = input;

  const activeException = exceptions.find(
    (exception) =>
      appScopeIncludes(exception.appScope, appToken) &&
      nowUtc.getTime() >= exception.startAtUtc.getTime() &&
      nowUtc.getTime() < exception.endAtUtc.getTime(),
  );
  if (activeException) {
    return { decision: 'ALLOWED_EXCEPTION', reason: `Active parent exception ${activeException.id}.` };
  }

  const activeWindows = windows.filter((window) => isWindowActive(window, nowUtc));

  const bedtime = activeWindows.find((window) => window.kind === 'BEDTIME' && appScopeIncludes(window.appScope, appToken));
  if (bedtime) {
    return { decision: 'BLOCKED_BEDTIME', reason: `Active bedtime window ${bedtime.id}.`, matchedWindowId: bedtime.id };
  }

  const activeSchoolModeWindows = activeWindows.filter((window) => window.kind === 'SCHOOL_MODE');
  if (activeSchoolModeWindows.length > 0) {
    const excludingWindows = activeSchoolModeWindows
      .filter((window) => !appScopeIncludes(window.appScope, appToken))
      .map((window) => window.id)
      .sort();
    if (excludingWindows.length > 0) {
      return {
        decision: 'BLOCKED_SCHOOL_MODE',
        reason: `App is outside the allow-scope of ${excludingWindows.length} of ${activeSchoolModeWindows.length} active school-mode window(s) (intersection semantics): ${excludingWindows.join(', ')}.`,
        matchedWindowId: excludingWindows[0],
        matchedWindowIds: excludingWindows,
      };
    }
  }

  const blockPeriod = activeWindows.find(
    (window) => window.kind === 'BLOCK_PERIOD' && appScopeIncludes(window.appScope, appToken),
  );
  if (blockPeriod) {
    return { decision: 'BLOCKED_PERIOD', reason: `Active block period ${blockPeriod.id}.`, matchedWindowId: blockPeriod.id };
  }

  const allowPeriodsForApp = windows.filter(
    (window) => window.kind === 'ALLOW_PERIOD' && appScopeIncludes(window.appScope, appToken),
  );
  if (allowPeriodsForApp.length > 0) {
    const activeAllowPeriod = activeWindows.find(
      (window) => window.kind === 'ALLOW_PERIOD' && appScopeIncludes(window.appScope, appToken),
    );
    if (!activeAllowPeriod) {
      return { decision: 'BLOCKED_OUTSIDE_ALLOW_PERIOD', reason: 'No allow period currently covers this app.' };
    }
  }

  if (!dailyLimit) {
    return { decision: 'ALLOWED', reason: 'No daily limit configured.' };
  }

  const zoned = toZonedWallClock(nowUtc, input.timezone);
  const usedMinutesToday = dailyLimit.anchorLocalDate === zoned.localDate ? dailyLimit.usedMinutesToday : 0;

  const activeBonusMinutes = bonusGrants
    .filter(
      (grant) =>
        appScopeIncludes(grant.appScope, appToken) &&
        nowUtc.getTime() >= grant.grantedAtUtc.getTime() &&
        nowUtc.getTime() < grant.expiresAtUtc.getTime(),
    )
    .reduce((sum, grant) => sum + grant.extraMinutes, 0);

  const effectiveLimit = dailyLimit.limitMinutes + activeBonusMinutes;
  const remainingMinutesToday = effectiveLimit - usedMinutesToday;

  if (remainingMinutesToday <= 0) {
    return {
      decision: 'BLOCKED_LIMIT_REACHED',
      reason: `Used ${usedMinutesToday} of ${effectiveLimit} effective minutes today.`,
      remainingMinutesToday: 0,
    };
  }

  return {
    decision: activeBonusMinutes > 0 ? 'ALLOWED_BONUS' : 'ALLOWED',
    reason: activeBonusMinutes > 0 ? `Allowed with ${activeBonusMinutes} active bonus minutes.` : 'Within daily limit.',
    remainingMinutesToday,
  };
}
