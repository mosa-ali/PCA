// PCA-SCREEN-BASELINE-1: the single source of truth for the non-weakenable "60/30" anti-gaming
// baseline on the parent-web side.
//
// The Android runtime engine (see
// android/app/src/main/java/org/pca/app/feature/screentime/engine/ScreenTimeEngine.kt) enforces
// a maximum of 60 continuous "active" minutes before a mandatory 30-minute Break Shield recovery
// period. This module is the parent-web mirror of that non-negotiable floor: a parent MAY
// configure a STRICTER (safer) policy than 60/30 (e.g. 45/30, 30/45, 60/90), but MUST NEVER be
// able to configure a WEAKER one (e.g. 90/30, 60/15, 180/5) through any parent-web surface.
//
// This is intentionally the *only* place these bounds are declared in parent-web -- every UI
// control and every submission path must import from here rather than hardcoding its own
// min/max, so the rule can never drift out of sync between the input's `min`/`max` attributes
// and the real validation that runs on submit.

/**
 * Continuous-use ("60" side) bounds.
 *
 * `MAX` is the anti-gaming ceiling: a continuous-use limit above this defeats the 60/30 rule and
 * must never be configurable. `MIN` is *not* part of the baseline rule itself -- it is carried
 * over unchanged from the pre-existing supported range (this change only ever tightens the
 * ceiling, never raises the floor).
 */
export const CONTINUOUS_USE_LIMIT_MIN_MINUTES = 15;
export const CONTINUOUS_USE_LIMIT_MAX_MINUTES = 60;

/**
 * Break-duration ("30" side) bounds.
 *
 * `MIN` is the anti-gaming floor: a break shorter than this defeats the 60/30 rule and must
 * never be configurable. `MAX` is a documented, sane operational ceiling (2 hours) chosen so the
 * field stays bounded rather than accepting an unbounded number; it is not itself part of the
 * anti-gaming invariant (any value >= 30 satisfies that), it just keeps the input sane.
 */
export const BREAK_DURATION_MIN_MINUTES = 30;
export const BREAK_DURATION_MAX_MINUTES = 120;

export interface ScreenTimePolicyInput {
  continuousUseLimitMinutes: number;
  breakDurationMinutes: number;
}

export type ScreenTimePolicyValidationError =
  | 'CONTINUOUS_USE_LIMIT_NOT_A_NUMBER'
  | 'CONTINUOUS_USE_LIMIT_TOO_LOW'
  | 'CONTINUOUS_USE_LIMIT_TOO_HIGH'
  | 'BREAK_DURATION_NOT_A_NUMBER'
  | 'BREAK_DURATION_TOO_LOW'
  | 'BREAK_DURATION_TOO_HIGH';

export interface ScreenTimePolicyValidationResult {
  valid: boolean;
  errors: ScreenTimePolicyValidationError[];
}

/**
 * The real validator -- must be called on every submission path (component logic, never HTML
 * `min`/`max` alone, since those are trivially bypassable via devtools or a non-browser client).
 */
export function validateScreenTimePolicy(input: ScreenTimePolicyInput): ScreenTimePolicyValidationResult {
  const errors: ScreenTimePolicyValidationError[] = [];
  const { continuousUseLimitMinutes, breakDurationMinutes } = input;

  if (!Number.isFinite(continuousUseLimitMinutes)) {
    errors.push('CONTINUOUS_USE_LIMIT_NOT_A_NUMBER');
  } else if (continuousUseLimitMinutes < CONTINUOUS_USE_LIMIT_MIN_MINUTES) {
    errors.push('CONTINUOUS_USE_LIMIT_TOO_LOW');
  } else if (continuousUseLimitMinutes > CONTINUOUS_USE_LIMIT_MAX_MINUTES) {
    errors.push('CONTINUOUS_USE_LIMIT_TOO_HIGH');
  }

  if (!Number.isFinite(breakDurationMinutes)) {
    errors.push('BREAK_DURATION_NOT_A_NUMBER');
  } else if (breakDurationMinutes < BREAK_DURATION_MIN_MINUTES) {
    errors.push('BREAK_DURATION_TOO_LOW');
  } else if (breakDurationMinutes > BREAK_DURATION_MAX_MINUTES) {
    errors.push('BREAK_DURATION_TOO_HIGH');
  }

  return { valid: errors.length === 0, errors };
}

/** Convenience predicate for read-only/display contexts (e.g. flagging a legacy stored policy
 * that predates this rule) where the caller does not need the itemized error list. */
export function isBaselineCompliantScreenTimePolicy(input: ScreenTimePolicyInput): boolean {
  return validateScreenTimePolicy(input).valid;
}

/** Human-readable messages for the errors above, for direct display in a form. */
export function describeScreenTimePolicyError(error: ScreenTimePolicyValidationError): string {
  switch (error) {
    case 'CONTINUOUS_USE_LIMIT_NOT_A_NUMBER':
      return 'Continuous-use limit must be a number.';
    case 'CONTINUOUS_USE_LIMIT_TOO_LOW':
      return `Continuous-use limit must be at least ${CONTINUOUS_USE_LIMIT_MIN_MINUTES} minutes.`;
    case 'CONTINUOUS_USE_LIMIT_TOO_HIGH':
      return `Continuous-use limit cannot be set above ${CONTINUOUS_USE_LIMIT_MAX_MINUTES} minutes -- this would weaken the mandatory 60/30 anti-gaming baseline.`;
    case 'BREAK_DURATION_NOT_A_NUMBER':
      return 'Break duration must be a number.';
    case 'BREAK_DURATION_TOO_LOW':
      return `Break duration cannot be set below ${BREAK_DURATION_MIN_MINUTES} minutes -- this would weaken the mandatory 60/30 anti-gaming baseline.`;
    case 'BREAK_DURATION_TOO_HIGH':
      return `Break duration cannot be set above ${BREAK_DURATION_MAX_MINUTES} minutes.`;
  }
}
