import { appScopeIncludes, isWindowActive, validateAppScope, validateScheduleWindow } from './policy.js';
import { toZonedWallClock } from './timezone.js';
import type { ScheduleDecision, ScheduleDecisionKind, ScheduleEvaluationInput } from './types.js';
import { translate } from '../i18n/translate.js';
import type { SupportedLocale } from '../i18n/types.js';

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
/**
 * `locale` (default 'en', preserving every existing caller's behavior
 * unchanged) governs only `ScheduleDecision.reasonMessage` -- the localized,
 * presentation-ready explanation added for doc 20 PCA-FR-113. `reason`
 * itself is untouched: still the stable, English, machine-oriented
 * diagnostic string existing callers/tests key off.
 */
export function evaluateSchedule(input: ScheduleEvaluationInput, locale: SupportedLocale = 'en'): ScheduleDecision {
  const windows = Array.isArray(input.windows) ? input.windows : null;
  const configErrors = [
    ...(windows ? windows.flatMap(validateScheduleWindow) : ['schedule windows must be an array']),
    ...validateAppToken(input.appToken),
    ...validateEvaluationInstant(input.nowUtc),
    ...validateEvaluationTimezone(input.timezone),
    ...validateDailyLimit(input.dailyLimit),
    ...validateBonusGrants(input.bonusGrants),
    ...validateParentExceptions(input.exceptions),
    ...validateActiveBonusTotal(input),
  ];
  if (configErrors.length > 0) {
    return {
      decision: 'INVALID_CONFIG',
      reason: 'One or more schedule configuration values failed validation.',
      reasonMessage: translate('schedule.INVALID_CONFIG', locale),
      configErrors,
    };
  }

  const intended = evaluateIntendedDecision(input, locale);

  if (input.enforcementCapability !== 'ENFORCED' && isRestrictive(intended.decision)) {
    return {
      decision: 'ENFORCEMENT_UNAVAILABLE',
      reason: `Intended decision ${intended.decision} cannot be confirmed enforced (capability: ${input.enforcementCapability}).`,
      reasonMessage: translate('schedule.ENFORCEMENT_UNAVAILABLE', locale, { enforcementCapability: input.enforcementCapability }),
      intendedDecision: intended.decision,
      matchedWindowId: intended.matchedWindowId,
      matchedWindowIds: intended.matchedWindowIds,
    };
  }

  return intended;
}

function validateAppToken(value: unknown): string[] {
  return typeof value === 'string' && value.length > 0
    ? []
    : ['app token must be a non-empty string'];
}

function validateParentExceptions(exceptions: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(exceptions)) return ['parent exceptions must be an array'];
  for (const exception of exceptions) {
    errors.push(...validateAppScope(exception?.appScope, `parent exception ${exception?.id ?? '(unknown)'}`));
    const startAt = exception?.startAtUtc instanceof Date ? exception.startAtUtc.getTime() : Number.NaN;
    const endAt = exception?.endAtUtc instanceof Date ? exception.endAtUtc.getTime() : Number.NaN;
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      errors.push(`parent exception ${exception?.id ?? '(unknown)'} must have finite dates with end after start`);
    }
  }
  return errors;
}

function validateEvaluationInstant(value: unknown): string[] {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return ['evaluation time must be a finite in-range instant'];
  }
  return [];
}

function validateEvaluationTimezone(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return ['evaluation timezone must be a valid IANA timezone'];
  }
  try {
    // The policy timezone is consumed for daily-limit rollover even when no
    // recurring window uses it. Validate it before evaluation so an invalid
    // persisted zone cannot escape as a RangeError from the success path.
    toZonedWallClock(new Date('2000-01-01T00:00:00.000Z'), value);
    return [];
  } catch {
    return ['evaluation timezone must be a valid IANA timezone'];
  }
}

/**
 * A malformed usage counter or date anchor must not become an implicit daily
 * reset. Mobile policy receivers reject these shapes before accepting a
 * policy; keep the platform-neutral evaluator fail-closed as well because it
 * is also used directly by server-side callers and conformance vectors.
 */
function validateDailyLimit(dailyLimit: unknown): string[] {
  if (dailyLimit === undefined) return [];
  if (typeof dailyLimit !== 'object' || dailyLimit === null || Array.isArray(dailyLimit)) {
    return ['daily limit must be an object'];
  }
  const record = dailyLimit as Record<string, unknown>;
  const errors = validateAppScope(record.appScope, 'daily limit');
  if (!Number.isSafeInteger(record.limitMinutes) || (record.limitMinutes as number) < 0) {
    errors.push('daily limit limitMinutes must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(record.usedMinutesToday) || (record.usedMinutesToday as number) < 0) {
    errors.push('daily limit usedMinutesToday must be a non-negative safe integer');
  }
  if (!isCanonicalGregorianLocalDate(record.anchorLocalDate)) {
    errors.push('daily limit anchorLocalDate must be a canonical Gregorian date');
  }
  return errors;
}

function isCanonicalGregorianLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateBonusGrants(grants: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(grants)) return ['bonus grants must be an array'];
  for (const [index, grant] of grants.entries()) {
    if (typeof grant !== 'object' || grant === null || Array.isArray(grant)) {
      errors.push(`bonus grant at index ${index} must be an object`);
      continue;
    }
    errors.push(...validateAppScope(grant?.appScope, `bonus grant ${grant?.id ?? '(unknown)'}`));
    if (!Number.isSafeInteger(grant.extraMinutes) || grant.extraMinutes < 0) {
      errors.push(`bonus grant ${grant.id}: extraMinutes must be a non-negative safe integer`);
    }
    const grantedAt = grant.grantedAtUtc instanceof Date ? grant.grantedAtUtc.getTime() : Number.NaN;
    const expiresAt = grant.expiresAtUtc instanceof Date ? grant.expiresAtUtc.getTime() : Number.NaN;
    if (!Number.isFinite(grantedAt) || !Number.isFinite(expiresAt) || expiresAt <= grantedAt) {
      errors.push(`bonus grant ${grant.id}: grant and expiry must be valid increasing instants`);
    }
  }
  return errors;
}

/** Only grants that are active for this app and evaluation instant contribute
 * to the arithmetic. Check each addition before performing it so unrelated
 * or expired grants cannot reject an otherwise valid evaluation. */
function validateActiveBonusTotal(input: ScheduleEvaluationInput): string[] {
  if (!Array.isArray(input.bonusGrants)) return [];
  const dailyLimit = input.dailyLimit;
  if (!dailyLimit || !appScopeIncludes(dailyLimit.appScope, input.appToken)) return [];

  const nowMillis = input.nowUtc instanceof Date ? input.nowUtc.getTime() : Number.NaN;
  if (!Number.isFinite(nowMillis)) return [];

  let activeBonusMinutes = 0;
  for (const grant of input.bonusGrants) {
    if (typeof grant !== 'object' || grant === null || Array.isArray(grant)) continue;
    const grantedAtMillis = grant.grantedAtUtc instanceof Date ? grant.grantedAtUtc.getTime() : Number.NaN;
    const expiresAtMillis = grant.expiresAtUtc instanceof Date ? grant.expiresAtUtc.getTime() : Number.NaN;
    // validateBonusGrants reports malformed timestamps. Do not dereference
    // malformed runtime values here before evaluateSchedule can return that
    // fail-closed INVALID_CONFIG result.
    if (!Number.isFinite(grantedAtMillis) || !Number.isFinite(expiresAtMillis) ||
        !appScopeIncludes(grant.appScope, input.appToken) ||
        nowMillis < grantedAtMillis || nowMillis >= expiresAtMillis) continue;
    const nextTotal = activeBonusMinutes + grant.extraMinutes;
    if (!Number.isSafeInteger(nextTotal)) {
      return ['active bonus grants exceed the exact safe-integer range'];
    }
    activeBonusMinutes = nextTotal;
  }
  if (Number.isSafeInteger(dailyLimit.limitMinutes) && dailyLimit.limitMinutes >= 0 &&
      !Number.isSafeInteger(dailyLimit.limitMinutes + activeBonusMinutes)) {
    return ['daily limit with active bonus grants exceeds the exact safe-integer range'];
  }
  return [];
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

function evaluateIntendedDecision(input: ScheduleEvaluationInput, locale: SupportedLocale): ScheduleDecision {
  const { nowUtc, appToken, windows, bonusGrants, exceptions, dailyLimit } = input;

  const activeException = exceptions.find(
    (exception) =>
      appScopeIncludes(exception.appScope, appToken) &&
      nowUtc.getTime() >= exception.startAtUtc.getTime() &&
      nowUtc.getTime() < exception.endAtUtc.getTime(),
  );
  if (activeException) {
    return {
      decision: 'ALLOWED_EXCEPTION',
      reason: `Active parent exception ${activeException.id}.`,
      reasonMessage: translate('schedule.ALLOWED_EXCEPTION', locale),
    };
  }

  const activeWindows = windows.filter((window) => isWindowActive(window, nowUtc));

  const bedtime = activeWindows.find((window) => window.kind === 'BEDTIME' && appScopeIncludes(window.appScope, appToken));
  if (bedtime) {
    return {
      decision: 'BLOCKED_BEDTIME',
      reason: `Active bedtime window ${bedtime.id}.`,
      reasonMessage: translate('schedule.BLOCKED_BEDTIME', locale),
      matchedWindowId: bedtime.id,
    };
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
        reasonMessage: translate('schedule.BLOCKED_SCHOOL_MODE', locale, {
          windowCount: excludingWindows.length,
          totalWindowCount: activeSchoolModeWindows.length,
        }),
        matchedWindowId: excludingWindows[0],
        matchedWindowIds: excludingWindows,
      };
    }
  }

  const blockPeriod = activeWindows.find(
    (window) => window.kind === 'BLOCK_PERIOD' && appScopeIncludes(window.appScope, appToken),
  );
  if (blockPeriod) {
    return {
      decision: 'BLOCKED_PERIOD',
      reason: `Active block period ${blockPeriod.id}.`,
      reasonMessage: translate('schedule.BLOCKED_PERIOD', locale),
      matchedWindowId: blockPeriod.id,
    };
  }

  const allowPeriodsForApp = windows.filter(
    (window) => window.kind === 'ALLOW_PERIOD' && appScopeIncludes(window.appScope, appToken),
  );
  if (allowPeriodsForApp.length > 0) {
    const activeAllowPeriod = activeWindows.find(
      (window) => window.kind === 'ALLOW_PERIOD' && appScopeIncludes(window.appScope, appToken),
    );
    if (!activeAllowPeriod) {
      return {
        decision: 'BLOCKED_OUTSIDE_ALLOW_PERIOD',
        reason: 'No allow period currently covers this app.',
        reasonMessage: translate('schedule.BLOCKED_OUTSIDE_ALLOW_PERIOD', locale),
      };
    }
  }

  if (!dailyLimit || !appScopeIncludes(dailyLimit.appScope, appToken)) {
    return { decision: 'ALLOWED', reason: 'No daily limit configured.', reasonMessage: translate('schedule.ALLOWED', locale) };
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
      reasonMessage: translate('schedule.BLOCKED_LIMIT_REACHED', locale, { usedMinutes: usedMinutesToday, limitMinutes: effectiveLimit }),
      remainingMinutesToday: 0,
    };
  }

  return {
    decision: activeBonusMinutes > 0 ? 'ALLOWED_BONUS' : 'ALLOWED',
    reason: activeBonusMinutes > 0 ? `Allowed with ${activeBonusMinutes} active bonus minutes.` : 'Within daily limit.',
    reasonMessage:
      activeBonusMinutes > 0
        ? translate('schedule.ALLOWED_BONUS', locale, { bonusMinutes: activeBonusMinutes })
        : translate('schedule.ALLOWED', locale),
    remainingMinutesToday,
  };
}
